import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  systemPreferences,
  Tray,
} from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { ActionSchema, controlToActions, lightControlDefaults, validateConfig } from '@phonedek/shared'
import type { Action, AssetKind, DeckConfig, LightBinding, PressResult } from '@phonedek/shared'
import { AssetStore } from './assets'
import { applyBackupImport, readBackupFile, writeBackupFile } from './backup'
import { ConfigStore } from './config-store'
import { DiscoveryService } from './discovery'
import { ActionExecutor } from './executor'
import { GameWatcher } from './game-watcher'
import { createHostActions } from './host-actions'
import { ControlInputRouter } from './control-input'
import { ControlStateService } from './control-state'
import { createKeySender, type KeySender } from './key-sender'
import { KeyboardRouter, keyboardInputAllowed } from './keyboard-input'
import { createKeyboardSender, type KeyboardSender } from './keyboard-sender'
import { createLogger, type Logger } from './logger'
import { lanAddresses, primaryLanAddress, urlsForPort } from './lan'
import { keyboardHelperPath } from './platform'
import { PointerRouter, pointerInputAllowed } from './pointer-input'
import {
  createPointerSender,
  pointerPlatformSupport,
  type PointerSender,
} from './pointer-sender'
import { createPairInfo } from './qr'
import { DeckServer, type PressContext } from './server'
import {
  MAX_AUTO_PROFILE_RULES,
  SettingsStore,
  sanitizeAutoProfileRules,
  sanitizeLightDevices,
  sanitizeObsHost,
  sanitizeObsPort,
  type AppSettings,
} from './settings-store'
import { UpdateService } from './updater'
import { isRunningAppSigned, resolveUpdatePolicy } from './update-policy'
import { createVolumeReader, HelperVolumeProbe, type VolumeReader } from './volume-source'
import { createMicrophone, parseWindowsInputPayload, type Microphone } from './microphone-source'
import {
  createMediaController,
  WindowsMediaProbe,
  type MediaController,
} from './media-source'
import { ObsClient } from './obs-client'
import { ObsStateSource, obsControlPercent } from './obs-source'
import { SecretStore } from './secret-store'
import { TwitchAuth, sanitizeTwitchClientId } from './twitch-auth'
import { TwitchClient } from './twitch-client'
import { TwitchStateSource } from './twitch-source'
import { LightStateSource } from './light-source'
import { IPC } from '../shared/api'
import type {
  AppState,
  AssetPickResult,
  AutoProfileSettingsInput,
  LightSettingsInput,
  LightStatusView,
  ObsInputsResult,
  ObsSettingsInput,
  ObsStatusView,
  OperationResult,
  PairView,
  PermissionStatus,
  SaveConfigResult,
  ServerInfoView,
  TwitchAuthStartResult,
  TwitchSettingsInput,
  TwitchStatusView,
} from '../shared/api'

app.setName('PhoneDeck')

const APP_VERSION = '0.2.3'

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
let controlState: ControlStateService | null = null
let volumeProbe: HelperVolumeProbe | null = null
let mediaProbe: WindowsMediaProbe | null = null
let mediaSource: MediaController | null = null
let microphone: Microphone | null = null
let obsClient: ObsClient | null = null
let obsSource: ObsStateSource | null = null
let twitchAuth: TwitchAuth | null = null
let twitchClient: TwitchClient | null = null
let twitchSource: TwitchStateSource | null = null
let lightSource: LightStateSource | null = null
let pointerSender: PointerSender | null = null
let pointerRouter: PointerRouter | null = null
let keyboardSender: KeyboardSender | null = null
let keyboardRouter: KeyboardRouter | null = null
let gameWatcher: GameWatcher | null = null
/** A native import/destructive dialog is waiting for a decision. */
let dialogOpen = false
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
      allowPointerControl: currentSettings.allowPointerControl,
      allowKeyboardControl: currentSettings.allowKeyboardControl,
      pairHost: currentSettings.pairHost,
      screenshotDirectory: currentSettings.screenshotDirectory,
      obsEnabled: currentSettings.obsEnabled,
      obsHost: currentSettings.obsHost,
      obsPort: currentSettings.obsPort,
      obsHasPassword: currentSettings.obsPassword.length > 0,
      twitchEnabled: currentSettings.twitchEnabled,
      twitchClientId: currentSettings.twitchClientId,
      twitchHasToken: twitchAuth?.hasToken === true,
      lightsEnabled: lightsActive(currentSettings),
      lights: currentSettings.lights.map((device) => ({ ...device })),
      autoProfileEnabled: currentSettings.autoProfileEnabled,
      autoProfileRules: currentSettings.autoProfileRules.map((rule) => ({ ...rule })),
    },
    clients: server?.getClients() ?? [],
    error: serverError,
    version: APP_VERSION,
    platform: process.platform,
    configPath: store.file,
    logPath: logger.logPath,
    obsStatus:
      obsClient?.status ?? {
        state: 'disabled',
        host: currentSettings.obsHost,
        port: currentSettings.obsPort,
      },
    twitchStatus: buildTwitchStatus(),
  }
}

