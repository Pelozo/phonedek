import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, shell, systemPreferences, Tray } from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { ActionSchema, controlToActions, validateConfig } from '@phonedek/shared'
import type { Action, AssetKind, DeckConfig, PressResult } from '@phonedek/shared'
import { AssetStore } from './assets'
import { applyBackupImport, readBackupFile, writeBackupFile } from './backup'
import { ConfigStore } from './config-store'
import { DiscoveryService } from './discovery'
import { ActionExecutor } from './executor'
import { createHostActions } from './host-actions'
import { ControlInputRouter } from './control-input'
import { createKeySender, type KeySender } from './key-sender'
import { createLogger, type Logger } from './logger'
import { lanAddresses, primaryLanAddress, urlsForPort } from './lan'
import { keyboardHelperPath } from './platform'
import { createPairInfo } from './qr'
import { DeckServer, type PressContext } from './server'
import { SettingsStore } from './settings-store'
import { UpdateService } from './updater'
import { isRunningAppSigned, resolveUpdatePolicy } from './update-policy'
import { IPC } from '../shared/api'
import type {
  AppState,
  AssetPickResult,
  OperationResult,
  PairView,
  PermissionStatus,
  SaveConfigResult,
  ServerInfoView,
} from '../shared/api'

app.setName('PhoneDeck')

const APP_VERSION = '0.2.0'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let logger: Logger
let store: ConfigStore
let settings: SettingsStore
let assets: AssetStore
let server: DeckServer
let discovery: DiscoveryService
let keySender: KeySender
let executor: ActionExecutor
let inputRouter: ControlInputRouter | null = null
let updater: UpdateService
let serverError: string | null = null
let pairCache: { key: string; value: PairView } | null = null
let shuttingDown = false
let isQuitting = false
let bootstrapped = false

const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/**
 * macOS 27 renamed the Accessibility privacy pane to "Device Control and Data
 * Access". The TCC service and the deep link above are unchanged, so only the
 * user-facing label needs to follow the OS version.
 */
function macPrivacyPaneName(): string {
  const major = Number.parseInt(process.getSystemVersion().split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= 27 ? 'Device Control and Data Access' : 'Accessibility'
}

/**
 * The Swift input helper only calls `AXIsProcessTrusted()`, which never shows
 * the native permission prompt. Without this Electron call macOS never adds
 * PhoneDeck to the privacy list, so users cannot enable it at all. Passing
 * `prompt: true` shows the system alert and registers the app.
 */
function requestAccessibilityPermission(prompt: boolean): boolean {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt)
  } catch (error) {
    logger?.warn(`Could not request macOS accessibility permission: ${(error as Error).message}`)
    return false
  }
}

let lastPermissionGranted: boolean | null = null

async function buildPermissionStatus(): Promise<PermissionStatus> {
  const supported = process.platform === 'darwin'
  const granted = supported ? requestAccessibilityPermission(false) : true
  // A helper that started before the privacy switch was flipped can keep the
  // cached denial; respawn it when permission becomes available so the grant
  // takes effect without relaunching the app.
  if (supported && granted && lastPermissionGranted === false) {
    void keySender?.restart?.().catch(() => {
      // The next command retries starting the helper.
    })
  }
  lastPermissionGranted = supported ? granted : null
  return {
    platform: process.platform,
    supported,
    granted,
    paneName: macPrivacyPaneName(),
    appPath: supported ? (process.execPath ?? null) : null,
  }
}

function helperPath(): string {
  return keyboardHelperPath(process.platform, {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  })
}

async function openAccessibilitySettings(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Accessibility settings are only available on macOS')
  }
  await shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
}
async function showOpen(options: OpenDialogOptions) {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
}

async function showSave(options: SaveDialogOptions) {
  return mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options)
}

