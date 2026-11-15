import type {
  Action,
  AssetKind,
  ConnectedClient,
  DeckConfig,
  LightDeviceType,
  MixerSnapshot,
  PressResult,
  RigGuardProbe,
  RigRunStatus,
} from '@phonedek/shared'

export interface PairView {
  host: string
  port: number
  name: string
  uri: string
  qrDataUrl: string
}

export interface ServerInfoView {
  running: boolean
  port: number
  urls: string[]
  lanAddresses: string[]
  token: string
  pair: PairView | null
  discovery: boolean
  settings: SettingsView
  clients: ConnectedClient[]
  error: string | null
  version: string
  platform: string
  configPath: string
  logPath: string | null
  /** Live OBS connection status; never includes the password. */
  obsStatus: ObsStatusView
  /** Live Twitch auth status; never includes tokens. */
  twitchStatus: TwitchStatusView
  /** Live Streamer.bot WebSocket status; never includes the password. */
  streamerbotStatus: StreamerBotStatus
}

export interface SettingsView {
  port: number
  discovery: boolean
  launchAtLogin: boolean
  minimizeToTray: boolean
  /** Paired phones may move the cursor and click. */
  allowPointerControl: boolean
  /** Paired phones may type text and keys. */
  allowKeyboardControl: boolean
  pairHost: string
  /** macOS capture folder; empty = OS Desktop. */
  screenshotDirectory: string
  /** Version whose What's New dialog was dismissed; empty on a fresh install. */
  lastSeenVersion: string
  obsEnabled: boolean
  obsHost: string
  obsPort: number
  /** True when a password is stored; the secret itself is never exposed. */
  obsHasPassword: boolean
  twitchEnabled: boolean
  /** Public client ID only; tokens are never exposed. */
  twitchClientId: string
  /** True when a Twitch token bundle is stored. */
  twitchHasToken: boolean
  /** Trigger actions in a local Streamer.bot instance. */
  streamerbotEnabled: boolean
  /** Streamer.bot WebSocket host. Defaults to 127.0.0.1. */
  streamerbotHost: string
  /** Streamer.bot WebSocket port. Defaults to 8080. */
  streamerbotPort: number
  /** True when a WebSocket password is stored; the secret is never exposed. */
  streamerbotHasPassword: boolean
  /** Local-light control is on and at least one device is configured. */
  lightsEnabled: boolean
  /** Configured local lights; never contains credentials. */
  lights: LightDeviceView[]
  /** Switch connected phones to a profile when a configured game starts. */
  autoProfileEnabled: boolean
  /** Process → profile rules, evaluated in top-to-bottom priority order. */
  autoProfileRules: AutoProfileRuleView[]
  /** Return phones to a profile after a matched game closes. */
  autoProfileRevertEnabled: boolean
  /** Profile to return to; empty when no target is selected. */
  autoProfileRevertProfileId: string
}

/** One configured local light as exposed to the renderer. */
export interface LightDeviceView {
  id: string
  name: string
  type: LightDeviceType
  host: string
  port: number
  /** Provider-side light id (Hue light), when the user pinned one. */
  lightId?: string
  /** True when a Hue application key or Nanoleaf token is stored. */
  hasCredential?: boolean
}

/** Live per-device availability for the Settings test row. */
export interface LightStatusView {
  id: string
  name: string
  /** Optional for older renderer fixtures; real statuses always include it. */
  type?: LightDeviceType
  host: string
  port: number
  lightId?: string
  available: boolean
  on?: boolean
  brightness?: number
  /** Mireds, 143..344. */
  temperature?: number
  error?: string
}

export interface LightDeviceInput {
  id: string
  name: string
  type?: LightDeviceType
  host: string
  port?: number
  /** Provider-side light id (Hue); omitted = the bridge's first light. */
  lightId?: string
  /**
   * Write-only Hue application key. Stored in the SecretStore and never
   * returned in `LightDeviceView`. An empty string clears it.
   */
  username?: string
  /**
   * Write-only Nanoleaf OpenAPI token. Stored in the SecretStore and never
   * returned in `LightDeviceView`. An empty string clears it.
   */
  token?: string
}

