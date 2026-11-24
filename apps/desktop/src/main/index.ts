import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
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
import { existsSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  ActionSchema,
  controlToActions,
  HUE_DEFAULT_PORT,
  lightControlDefaults,
  normalizeProfileId,
  rigActionOf,
  rigById,
  RIG_CAPABILITY,
  validateConfig,
} from '@phonedek/shared'
import type {
  Action,
  AssetKind,
  DeckConfig,
  LightBinding,
  MixerSnapshot,
  PressResult,
  RigPreset,
  RigProgressMessage,
} from '@phonedek/shared'
import { AssetStore } from './assets'
import { applyBackupImport, readBackupFile, writeBackupFile } from './backup'
import { ConfigStore } from './config-store'
import { DiscoveryService } from './discovery'
import { ActionExecutor } from './executor'
import { GameWatcher, createProcessProvider, type ProcessProvider } from './game-watcher'
import { createHostActions } from './host-actions'
import { ControlInputRouter } from './control-input'
import { ControlStateService } from './control-state'
import { createKeySender, type KeySender } from './key-sender'
import { KeyboardRouter, keyboardInputAllowed } from './keyboard-input'
import { createKeyboardSender, type KeyboardSender } from './keyboard-sender'
import { createLogger, type Logger } from './logger'
import { lanAddresses, primaryLanAddress, urlsForPort } from './lan'
import { legacyConfigJson } from './legacy-export'
import { audioDeviceHelperPath, keyboardHelperPath } from './platform'
import { InputCapture } from './input-capture'
import { PointerRouter, pointerInputAllowed } from './pointer-input'
import { RigRunner } from './rig-runner'
import type { RigPreview, RigRunResult } from './rig-runner'
import { RuleService } from './rule-service'
import type { EventRulesView, RuleFireView, RulePreviewView } from '../shared/api'
import type { RigGuardProbes } from './rig-guards'
import {
  createPointerSender,
  pointerPlatformSupport,
  type PointerSender,
} from './pointer-sender'
import { createPairInfo } from './qr'
import { AudioDeviceService, DeckServer, type PressContext } from './server'
import {
  MAX_AUTO_PROFILE_RULES,
  MAX_LIGHT_DEVICES,
  SettingsStore,
  disarmAutomationAfterImport,
  sanitizeAutoProfileRevertProfileId,
  sanitizeAutoProfileRules,
  sanitizeLastSeenVersion,
  sanitizeLightDevices,
  sanitizeLightHost,
  sanitizeLightPort,
  sanitizeLightTarget,
  sanitizeObsHost,
  sanitizeObsPort,
  sanitizeStreamerBotHost,
  sanitizeStreamerBotPort,
  normalizeProcessName,
  type AppSettings,
  type LightDeviceSettings,
} from './settings-store'
import { UpdateService } from './updater'
import { isRunningAppSigned, resolveUpdatePolicy } from './update-policy'
import { createVolumeReader, HelperVolumeProbe, type VolumeReader } from './volume-source'
import { createMicrophone, parseWindowsInputPayload, type Microphone } from './microphone-source'
import {
  audioDeviceUnsupportedReason,
  createAudioDeviceController,
  sanitizeAudioDeviceError,
  type AudioDeviceController,
} from './audio-device-source'
import {
  createAppVolumeSource,
  type AppVolumeSource,
} from './app-volume-source'
import { MixerService } from './mixer-service'
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
import {
  StreamerBotClient,
  normalizeDoAction,
  type StreamerBotStatus,
} from './streamerbot-client'
import { LightStateSource, type LightDeviceStatus } from './light-source'
import { LightCredentialStore, isValidLightCredential } from './light-credentials'
import { HueClient, discoverHueBridges, pairHueBridge, type HueLightInfo } from './hue-client'
import { IPC, parseAudioDeviceSetInput } from '../shared/api'
import type {
  AppState,
  AssetPickResult,
  AudioDevicesResult,
  AudioDeviceView,
  AutoProfileSettingsInput,
  HueDiscoveryResult,
  HueLightResult,
  HueLightView,
  HuePairInput,
  HuePairResult,
  LightDeviceView,
  LightSettingsInput,
  LightStatusView,
  MacroCaptureStartInput,
  MacroCaptureStartResult,
  MacroCaptureSupportView,
  ObsInputsResult,
  ObsSettingsInput,
  ObsStatusView,
  OperationResult,
  PairView,
  PermissionStatus,
  RigGuardView,
  RigPreviewView,
  RigRunView,
  RigStatusView,
  SaveConfigResult,
  ServerInfoView,
  StreamerBotActionsResult,
  StreamerBotSettingsInput,
  TwitchAuthStartResult,
  TwitchSettingsInput,
  TwitchStatusView,
} from '../shared/api'

app.setName('PhoneDeck')

// Read the packaged/dev package version instead of a hand-maintained constant;
// update checks already use app.getVersion(), and the What's New flow must agree.
const APP_VERSION = app.getVersion()

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
let rigRunner: RigRunner | null = null
let inputRouter: ControlInputRouter | null = null
let controlState: ControlStateService | null = null
let volumeProbe: HelperVolumeProbe | null = null
let mediaProbe: WindowsMediaProbe | null = null
let mediaSource: MediaController | null = null
let microphone: Microphone | null = null
let appVolumeSource: AppVolumeSource | null = null
let audioDevices: AudioDeviceController | null = null
let audioDeviceService: AudioDeviceService | null = null
let mixer: MixerService | null = null
let obsClient: ObsClient | null = null
let obsSource: ObsStateSource | null = null
let twitchAuth: TwitchAuth | null = null
let twitchClient: TwitchClient | null = null
let twitchSource: TwitchStateSource | null = null
let streamerbotClient: StreamerBotClient | null = null
let secretStore: SecretStore | null = null
let lightSource: LightStateSource | null = null
let lightCredentials: LightCredentialStore | null = null
let pointerSender: PointerSender | null = null
let pointerRouter: PointerRouter | null = null
let keyboardSender: KeyboardSender | null = null
let keyboardRouter: KeyboardRouter | null = null
let gameWatcher: GameWatcher | null = null
let ruleService: RuleService | null = null
let macroCapture: InputCapture | null = null
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