async function buildServerInfo(): Promise<ServerInfoView> {
  const currentSettings = settings.get()
  const config = store.get()
  const port = server?.port || currentSettings.port
  let pair: PairView | null = null
  try {
    const detected = lanAddresses().map((item) => item.address)
    const requestedHost = detected.includes(currentSettings.pairHost) ? currentSettings.pairHost : undefined
    const host = requestedHost ?? primaryLanAddress() ?? '127.0.0.1'
    const key = `${currentSettings.token}|${port}|${config.serverName}|${host}`
    if (pairCache?.key === key) {
      pair = pairCache.value
    } else {
      const info = await createPairInfo(currentSettings.token, port, config.serverName, requestedHost)
      pair = {
        host: info.host,
        port: info.port,
        name: info.name,
        uri: info.uri,
        qrDataUrl: info.qrDataUrl,
      }
      pairCache = { key, value: pair }
    }
  } catch (error) {
    logger?.warn(`Could not build pairing QR: ${(error as Error).message}`)
  }

  return {
    running: server?.running ?? false,
    port,
    urls: urlsForPort(port),
    lanAddresses: lanAddresses().map((item) => item.address),
    token: currentSettings.token,
    pair,
    discovery: discovery?.running ?? false,
    settings: {
      port: currentSettings.port,
      discovery: currentSettings.discovery,
      launchAtLogin: currentSettings.launchAtLogin,
      minimizeToTray: currentSettings.minimizeToTray,
      pairHost: currentSettings.pairHost,
      screenshotDirectory: currentSettings.screenshotDirectory,
    },
    clients: server?.getClients() ?? [],
    error: serverError,
    version: APP_VERSION,
    platform: process.platform,
    configPath: store.file,
    logPath: logger.logPath,
  }
}

async function buildState(): Promise<AppState> {
  return {
    config: store.get(),
    server: await buildServerInfo(),
    settings: {
      port: settings.get().port,
      discovery: settings.get().discovery,
      launchAtLogin: settings.get().launchAtLogin,
      minimizeToTray: settings.get().minimizeToTray,
      pairHost: settings.get().pairHost,
      screenshotDirectory: settings.get().screenshotDirectory,
    },
  }
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (bootstrapped) createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  updateTrayMenu()
}

function hideMainWindow(): void {
  mainWindow?.hide()
  updateTrayMenu()
}

function connectedPhoneLabel(): string {
  const clients = server?.getClients() ?? []
  if (clients.length === 0) return 'No phones connected'
  return `${clients.length} phone${clients.length === 1 ? '' : 's'} connected`
}

function updateTrayMenu(): void {
  if (!tray) return
  const visible = mainWindow?.isVisible() ?? false
  const template: MenuItemConstructorOptions[] = [
    { label: 'Show PhoneDeck', click: () => showMainWindow() },
  ]
  if (visible) template.push({ label: 'Hide', click: () => hideMainWindow() })
  template.push(
    {
      label: 'Pair phone',
      click: () => {
        showMainWindow()
        mainWindow?.webContents.send(IPC.openPairEvent)
      },
    },
    { type: 'separator' },
    { label: connectedPhoneLabel(), enabled: false },
    { type: 'separator' },
    {
      label: 'Quit PhoneDeck',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  )
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  if (tray) return
  const iconPath = trayIconPath()
  if (!existsSync(iconPath)) {
    logger?.warn(`Tray icon not found at ${iconPath}; continuing without a tray icon`)
    return
  }
  try {
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      logger?.warn(`Tray icon at ${iconPath} could not be decoded; continuing without a tray icon`)
      return
    }
    if (process.platform === 'darwin') image = image.resize({ width: 18, height: 18 })
    tray = new Tray(image)
    tray.setToolTip('PhoneDeck')
    tray.on('click', () => showMainWindow())
    updateTrayMenu()
  } catch (error) {
    logger?.warn(`Could not create the tray icon: ${(error as Error).message}`)
    tray = null
  }
}

async function pushServerInfo(): Promise<void> {
  updateTrayMenu()
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send(IPC.serverInfoEvent, await buildServerInfo())
  } catch (error) {
    logger.warn(`Could not push server info: ${(error as Error).message}`)
  }
}

function friendlyServerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/EADDRINUSE/i.test(message)) {
    return `Port ${settings.get().port} is already in use. Change the port in Settings or close the other program.`
  }
  if (/EACCES/i.test(message)) return 'Windows denied access to the network port. Try a different port.'
  return message
}

async function startServer(): Promise<void> {
  try {
    await server.start()
    serverError = null
  } catch (error) {
    serverError = friendlyServerError(error)
    logger.error(`Deck server failed: ${serverError}`)
  }
}