export interface LightSettingsInput {
  enabled?: boolean
  /** Full replacement list (max 8). Omit to change only `enabled`. */
  lights?: LightDeviceInput[]
}

/** Minimal Hue light metadata for a future pairing/picker UI. */
export interface HueLightView {
  id: string
  name: string
  on: boolean
  brightness: number
  /** Mireds, 143..344. */
  temperature: number
}

export interface HueBridgeView {
  id: string
  host: string
  port: number
}

export interface HuePairInput {
  /** Bare bridge hostname or IP address (manual entry or discovery result). */
  host: string
  port?: number
  /** Existing configured bridge to attach the credential to. */
  deviceId?: string
  /** Display name when a new device is created. */
  name?: string
  /** Hue light id to control; omitted = the bridge's first light. */
  lightId?: string
}

export interface HuePairResult extends OperationResult {
  deviceId?: string
  /** Lights exposed by the bridge, for the follow-up picker. No credentials. */
  lights?: HueLightView[]
}

export interface HueLightResult {
  ok: boolean
  lights: HueLightView[]
  error?: string
}

export interface HueDiscoveryResult {
  ok: boolean
  bridges: HueBridgeView[]
  error?: string
}

/** One auto-profile rule as exposed to the renderer. */
export interface AutoProfileRuleView {
  id: string
  /** Normalized executable basename, lowercase, without `.exe`. */
  process: string
  profileId: string
}

export interface AutoProfileSettingsInput {
  enabled?: boolean
  /** Full replacement list (max 16). Omit to change only `enabled`. */
  rules?: AutoProfileRuleView[]
  /** Return phones to `revertProfileId` when a matched game closes. */
  revertEnabled?: boolean
  /** Existing deck profile id, or null to clear the return target. */
  revertProfileId?: string | null
}

export type ObsStateView =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'disconnected'
  | 'reconnecting'
  | 'error'

export interface ObsStatusView {
  state: ObsStateView
  host: string
  port: number
  obsVersion?: string
  websocketVersion?: string
  lastError?: string
  nextRetryMs?: number
}

export interface ObsInputView {
  name: string
  kind: string
  audio: boolean
}

export interface ObsInputsResult {
  ok: boolean
  inputs?: ObsInputView[]
  error?: string
}

export interface ObsSettingsInput {
  enabled?: boolean
  host?: string
  port?: number
  /** Omitted/empty keeps the stored password; `clearPassword` removes it. */
  password?: string
  clearPassword?: boolean
}

export type TwitchStateView =
  | 'disabled'
  | 'unauthorized'
  | 'authorizing'
  | 'authorized'
  | 'error'

export interface TwitchDeviceView {
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
}

export interface TwitchStatusView {
  state: TwitchStateView
  enabled: boolean
  /** True when a validated user token is loaded. */
  connected: boolean
  /** Display name/login; never a token. */
  account?: string
  login?: string
  userId?: string
  scopes: string[]
  /** Present while a Device Code Flow awaits the user. */
  device?: TwitchDeviceView
  expiresAt?: number
  lastError?: string
}

export interface TwitchAuthStartResult {
  ok: boolean
  device?: TwitchDeviceView
  error?: string
}

export interface TwitchSettingsInput {
  enabled?: boolean
  /** Public client ID; empty clears it (unless a bundled default exists). */
  clientId?: string
}

export type StreamerBotState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'disconnected'
  | 'reconnecting'
  | 'error'

/** Live Streamer.bot connection state for the future Settings card. */
export interface StreamerBotStatus {
  state: StreamerBotState
  host: string
  port: number
  /** Streamer.bot instance name from its Hello message. */
  instanceName?: string
  /** Streamer.bot version from its Hello message. */
  version?: string
  /** Actions learned through the last successful GetActions. */
  actionCount?: number
  lastError?: string
  nextRetryMs?: number
}