/** Lights are advertised/read only when enabled and at least one device exists. */
function lightsActive(current: AppSettings): boolean {
  return current.lightsEnabled && current.lights.length > 0
}

/**
 * Map a normalized value-control value to a raw light value.
 * Power is semantic (on/off at 0.5); brightness/temperature honor the
 * control's configured min/max.
 */
function lightRawValue(binding: LightBinding, value: number, min?: number, max?: number): number {
  if (binding.target === 'power') return value >= 0.5 ? 100 : 0
  const defaults = lightControlDefaults(binding.target)
  const floor = typeof min === 'number' && Number.isFinite(min) ? min : defaults.min
  const ceiling = typeof max === 'number' && Number.isFinite(max) ? max : defaults.max
  return floor + Math.max(0, Math.min(1, value)) * (ceiling - floor)
}

function buildTwitchStatus(): TwitchStatusView {
  const status = twitchAuth?.status
  if (!status) {
    return { state: 'disabled', enabled: false, connected: false, scopes: [] }
  }
  return {
    state: status.state,
    enabled: status.enabled,
    connected: twitchAuth?.connected === true,
    scopes: [...status.scopes],
    ...(status.account ? { account: status.account } : {}),
    ...(status.login ? { login: status.login } : {}),
    ...(status.userId ? { userId: status.userId } : {}),
    ...(status.device ? { device: { ...status.device } } : {}),
    ...(status.expiresAt ? { expiresAt: status.expiresAt } : {}),
    ...(status.lastError ? { lastError: status.lastError } : {}),
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
      allowPointerControl: settings.get().allowPointerControl,
      allowKeyboardControl: settings.get().allowKeyboardControl,
      pairHost: settings.get().pairHost,
      screenshotDirectory: settings.get().screenshotDirectory,
      obsEnabled: settings.get().obsEnabled,
      obsHost: settings.get().obsHost,
      obsPort: settings.get().obsPort,
      obsHasPassword: settings.get().obsPassword.length > 0,
      twitchEnabled: settings.get().twitchEnabled,
      twitchClientId: settings.get().twitchClientId,
      twitchHasToken: twitchAuth?.hasToken === true,
      lightsEnabled: lightsActive(settings.get()),
      lights: settings.get().lights.map((device) => ({ ...device })),
      autoProfileEnabled: settings.get().autoProfileEnabled,
      autoProfileRules: settings.get().autoProfileRules.map((rule) => ({ ...rule })),
    },
  }
}

/** Recompute both input gates after the master switch or a native dialog changes. */
function applyInputGates(): void {
  pointerRouter?.setBlocked(!pointerInputAllowed(settings.get().allowPointerControl, dialogOpen))
  keyboardRouter?.setBlocked(!keyboardInputAllowed(settings.get().allowKeyboardControl, dialogOpen))
}

