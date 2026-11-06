import type { Action, ConnectedClient, DeckConfig, PressResult } from '@phonedek/shared'

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

export interface PhoneDeckApi {
  getState(): Promise<AppState>
  saveConfig(config: DeckConfig): Promise<SaveConfigResult>
  importAsset(): Promise<AssetPickResult>
  pickApplication(): Promise<string | null>
  testActions(actions: Action[], label?: string): Promise<PressResult>
  setPort(port: number): Promise<OperationResult>
  rotateToken(): Promise<OperationResult>
  setDiscovery(enabled: boolean): Promise<OperationResult>
  setLaunchAtLogin(enabled: boolean): Promise<OperationResult>
  exportConfig(): Promise<OperationResult>
  importConfig(): Promise<SaveConfigResult>
  openLogs(): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  onServerInfo(listener: (info: ServerInfoView) => void): () => void
  onConfigChanged(listener: (config: DeckConfig) => void): () => void
}

export const IPC = {
  getState: 'phonedek:get-state',
  saveConfig: 'phonedek:save-config',
  importAsset: 'phonedek:import-asset',
  pickApplication: 'phonedek:pick-application',
  testActions: 'phonedek:test-actions',
  setPort: 'phonedek:set-port',
  rotateToken: 'phonedek:rotate-token',
  setDiscovery: 'phonedek:set-discovery',
  setLaunchAtLogin: 'phonedek:set-launch-at-login',
  exportConfig: 'phonedek:export-config',
  importConfig: 'phonedek:import-config',
  openLogs: 'phonedek:open-logs',
  openExternal: 'phonedek:open-external',
  copyText: 'phonedek:copy-text',
  serverInfoEvent: 'phonedek:server-info',
  configChangedEvent: 'phonedek:config-changed',
} as const