function audioHelperPath(): string {
  return audioDeviceHelperPath(process.platform, {
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
      lastSeenVersion: currentSettings.lastSeenVersion,
      obsEnabled: currentSettings.obsEnabled,
      obsHost: currentSettings.obsHost,
      obsPort: currentSettings.obsPort,
      obsHasPassword: currentSettings.obsPassword.length > 0,
      twitchEnabled: currentSettings.twitchEnabled,
      twitchClientId: currentSettings.twitchClientId,
      twitchHasToken: twitchAuth?.hasToken === true,
      streamerbotEnabled: currentSettings.streamerbotEnabled,
      streamerbotHost: currentSettings.streamerbotHost,
      streamerbotPort: currentSettings.streamerbotPort,
      streamerbotHasPassword: secretStore?.has('streamerbot.password') === true,
      lightsEnabled: lightsActive(currentSettings),
      lights: lightDeviceViews(currentSettings.lights),
      autoProfileEnabled: currentSettings.autoProfileEnabled,
      autoProfileRules: currentSettings.autoProfileRules.map((rule) => ({ ...rule })),
      autoProfileRevertEnabled: currentSettings.autoProfileRevertEnabled,
      autoProfileRevertProfileId: currentSettings.autoProfileRevertProfileId ?? '',
      automationEnabled: currentSettings.automationEnabled,
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
    streamerbotStatus: buildStreamerbotStatus(),
  }
}

/** Lights are advertised/read only when enabled and at least one device exists. */
function lightsActive(current: AppSettings): boolean {
  return current.lightsEnabled && current.lights.length > 0
}

/**
 * Renderer-safe device list. Credentials only appear as a boolean; the Hue
 * application key and Nanoleaf token never leave the main process.
 */
function lightDeviceViews(devices: readonly LightDeviceSettings[]): LightDeviceView[] {
  return devices.map((device) => {
    const stored = lightCredentials?.get(device.id)
    const hasCredential =
      device.type === 'hue'
        ? Boolean(stored?.username)
        : device.type === 'nanoleaf'
          ? Boolean(stored?.token)
          : false
    return {
      id: device.id,
      name: device.name,
      type: device.type,
      host: device.host,
      port: device.port,
      ...(device.lightId ? { lightId: device.lightId } : {}),
      hasCredential,
    }
  })
}

function hueLightViews(lights: readonly HueLightInfo[]): HueLightView[] {
  return lights.map((light) => ({
    id: light.id,
    name: light.name,
    on: light.state.on,
    brightness: light.state.brightness,
    temperature: light.state.temperature,
  }))
}

function lightStatusView(status: LightDeviceStatus): LightStatusView {
  return {
    id: status.id,
    name: status.name,
    type: status.type,
    host: status.host,
    port: status.port,
    ...(status.lightId ? { lightId: status.lightId } : {}),
    available: status.available,
    ...(status.state?.on === undefined ? {} : { on: status.state.on }),
    ...(status.state?.brightness === undefined ? {} : { brightness: status.state.brightness }),
    ...(status.state?.temperature === undefined ? {} : { temperature: status.state.temperature }),
    ...(status.error ? { error: status.error } : {}),
  }
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

function buildStreamerbotStatus(): StreamerBotStatus {
  const current = settings.get()
  return (
    streamerbotClient?.status ?? {
      state: 'disabled',
      host: current.streamerbotHost,
      port: current.streamerbotPort,
    }
  )
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
      lastSeenVersion: settings.get().lastSeenVersion,
      obsEnabled: settings.get().obsEnabled,
      obsHost: settings.get().obsHost,
      obsPort: settings.get().obsPort,
      obsHasPassword: settings.get().obsPassword.length > 0,
      twitchEnabled: settings.get().twitchEnabled,
      twitchClientId: settings.get().twitchClientId,
      twitchHasToken: twitchAuth?.hasToken === true,
      streamerbotEnabled: settings.get().streamerbotEnabled,
      streamerbotHost: settings.get().streamerbotHost,
      streamerbotPort: settings.get().streamerbotPort,
      streamerbotHasPassword: secretStore?.has('streamerbot.password') === true,
      lightsEnabled: lightsActive(settings.get()),
      lights: lightDeviceViews(settings.get().lights),
      autoProfileEnabled: settings.get().autoProfileEnabled,
      autoProfileRules: settings.get().autoProfileRules.map((rule) => ({ ...rule })),
      autoProfileRevertEnabled: settings.get().autoProfileRevertEnabled,
      autoProfileRevertProfileId: settings.get().autoProfileRevertProfileId ?? '',
      automationEnabled: settings.get().automationEnabled,
    },
  }
}

/**
 * Drop a return target whose profile was deleted. Run at startup and whenever
 * the deck config changes; the watcher also ignores a stale id defensively.
 */
function pruneAutoProfileRevertProfile(): void {
  const profileId = settings.get().autoProfileRevertProfileId
  if (!profileId) return
  if (store.get().profiles.some((profile) => profile.id === profileId)) return
  settings.update({ autoProfileRevertProfileId: undefined })
  gameWatcher?.refresh()
  logger?.info(`Auto-profile: cleared return profile "${profileId}" because it was deleted`)
}

/** Recompute both input gates after the master switch or a native dialog changes. */
function applyInputGates(): void {
  pointerRouter?.setBlocked(!pointerInputAllowed(settings.get().allowPointerControl, dialogOpen))
  keyboardRouter?.setBlocked(!keyboardInputAllowed(settings.get().allowKeyboardControl, dialogOpen))
}

/** Guard-triggered process scans share one snapshot for this long. */
const RIG_PROCESS_SNAPSHOT_TTL_MS = 2_000
let rigProcessProvider: ProcessProvider | null = null
let rigProcessSnapshot: { at: number; names: Set<string> } | null = null
let rigProcessSnapshotInFlight: Promise<Set<string>> | null = null

/**
 * Normalized process names for rig `appRunning` guards.
 *
 * Uses the same tasklist/ps snapshot helper and `normalizeProcessName` as the
 * auto-profile watcher, with a 2 s TTL (and single-flight) so several guards in
 * one rig cost one scan. A scan failure rejects: the guard then fails closed.
 */
async function rigRunningProcesses(): Promise<Set<string>> {
  const now = Date.now()
  if (rigProcessSnapshot && now - rigProcessSnapshot.at < RIG_PROCESS_SNAPSHOT_TTL_MS) {
    return rigProcessSnapshot.names
  }
  if (rigProcessSnapshotInFlight) return rigProcessSnapshotInFlight

  rigProcessProvider ??= createProcessProvider(process.platform)
  const pending = rigProcessProvider
    .list()
    .then((names) => {
      const normalized = new Set<string>()
      for (const name of names) {
        const value = normalizeProcessName(name)
        if (value) normalized.add(value)
      }
      rigProcessSnapshot = { at: Date.now(), names: normalized }
      return normalized
    })
    .finally(() => {
      rigProcessSnapshotInFlight = null
    })
  rigProcessSnapshotInFlight = pending
  return pending
}

