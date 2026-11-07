import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ActionSchema, validateConfig } from '@phonedek/shared'
import type { Action, DeckConfig, PressResult } from '@phonedek/shared'
import { AssetStore } from './assets'
import { readBackupFile, writeBackupFile } from './backup'
import { ConfigStore } from './config-store'
import { DiscoveryService } from './discovery'
import { ActionExecutor } from './executor'
import { createHostActions } from './host-actions'
import { createKeySender, type KeySender } from './key-sender'
import { createLogger, type Logger } from './logger'
import { lanAddresses, primaryLanAddress, urlsForPort } from './lan'
import { createPairInfo } from './qr'
import { DeckServer, type PressContext } from './server'
import { SettingsStore } from './settings-store'
import { IPC } from '../shared/api'
import type {
  AppState,
  AssetPickResult,
  OperationResult,
  PairView,
  SaveConfigResult,
  ServerInfoView,
} from '../shared/api'

app.setName('PhoneDeck')

const APP_VERSION = '0.1.2'

let mainWindow: BrowserWindow | null = null
let logger: Logger
let store: ConfigStore
let settings: SettingsStore
let assets: AssetStore
let server: DeckServer
let discovery: DiscoveryService
let keySender: KeySender
let executor: ActionExecutor
let serverError: string | null = null
let pairCache: { key: string; value: PairView } | null = null
let shuttingDown = false

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'keyboard-helper.ps1')
    : join(app.getAppPath(), 'resources', 'keyboard-helper.ps1')
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
      pairHost: currentSettings.pairHost,
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
      pairHost: settings.get().pairHost,
    },
  }
}

async function pushServerInfo(): Promise<void> {
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

  ipcMain.handle(IPC.importAsset, async (): Promise<AssetPickResult> => {
    const result = await showOpen({
      title: 'Choose a button background',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    const source = result.filePaths[0]
    if (result.canceled || !source) return { ok: false }
    try {
      return { ok: true, asset: assets.importFile(source) }
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

  ipcMain.handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Invalid URL')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.copyText, async (_event, text: string): Promise<void> => {
    clipboard.writeText(String(text).slice(0, 20_000))
  })
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
  })
  mainWindow.on('closed', () => {
    mainWindow = null
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
  })
  executor = new ActionExecutor(keySender, host, logger)

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
  if (process.platform === 'win32' && 'prewarm' in keySender) {
    void (keySender as unknown as { prewarm: () => Promise<void> }).prewarm()
  }

  registerIpc()
  Menu.setApplicationMenu(null)
  createWindow()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void (async () => {
      try {
        keySender?.dispose?.()
        discovery?.stop()
        await server?.stop()
      } catch (error) {
        logger?.error('Shutdown failed', error)
      } finally {
        app.quit()
      }
    })()
  })
}