async function restartServer(port: number): Promise<OperationResult> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { ok: false, error: 'Choose a port between 1024 and 65535' }
  }
  const previous = settings.get().port
  await server.stop()
  settings.update({ port })
  pairCache = null
  await startServer()
  if (!server.running) {
    settings.update({ port: previous })
    await startServer()
    pairCache = null
    await pushServerInfo()
    return { ok: false, error: serverError ?? 'Could not start the server on that port', state: await buildState() }
  }
  await pushServerInfo()
  return { ok: true, state: await buildState() }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, async () => buildState())

  ipcMain.handle(IPC.saveConfig, async (_event, input: DeckConfig): Promise<SaveConfigResult> => {
    const validation = validateConfig(input)
    if (!validation.ok) return { ok: false, errors: validation.errors }
    try {
      const config = store.replace(validation.config)
      return { ok: true, config }
    } catch (error) {
      return { ok: false, errors: [(error as Error).message] }
    }
  })

  ipcMain.handle(IPC.importAsset, async (_event, requested?: unknown): Promise<AssetPickResult> => {
    if (requested !== undefined && requested !== 'image' && requested !== 'video') {
      return { ok: false, error: 'Asset kind must be "image" or "video"' }
    }
    const kind: AssetKind = requested ?? 'image'
    const video = kind === 'video'
    const result = await showOpen({
      title: video ? 'Choose a video for the background or icon' : 'Choose an image for the background or icon',
      properties: ['openFile'],
      filters: video
        ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov'] }]
        : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    const source = result.filePaths[0]
    if (result.canceled || !source) return { ok: false }
    try {
      return { ok: true, asset: assets.importFile(source, kind) }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC.pickApplication, async (): Promise<string | null> => {
    const result = await showOpen({
      title: 'Choose an application',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
              { name: 'All files', extensions: ['*'] },
            ]
          : [{ name: 'All files', extensions: ['*'] }],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.testActions, async (_event, input: Action[]): Promise<PressResult> => {
    const parsed = z.array(ActionSchema).max(32).safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }
    }
    return executor.execute(parsed.data, 'test action')
  })

  ipcMain.handle(
    IPC.testControlInput,
    async (
      _event,
      profileId: unknown,
      pageId: unknown,
      buttonId: unknown,
      delta: unknown,
      value: unknown,
    ): Promise<PressResult> => {
      if (typeof profileId !== 'string' || typeof pageId !== 'string' || typeof buttonId !== 'string') {
        return { ok: false, error: 'Invalid control test request' }
      }
      const config = store.get()
      const profile = config.profiles.find((item) => item.id === profileId)
      const page = profile?.pages.find((item) => item.id === pageId)
      const button = page?.buttons.find((item) => item.id === buttonId)
      if (!button?.control) return { ok: false, error: 'Control not found' }

      if (value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          return { ok: false, error: 'Test value must be between 0 and 1' }
        }
        if (button.control.emit !== 'value') {
          return { ok: false, error: 'This control does not use an absolute value' }
        }
        return executor.executeVolume(value * 100, `test ${button.label || 'control'}`)
      }

      if (typeof delta !== 'number' || !Number.isFinite(delta) || Math.abs(delta) > 100) {
        return { ok: false, error: 'Test delta must be between -100 and 100' }
      }
      const actions = controlToActions(button.control, delta)
      if (actions.length === 0) return { ok: false, error: 'This control has no action' }
      return executor.execute(actions, `test ${button.label || 'control'}`)
    },
  )

  ipcMain.handle(IPC.setPort, async (_event, port: number): Promise<OperationResult> => restartServer(port))

  ipcMain.handle(IPC.rotateToken, async (): Promise<OperationResult> => {
    const token = settings.rotateToken()
    server.setToken(token)
    pairCache = null
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(IPC.setDiscovery, async (_event, enabled: boolean): Promise<OperationResult> => {
    settings.update({ discovery: enabled })
    if (enabled) {
      const started = await discovery.start()
      if (!started) {
        await pushServerInfo()
        return { ok: false, error: 'Could not start discovery. UDP port 47655 may be in use.', state: await buildState() }
      }
    } else {
      discovery.stop()
    }
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(IPC.setPairHost, async (_event, host: string): Promise<OperationResult> => {
    const clean = typeof host === 'string' ? host.trim() : ''
    if (clean && !lanAddresses().some((item) => item.address === clean)) {
      return { ok: false, error: 'That address is not currently assigned to this PC', state: await buildState() }
    }
    settings.update({ pairHost: clean })
    pairCache = null
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(
    IPC.setPhoneBrightness,
    async (_event, clientId: unknown, level: unknown): Promise<OperationResult> => {
      if (typeof clientId !== 'string' || !clientId.trim()) {
        return { ok: false, error: 'Phone is not connected' }
      }
      const id = clientId.trim()
      if (
        !(
          level === null ||
          (typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1)
        )
      ) {
        return { ok: false, error: 'Brightness must be between 0 and 100%' }
      }
      if (!server) return { ok: false, error: 'Phone is not connected' }
      const result = server.setClientBrightness(id, level)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
  )

  ipcMain.handle(IPC.pickScreenshotDirectory, async (): Promise<string | null> => {
    const result = await showOpen({
      title: 'Choose a screenshot folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(
    IPC.setScreenshotDirectory,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'string') {
        return { ok: false, error: 'Screenshot folder must be a path' }
      }
      const clean = input.trim()
      if (clean.length > 4096) {
        return { ok: false, error: 'Screenshot folder path is too long' }
      }
      if (clean && !isAbsolute(clean)) {
        return { ok: false, error: 'Choose an absolute folder path' }
      }
      settings.update({ screenshotDirectory: clean })
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.setLaunchAtLogin, async (_event, enabled: boolean): Promise<OperationResult> => {
    settings.update({ launchAtLogin: enabled })
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        app.setLoginItemSettings({ openAtLogin: enabled })
      } catch (error) {
        logger.warn(`Could not update login item: ${(error as Error).message}`)
      }
    }
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(IPC.setMinimizeToTray, async (_event, enabled: unknown): Promise<OperationResult> => {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'Tray preference must be true or false', state: await buildState() }
    }
    settings.update({ minimizeToTray: enabled })
    updateTrayMenu()
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(IPC.exportConfig, async (): Promise<OperationResult> => {
    const result = await showSave({
      title: 'Export PhoneDeck backup',
      defaultPath: 'phonedek-backup.zip',
      filters: [{ name: 'PhoneDeck backup', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      const written = writeBackupFile(result.filePath, store.get(), assets.dir)
      for (const warning of written.warnings) logger.warn(warning)
      logger.info(`Exported backup with ${written.assets} assets (${written.bytes} bytes)`)
      return { ok: true, path: result.filePath }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC.importConfig, async (): Promise<SaveConfigResult> => {
    const result = await showOpen({
      title: 'Import PhoneDeck backup',
      properties: ['openFile'],
      filters: [
        { name: 'PhoneDeck backup', extensions: ['zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return { ok: false }
    try {
      const backup = readBackupFile(file)
      let importedAssets = 0
      for (const [name, data] of backup.assets) {
        if (assets.importBuffer(name, data)) importedAssets += 1
      }
      for (const warning of backup.warnings) logger.warn(warning)
      const config = store.replace(backup.config)
      logger.info(`Imported backup ${file} (${importedAssets} assets)`)
      mainWindow?.webContents.send(IPC.configChangedEvent, config)
      return { ok: true, config }
    } catch (error) {
      return { ok: false, errors: [(error as Error).message] }
    }
  })

  ipcMain.handle(IPC.openLogs, async (): Promise<void> => {
    if (logger.logPath && existsSync(logger.logPath)) await shell.openPath(logger.logPath)
    else await shell.openPath(app.getPath('userData'))
  })

  ipcMain.handle(IPC.openAccessibility, async (): Promise<void> => {
    await openAccessibilitySettings()
  })

  ipcMain.handle(IPC.getPermissionStatus, async (): Promise<PermissionStatus> => buildPermissionStatus())
  ipcMain.handle(IPC.requestPermission, async (): Promise<PermissionStatus> => {
    if (process.platform === 'darwin') requestAccessibilityPermission(true)
    return buildPermissionStatus()
  })
  /**
   * One action for the unsigned build path: open the privacy pane, then reveal
   * the exact executable in Finder so it can be dragged into the list. Opening
   * Finder last keeps the file visible instead of hiding it behind Settings.
   */
  ipcMain.handle(IPC.openPermissionSetup, async (): Promise<void> => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
    setTimeout(() => {
      if (existsSync(process.execPath)) shell.showItemInFolder(process.execPath)
    }, 700)
  })
  ipcMain.handle(IPC.revealPermissionFile, async (_event, kind: unknown): Promise<void> => {
    if (process.platform !== 'darwin') return
    const target = kind === 'app' ? process.execPath : kind === 'helper' ? helperPath() : null
    if (target && existsSync(target)) shell.showItemInFolder(target)
  })

  ipcMain.handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Invalid URL')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.copyText, async (_event, text: string): Promise<void> => {
    clipboard.writeText(String(text).slice(0, 20_000))
  })

  ipcMain.handle(IPC.getUpdateStatus, async () => updater.getStatus())
  ipcMain.handle(IPC.checkForUpdates, async () => updater.check())
  ipcMain.handle(IPC.installUpdate, async (): Promise<void> => updater.install())
}

/**
 * macOS needs a real application menu for standard editing shortcuts
 * (Cmd+C/V/X/A/Z), window management and Cmd+Q. A null menu removes them.
 */
function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          label: `Grant ${macPrivacyPaneName()} Permission…`,
          click: () => {
            requestAccessibilityPermission(true)
          },
        },
        {
          label: `Open ${macPrivacyPaneName()} Settings…`,
          click: () => {
            void openAccessibilitySettings().catch((error) => {
              logger.warn(`Could not open ${macPrivacyPaneName()} settings: ${(error as Error).message}`)
            })
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#070b14',
    show: false,
    title: 'PhoneDeck',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    updateTrayMenu()
  })
  mainWindow.on('show', () => updateTrayMenu())
  mainWindow.on('hide', () => updateTrayMenu())
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    // Only the tray preference changes close semantics. Minimizing (including
    // the OS minimize button) never hides the window.
    if (settings?.get().minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    updateTrayMenu()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  logger = createLogger(userData)
  logger.info(`PhoneDeck ${APP_VERSION} starting on ${process.platform} (${process.arch})`)
  logger.info(`Data directory: ${userData}`)

  store = new ConfigStore({ dir: userData, logger })
  if (store.getLastError()) logger.warn(`Config was repaired: ${store.getLastError()}`)
  settings = new SettingsStore(userData, logger)
  assets = new AssetStore(store.assetsDir, logger)

  keySender = createKeySender(helperPath(), process.platform, logger)
  const host = createHostActions({
    platform: process.platform,
    logger,
    openPath: async (path) => shell.openPath(path),
    openExternal: async (url) => shell.openExternal(url),
    getScreenshotDirectory: () => settings.get().screenshotDirectory || app.getPath('desktop'),
    ...(process.platform === 'win32'
      ? {
          setSystemVolume: async (level: number) => {
            if (!keySender.setVolume) throw new Error('The Windows keyboard helper does not support volume control.')
            await keySender.setVolume(level)
          },
        }
      : {}),
  })
  executor = new ActionExecutor(keySender, host, logger, {
    onScreenshot: (path) => {
      logger.info(`Screenshot saved to ${path}`)
      try {
        if (!Notification.isSupported()) return
        const notification = new Notification({
          title: 'PhoneDeck',
          body: `Screenshot saved to Desktop: ${basename(path)}`,
        })
        notification.on('click', () => shell.showItemInFolder(path))
        notification.show()
      } catch (error) {
        logger.warn(
          `Could not show screenshot notification: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  })
  const router = new ControlInputRouter({
    execute: (actions, label) => executor.execute(actions, label),
    applyAbsolute: (_control, value, label) => executor.executeVolume(value * 100, label),
    logger,
  })
  inputRouter = router

  server = new DeckServer({
    port: settings.get().port,
    token: settings.get().token,
    version: APP_VERSION,
    assets,
    getConfig: () => store.get(),
    getServerName: () => store.get().serverName,
    logger,
    onPress: async (_client, _message, context: PressContext) =>
      executor.execute(context.button.actions, context.button.label),
    onInput: async (_client, message, context) =>
      router.handle(message, { control: context.control, label: context.button.label }),
    importBackup: async (filePath, preview) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, error: 'No PhoneDeck window is available for approval.' }
      }

      const shownWarnings = preview.warnings.slice(0, 5)
      const detailLines = [
        `${preview.profiles} profile(s) · ${preview.pages} page(s) · ${preview.buttons} button(s)`,
        `${preview.assets} asset(s) · ${(preview.bytes / (1024 * 1024)).toFixed(1)} MB`,
      ]
      if (shownWarnings.length > 0) {
        detailLines.push(
          `Warnings:\n${shownWarnings.join('\n')}${
            preview.warnings.length > shownWarnings.length
              ? `\n…and ${preview.warnings.length - shownWarnings.length} more`
              : ''
          }`,
        )
      }
      if (preview.dangerousActions > 0) {
        detailLines.push(
          `${preview.dangerousActions} launch/command action(s) will run as your user.`,
        )
      }
      detailLines.push('A pre-import backup will be saved first.')

      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Replace deck', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Import deck from phone',
        message: `Replace this PC's deck with "${preview.serverName}"?`,
        detail: detailLines.join('\n\n'),
      })
      if (choice.response !== 0) {
        return { ok: false, error: 'Import cancelled on the PC.' }
      }

      try {
        const applied = applyBackupImport({
          filePath,
          currentConfig: store.get(),
          assetsDir: store.assetsDir,
          backupDir: join(app.getPath('userData'), 'backups'),
          importAsset: (name, data) => assets.importBuffer(name, data),
        })
        const config = store.replace(applied.config)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.configChangedEvent, config)
        }
        logger.info(
          `Imported phone backup (${applied.importedAssets} assets); pre-import backup ${applied.preImportPath}`,
        )
        if (applied.warnings.length > 0) {
          logger.warn(`Import warnings: ${applied.warnings.join('; ')}`)
        }
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: `Could not import deck: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
    onClientsChanged: () => {
      void pushServerInfo()
    },
  })

  discovery = new DiscoveryService({
    getPort: () => server.port || settings.get().port,
    getName: () => store.get().serverName,
    version: APP_VERSION,
    logger,
  })

  store.onChange(() => {
    server.broadcastConfig()
    pairCache = null
    void pushServerInfo()
  })

  await startServer()
  if (settings.get().discovery) await discovery.start()
  if ((process.platform === 'win32' || process.platform === 'darwin') && 'prewarm' in keySender) {
    void (keySender as unknown as { prewarm: () => Promise<void> }).prewarm()
  }

  registerIpc()
  installApplicationMenu()

  // Windows NSIS updates work unsigned. Squirrel.Mac requires a Developer ID
  // signed (and notarized) app, so only enable macOS updates when the running
  // executable actually carries that signature. Linux stays disabled.
  const developerIdSigned =
    app.isPackaged && process.platform === 'darwin' ? isRunningAppSigned(process.execPath) : false
  const updatePolicy = resolveUpdatePolicy({
    isPackaged: app.isPackaged,
    platform: process.platform,
    developerIdSigned,
  })
  logger.info(
    updatePolicy.enabled
      ? 'Auto-update policy: enabled'
      : `Auto-update policy: disabled (${updatePolicy.reason ?? 'unknown'})`,
  )
  updater = new UpdateService({
    enabled: updatePolicy.enabled,
    disabledReason: updatePolicy.reason ?? undefined,
    currentVersion: app.getVersion(),
    platform: process.platform,
    getWindow: () => mainWindow,
    logger,
  })
  updater.init()

  createWindow()
  createTray()
  bootstrapped = true
  updater.checkOnStartup()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      updateTrayMenu()
      return
    }
    if (bootstrapped) createWindow()
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.phonedek.desktop')
    try {
      await bootstrap()
    } catch (error) {
      logger?.error('Startup failed', error)
      dialog.showErrorBox('PhoneDeck could not start', error instanceof Error ? error.message : String(error))
      app.quit()
    }
  })

  app.on('activate', () => {
    if (bootstrapped && BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    // macOS convention: keep the app and the deck server alive in the dock
    // until the user explicitly chooses Quit (Cmd+Q).
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    isQuitting = true
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void (async () => {
      try {
        inputRouter?.dispose()
        keySender?.dispose?.()
        discovery?.stop()
        await server?.stop()
      } catch (error) {
        logger?.error('Shutdown failed', error)
      } finally {
        tray?.destroy()
        tray = null
        app.quit()
      }
    })()
  })
}