/**
 * Rig guard probes wired to the integrations this desktop actually has.
 *
 * A source that was never constructed omits its probe, so the guard reports
 * "unavailable" and blocks the rig (fail closed). A constructed source that is
 * disabled/offline throws from `readStatus`, which fails closed the same way.
 */
function createRigGuardProbes(): RigGuardProbes {
  const probes: RigGuardProbes = {}
  const obs = obsSource
  if (obs) {
    probes.obsStreaming = async () => (await obs.readStatus('streaming')).active === true
    probes.obsRecording = async () => (await obs.readStatus('recording')).active === true
  }
  const twitch = twitchSource
  if (twitch) {
    probes.twitchLive = async () => (await twitch.readStatus('live')).active === true
  }
  const mic = microphone
  if (mic) {
    probes.micMuted = async () => (await mic.read()).muted === true
  }
  const lights = lightSource
  if (lights) {
    probes.lightOn = async (lightId?: string) =>
      (await lights.readStatus(lightId, 'power')).active === true
  }
  probes.appRunning = async (arg: string) => {
    const name = normalizeProcessName(arg)
    if (!name) throw new Error(`"${arg}" is not a process name`)
    return (await rigRunningProcesses()).has(name)
  }
  return probes
}

/** Copy guard results into the renderer-safe API shape. */
function rigGuardViews(guards: readonly RigGuardView[]): RigGuardView[] {
  return guards.map((guard) => ({
    probe: guard.probe,
    label: guard.label,
    expect: guard.expect,
    actual: guard.actual,
    ok: guard.ok,
    available: guard.available,
    ...(guard.error !== undefined ? { error: guard.error } : {}),
  }))
}

function rigPreviewView(preview: RigPreview): RigPreviewView {
  return {
    presetId: preview.presetId,
    name: preview.name,
    ok: preview.ok,
    total: preview.total,
    estimatedMs: preview.estimatedMs,
    guards: rigGuardViews(preview.guards),
    blocked: rigGuardViews(preview.blocked),
    ...(preview.error !== undefined ? { error: preview.error } : {}),
  }
}

function rigRunView(result: RigRunResult): RigRunView {
  return {
    presetId: result.presetId,
    name: result.name,
    status: result.status,
    ok: result.ok,
    completed: result.completed,
    total: result.total,
    durationMs: result.durationMs,
    at: result.at,
    failures: result.failures.map((failure) => ({ ...failure })),
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    ...(result.guards !== undefined ? { guards: rigGuardViews(result.guards) } : {}),
    ...(result.active !== undefined ? { active: { ...result.active } } : {}),
  }
}

/** Resolve a validated rig id against the current config. */
function configuredRig(presetId: unknown): RigPreset | undefined {
  const id = normalizeProfileId(presetId)
  return id ? rigById(store.get().rigs, id) : undefined
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

/** Lazily create the global capture service (never loads the native module at startup). */
function captureService(): InputCapture {
  if (!macroCapture) {
    macroCapture = new InputCapture({
      shortcut: globalShortcut,
      isSelfFocused: () =>
        BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused()),
      accessibilityGranted: () =>
        process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false),
      send: (channel, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
      },
      notify: (title, body) => {
        try {
          if (!Notification.isSupported()) return
          new Notification({ title, body }).show()
        } catch {
          // Notifications are optional (Linux without a server, macOS denial).
        }
      },
      logger,
    })
  }
  return macroCapture
}