/** One Streamer.bot action as exposed to the action picker. */
export interface StreamerBotActionView {
  id: string
  name: string
  /** Streamer.bot group; `"None"` is flattened to undefined. */
  group?: string
  enabled: boolean
  subactionCount: number
  triggerCount: number
}

export interface StreamerBotActionsResult {
  ok: boolean
  actions: StreamerBotActionView[]
  error?: string
}

export interface StreamerBotSettingsInput {
  enabled?: boolean
  host?: string
  port?: number
  /** Write-only WebSocket password; empty/omitted keeps the stored value. */
  password?: string
  /** Remove the stored password. */
  clearPassword?: boolean
}

/* Rig presets (P2 wiring; the renderer UI lands in P3) */

/** One evaluated guard in a rig pre-flight/run report. */
export interface RigGuardView {
  probe: RigGuardProbe
  /** Human description, e.g. `Not OBS streaming` or `App running (discord)`. */
  label: string
  /** Effective expectation (`expect` defaults to true). */
  expect: boolean
  /** Observed value, or null when unavailable/timed out. */
  actual: boolean | null
  ok: boolean
  available: boolean
  error?: string
}

/** Guard pre-flight result; never updates the last-run chip. */
export interface RigPreviewView {
  presetId: string
  name: string
  ok: boolean
  total: number
  estimatedMs: number
  guards: RigGuardView[]
  /** Guards that would block the run (in preset order). */
  blocked: RigGuardView[]
  error?: string
}

/** One failed step in a rig run report. */
export interface RigFailureView {
  /** 1-based step index. */
  index: number
  label: string
  error: string
}

/** Final outcome of one editor-started rig. */
export interface RigRunView {
  presetId: string
  name: string
  status: RigRunStatus
  ok: boolean
  completed: number
  total: number
  durationMs: number
  /** End time in ms, for `NOW`/`12m`/`3h` chips. */
  at: number
  failures: RigFailureView[]
  error?: string
  /** Success summary, e.g. `Studio: 9/9 steps in 12.3s`. */
  message?: string
  guards?: RigGuardView[]
  /** Present on `busy`: the run that currently owns the runner. */
  active?: {
    presetId: string
    name: string
    index: number
    total: number
  }
}

/** Last-run/active reading for one configured rig status tile. */
export interface RigStatusView {
  presetId: string
  name: string
  /** ≤12-char tile detail: `READY`, `3/9`, `RUN 2m`, `FAILED`, `NO RIG`, … */
  detail: string
  active: boolean
  available: boolean
  status?: RigRunStatus
  error?: string
  /** Last run end time in ms; absent when the rig has never run. */
  at?: number
  durationMs?: number
  message?: string
}

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion?: string
  progress?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
  canCheck: boolean
}

export interface AppState {
  config: DeckConfig
  server: ServerInfoView
  settings: SettingsView
}

export interface SaveConfigResult {
  ok: boolean
  config?: DeckConfig
  errors?: string[]
}

export interface AssetPickResult {
  ok: boolean
  asset?: string
  error?: string
}

export interface OperationResult {
  ok: boolean
  error?: string
  state?: AppState
  path?: string
}

/** macOS input-control permission (called Accessibility before macOS 27). */
export interface PermissionStatus {
  platform: string
  /** False on platforms that do not gate synthetic input. */
  supported: boolean
  granted: boolean
  /** Localized pane name: "Device Control and Data Access" on macOS 27+. */
  paneName: string
  /** Main executable that macOS must authorize. */
  appPath: string | null
}

