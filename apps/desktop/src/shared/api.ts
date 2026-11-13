import type { Action, AssetKind, ConnectedClient, DeckConfig, PressResult } from '@phonedek/shared'

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
}

export interface SettingsView {
  port: number
  discovery: boolean
  launchAtLogin: boolean
  minimizeToTray: boolean
  /** Paired phones may move the cursor and click. */
  allowPointerControl: boolean
  pairHost: string
  /** macOS capture folder; empty = OS Desktop. */
  screenshotDirectory: string
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
  setPairHost(host: string): Promise<OperationResult>
  setPhoneBrightness(clientId: string, level: number | null): Promise<OperationResult>
  setScreenshotDirectory(path: string): Promise<OperationResult>
  pickScreenshotDirectory(): Promise<string | null>
  getObsStatus(): Promise<ObsStatusView>
  setObsSettings(input: ObsSettingsInput): Promise<OperationResult>
  listObsInputs(): Promise<ObsInputsResult>
  testObsInputVolume(input: string | undefined, percent: number): Promise<PressResult>
  testObsMute(input?: string): Promise<PressResult>
  getTwitchStatus(): Promise<TwitchStatusView>
  setTwitchSettings(input: TwitchSettingsInput): Promise<OperationResult>
  startTwitchAuth(): Promise<TwitchAuthStartResult>
  cancelTwitchAuth(): Promise<OperationResult>
  disconnectTwitch(): Promise<OperationResult>
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
  setPairHost: 'phonedek:set-pair-host',
  setPhoneBrightness: 'phonedek:set-phone-brightness',
  setScreenshotDirectory: 'phonedek:set-screenshot-directory',
  pickScreenshotDirectory: 'phonedek:pick-screenshot-directory',
  getObsStatus: 'phonedek:obs-get-status',
  setObsSettings: 'phonedek:obs-set-settings',
  listObsInputs: 'phonedek:obs-list-inputs',
  testObsInputVolume: 'phonedek:obs-test-volume',
  testObsMute: 'phonedek:obs-test-mute',
  getTwitchStatus: 'phonedek:twitch-get-status',
  setTwitchSettings: 'phonedek:twitch-set-settings',
  startTwitchAuth: 'phonedek:twitch-start-auth',
  cancelTwitchAuth: 'phonedek:twitch-cancel-auth',
  disconnectTwitch: 'phonedek:twitch-disconnect',
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