function captureInputOf(value: unknown): MacroCaptureStartInput {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    captureMouse: typeof raw['captureMouse'] === 'boolean' ? raw['captureMouse'] : undefined,
    captureMouseMove: typeof raw['captureMouseMove'] === 'boolean' ? raw['captureMouseMove'] : undefined,
    ignoreSelf: typeof raw['ignoreSelf'] === 'boolean' ? raw['ignoreSelf'] : undefined,
  }
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
        if (button.control.binding.type === 'appVolume') {
          if (!appVolumeSource) return { ok: false, error: 'Per-app volume is not available on this desktop.' }
          const level = value * 100
          try {
            await appVolumeSource.setVolume(button.control.binding.match, level)
            await controlState?.noteAppVolumeWritten(button.control.binding.match, level)
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
    IPC.getObsInputLevel,
    async (_event, input: unknown): Promise<{ level: number; muted: boolean } | null> => {
      if (input !== undefined && typeof input !== 'string') return null
      if (!obsSource) return null
      try {
        const reading = await obsSource.read(input)
        return { level: reading.level, muted: reading.muted }
      } catch {
        return null
      }
    },
  )

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
    IPC.getStreamerbotStatus,
    async (): Promise<StreamerBotStatus> => buildStreamerbotStatus(),
  )

  ipcMain.handle(
    IPC.setStreamerbotSettings,
    async (_event, input: unknown): Promise<OperationResult> => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {
          ok: false,
          error: 'Invalid Streamer.bot settings',
          state: await buildState(),
        }
      }
      const value = input as StreamerBotSettingsInput
      const patch: Partial<AppSettings> = {}

      if (value.enabled !== undefined) {
        if (typeof value.enabled !== 'boolean') {
          return {
            ok: false,
            error: 'Streamer.bot enable must be true or false',
            state: await buildState(),
          }
        }
        patch.streamerbotEnabled = value.enabled
      }
      if (value.host !== undefined) {
        if (typeof value.host !== 'string') {
          return { ok: false, error: 'Streamer.bot host must be text', state: await buildState() }
        }
        const clean = sanitizeStreamerBotHost(value.host)
        if (clean !== value.host.trim()) {
          return {
            ok: false,
            error: 'Enter localhost, an IP address or a hostname (no scheme or path).',
            state: await buildState(),
          }
        }
        patch.streamerbotHost = clean
      }
      if (value.port !== undefined) {
        const port = sanitizeStreamerBotPort(value.port)
        if (port !== value.port) {
          return {
            ok: false,
            error: 'Streamer.bot port must be between 1 and 65535',
            state: await buildState(),
          }
        }
        patch.streamerbotPort = port
      }
      if (value.password !== undefined && typeof value.password !== 'string') {
        return { ok: false, error: 'Streamer.bot password must be text', state: await buildState() }
      }
      if (typeof value.password === 'string' && value.password.length > 256) {
        return { ok: false, error: 'Streamer.bot password is too long', state: await buildState() }
      }
      if (!secretStore) {
        return {
          ok: false,
          error: 'Secret storage is not available on this desktop.',
          state: await buildState(),
        }
      }

      if (value.clearPassword === true) {
        secretStore.delete('streamerbot.password')
      } else if (typeof value.password === 'string' && value.password.length > 0) {
        secretStore.set('streamerbot.password', value.password)
      }

      const updated = settings.update(patch)
      const password = secretStore.get('streamerbot.password') ?? ''
      streamerbotClient?.configure({
        host: updated.streamerbotHost,
        port: updated.streamerbotPort,
        password,
        enabled: updated.streamerbotEnabled,
      })
      if (updated.streamerbotEnabled) streamerbotClient?.start()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(
    IPC.listStreamerbotActions,
    async (): Promise<StreamerBotActionsResult> => {
      if (!streamerbotClient) {
        return {
          ok: false,
          actions: [],
          error: 'Streamer.bot is not available on this desktop.',
        }
      }
      try {
        return { ok: true, actions: await streamerbotClient.getActions() }
      } catch (error) {
        return {
          ok: false,
          actions: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )

  ipcMain.handle(
    IPC.testStreamerbotAction,
    async (_event, actionName: unknown, args: unknown): Promise<PressResult> => {
      if (!streamerbotClient?.connected) {
        return { ok: false, error: 'Streamer.bot is not connected.' }
      }
      try {
        const normalized = normalizeDoAction(actionName, args)
        await streamerbotClient.doAction(normalized.name, normalized.args)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

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

      const previousLights = settings.get().lights
      if (value.lights !== undefined) {
        if (!Array.isArray(value.lights)) {
          return { ok: false, error: 'Lights must be a list', state: await buildState() }
        }
        if (value.lights.length > MAX_LIGHT_DEVICES) {
          return {
            ok: false,
            error: `At most ${MAX_LIGHT_DEVICES} lights can be configured`,
            state: await buildState(),
          }
        }
        const devices = sanitizeLightDevices(value.lights)
        if (devices.length !== value.lights.length) {
          return {
            ok: false,
            error:
              'Each light needs a supported type, a name and a bare hostname or IP address (no scheme or path).',
            state: await buildState(),
          }
        }
        for (const [index, input] of value.lights.entries()) {
          const device = devices[index]!
          if (
            input.username !== undefined &&
            (device.type !== 'hue' ||
              (input.username !== '' && !isValidLightCredential(input.username)))
          ) {
            return {
              ok: false,
              error: 'Hue application keys may contain letters, numbers, dots, dashes and underscores.',
              state: await buildState(),
            }
          }
          if (
            input.token !== undefined &&
            (device.type !== 'nanoleaf' ||
              (input.token !== '' && !isValidLightCredential(input.token)))
          ) {
            return {
              ok: false,
              error: 'Nanoleaf tokens may contain letters, numbers, dots, dashes and underscores.',
              state: await buildState(),
            }
          }
        }
        patch.lights = devices
        if (value.enabled === undefined) patch.lightsEnabled = devices.length > 0
      }

      const updated = settings.update(patch)

      if (value.lights !== undefined && lightCredentials) {
        const previousById = new Map(previousLights.map((device) => [device.id, device]))
        for (const [index, input] of value.lights.entries()) {
          const device = updated.lights[index]!
          const previous = previousById.get(device.id)
          // A type switch must not carry the old provider's secret forward.
          if (previous && previous.type !== device.type) lightCredentials.clear(device.id)
          if (input.username !== undefined) {
            lightCredentials.set(device.id, { username: input.username })
          }
          if (input.token !== undefined) {
            lightCredentials.set(device.id, { token: input.token })
          }
        }
        const liveIds = new Set(updated.lights.map((device) => device.id))
        for (const previous of previousLights) {
          if (!liveIds.has(previous.id)) lightCredentials.clear(previous.id)
        }
      }

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

      if (value.revertEnabled !== undefined) {
        if (typeof value.revertEnabled !== 'boolean') {
          return {
            ok: false,
            error: 'Return-after-close must be true or false',
            state: await buildState(),
          }
        }
        patch.autoProfileRevertEnabled = value.revertEnabled
      }

      if (value.revertProfileId !== undefined) {
        if (value.revertProfileId === null) {
          patch.autoProfileRevertProfileId = undefined
        } else {
          const revertProfileId = sanitizeAutoProfileRevertProfileId(value.revertProfileId)
          if (!revertProfileId) {
            return {
              ok: false,
              error: 'Choose a valid return profile.',
              state: await buildState(),
            }
          }
          const profileIds = new Set(store.get().profiles.map((profile) => profile.id))
          if (!profileIds.has(revertProfileId)) {
            return {
              ok: false,
              error: 'The return profile must exist in this deck.',
              state: await buildState(),
            }
          }
          patch.autoProfileRevertProfileId = revertProfileId
        }
      }

      settings.update(patch)
      gameWatcher?.refresh()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.previewRig, async (_event, presetId: unknown): Promise<RigPreviewView> => {
    const requestedId = typeof presetId === 'string' ? presetId.slice(0, 64) : ''
    const failed = (error: string): RigPreviewView => ({
      presetId: requestedId,
      name: requestedId,
      ok: false,
      total: 0,
      estimatedMs: 0,
      guards: [],
      blocked: [],
      error,
    })
    const rig = configuredRig(presetId)
    if (!rig) {
      return failed(
        requestedId ? `Rig "${requestedId}" is not configured.` : 'Choose a valid rig.',
      )
    }
    if (!rigRunner) return failed('Rigs are not available on this desktop.')
    // Preview only evaluates guards: no last-run write and no progress frames.
    return rigPreviewView(await rigRunner.preview(rig, rig.id))
  })

  ipcMain.handle(IPC.runRig, async (_event, presetId: unknown): Promise<RigRunView> => {
    const at = Date.now()
    const requestedId = typeof presetId === 'string' ? presetId.slice(0, 64) : ''
    const failed = (error: string): RigRunView => ({
      presetId: requestedId,
      name: requestedId,
      status: 'failed',
      ok: false,
      completed: 0,
      total: 0,
      durationMs: 0,
      at,
      failures: [],
      error,
    })
    const rig = configuredRig(presetId)
    if (!rig) {
      return failed(
        requestedId ? `Rig "${requestedId}" is not configured.` : 'Choose a valid rig.',
      )
    }
    if (!rigRunner) return failed('Rigs are not available on this desktop.')
    // Editor-started runs carry no button id and share the phone/HTTP runner gate.
    logger.info(`Rig "${rig.name}" started from the editor`)
    return rigRunView(await rigRunner.run(rig, { presetId: rig.id }))
  })

  ipcMain.handle(IPC.abortRig, async (): Promise<OperationResult> => {
    if (rigRunner?.abort() === true) return { ok: true }
    return { ok: false, error: 'No rig is running.' }
  })

  ipcMain.handle(IPC.getRigStatuses, async (): Promise<RigStatusView[]> => {
    const runner = rigRunner
    if (!runner) return []
    return (store.get().rigs ?? []).map((rig) => {
      const reading = runner.readStatus(rig)
      const last = runner.lastRun(rig.id)
      return {
        presetId: rig.id,
        name: rig.name,
        detail: reading.detail,
        active: reading.active,
        available: reading.available,
        ...(reading.status !== undefined ? { status: reading.status } : {}),
        ...(reading.error !== undefined ? { error: reading.error } : {}),
        ...(last ? { at: last.at, durationMs: last.durationMs } : {}),
        ...(last?.message !== undefined ? { message: last.message } : {}),
      }
    })
  })

  ipcMain.handle(IPC.getLightStatuses, async (): Promise<LightStatusView[]> => {
    if (!lightSource) return []
    const statuses = await lightSource.listStatuses()
    return statuses.map(lightStatusView)
  })

  ipcMain.handle(IPC.getEventRules, async (): Promise<EventRulesView> => {
    if (!ruleService) return { armed: false, statuses: [], sources: [], history: [] }
    return ruleService.getEventRules()
  })

  ipcMain.handle(
    IPC.setAutomationEnabled,
    async (_event, armed: unknown): Promise<OperationResult> => {
      if (typeof armed !== 'boolean') {
        return {
          ok: false,
          error: 'Armed must be true or false',
          state: await buildState(),
        }
      }
      settings.update({ automationEnabled: armed })
      ruleService?.setArmed(armed)
      // Process rules share the GameWatcher poller, so arming changes whether
      // it needs to run even when auto-profile itself is disabled.
      gameWatcher?.refresh()
      await pushServerInfo()
      return { ok: true, state: await buildState() }
    },
  )

  ipcMain.handle(IPC.previewRule, async (_event, ruleId: unknown): Promise<RulePreviewView> => {
    const id = typeof ruleId === 'string' ? normalizeProfileId(ruleId) : null
    if (!id) {
      return {
        ruleId: '',
        ok: false,
        wouldRun: false,
        blocked: [],
        missing: [],
        error: 'Choose a valid rule.',
      }
    }
    if (!ruleService) {
      return {
        ruleId: id,
        ok: false,
        wouldRun: false,
        blocked: [],
        missing: [],
        error: 'Automation is not available on this desktop.',
      }
    }
    return ruleService.preview(id)
  })

  ipcMain.handle(IPC.fireRule, async (_event, ruleId: unknown): Promise<RuleFireView> => {
    const id = typeof ruleId === 'string' ? normalizeProfileId(ruleId) : null
    if (!id) {
      return {
        ruleId: '',
        ruleName: '',
        status: 'missing',
        ok: false,
        detail: 'Choose a valid rule.',
        durationMs: 0,
        actions: [],
        source: 'manual',
      }
    }
    if (!ruleService) {
      return {
        ruleId: id,
        ruleName: id,
        status: 'missing',
        ok: false,
        detail: 'Automation is not available on this desktop.',
        durationMs: 0,
        actions: [],
        source: 'manual',
      }
    }
    return ruleService.fire(id)
  })

  ipcMain.handle(IPC.clearRuleHistory, async (): Promise<{ ok: true }> => {
    ruleService?.clearHistory()
    return { ok: true }
  })

  ipcMain.handle(
    IPC.pairHueLight,
    async (_event, input: unknown): Promise<HuePairResult> => {
      const failed = async (error: string): Promise<HuePairResult> => ({
        ok: false,
        error,
        state: await buildState(),
      })
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return failed('Hue pairing needs a bridge host.')
      }
      const value = input as HuePairInput
      const host = sanitizeLightHost(value.host)
      if (!host) return failed('Enter the Hue bridge IP address or hostname (no scheme or path).')
      const port = sanitizeLightPort(value.port, HUE_DEFAULT_PORT)
      const requestedLightId =
        value.lightId === undefined ? undefined : sanitizeLightTarget(value.lightId)
      if (value.lightId !== undefined && !requestedLightId) {
        return failed('The Hue light id contains unsupported characters.')
      }

      const current = settings.get().lights
      const requestedId = typeof value.deviceId === 'string' ? value.deviceId.trim() : ''
      const existing = requestedId
        ? current.find((device) => device.id === requestedId)
        : current.find(
            (device) => device.type === 'hue' && device.host === host && device.port === port,
          )
      if (requestedId && !existing) {
        return failed('That configured light no longer exists.')
      }
      if (existing && existing.type !== 'hue') {
        return failed('That device is not a Hue bridge.')
      }

      let paired: Awaited<ReturnType<typeof pairHueBridge>>
      try {
        paired = await pairHueBridge(
          { host, port },
          { attempts: 30, retryDelayMs: 1000, timeoutMs: 4000 },
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`Hue pairing failed for ${host}:${port}: ${reason}`)
        return failed(reason)
      }

      let deviceId: string
      let nextDevices: LightDeviceSettings[]
      if (existing) {
        deviceId = existing.id
        nextDevices = current.map((device) =>
          device.id === deviceId
            ? {
                ...device,
                type: 'hue',
                host,
                port,
                ...(requestedLightId ? { lightId: requestedLightId } : {}),
              }
            : device,
        )
      } else {
        if (current.length >= MAX_LIGHT_DEVICES) {
          return failed(`At most ${MAX_LIGHT_DEVICES} lights can be configured.`)
        }
        let suffix = 1
        while (current.some((device) => device.id === `hue-${suffix}`)) suffix += 1
        deviceId = `hue-${suffix}`
        const rawName = typeof value.name === 'string' ? value.name.trim().slice(0, 40) : ''
        nextDevices = [
          ...current,
          {
            id: deviceId,
            name: rawName || `Hue ${host}`,
            type: 'hue',
            host,
            port,
            ...(requestedLightId ? { lightId: requestedLightId } : {}),
          },
        ]
      }

      lightCredentials?.set(deviceId, { username: paired.username })
      settings.update({ lights: nextDevices, lightsEnabled: true })
      lightSource?.configure(settings.get().lights)
      await controlState?.noteLightChanged()
      await pushServerInfo()

      let lights: HueLightView[] = []
      try {
        const device = settings.get().lights.find((item) => item.id === deviceId)
        if (device) {
          lights = hueLightViews(
            await new HueClient(device, { username: paired.username }).listLights(),
          )
        }
      } catch (error) {
        // Pairing succeeded even if the follow-up list fails; the UI can retry.
        logger.warn(
          `Hue light list failed after pairing ${host}:${port}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }

      return {
        ok: true,
        deviceId,
        lights,
        state: await buildState(),
      }
    },
  )

  ipcMain.handle(IPC.listHueLights, async (_event, deviceId: unknown): Promise<HueLightResult> => {
    if (typeof deviceId !== 'string') {
      return { ok: false, lights: [], error: 'Choose a configured Hue bridge.' }
    }
    const device = settings.get().lights.find((item) => item.id === deviceId)
    if (!device || device.type !== 'hue') {
      return { ok: false, lights: [], error: 'That device is not a Hue bridge.' }
    }
    const username = lightCredentials?.get(device.id)?.username
    if (!username) {
      return { ok: false, lights: [], error: 'Pair the Hue bridge first.' }
    }
    try {
      const lights = await new HueClient(device, { username }).listLights()
      return { ok: true, lights: hueLightViews(lights) }
    } catch (error) {
      return {
        ok: false,
        lights: [],
        error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      }
    }
  })

  ipcMain.handle(IPC.discoverHueBridges, async (): Promise<HueDiscoveryResult> => {
    try {
      return { ok: true, bridges: await discoverHueBridges() }
    } catch (error) {
      return {
        ok: false,
        bridges: [],
        error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      }
    }
  })

  ipcMain.handle(
    IPC.testLight,
    async (_event, deviceId: unknown): Promise<LightStatusView | null> => {
      if (!lightSource || typeof deviceId !== 'string') return null
      try {
        return lightStatusView(await lightSource.test(deviceId))
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(IPC.getMixerSnapshot, async (): Promise<MixerSnapshot> => {
    if (!appVolumeSource) {
      return {
        available: false,
        sessions: [],
        reason:
          process.platform === 'darwin'
            ? 'Per-app audio is not available on macOS without a virtual audio driver.'
            : 'Per-app audio is not available on this desktop.',
        updatedAt: Date.now(),
      }
    }
    return appVolumeSource.snapshot()
  })

  ipcMain.handle(
    IPC.setMixerVolume,
    async (_event, sessionId: unknown, volume: unknown): Promise<PressResult> => {
      if (!appVolumeSource) return { ok: false, error: 'Per-app audio is not available on this desktop.' }
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 512) {
        return { ok: false, error: 'Invalid mixer session' }
      }
      if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) {
        return { ok: false, error: 'Mixer volume must be between 0 and 100' }
      }
      try {
        await appVolumeSource.setVolumeById(sessionId, volume)
        await controlState?.noteAppVolumeChanged()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    IPC.setMixerMute,
    async (_event, sessionId: unknown, muted: unknown): Promise<PressResult> => {
      if (!appVolumeSource) return { ok: false, error: 'Per-app audio is not available on this desktop.' }
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 512) {
        return { ok: false, error: 'Invalid mixer session' }
      }
      if (typeof muted !== 'boolean') return { ok: false, error: 'Mixer mute must be a boolean' }
      try {
        await appVolumeSource.setMuteById(sessionId, muted)
        await controlState?.noteAppVolumeChanged()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(
    IPC.getAudioDevices,
    async (_event, force: unknown): Promise<AudioDevicesResult> => {
      if (!audioDevices) {
        return {
          ok: false,
          error:
            audioDeviceUnsupportedReason(process.platform) ??
            'Audio device switching is not available on this desktop.',
          output: [],
          input: [],
        }
      }
      const snapshot = await audioDevices.list({ force: force === true })
      if (!snapshot.available) {
        return {
          ok: false,
          error: snapshot.reason ?? 'Audio device switching is not available on this desktop.',
          output: [],
          input: [],
        }
      }
      const view = (entry: (typeof snapshot.output)[number]): AudioDeviceView => ({
        id: entry.id,
        name: entry.name,
        deviceKind: entry.deviceKind,
        ...(entry.form ? { form: entry.form } : {}),
        current: entry.current,
        available: entry.available,
      })
      return {
        ok: true,
        output: snapshot.output.map(view),
        input: snapshot.input.map(view),
        ...(snapshot.currentOutputId ? { currentOutputId: snapshot.currentOutputId } : {}),
        ...(snapshot.currentInputId ? { currentInputId: snapshot.currentInputId } : {}),
      }
    },
  )

  ipcMain.handle(
    IPC.setAudioDevice,
    async (_event, kind: unknown, id: unknown): Promise<PressResult> => {
      if (!audioDevices) {
        return {
          ok: false,
          error:
            audioDeviceUnsupportedReason(process.platform) ??
            'Audio device switching is not available on this desktop.',
        }
      }
      const parsed = parseAudioDeviceSetInput(kind, id)
      if (!parsed) {
        return { ok: false, error: 'Invalid audio device' }
      }
      try {
        await audioDevices.setDefault(parsed.kind, { id: parsed.id })
        await controlState?.noteAudioDeviceChanged(parsed.kind)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: sanitizeAudioDeviceError(error, 300) }
      }
    },
  )

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

  ipcMain.handle(
    IPC.setLastSeenVersion,
    async (_event, version: unknown): Promise<OperationResult> => {
      const clean = sanitizeLastSeenVersion(version)
      if (!clean) {
        return { ok: false, error: 'Invalid app version', state: await buildState() }
      }
      settings.update({ lastSeenVersion: clean })
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

  ipcMain.handle(IPC.exportLegacyConfig, async (): Promise<OperationResult> => {
    const result = await showSave({
      title: 'Export deck for an older desktop',
      defaultPath: 'phonedek-compatible.json',
      filters: [{ name: 'PhoneDeck config', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      const exported = legacyConfigJson(store.get())
      writeFileSync(result.filePath, exported.json, 'utf8')
      logger.info(`Exported compatible config ${result.filePath}: ${exported.summary}`)
      return { ok: true, path: result.filePath, message: exported.summary }
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
      // An imported deck is never armed, even if this PC had automation on.
      disarmAutomationAfterImport(settings)
      ruleService?.setArmed(false)
      gameWatcher?.refresh()
      logger.info(`Imported backup ${file} (${importedAssets} assets); automation disarmed`)
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

  ipcMain.handle(
    IPC.getMacroCaptureSupport,
    async (): Promise<MacroCaptureSupportView> => captureService().support(),
  )
  ipcMain.handle(
    IPC.startMacroCapture,
    async (_event, input?: unknown): Promise<MacroCaptureStartResult> =>
      captureService().start(captureInputOf(input)),
  )
  ipcMain.handle(IPC.stopMacroCapture, async () => captureService().stop('user'))
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
    macroCapture?.stop('user')
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
  pruneAutoProfileRevertProfile()
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
  appVolumeSource = createAppVolumeSource(process.platform, {
    ...(process.platform === 'win32' && volumeProbe
      ? { windowsTransport: volumeProbe }
      : {}),
    logger,
  })
  if (appVolumeSource && process.platform === 'win32') {
    logger.info('Per-app audio mixer enabled through the Core Audio helper')
  } else if (appVolumeSource) {
    logger.info('Per-app audio mixer enabled through pactl sink inputs')
  } else if (process.platform === 'darwin') {
    logger.info('Per-app audio mixer disabled: macOS has no public per-app volume API')
  }
  const audioHelper = audioHelperPath()
  audioDevices = createAudioDeviceController(process.platform, {
    helperPath: audioHelper,
    logger,
  })
  if (audioDevices && process.platform === 'win32' && !existsSync(audioHelper)) {
    // A packaged build without the helper must not advertise a panel that can
    // only fail: drop the controller so the capability is absent and tiles stay
    // on their quiet NO AUDIO fallback.
    logger.warn(`Audio device switching unavailable: helper not found at ${audioHelper}`)
    audioDevices.dispose()
    audioDevices = null
  } else if (audioDevices) {
    logger.info(
      `Audio device switching enabled (${process.platform === 'linux' ? 'Linux pactl' : process.platform === 'darwin' ? 'macOS CoreAudio' : 'Windows Core Audio'})`,
    )
  } else {
    logger.info(
      `Audio device switching unavailable: ${audioDeviceUnsupportedReason(process.platform) ?? 'unsupported platform'}`,
    )
  }
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
  secretStore = secrets
  lightCredentials = new LightCredentialStore(secrets)
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

  streamerbotClient = new StreamerBotClient({
    host: settings.get().streamerbotHost,
    port: settings.get().streamerbotPort,
    password: secrets.get('streamerbot.password') ?? '',
    enabled: settings.get().streamerbotEnabled,
    logger,
  })
  streamerbotClient.onStatus((status) => {
    if (status.state === 'connected') {
      logger.info(
        `Streamer.bot connected at ${status.host}:${status.port}` +
          `${status.version ? ` (v${status.version})` : ''}`,
      )
    } else if (status.lastError && status.state !== 'reconnecting') {
      logger.warn(`Streamer.bot ${status.state}: ${status.lastError}`)
    }
    void pushServerInfo()
  })
  if (settings.get().streamerbotEnabled) streamerbotClient.start()

  lightSource = new LightStateSource({
    logger,
    ...(lightCredentials ? { credentials: lightCredentials } : {}),
  })
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
    runAppVolumeAction: async (step) => {
      if (!appVolumeSource) throw new Error('Per-app audio is not available on this desktop.')
      if (step.action === 'setMute') {
        await appVolumeSource.setMute(step.match, step.muted)
      } else {
        await appVolumeSource.toggleMute(step.match)
      }
      await controlState?.noteAppVolumeChanged(step.match)
    },
    ...(audioDevices
      ? {
          runAudioDeviceAction: async (step) => {
            if (step.action === 'set') {
              await audioDevices!.setDefault(step.deviceKind, step.device, step.allRoles)
            } else {
              await audioDevices!.cycle(step.deviceKind, step.devices, step.allRoles)
            }
            await controlState?.noteAudioDeviceChanged(step.deviceKind)
          },
        }
      : {}),
    runStreamerBotAction: async (step) => {
      if (!streamerbotClient) throw new Error('Streamer.bot is not available on this desktop.')
      await streamerbotClient.doAction(step.actionName, step.args)
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

  // One runner owns every rig (phone presses, HTTP presses and the editor):
  // guards, single-flight, abort and last-run state live in one place.
  const runner = new RigRunner(
    {
      executePlan: (groups, label, options) => executor.executePlan(groups, label, options),
      probes: createRigGuardProbes(),
      now: () => Date.now(),
      logger,
    },
    {
      onProgress: (frame) => {
        const message: RigProgressMessage = {
          type: 'rigProgress',
          phase: frame.phase,
          presetId: frame.presetId,
          ...(frame.buttonId !== undefined ? { buttonId: frame.buttonId } : {}),
          index: frame.index,
          total: frame.total,
          ...(frame.label !== undefined ? { label: frame.label } : {}),
          ...(frame.status !== undefined ? { status: frame.status } : {}),
          ...(frame.ok !== undefined ? { ok: frame.ok } : {}),
          ...(frame.error !== undefined ? { error: frame.error } : {}),
          ...(frame.durationMs !== undefined ? { durationMs: frame.durationMs } : {}),
        }
        // Only phones that advertised `rig-v1` receive progress; old apps see
        // the ordinary press and its final pressResult.
        try {
          server?.sendToClientsWithCapability(RIG_CAPABILITY, message)
        } catch (error) {
          logger.warn(
            `Could not send rig progress: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        void controlState?.noteRigChanged(frame.presetId)
      },
    },
  )
  rigRunner = runner

  controlState = new ControlStateService({
    ...(volumeReader ? { reader: volumeReader } : {}),
    ...(microphone ? { micReader: microphone } : {}),
    ...(mediaSource ? { mediaReader: mediaSource } : {}),
    ...(appVolumeSource ? { appReader: appVolumeSource } : {}),
    ...(obsSource ? { obsReader: obsSource } : {}),
    ...(twitchSource ? { twitchReader: twitchSource } : {}),
    ...(lightSource ? { lightReader: lightSource } : {}),
    ...(audioDevices ? { audioReader: audioDevices } : {}),
    // Rig status is in-memory, so it is always readable (even with no device
    // integrations) and `control-state-v1` must stay advertised for rig tiles.
    rigReader: {
      readStatus: (presetId) => runner.readStatus(rigById(store.get().rigs, presetId)),
    },
    logger,
  })
  {
    const sources = [
      volumeReader ? 'volume' : null,
      microphone ? 'microphone' : null,
      mediaSource ? 'media' : null,
      appVolumeSource ? 'mixer' : null,
      obsSource ? 'OBS' : null,
      twitchSource ? 'Twitch' : null,
      lightSource && lightsActive(settings.get()) ? 'lights' : null,
      'rigs',
    ]
      .filter(Boolean)
      .join(' + ')
    logger.info(`Live control state enabled on ${process.platform} (${sources})`)
  }

  mixer = appVolumeSource
    ? new MixerService({
        source: appVolumeSource,
        logger,
        ...(controlState
          ? { onWriteApplied: () => controlState?.noteAppVolumeChanged() }
          : {}),
      })
    : null
  if (mixer) logger.info('Live mixer transport enabled (subscribe + 1 Hz snapshots)')

  audioDeviceService = audioDevices
    ? new AudioDeviceService({
        controller: audioDevices,
        logger,
        onChanged: (kind) => controlState?.noteAudioDeviceChanged(kind),
      })
    : null

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
      if (control.binding.type === 'appVolume') {
        if (!appVolumeSource) return { ok: false, error: 'Per-app volume is not available on this desktop.' }
        const level = Math.max(0, Math.min(100, value * 100))
        try {
          await appVolumeSource.setVolume(control.binding.match, level)
          await controlState?.noteAppVolumeWritten(control.binding.match, level)
          logger.info(
            `Set app volume for "${control.binding.match.process ?? 'app'}" to ${Math.round(level)}% for "${label}"`,
          )
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
    onPress: async (_client, _message, context: PressContext) => {
      // A rig button is schema-restricted to its single rig action. Resolve it
      // before touching the executor so a rig can never also run stale extras.
      const rigAction = rigActionOf(context.button.actions)
      if (rigAction) {
        if (!rigRunner) return { ok: false, error: 'Rigs are not available on this desktop.' }
        const result = await rigRunner.run(rigById(store.get().rigs, rigAction.presetId), {
          presetId: rigAction.presetId,
          buttonId: context.button.id,
        })
        return {
          ok: result.ok,
          ...(result.error !== undefined ? { error: result.error } : {}),
          ...(result.message !== undefined ? { message: result.message } : {}),
        }
      }
      return executor.execute(context.button.actions, context.button.label)
    },
    onInput: async (client, message, context) =>
      router.handle(message, {
        control: context.control,
        label: context.button.label,
        clientId: client.id,
      }),
    pointerSupported: pointerRouter !== null,
    keyboardSupported: () =>
      keyboardRouter !== null && settings.get().allowKeyboardControl,
    mixerSupported: () => appVolumeSource !== null,
    mixer: mixer ?? undefined,
    audioDevices: audioDeviceService ?? undefined,
    audioDevicesSupported: () => audioDeviceService !== null,
    controlState: controlState ?? undefined,
    controlStateSupported: controlState !== null,
    obsSupported: () => obsClient?.connected === true,
    twitchSupported: () => twitchSource?.connected === true,
    lightSupported: () => lightsActive(settings.get()),
    streamerbotSupported: () => streamerbotClient?.connected === true,
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
      mixer?.unsubscribe(client.id)
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
        // Defence in depth: an imported deck must never auto-fire, even when
        // this PC had automation armed. Rules come back disarmed.
        disarmAutomationAfterImport(settings)
        ruleService?.setArmed(false)
        gameWatcher?.refresh()
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
    onClientsChanged: (clients) => {
      // Rules see presence through one level; a replay to a reconnecting phone
      // is sent here as well (profile only, never a page).
      ruleService?.clientsChanged(clients)
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
      revertEnabled: settings.get().autoProfileRevertEnabled,
      revertProfileId: settings.get().autoProfileRevertProfileId,
    }),
    getProfileIds: () => store.get().profiles.map((profile) => profile.id),
    onSwitch: (profileId) => {
      server.broadcastProfile(profileId)
    },
    onRevert: (profileId) => {
      server.broadcastProfile(profileId)
    },
    // Event rules share this one poller; a disabled auto-profile does not stop
    // process rules from seeing snapshots, and vice versa.
    keepPolling: () => ruleService?.needsProcessPolling() === true,
    onSnapshot: (running) => {
      ruleService?.processSnapshot(running)
    },
    logger,
  })

  // One rule engine for the desktop. Constructed after the server and runner so
  // every action reference resolves against the live config.
  ruleService = new RuleService({
    getConfig: () => store.get(),
    isArmed: () => settings.get().automationEnabled,
    probes: createRigGuardProbes(),
    runRig: async (presetId) => {
      const runner = rigRunner
      if (!runner) throw new Error('Rigs are not available on this desktop.')
      const rig = rigById(store.get().rigs, presetId)
      if (!rig) throw new Error(`Rig "${presetId}" is not configured.`)
      return runner.run(rig, { presetId: rig.id })
    },
    showProfile: (profileId) =>
      store.get().profiles.some((profile) => profile.id === profileId) &&
      server.broadcastProfile(profileId),
    showPage: (profileId, pageId) => {
      // The phone applies a profile synchronously, so an immediate navigate
      // lands on the right page in the new profile.
      const profile = store.get().profiles.find((candidate) => candidate.id === profileId)
      if (!profile || !profile.pages.some((page) => page.id === pageId)) return false
      if (!server.broadcastProfile(profileId)) return false
      server.broadcastNavigate('goto', pageId)
      return true
    },
    sendToClient: (clientId, message) => server.sendToClient(clientId, message),
    ...(obsClient && obsSource ? { obs: { client: obsClient, source: obsSource } } : {}),
    ...(twitchSource ? { twitch: twitchSource } : {}),
    logger,
  })
  ruleService.configure(store.get().rules)
  ruleService.setArmed(settings.get().automationEnabled)
  ruleService.clientsChanged(server.getClients())

  discovery = new DiscoveryService({
    getPort: () => server.port || settings.get().port,
    getName: () => store.get().serverName,
    version: APP_VERSION,
    logger,
  })

  store.onChange(() => {
    // A rig that is mid-run must not keep executing steps after its preset was
    // deleted; abort at the next group/delay boundary. Renames/edits keep running.
    const activeRig = rigRunner?.active
    if (activeRig && !rigById(store.get().rigs, activeRig.presetId)) {
      rigRunner?.abort()
      logger.warn(`Rig "${activeRig.presetId}" was deleted from the config; stopping it.`)
    }
    pruneAutoProfileRevertProfile()
    ruleService?.configure(store.get().rules)
    gameWatcher?.refresh()
    server.broadcastConfig()
    void controlState?.noteRigChanged()
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
        macroCapture?.dispose()
        rigRunner?.abort()
        controlState?.dispose()
        mixer?.dispose()
        twitchAuth?.dispose()
        streamerbotClient?.dispose()
        obsSource?.dispose()
        obsClient?.dispose()
        lightSource?.dispose()
        audioDeviceService?.dispose()
        audioDevices?.dispose()
        volumeProbe?.dispose()
        mediaProbe?.dispose()
        pointerRouter?.dispose()
        pointerSender?.dispose()
        keyboardRouter?.dispose()
        keyboardSender?.dispose()
        ruleService?.dispose()
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