export interface PhoneDeckApi {
  getState(): Promise<AppState>
  saveConfig(config: DeckConfig): Promise<SaveConfigResult>
  importAsset(kind?: AssetKind): Promise<AssetPickResult>
  pickApplication(): Promise<string | null>
  testActions(actions: Action[], label?: string): Promise<PressResult>
  testControlInput(
    profileId: string,
    pageId: string,
    buttonId: string,
    delta: number,
    value?: number,
  ): Promise<PressResult>
  setPort(port: number): Promise<OperationResult>
  rotateToken(): Promise<OperationResult>
  setDiscovery(enabled: boolean): Promise<OperationResult>
  setLaunchAtLogin(enabled: boolean): Promise<OperationResult>
  setMinimizeToTray(enabled: boolean): Promise<OperationResult>
  setAllowPointerControl(enabled: boolean): Promise<OperationResult>
  setAllowKeyboardControl(enabled: boolean): Promise<OperationResult>
  setPairHost(host: string): Promise<OperationResult>
  setPhoneBrightness(clientId: string, level: number | null): Promise<OperationResult>
  setScreenshotDirectory(path: string): Promise<OperationResult>
  pickScreenshotDirectory(): Promise<string | null>
  /** Record that the current version's What's New dialog was seen. */
  setLastSeenVersion(version: string): Promise<OperationResult>
  getObsStatus(): Promise<ObsStatusView>
  setObsSettings(input: ObsSettingsInput): Promise<OperationResult>
  listObsInputs(): Promise<ObsInputsResult>
  /** Current level for one OBS input, used to seed a new control. */
  getObsInputLevel(input?: string): Promise<{ level: number; muted: boolean } | null>
  testObsInputVolume(input: string | undefined, percent: number): Promise<PressResult>
  testObsMute(input?: string): Promise<PressResult>
  getTwitchStatus(): Promise<TwitchStatusView>
  setTwitchSettings(input: TwitchSettingsInput): Promise<OperationResult>
  startTwitchAuth(): Promise<TwitchAuthStartResult>
  cancelTwitchAuth(): Promise<OperationResult>
  disconnectTwitch(): Promise<OperationResult>
  getStreamerbotStatus(): Promise<StreamerBotStatus>
  setStreamerbotSettings(input: StreamerBotSettingsInput): Promise<OperationResult>
  /** Refresh and return the Streamer.bot action list for the action picker. */
  listStreamerbotActions(): Promise<StreamerBotActionsResult>
  /** Fire one Streamer.bot action as a connection test. */
  testStreamerbotAction(actionName: string, args?: Record<string, string>): Promise<PressResult>
  setLightSettings(input: LightSettingsInput): Promise<OperationResult>
  getLightStatuses(): Promise<LightStatusView[]>
  /** Pair a Hue bridge after the user presses its physical link button. */
  pairHueLight(input: HuePairInput): Promise<HuePairResult>
  /** Lights on a configured Hue bridge, for the device picker. */
  listHueLights(deviceId: string): Promise<HueLightResult>
  /** Optional cloud discovery; manual host entry is the fallback. */
  discoverHueBridges(): Promise<HueDiscoveryResult>
  /** Force a read of one configured light (connection test). */
  testLight(deviceId: string): Promise<LightStatusView | null>
  /** Per-app mixer snapshot for a future full-screen mixer (no UI yet). */
  getMixerSnapshot(): Promise<MixerSnapshot>
  setMixerVolume(sessionId: string, volume: number): Promise<PressResult>
  setMixerMute(sessionId: string, muted: boolean): Promise<PressResult>
  setAutoProfileSettings(input: AutoProfileSettingsInput): Promise<OperationResult>
  /** Evaluate a rig's guards without running it (no last-run/progress changes). */
  previewRig(presetId: string): Promise<RigPreviewView>
  /** Run one configured rig from the editor; shares the runner gate. */
  runRig(presetId: string): Promise<RigRunView>
  /** Abort the active rig at the next step/delay boundary. */
  abortRig(): Promise<OperationResult>
  /** Last-run/active readings for every configured rig. */
  getRigStatuses(): Promise<RigStatusView[]>
  exportConfig(): Promise<OperationResult>
  importConfig(): Promise<SaveConfigResult>
  openLogs(): Promise<void>
  openAccessibility(): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  getPermissionStatus(): Promise<PermissionStatus>
  requestPermission(): Promise<PermissionStatus>
  openPermissionSetup(): Promise<void>
  revealPermissionFile(kind: 'app' | 'helper'): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  onServerInfo(listener: (info: ServerInfoView) => void): () => void
  onConfigChanged(listener: (config: DeckConfig) => void): () => void
  onOpenPair(listener: () => void): () => void
}