function setDialogOpen(open: boolean): void {
  dialogOpen = open
  applyInputGates()
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
        if (button.control.binding.type === 'mic') {
          return executor.executeInputGain(value * 100, `test ${button.label || 'control'}`)
        }
        if (button.control.binding.type === 'obs') {
          if (!obsSource) return { ok: false, error: 'OBS is not available on this desktop.' }
          const ceiling = button.control.max ?? 200
          const percent = obsControlPercent(value, ceiling)
          try {
            const input = await obsSource.setVolume(button.control.binding.input, percent)
            await controlState?.noteObsWritten(input, percent)
            return { ok: true }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        }
        if (button.control.binding.type === 'light') {
          if (!lightSource) return { ok: false, error: 'Local lights are not available on this desktop.' }
          const binding = button.control.binding
          try {
            await lightSource.setLevel(
              binding.light,
              binding.target,
              lightRawValue(binding, value, button.control.min, button.control.max),
            )
            await controlState?.noteLightWritten(binding.light)
            return { ok: true }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
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

  ipcMain.handle(IPC.getObsStatus, async (): Promise<ObsStatusView> => {
    if (obsClient) return obsClient.status
    const current = settings.get()
    return { state: 'disabled', host: current.obsHost, port: current.obsPort }
  })

  ipcMain.handle(
    IPC.setObsSettings,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, error: 'Invalid OBS settings', state: await buildState() }
      }
      const value = input as ObsSettingsInput
      const patch: Partial<AppSettings> = {}

      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean') {
          return { ok: false, error: 'OBS enable must be true or false', state: await buildState() }
        }
        patch.obsEnabled = value.enabled
      }
      if (value.host !== undefined) {
        if (typeof value.host !== 'string') {
          return { ok: false, error: 'OBS host must be text', state: await buildState() }
        }
        const clean = sanitizeObsHost(value.host)
        if (clean !== value.host.trim()) {
          return {
            ok: false,
            error: 'Enter localhost, an IP address or a hostname (no scheme or path).',
            state: await buildState(),
          }
        }
        patch.obsHost = clean
      }
      if (value.port !== undefined) {
        const port = sanitizeObsPort(value.port)
        if (port !== value.port) {
          return { ok: false, error: 'OBS port must be between 1 and 65535', state: await buildState() }
        }
        patch.obsPort = port
      }
      if (value.clearPassword === true) {
        patch.obsPassword = ''
      } else if (value.password !== undefined) {
        if (typeof value.password !== 'string') {
          return { ok: false, error: 'OBS password must be text', state: await buildState() }
        }
        if (value.password.length > 256) {
          return { ok: false, error: 'OBS password is too long', state: await buildState() }
        }
        if (value.password.length > 0) patch.obsPassword = value.password
      }

      const updated = settings.update(patch)
      obsClient?.configure({
        host: updated.obsHost,
        port: updated.obsPort,
        password: updated.obsPassword,
        enabled: updated.obsEnabled,
      })
      if (updated.obsEnabled) obsClient?.start()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.listObsInputs, async (): Promise<ObsInputsResult> => {
    if (!obsSource) return { ok: false, error: 'OBS is not available on this desktop.' }
    try {
      return { ok: true, inputs: await obsSource.listInputs(true) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    IPC.testObsInputVolume,
    async (_event, input: unknown, percent: unknown): Promise<PressResult> => {
      if (input !== undefined && typeof input !== 'string') {
        return { ok: false, error: 'OBS input name must be text' }
      }
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 2000) {
        return { ok: false, error: 'OBS volume must be between 0 and 2000%' }
      }
      if (!obsSource) return { ok: false, error: 'OBS is not available on this desktop.' }
      try {
        const resolved = await obsSource.setVolume(
          typeof input === 'string' ? input : undefined,
          percent,
        )
        await controlState?.noteObsWritten(resolved, percent)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.testObsMute, async (_event, input: unknown): Promise<PressResult> => {
    if (input !== undefined && typeof input !== 'string') {
      return { ok: false, error: 'OBS input name must be text' }
    }
    if (!obsSource) return { ok: false, error: 'OBS is not available on this desktop.' }
    try {
      const result = await obsSource.toggleMute(typeof input === 'string' ? input : undefined)
      await controlState?.noteObsChanged(result.input)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.getTwitchStatus, async (): Promise<TwitchStatusView> => buildTwitchStatus())

  ipcMain.handle(
    IPC.setTwitchSettings,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'object' || input === null) {
        return { ok: false, error: 'Twitch settings must be an object' }
      }
      const value = input as TwitchSettingsInput
      const patch: Partial<AppSettings> = {}
      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean') return { ok: false, error: 'Twitch enabled must be true or false' }
        patch.twitchEnabled = value.enabled
      }
      if (value.clientId !== undefined) {
        if (typeof value.clientId !== 'string') {
          return { ok: false, error: 'Twitch Client ID must be text' }
        }
        const trimmed = value.clientId.trim()
        const clean = sanitizeTwitchClientId(trimmed)
        if (trimmed.length > 0 && !clean) {
          return { ok: false, error: 'Twitch Client ID may only contain letters and digits' }
        }
        patch.twitchClientId = clean
      }
      const updated = settings.update(patch)
      if (!twitchAuth) return { ok: false, error: 'Twitch is not available on this desktop.' }
      twitchAuth.configure({
        clientId: updated.twitchClientId,
        enabled: updated.twitchEnabled,
      })
      if (updated.twitchEnabled) {
        void twitchAuth.start()
      } else {
        twitchAuth.cancelDeviceFlow()
      }
      await controlState?.noteTwitchChanged()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.startTwitchAuth, async (): Promise<TwitchAuthStartResult> => {
    if (!twitchAuth) return { ok: false, error: 'Twitch is not available on this desktop.' }
    if (!settings.get().twitchEnabled) {
      return { ok: false, error: 'Enable Twitch in Settings first.' }
    }
    try {
      const device = await twitchAuth.startDeviceFlow()
      await pushServerInfo()
      return { ok: true, device }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle(IPC.cancelTwitchAuth, async (): Promise<OperationResult> => {
    twitchAuth?.cancelDeviceFlow()
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(IPC.disconnectTwitch, async (): Promise<OperationResult> => {
    twitchAuth?.disconnect()
    await controlState?.noteTwitchChanged()
    await pushServerInfo()
    return { ok: true, state: await buildState() }
  })

  ipcMain.handle(
    IPC.setLightSettings,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, error: 'Light settings must be an object', state: await buildState() }
      }
      const value = input as LightSettingsInput
      const patch: Partial<AppSettings> = {}

      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean') {
          return { ok: false, error: 'Light enabled must be true or false', state: await buildState() }
        }
        patch.lightsEnabled = value.enabled
      }

      if (value.lights !== undefined) {
        if (!Array.isArray(value.lights)) {
          return { ok: false, error: 'Lights must be a list', state: await buildState() }
        }
        if (value.lights.length > 8) {
          return { ok: false, error: 'At most 8 lights can be configured', state: await buildState() }
        }
        const devices = sanitizeLightDevices(value.lights)
        if (devices.length !== value.lights.length) {
          return {
            ok: false,
            error:
              'Each light needs an Elgato type, a name and a bare hostname or IP address (no scheme or path).',
            state: await buildState(),
          }
        }
        patch.lights = devices
        if (value.enabled === undefined) patch.lightsEnabled = devices.length > 0
      }

      const updated = settings.update(patch)
      lightSource?.configure(updated.lights)
      await controlState?.noteLightChanged()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(
    IPC.setAutoProfileSettings,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, error: 'Invalid auto-profile settings', state: await buildState() }
      }
      const value = input as AutoProfileSettingsInput
      const patch: Partial<AppSettings> = {}

      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean') {
          return { ok: false, error: 'Auto-profile enabled must be true or false', state: await buildState() }
        }
        patch.autoProfileEnabled = value.enabled
      }

      if (value.rules !== undefined) {
        if (!Array.isArray(value.rules)) {
          return { ok: false, error: 'Auto-profile rules must be a list', state: await buildState() }
        }
        if (value.rules.length > MAX_AUTO_PROFILE_RULES) {
          return {
            ok: false,
            error: `At most ${MAX_AUTO_PROFILE_RULES} auto-profile rules can be configured`,
            state: await buildState(),
          }
        }
        const rules = sanitizeAutoProfileRules(value.rules)
        if (rules.length !== value.rules.length) {
          return {
            ok: false,
            error: 'Each rule needs an existing profile and a process name or executable path.',
            state: await buildState(),
          }
        }
        const profileIds = new Set(store.get().profiles.map((profile) => profile.id))
        if (rules.some((rule) => !profileIds.has(rule.profileId))) {
          return {
            ok: false,
            error: 'Each rule must use a profile that exists in this deck.',
            state: await buildState(),
          }
        }
        patch.autoProfileRules = rules
      }

      settings.update(patch)
      gameWatcher?.refresh()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.getLightStatuses, async (): Promise<LightStatusView[]> => {
    if (!lightSource) return []
    const statuses = await lightSource.listStatuses()
    return statuses.map((status) => ({
      id: status.id,
      name: status.name,
      host: status.host,
      port: status.port,
      available: status.available,
      ...(status.state?.on === undefined ? {} : { on: status.state.on }),
      ...(status.state?.brightness === undefined ? {} : { brightness: status.state.brightness }),
      ...(status.state?.temperature === undefined
        ? {}
        : { temperature: status.state.temperature }),
      ...(status.error ? { error: status.error } : {}),
    }))
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

  ipcMain.handle(
    IPC.setAllowPointerControl,
    async (_event, enabled: unknown): Promise<OperationResult> => {
      if (typeof enabled !== 'boolean') {
        return { ok: false, error: 'Pointer control must be true or false', state: await buildState() }
      }
      settings.update({ allowPointerControl: enabled })
      applyInputGates()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(
    IPC.setAllowKeyboardControl,
    async (_event, enabled: unknown): Promise<OperationResult> => {
      if (typeof enabled !== 'boolean') {
        return {
          ok: false,
          error: 'Keyboard control must be true or false',
          state: await buildState(),
        }
      }
      settings.update({ allowKeyboardControl: enabled })
      applyInputGates()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

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
  if (process.platform === 'win32') {
    volumeProbe = new HelperVolumeProbe(helperPath(), logger)
  }
  const windowsMic =
    process.platform === 'win32' && volumeProbe && keySender.setInputGain && keySender.setInputMute
      ? {
          read: async () => parseWindowsInputPayload(await volumeProbe!.readInput()),
          setGain: async (level: number) => keySender.setInputGain!(level),
          setMute: async (muted: boolean) => keySender.setInputMute!(muted),
        }
      : undefined
  microphone = createMicrophone(process.platform, windowsMic ? { windows: windowsMic } : {})
  if (process.platform === 'win32') {
    mediaProbe = new WindowsMediaProbe(logger)
    mediaSource = createMediaController('win32', { windowsBackend: mediaProbe })
  } else {
    mediaSource = createMediaController(process.platform)
  }
  obsClient = new ObsClient({
    host: settings.get().obsHost,
    port: settings.get().obsPort,
    password: settings.get().obsPassword,
    enabled: settings.get().obsEnabled,
    logger,
  })
  obsSource = new ObsStateSource(obsClient, { logger })
  obsSource.onChange((input) => {
    void controlState?.noteObsChanged(input)
  })
  obsClient.onStatus((status) => {
    if (status.state === 'connected') {
      logger.info(
        `OBS identified at ${status.host}:${status.port}` +
          `${status.obsVersion ? ` (OBS ${status.obsVersion})` : ''}`,
      )
    } else if (status.lastError && status.state !== 'reconnecting') {
      logger.warn(`OBS ${status.state}: ${status.lastError}`)
    }
    void pushServerInfo()
  })
  obsClient.configure({
    host: settings.get().obsHost,
    port: settings.get().obsPort,
    password: settings.get().obsPassword,
    enabled: settings.get().obsEnabled,
  })

  let secretStorage: typeof safeStorage | null = null
  try {
    if (safeStorage.isEncryptionAvailable()) secretStorage = safeStorage
  } catch (error) {
    logger.warn(`OS secret encryption is unavailable: ${(error as Error).message}`)
  }
  const secrets = new SecretStore({ dir: userData, safeStorage: secretStorage, logger })
  twitchAuth = new TwitchAuth({
    clientId: settings.get().twitchClientId,
    enabled: settings.get().twitchEnabled,
    store: secrets,
    logger,
  })
  twitchClient = new TwitchClient({ tokenProvider: twitchAuth, logger })
  twitchSource = new TwitchStateSource(twitchClient, twitchAuth, { logger })
  twitchAuth.onStatus((status) => {
    if (status.lastError && status.state !== 'authorizing') {
      logger.warn(`Twitch ${status.state}: ${status.lastError}`)
    } else if (status.state === 'authorized') {
      logger.info(`Twitch authorized${status.login ? ` as ${status.login}` : ''}`)
    }
    void controlState?.noteTwitchChanged()
    void pushServerInfo()
  })
  if (settings.get().twitchEnabled) void twitchAuth.start()

  lightSource = new LightStateSource({ logger })
  lightSource.configure(settings.get().lights)
  lightSource.onChange((lightId) => {
    void controlState?.noteLightWritten(lightId)
  })

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
    ...(microphone
      ? {
          setSystemInputGain: async (level: number) => {
            await microphone!.setGain(level)
            await controlState?.noteMicWritten(level)
          },
          toggleSystemInputMute: async () => {
            const reading = await microphone!.toggleMute()
            await controlState?.noteMicWritten(reading.level, reading.muted)
          },
        }
      : {}),
    toggleObsInputMute: async (input?: string) => {
      if (!obsSource) throw new Error('OBS is not available on this desktop.')
      const result = await obsSource.toggleMute(input)
      await controlState?.noteObsChanged(result.input)
    },
    runObsAction: async (step) => {
      if (!obsSource) throw new Error('OBS is not available on this desktop.')
      await obsSource.execute(step)
      await controlState?.noteObsChanged()
    },
    runTwitchAction: async (step) => {
      if (!twitchSource) throw new Error('Twitch is not available on this desktop.')
      await twitchSource.execute(step)
      await controlState?.noteTwitchChanged()
    },
    runLightAction: async (step) => {
      if (!lightSource) throw new Error('Local lights are not available on this desktop.')
      await lightSource.execute(step)
      await controlState?.noteLightWritten(step.light)
    },
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
  const volumeReader: VolumeReader | null =
    process.platform === 'win32'
      ? (volumeProbe
          ? createVolumeReader('win32', { windowsRead: () => volumeProbe!.read() })
          : null)
      : createVolumeReader(process.platform)
  controlState =
    volumeReader ||
    microphone ||
    mediaSource ||
    settings.get().obsEnabled ||
    settings.get().twitchEnabled ||
    lightsActive(settings.get())
      ? new ControlStateService({
          ...(volumeReader ? { reader: volumeReader } : {}),
          ...(microphone ? { micReader: microphone } : {}),
          ...(mediaSource ? { mediaReader: mediaSource } : {}),
          ...(obsSource ? { obsReader: obsSource } : {}),
          ...(twitchSource ? { twitchReader: twitchSource } : {}),
          ...(lightSource ? { lightReader: lightSource } : {}),
          logger,
        })
      : null
  if (controlState) {
    const sources = [
      volumeReader ? 'volume' : null,
      microphone ? 'microphone' : null,
      mediaSource ? 'media' : null,
      obsSource ? 'OBS' : null,
      twitchSource ? 'Twitch' : null,
      lightSource && lightsActive(settings.get()) ? 'lights' : null,
    ]
      .filter(Boolean)
      .join(' + ')
    logger.info(`Live control state enabled on ${process.platform} (${sources})`)
  } else {
    logger.info('Live control state disabled: no system volume, microphone or OBS reader on this host')
  }

  const router = new ControlInputRouter({
    execute: (actions, label) => executor.execute(actions, label),
    applyMedia: async (control, value, label) => {
      if (!mediaSource || control.binding.type !== 'media') {
        return { ok: false, error: 'Media seek is not available on this desktop.' }
      }
      try {
        const positionMs = await mediaSource.seekFraction(value)
        await controlState?.noteMediaChanged()
        logger.info(
          `Seeked media to ${positionMs} ms for "${label}"` +
            ` (${control.kind !== 'trackpad' && control.commit === 'end' ? 'commit end' : 'live'})`,
        )
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    applyAbsolute: async (control, value, label) => {
      if (control.binding.type === 'mic') {
        return executor.executeInputGain(value * 100, label)
      }
      if (control.binding.type === 'obs') {
        if (!obsSource) return { ok: false, error: 'OBS is not available on this desktop.' }
        const max = 'max' in control && typeof control.max === 'number' ? control.max : 200
        const percent = obsControlPercent(value, max)
        try {
          const input = await obsSource.setVolume(control.binding.input, percent)
          await controlState?.noteObsWritten(input, percent)
          logger.info(`Set OBS input "${input}" to ${Math.round(percent)}% for "${label}"`)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      if (control.binding.type === 'light') {
        if (!lightSource) return { ok: false, error: 'Local lights are not available on this desktop.' }
        const binding = control.binding
        const min = 'min' in control && typeof control.min === 'number' ? control.min : undefined
        const max = 'max' in control && typeof control.max === 'number' ? control.max : undefined
        try {
          const raw = lightRawValue(binding, value, min, max)
          await lightSource.setLevel(binding.light, binding.target, raw)
          await controlState?.noteLightWritten(binding.light)
          logger.info(`Set light "${binding.light ?? 'first'}" ${binding.target} to ${Math.round(raw)} for "${label}"`)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      const result = await executor.executeVolume(value * 100, label)
      if (result.ok) await controlState?.noteVolumeWritten(value * 100)
      return result
    },
    logger,
  })
  inputRouter = router

  pointerSender = createPointerSender(process.platform, helperPath(), logger)
  pointerRouter = pointerSender
    ? new PointerRouter({
        sender: pointerSender,
        logger,
      })
    : null
  if (pointerRouter) {
    logger.info(`Pointer control enabled on ${process.platform}`)
  } else {
    const support = pointerPlatformSupport()
    logger.info(`Pointer control disabled: ${support.reason ?? 'not supported on this host'}`)
  }

  keyboardSender = createKeyboardSender(process.platform, helperPath(), logger)
  keyboardRouter = keyboardSender
    ? new KeyboardRouter({
        sender: keyboardSender,
        logger,
      })
    : null
  if (keyboardRouter) {
    logger.info(`Keyboard control enabled on ${process.platform}`)
  }
  applyInputGates()

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
    onInput: async (client, message, context) =>
      router.handle(message, {
        control: context.control,
        label: context.button.label,
        clientId: client.id,
      }),
    pointerSupported: pointerRouter !== null,
    keyboardSupported: () =>
      keyboardRouter !== null && settings.get().allowKeyboardControl,
    controlState: controlState ?? undefined,
    controlStateSupported: controlState !== null,
    obsSupported: () => obsClient?.connected === true,
    twitchSupported: () => twitchSource?.connected === true,
    lightSupported: () => lightsActive(settings.get()),
    onPointer: async (client, message, context) => {
      if (!pointerRouter) {
        return {
          seq: message.seq,
          ok: false,
          error: 'Pointer control is not supported by this desktop.',
        }
      }
      return pointerRouter.handle(
        client.id,
        message,
        context ? { control: context.control, label: context.label } : undefined,
      )
    },
    onKeyboard: async (client, message, context) => {
      if (!keyboardRouter) {
        return {
          seq: message.seq,
          ok: false,
          error: 'Keyboard control is not supported by this desktop.',
        }
      }
      return keyboardRouter.handle(
        client.id,
        message,
        context ? { button: context.button, label: context.label } : undefined,
      )
    },
    onClientClosed: (client) => {
      pointerRouter?.clientDisconnected(client.id)
      keyboardRouter?.clientDisconnected(client.id)
      inputRouter?.clientDisconnected(client.id)
    },
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

      // The window may be hidden to the tray; surface it so the approval
      // dialog is not shown behind an invisible parent (or not shown at all).
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      logger.info(`Showing phone import approval dialog for "${preview.serverName}"`)
      setDialogOpen(true)
      const choice = await (async () => {
        try {
          return await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['Replace deck', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: 'Import deck from phone',
            message: `Replace this PC's deck with "${preview.serverName}"?`,
            detail: detailLines.join('\n\n'),
          })
        } finally {
          mainWindow.setAlwaysOnTop(false)
          setDialogOpen(false)
        }
      })()
      logger.info(`Phone import approval: ${choice.response === 0 ? 'approved' : 'cancelled'}`)
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

  // Helper failures arrive asynchronously; report them on the message's seq so
  // the phone can show TX ERR. Error strings never contain typed text.
  keyboardSender?.setErrorHandler?.((error, meta) => {
    if (!meta?.clientId || meta.seq === undefined) return
    server?.sendToClient(meta.clientId, {
      type: 'keyboardResult',
      seq: meta.seq,
      ok: false,
      error: error.message.slice(0, 240),
    })
  })

  gameWatcher = new GameWatcher({
    getSettings: () => ({
      enabled: settings.get().autoProfileEnabled,
      rules: settings.get().autoProfileRules,
    }),
    getProfileIds: () => store.get().profiles.map((profile) => profile.id),
    onSwitch: (profileId) => {
      server.broadcastProfile(profileId)
    },
    logger,
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
  gameWatcher.refresh()
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
        await inputRouter?.dispose()
        controlState?.dispose()
        twitchAuth?.dispose()
        obsSource?.dispose()
        obsClient?.dispose()
        lightSource?.dispose()
        volumeProbe?.dispose()
        mediaProbe?.dispose()
        pointerRouter?.dispose()
        pointerSender?.dispose()
        keyboardRouter?.dispose()
        keyboardSender?.dispose()
        gameWatcher?.dispose()
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
