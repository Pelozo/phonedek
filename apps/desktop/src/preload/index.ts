import { contextBridge, ipcRenderer } from 'electron'
import type { Action, ConnectedClient, DeckConfig, PressResult } from '@phonedek/shared'
import { IPC } from '../shared/api'
import type {
  AppState,
  AssetPickResult,
  OperationResult,
  PhoneDeckApi,
  SaveConfigResult,
  ServerInfoView,
  UpdateStatus,
} from '../shared/api'

const api: PhoneDeckApi = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getState),
  saveConfig: (config: DeckConfig): Promise<SaveConfigResult> => ipcRenderer.invoke(IPC.saveConfig, config),
  importAsset: (): Promise<AssetPickResult> => ipcRenderer.invoke(IPC.importAsset),
  pickApplication: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickApplication),
  testActions: (actions: Action[], label?: string): Promise<PressResult> =>
    ipcRenderer.invoke(IPC.testActions, actions, label),
  setPort: (port: number): Promise<OperationResult> => ipcRenderer.invoke(IPC.setPort, port),
  rotateToken: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.rotateToken),
  setDiscovery: (enabled: boolean): Promise<OperationResult> => ipcRenderer.invoke(IPC.setDiscovery, enabled),
  setLaunchAtLogin: (enabled: boolean): Promise<OperationResult> => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled),
  setPairHost: (host: string): Promise<OperationResult> => ipcRenderer.invoke(IPC.setPairHost, host),
  exportConfig: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.exportConfig),
  importConfig: (): Promise<SaveConfigResult> => ipcRenderer.invoke(IPC.importConfig),
  openLogs: (): Promise<void> => ipcRenderer.invoke(IPC.openLogs),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.getUpdateStatus),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),
  onUpdateStatus: (listener: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(IPC.updateStatusEvent, handler)
    return () => ipcRenderer.removeListener(IPC.updateStatusEvent, handler)
  },
  onServerInfo: (listener: (info: ServerInfoView) => void): (() => void) => {
    const handler = (_event: unknown, info: ServerInfoView): void => listener(info)
    ipcRenderer.on(IPC.serverInfoEvent, handler)
    return () => ipcRenderer.removeListener(IPC.serverInfoEvent, handler)
  },
  onConfigChanged: (listener: (config: DeckConfig) => void): (() => void) => {
    const handler = (_event: unknown, config: DeckConfig): void => listener(config)
    ipcRenderer.on(IPC.configChangedEvent, handler)
    return () => ipcRenderer.removeListener(IPC.configChangedEvent, handler)
  },
}

// Keep the unused import in the type surface for renderer convenience.
export type { ConnectedClient }

contextBridge.exposeInMainWorld('phonedek', api)
