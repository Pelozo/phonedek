import { contextBridge, ipcRenderer } from 'electron'
import type { Action, AssetKind, ConnectedClient, DeckConfig, PressResult } from '@phonedek/shared'
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
  PermissionStatus,
  PhoneDeckApi,
  SaveConfigResult,
  ServerInfoView,
  TwitchAuthStartResult,
  TwitchSettingsInput,
  TwitchStatusView,
  UpdateStatus,
} from '../shared/api'

const api: PhoneDeckApi = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getState),
  saveConfig: (config: DeckConfig): Promise<SaveConfigResult> => ipcRenderer.invoke(IPC.saveConfig, config),
  importAsset: (kind?: AssetKind): Promise<AssetPickResult> => ipcRenderer.invoke(IPC.importAsset, kind),
  pickApplication: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickApplication),
  testActions: (actions: Action[], label?: string): Promise<PressResult> =>
    ipcRenderer.invoke(IPC.testActions, actions, label),
  testControlInput: (
    profileId: string,
    pageId: string,
    buttonId: string,
    delta: number,
    value?: number,
  ): Promise<PressResult> =>
    ipcRenderer.invoke(IPC.testControlInput, profileId, pageId, buttonId, delta, value),
  setPort: (port: number): Promise<OperationResult> => ipcRenderer.invoke(IPC.setPort, port),
  rotateToken: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.rotateToken),
  setDiscovery: (enabled: boolean): Promise<OperationResult> => ipcRenderer.invoke(IPC.setDiscovery, enabled),
  setLaunchAtLogin: (enabled: boolean): Promise<OperationResult> => ipcRenderer.invoke(IPC.setLaunchAtLogin, enabled),
  setMinimizeToTray: (enabled: boolean): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setMinimizeToTray, enabled),
  setAllowPointerControl: (enabled: boolean): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setAllowPointerControl, enabled),
  setAllowKeyboardControl: (enabled: boolean): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setAllowKeyboardControl, enabled),
  setPairHost: (host: string): Promise<OperationResult> => ipcRenderer.invoke(IPC.setPairHost, host),
  setPhoneBrightness: (clientId: string, level: number | null): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setPhoneBrightness, clientId, level),
  setScreenshotDirectory: (path: string): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setScreenshotDirectory, path),
  pickScreenshotDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.pickScreenshotDirectory),
  getObsStatus: (): Promise<ObsStatusView> => ipcRenderer.invoke(IPC.getObsStatus),
  setObsSettings: (input: ObsSettingsInput): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setObsSettings, input),
  listObsInputs: (): Promise<ObsInputsResult> => ipcRenderer.invoke(IPC.listObsInputs),
  testObsInputVolume: (input: string | undefined, percent: number): Promise<PressResult> =>
    ipcRenderer.invoke(IPC.testObsInputVolume, input, percent),
  testObsMute: (input?: string): Promise<PressResult> =>
    ipcRenderer.invoke(IPC.testObsMute, input),
  getTwitchStatus: (): Promise<TwitchStatusView> => ipcRenderer.invoke(IPC.getTwitchStatus),
  setTwitchSettings: (input: TwitchSettingsInput): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setTwitchSettings, input),
  startTwitchAuth: (): Promise<TwitchAuthStartResult> => ipcRenderer.invoke(IPC.startTwitchAuth),
  cancelTwitchAuth: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.cancelTwitchAuth),
  disconnectTwitch: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.disconnectTwitch),
  setLightSettings: (input: LightSettingsInput): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setLightSettings, input),
  getLightStatuses: (): Promise<LightStatusView[]> => ipcRenderer.invoke(IPC.getLightStatuses),
  setAutoProfileSettings: (input: AutoProfileSettingsInput): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.setAutoProfileSettings, input),
  exportConfig: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.exportConfig),
  importConfig: (): Promise<SaveConfigResult> => ipcRenderer.invoke(IPC.importConfig),
  openLogs: (): Promise<void> => ipcRenderer.invoke(IPC.openLogs),
  openAccessibility: (): Promise<void> => ipcRenderer.invoke(IPC.openAccessibility),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  getPermissionStatus: (): Promise<PermissionStatus> => ipcRenderer.invoke(IPC.getPermissionStatus),
  requestPermission: (): Promise<PermissionStatus> => ipcRenderer.invoke(IPC.requestPermission),
  openPermissionSetup: (): Promise<void> => ipcRenderer.invoke(IPC.openPermissionSetup),
  revealPermissionFile: (kind: 'app' | 'helper'): Promise<void> =>
    ipcRenderer.invoke(IPC.revealPermissionFile, kind),
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
  onOpenPair: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.openPairEvent, handler)
    return () => ipcRenderer.removeListener(IPC.openPairEvent, handler)
  },
}

// Keep the unused import in the type surface for renderer convenience.
export type { ConnectedClient }

contextBridge.exposeInMainWorld('phonedek', api)
