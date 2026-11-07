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
}

export interface SettingsView {
  port: number
  discovery: boolean
  launchAtLogin: boolean
  minimizeToTray: boolean
  pairHost: string
  /** macOS capture folder; empty = OS Desktop. */
  screenshotDirectory: string
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
  testControlInput(profileId: string, pageId: string, buttonId: string, delta: number): Promise<PressResult>
  setPort(port: number): Promise<OperationResult>
  rotateToken(): Promise<OperationResult>
  setDiscovery(enabled: boolean): Promise<OperationResult>
  setLaunchAtLogin(enabled: boolean): Promise<OperationResult>
  setMinimizeToTray(enabled: boolean): Promise<OperationResult>
  setPairHost(host: string): Promise<OperationResult>
  setPhoneBrightness(clientId: string, level: number | null): Promise<OperationResult>
  setScreenshotDirectory(path: string): Promise<OperationResult>
  pickScreenshotDirectory(): Promise<string | null>
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
  setPairHost: 'phonedek:set-pair-host',
  setPhoneBrightness: 'phonedek:set-phone-brightness',
  setScreenshotDirectory: 'phonedek:set-screenshot-directory',
  pickScreenshotDirectory: 'phonedek:pick-screenshot-directory',
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