export const IPC = {
  getState: 'phonedek:get-state',
  saveConfig: 'phonedek:save-config',
  importAsset: 'phonedek:import-asset',
  pickApplication: 'phonedek:pick-application',
  testActions: 'phonedek:test-actions',
  testControlInput: 'phonedek:test-control-input',
  setPort: 'phonedek:set-port',
  rotateToken: 'phonedek:rotate-token',
  setDiscovery: 'phonedek:set-discovery',
  setLaunchAtLogin: 'phonedek:set-launch-at-login',
  setMinimizeToTray: 'phonedek:set-minimize-to-tray',
  setAllowPointerControl: 'phonedek:set-allow-pointer-control',
  setAllowKeyboardControl: 'phonedek:set-allow-keyboard-control',
  setPairHost: 'phonedek:set-pair-host',
  setPhoneBrightness: 'phonedek:set-phone-brightness',
  setScreenshotDirectory: 'phonedek:set-screenshot-directory',
  pickScreenshotDirectory: 'phonedek:pick-screenshot-directory',
  setLastSeenVersion: 'phonedek:set-last-seen-version',
  getObsStatus: 'phonedek:obs-get-status',
  setObsSettings: 'phonedek:obs-set-settings',
  listObsInputs: 'phonedek:obs-list-inputs',
  getObsInputLevel: 'phonedek:obs-input-level',
  testObsInputVolume: 'phonedek:obs-test-volume',
  testObsMute: 'phonedek:obs-test-mute',
  getTwitchStatus: 'phonedek:twitch-get-status',
  setTwitchSettings: 'phonedek:twitch-set-settings',
  startTwitchAuth: 'phonedek:twitch-start-auth',
  cancelTwitchAuth: 'phonedek:twitch-cancel-auth',
  disconnectTwitch: 'phonedek:twitch-disconnect',
  getStreamerbotStatus: 'phonedek:streamerbot-get-status',
  setStreamerbotSettings: 'phonedek:streamerbot-set-settings',
  listStreamerbotActions: 'phonedek:streamerbot-list-actions',
  testStreamerbotAction: 'phonedek:streamerbot-test-action',
  setLightSettings: 'phonedek:lights-set-settings',
  getLightStatuses: 'phonedek:lights-get-statuses',
  pairHueLight: 'phonedek:lights-pair-hue',
  listHueLights: 'phonedek:lights-list-hue',
  discoverHueBridges: 'phonedek:lights-discover-hue',
  testLight: 'phonedek:lights-test',
  getMixerSnapshot: 'phonedek:mixer-get-snapshot',
  setMixerVolume: 'phonedek:mixer-set-volume',
  setMixerMute: 'phonedek:mixer-set-mute',
  setAutoProfileSettings: 'phonedek:auto-profile-set-settings',
  previewRig: 'phonedek:rig-preview',
  runRig: 'phonedek:rig-run',
  abortRig: 'phonedek:rig-abort',
  getRigStatuses: 'phonedek:rig-get-statuses',
  exportConfig: 'phonedek:export-config',
  importConfig: 'phonedek:import-config',
  openLogs: 'phonedek:open-logs',
  openAccessibility: 'phonedek:open-accessibility',
  openExternal: 'phonedek:open-external',
  copyText: 'phonedek:copy-text',
  getPermissionStatus: 'phonedek:get-permission-status',
  requestPermission: 'phonedek:request-permission',
  openPermissionSetup: 'phonedek:open-permission-setup',
  revealPermissionFile: 'phonedek:reveal-permission-file',
  getUpdateStatus: 'phonedek:update-get-status',
  checkForUpdates: 'phonedek:update-check',
  installUpdate: 'phonedek:update-install',
  updateStatusEvent: 'phonedek:update-status',
  serverInfoEvent: 'phonedek:server-info',
  configChangedEvent: 'phonedek:config-changed',
  openPairEvent: 'phonedek:open-pair',
} as const
