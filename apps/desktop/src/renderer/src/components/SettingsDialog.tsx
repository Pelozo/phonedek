import { useEffect, useRef, useState } from 'react'
import { BRIGHTNESS_CAPABILITY } from '@phonedek/shared'
import type { ConnectedClient, DeckConfig } from '@phonedek/shared'
import type {
  ObsInputView,
  ObsSettingsInput,
  ObsStatusView,
  ServerInfoView,
  SettingsView,
  UpdateStatus,
  PermissionStatus,
} from '../../../shared/api'
import {
  canCheckForUpdates,
  formatProgressDetail,
  summarizeUpdateStatus,
  updateProgressPercent,
} from '../../../shared/update-status'
import { obsEndpoint, obsStatusSummary } from '../lib/obs'
import { Icon } from './Icons'
import { LightsSettings } from './LightsSettings'
import { Modal, Slider, Toggle, useConfirm } from './Primitives'
import { TwitchSettings } from './TwitchSettings'

function PhoneBrightnessRow({
  client,
  onToast,
}: {
  client: ConnectedClient
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const capable = client.capabilities?.includes(BRIGHTNESS_CAPABILITY) ?? false
  const [percent, setPercent] = useState(() => Math.round((client.brightnessLevel ?? 0.5) * 100))
  const [usingSystem, setUsingSystem] = useState(client.brightnessLevel === null)
  const latest = useRef(percent)
  const lastSent = useRef(0)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const send = (level: number | null): void => {
    void window.phonedek
      .setPhoneBrightness(client.id, level)
      .then((result) => {
        if (!result.ok) onToast(result.error ?? 'Could not update phone brightness', 'error')
      })
      .catch((error: unknown) => {
        onToast(error instanceof Error ? error.message : String(error), 'error')
      })
  }

  const cancelPending = (): void => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }

  const schedule = (value: number, immediate = false): void => {
    latest.current = value
    const now = Date.now()
    const elapsed = now - lastSent.current
    if (immediate || elapsed >= 100) {
      cancelPending()
      lastSent.current = now
      send(value / 100)
      return
    }
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      lastSent.current = Date.now()
      send(latest.current / 100)
    }, 100 - elapsed)
  }

  const name = client.device?.name?.trim() || 'Connected phone'
  const detail = [client.device?.model?.trim(), client.address].filter(Boolean).join(' · ')

  return (
    <div className="phone-row">
      <div className="phone-head">
        <span className="phone-icon" aria-hidden="true">
          <Icon name="phone" size={16} />
        </span>
        <div>
          <strong>{name}</strong>
          {detail && <small>{detail}</small>}
        </div>
      </div>

      {capable ? (
        <>
          <Slider
            label="Brightness"
            ariaLabel={`Brightness for ${name}`}
            value={percent}
            min={0}
            max={100}
            suffix="%"
            onChange={(value) => {
              setUsingSystem(false)
              setPercent(value)
              schedule(value)
            }}
            onCommit={(value) => {
              setUsingSystem(false)
              setPercent(value)
              schedule(value, true)
            }}
          />
          <div className="phone-actions">
            <span className="phone-mode">{usingSystem ? 'System brightness' : 'Window brightness'}</span>
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                cancelPending()
                setUsingSystem(true)
                latest.current = percent
                send(null)
              }}
            >
              Use system
            </button>
          </div>
        </>
      ) : (
        <p className="phone-capability">Update the phone app to control brightness.</p>
      )}
    </div>
  )
}

export function SettingsDialog({
  server,
  settings,
  serverName,
  updateStatus,
  permission,
  onGrantPermission,
  onOpenPermissionSetup,
  onCheckForUpdates,
  onInstallUpdate,
  onRenameServer,
  onClose,
  onServerUpdate,
  onConfigImported,
  onToast,
}: {
  server: ServerInfoView
  settings: SettingsView
  serverName: string
  updateStatus: UpdateStatus | null
  permission: PermissionStatus | null
  onGrantPermission: () => Promise<void>
  onOpenPermissionSetup: () => Promise<void>
  onCheckForUpdates: () => Promise<UpdateStatus>
  onInstallUpdate: () => Promise<void>
  onRenameServer: (name: string) => void
  onClose: () => void
  onServerUpdate: (server: ServerInfoView) => void
  onConfigImported: (config: DeckConfig) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [busy, setBusy] = useState(false)
  const [nameDraft, setNameDraft] = useState(serverName)
  const [obsStatus, setObsStatus] = useState<ObsStatusView>(server.obsStatus)
  const [obsHostDraft, setObsHostDraft] = useState(settings.obsHost)
  const [obsPortDraft, setObsPortDraft] = useState(String(settings.obsPort))
  const [obsPasswordDraft, setObsPasswordDraft] = useState('')
  const [obsBusy, setObsBusy] = useState(false)
  const [obsInputList, setObsInputList] = useState<ObsInputView[] | null>(null)
  const [obsInputsError, setObsInputsError] = useState<string | null>(null)
  const confirm = useConfirm()

  useEffect(() => setNameDraft(serverName), [serverName])
  useEffect(() => setObsStatus(server.obsStatus), [server.obsStatus])
  useEffect(() => setObsHostDraft(settings.obsHost), [settings.obsHost])
  useEffect(() => setObsPortDraft(String(settings.obsPort)), [settings.obsPort])
  useEffect(() => {
    if (!settings.obsHasPassword) setObsPasswordDraft('')
  }, [settings.obsHasPassword])

  // Re-poll while the dialog is open: the main process pushes status changes,
  // but a direct poll also refreshes the retry countdown and first connect.
  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.phonedek.getObsStatus()
        if (active) setObsStatus(next)
      } catch {
        // OBS status is informational; keep the rest of Settings usable.
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const commitName = (): void => {
    const next = nameDraft.trim()
    if (next && next !== serverName) onRenameServer(next)
    else setNameDraft(serverName)
  }

  const toggleLogin = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setLaunchAtLogin(enabled)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Could not update auto-start', 'error')
    } finally {
      setBusy(false)
    }
  }

  const applyScreenshotFolder = async (path: string): Promise<void> => {
    const result = await window.phonedek.setScreenshotDirectory(path)
    if (result.state) onServerUpdate(result.state.server)
    if (!result.ok) {
      onToast(result.error ?? 'Could not update the screenshot folder', 'error')
      return
    }
    onToast(path ? 'Screenshot folder updated' : 'Screenshots will use the Desktop', 'success')
  }

  const chooseScreenshotFolder = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.phonedek.pickScreenshotDirectory()
      if (path) await applyScreenshotFolder(path)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const useDesktopScreenshotFolder = async (): Promise<void> => {
    setBusy(true)
    try {
      await applyScreenshotFolder('')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleTray = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setMinimizeToTray(enabled)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Could not update tray preference', 'error')
    } finally {
      setBusy(false)
    }
  }

  const togglePointerControl = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setAllowPointerControl(enabled)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Could not update pointer control', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleKeyboardControl = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setAllowKeyboardControl(enabled)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Could not update keyboard control', 'error')
    } finally {
      setBusy(false)
    }
  }

  const pushObsSettings = async (input: ObsSettingsInput) => {
    const result = await window.phonedek.setObsSettings(input)
    if (result.state) onServerUpdate(result.state.server)
    return result
  }

  const refreshObsStatus = async (): Promise<ObsStatusView | null> => {
    try {
      const next = await window.phonedek.getObsStatus()
      setObsStatus(next)
      return next
    } catch {
      return null
    }
  }

  const applyObsSettings = async (input: ObsSettingsInput, success?: string): Promise<boolean> => {
    setObsBusy(true)
    try {
      const result = await pushObsSettings(input)
      if (!result.ok) onToast(result.error ?? 'Could not update OBS settings', 'error')
      else if (success) onToast(success, 'success')
      await refreshObsStatus()
      return result.ok
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
      return false
    } finally {
      setObsBusy(false)
    }
  }

  const toggleObs = (enabled: boolean): void => {
    void applyObsSettings({ enabled }, enabled ? 'OBS control enabled' : 'OBS control disabled')
  }

  const commitObsHost = (): void => {
    const next = obsHostDraft.trim()
    if (next === settings.obsHost) {
      setObsHostDraft(settings.obsHost)
      return
    }
    void applyObsSettings({ host: next }, 'OBS host updated')
  }

  const commitObsPort = (): void => {
    const port = Number(obsPortDraft)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      onToast('OBS port must be between 1 and 65535', 'error')
      setObsPortDraft(String(settings.obsPort))
      return
    }
    if (port === settings.obsPort) return
    void applyObsSettings({ port }, 'OBS port updated')
  }

  const setObsPassword = async (): Promise<void> => {
    if (!obsPasswordDraft) return
    const ok = await applyObsSettings({ password: obsPasswordDraft }, 'OBS password updated')
    if (ok) setObsPasswordDraft('')
  }

  const clearObsPassword = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Clear OBS password',
      message: 'Remove the stored OBS WebSocket password?',
      warning: 'Only do this when OBS WebSocket authentication is disabled.',
      confirmLabel: 'Clear password',
      danger: true,
    })
    if (!confirmed) return
    const ok = await applyObsSettings({ clearPassword: true }, 'OBS password cleared')
    if (ok) setObsPasswordDraft('')
  }

  const testObsConnection = async (): Promise<void> => {
    setObsBusy(true)
    try {
      if (!settings.obsEnabled) {
        const enabled = await pushObsSettings({ enabled: true })
        if (!enabled.ok) {
          onToast(enabled.error ?? 'Could not enable OBS', 'error')
          return
        }
      } else {
        // The client only restarts on a config change; cycle the master switch
        // to force an immediate attempt instead of waiting for the backoff.
        await pushObsSettings({ enabled: false })
        const enabled = await pushObsSettings({ enabled: true })
        if (!enabled.ok) {
          onToast(enabled.error ?? 'Could not reconnect OBS', 'error')
          return
        }
      }
      const next = await refreshObsStatus()
      onToast(
        next?.state === 'connected'
          ? 'OBS connected'
          : 'OBS reconnect requested — check that OBS is running with the WebSocket server enabled',
        next?.state === 'connected' ? 'success' : 'info',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setObsBusy(false)
    }
  }

  const refreshObsInputs = async (): Promise<void> => {
    setObsBusy(true)
    setObsInputsError(null)
    try {
      const result = await window.phonedek.listObsInputs()
      if (!result.ok) {
        setObsInputsError(result.error ?? 'Could not list OBS inputs')
        setObsInputList([])
        return
      }
      setObsInputList(result.inputs ?? [])
    } catch (error) {
      setObsInputsError(error instanceof Error ? error.message : String(error))
    } finally {
      setObsBusy(false)
    }
  }

  const exportConfig = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.exportConfig()
      if (result.ok) onToast('Configuration exported', 'success')
      else if (result.error) onToast(result.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  const importConfig = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.importConfig()
      if (result.ok && result.config) {
        onConfigImported(result.config)
        onToast('Configuration imported', 'success')
      } else if (result.errors?.length) {
        onToast(result.errors[0] ?? 'Import failed', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setBusy(true)
    try {
      await onCheckForUpdates()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    const version = updateStatus?.availableVersion
    const message = version
      ? `PhoneDeck will close and restart to install version ${version}. Continue?`
      : 'PhoneDeck will close and restart to install the downloaded update. Continue?'
    const confirmed = await confirm({
      title: 'Restart and install',
      message,
      confirmLabel: 'Restart and install',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await onInstallUpdate()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
      setBusy(false)
    }
  }

  const grantPermission = async (): Promise<void> => {
    setBusy(true)
    try {
      await onGrantPermission()
    } finally {
      setBusy(false)
    }
  }

  const copyHelperPath = async (path: string): Promise<void> => {
    try {
      await window.phonedek.copyText(path)
      onToast('Helper path copied', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const obsSummary = obsStatusSummary(obsStatus)
  const obsHostIsLoopback = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(
    obsHostDraft.trim(),
  )

  const updateSummary = updateStatus
    ? summarizeUpdateStatus(updateStatus)
    : {
        title: 'Update status unavailable',
        detail: 'The desktop process did not report update state. Restart PhoneDeck and try again.',
        tone: 'neutral' as const,
      }
  const updatePercent = updateStatus?.state === 'downloading' ? updateProgressPercent(updateStatus) : null
  const checkDisabled = busy || !updateStatus || !canCheckForUpdates(updateStatus)

  return (
    <Modal
      title="Settings"
      subtitle="Desktop app preferences and diagnostics."
      onClose={onClose}
      footer={
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-section">
        <h3>Deck</h3>
        <label className="field">
          <span>Name shown on the phone</span>
          <input
            value={nameDraft}
            maxLength={80}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </label>
      </div>

      <div className="settings-section">
        <h3>Startup</h3>
        <Toggle
          label="Start PhoneDeck with your computer"
          description="The deck keeps working after you sign in."
          checked={settings.launchAtLogin}
          onChange={(enabled) => void toggleLogin(enabled)}
          disabled={busy}
        />
      </div>

      <div className="settings-section">
        <h3>Window</h3>
        <Toggle
          label="Keep PhoneDeck in the tray"
          description="Closing the window keeps the deck server running. Use the tray menu to show or quit PhoneDeck."
          checked={settings.minimizeToTray}
          onChange={(enabled) => void toggleTray(enabled)}
          disabled={busy}
        />
      </div>

      <div className="settings-section">
        <h3>Input</h3>
        <Toggle
          label="Allow pointer control"
          description="A paired phone can move the mouse and click. Turn this off to suspend all pointer input."
          checked={settings.allowPointerControl}
          onChange={(enabled) => void togglePointerControl(enabled)}
          disabled={busy}
        />
        <Toggle
          label="Allow keyboard control"
          description="A paired phone can type into the active PC window. Turn this off to suspend all phone typing."
          checked={settings.allowKeyboardControl}
          onChange={(enabled) => void toggleKeyboardControl(enabled)}
          disabled={busy}
        />
      </div>

      <div className="settings-section">
        <h3>OBS Studio</h3>
        <Toggle
          label="Control OBS through its WebSocket server"
          description="OBS 28 or newer. The connection is unencrypted; use localhost or a trusted LAN."
          checked={settings.obsEnabled}
          onChange={toggleObs}
          disabled={busy || obsBusy}
        />

        <div className={`obs-status ${obsSummary.tone}`}>
          <span
            className={`dot ${
              obsSummary.tone === 'ok' ? 'online' : obsSummary.tone === 'error' ? 'error' : 'offline'
            }`}
            aria-hidden="true"
          />
          <div>
            <strong>{obsSummary.label}</strong>
            <small>{obsSummary.detail}</small>
          </div>
          <span className="mono obs-status-endpoint">{obsEndpoint(obsStatus)}</span>
        </div>

        <div className="two-col">
          <label className="field">
            <span>Host</span>
            <input
              value={obsHostDraft}
              placeholder="127.0.0.1"
              spellCheck={false}
              disabled={!settings.obsEnabled || obsBusy}
              onChange={(event) => setObsHostDraft(event.target.value)}
              onBlur={commitObsHost}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
            />
          </label>
          <label className="field">
            <span>Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={obsPortDraft}
              placeholder="4455"
              disabled={!settings.obsEnabled || obsBusy}
              onChange={(event) => setObsPortDraft(event.target.value)}
              onBlur={commitObsPort}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
            />
          </label>
        </div>
        {!obsHostIsLoopback && (
          <p className="hint">
            This host is not loopback. OBS WebSocket is not encrypted, so only use a host on a trusted LAN.
          </p>
        )}

        <label className="field">
          <span>
            Password {settings.obsHasPassword && <em className="tag">Password set</em>}
          </span>
          <input
            type="password"
            value={obsPasswordDraft}
            autoComplete="new-password"
            disabled={!settings.obsEnabled || obsBusy}
            placeholder={
              settings.obsHasPassword
                ? 'Enter a new password to replace the stored one'
                : 'No password set'
            }
            onChange={(event) => setObsPasswordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </label>
        <div className="row gap">
          <button
            type="button"
            className="button secondary small"
            onClick={() => void setObsPassword()}
            disabled={!obsPasswordDraft || obsBusy || !settings.obsEnabled}
          >
            Set password
          </button>
          {settings.obsHasPassword && (
            <button
              type="button"
              className="button ghost small"
              onClick={() => void clearObsPassword()}
              disabled={obsBusy || !settings.obsEnabled}
            >
              Clear password
            </button>
          )}
          <span className="hint">Stored on this PC only; never shown or sent to the phone.</span>
        </div>

        <div className="row gap">
          <button
            type="button"
            className="button secondary small"
            onClick={() => void testObsConnection()}
            disabled={obsBusy}
          >
            <Icon name="refresh" size={14} /> Test / reconnect
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={() => void refreshObsInputs()}
            disabled={obsBusy || obsStatus.state !== 'connected'}
          >
            <Icon name="sliders" size={14} /> Refresh inputs
          </button>
          <span className="hint">In OBS: Tools → WebSocket Server Settings → Enable WebSocket server.</span>
        </div>

        {obsInputsError && <p className="hint error-text">{obsInputsError}</p>}
        {obsInputList && !obsInputsError && (
          <div className="obs-input-summary">
            <span className="mono">
              {obsInputList.length} input{obsInputList.length === 1 ? '' : 's'} in this scene collection
            </span>
            {obsInputList.length > 0 && (
              <div className="obs-input-chips">
                {obsInputList.slice(0, 8).map((input) => (
                  <span className="obs-input-chip" key={input.name}>
                    {input.name}
                    {input.audio ? ' · audio' : ''}
                  </span>
                ))}
                {obsInputList.length > 8 && <span className="obs-input-chip">+{obsInputList.length - 8}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      <TwitchSettings
        server={server}
        settings={settings}
        onServerUpdate={onServerUpdate}
        onToast={onToast}
      />

      <LightsSettings
        settings={settings}
        onServerUpdate={onServerUpdate}
        onToast={onToast}
      />

      <div className="settings-section">
        <h3>Phone</h3>
        {server.clients.length === 0 ? (
          <p className="phone-empty">No phones connected.</p>
        ) : (
          server.clients.map((client) => (
            <PhoneBrightnessRow key={client.id} client={client} onToast={onToast} />
          ))
        )}
      </div>

      <div className="settings-section">
        <h3>Screenshots</h3>
        <div className="settings-row">
          <div>
            <strong>Capture folder</strong>
            <small>Used for full-screen captures on macOS. Windows uses the Snipping Tool.</small>
          </div>
        </div>
        <div className="path-box" title={settings.screenshotDirectory || 'Desktop (default)'}>
          <Icon name="folder" size={15} />
          <code>{settings.screenshotDirectory || 'Desktop (default)'}</code>
        </div>
        <div className="row gap">
          <button
            type="button"
            className="button secondary small"
            onClick={() => void chooseScreenshotFolder()}
            disabled={busy}
          >
            <Icon name="folder" size={14} /> Choose folder…
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void useDesktopScreenshotFolder()}
            disabled={busy || !settings.screenshotDirectory}
          >
            Use Desktop
          </button>
        </div>
      </div>

      {permission?.supported && (
        <div className="settings-section">
          <h3>Input permission</h3>
          <div className={`permission-card ${permission.granted ? 'ok' : 'warn'}`}>
            <div className="permission-card-head">
              <span className="permission-card-icon" aria-hidden="true">
                <Icon name={permission.granted ? 'check' : 'lock'} size={17} />
              </span>
              <div>
                <strong>{permission.granted ? 'Input control allowed' : 'Input control blocked'}</strong>
                <small>
                  {permission.granted
                    ? 'PhoneDeck can send keystrokes, clicks and media keys.'
                    : `macOS needs PhoneDeck allowed in ${permission.paneName}. The phone can connect, but actions fail until it is enabled.`}
                </small>
              </div>
            </div>

            {!permission.granted && (
              <>
                <div className="row gap">
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => void onOpenPermissionSetup()}
                  >
                    <Icon name="folder" size={14} /> Open permission setup
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => void grantPermission()}
                    disabled={busy}
                  >
                    <Icon name="check" size={14} /> Try macOS prompt
                  </button>
                </div>

                {permission.appPath && (
                  <div className="permission-helper-path">
                    <span>
                      If the switch is already on, macOS 27 may need the executable itself. Add this file, then
                      relaunch PhoneDeck:
                    </span>
                    <div className="permission-file">
                      <strong>App executable</strong>
                      <div className="path-box" title={permission.appPath}>
                        <Icon name="folder" size={15} />
                        <code>{permission.appPath}</code>
                      </div>
                      <div className="row gap">
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => void window.phonedek.revealPermissionFile('app')}
                        >
                          <Icon name="folder" size={14} /> Show
                        </button>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => void copyHelperPath(permission.appPath as string)}
                        >
                          <Icon name="copy" size={14} /> Copy
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3>Updates</h3>
        <div className={`update-card ${updateSummary.tone}`}>
          <div className="update-card-head">
            <span className="update-card-icon">
              <Icon
                name={
                  updateStatus?.state === 'downloaded'
                    ? 'check'
                    : updateStatus?.state === 'checking'
                      ? 'refresh'
                      : updateStatus?.state === 'disabled'
                        ? 'monitor'
                        : updateStatus?.state === 'error'
                          ? 'bolt'
                          : 'download'
                }
                size={18}
              />
            </span>
            <div className="update-card-text">
              <strong>{updateSummary.title}</strong>
              <small>{updateSummary.detail}</small>
            </div>
          </div>

          {updateStatus?.state === 'downloading' && updatePercent !== null && (
            <div className="update-progress">
              <div
                className="update-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={updatePercent}
              >
                <span style={{ width: `${updatePercent}%` }} />
              </div>
              <div className="update-progress-meta">{formatProgressDetail(updateStatus)}</div>
            </div>
          )}

          <div className="update-meta">
            <span>Installed version</span>
            <strong>{updateStatus?.currentVersion ?? server.version}</strong>
            {updateStatus?.availableVersion && (
              <>
                <span>Available version</span>
                <strong>{updateStatus.availableVersion}</strong>
              </>
            )}
          </div>

          <div className="settings-row">
            <div>
              <strong>GitHub Releases</strong>
              <small>Checks the public release feed over HTTPS. No GitHub account or token is required.</small>
            </div>
            <div className="row gap">
              <button
                type="button"
                className="button secondary"
                onClick={() => void checkUpdates()}
                disabled={checkDisabled}
              >
                <Icon name={updateStatus?.state === 'checking' ? 'refresh' : 'download'} size={15} />
                {updateStatus?.state === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {updateStatus?.state === 'downloaded' && (
                <button type="button" className="button primary" onClick={() => void installUpdate()} disabled={busy}>
                  <Icon name="arrow-up" size={15} /> Restart and install
                </button>
              )}
            </div>
          </div>

          {updateStatus?.state === 'disabled' && (
            <p className="update-note">
              {updateStatus.message ??
                'Automatic updates are unavailable in this build. Download the latest release from GitHub Releases to update manually.'}
            </p>
          )}
          {updateStatus?.state === 'error' && (
            <p className="update-note">You can retry the check, or download the latest installer from GitHub Releases.</p>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3>Configuration</h3>
        <div className="settings-row">
          <div>
            <strong>Export / import</strong>
            <small>A ZIP backup with profiles, pages, actions and background images.</small>
          </div>
          <div className="row gap">
            <button type="button" className="button secondary" onClick={() => void exportConfig()} disabled={busy}>
              <Icon name="download" size={15} /> Export backup
            </button>
            <button type="button" className="button secondary" onClick={() => void importConfig()} disabled={busy}>
              <Icon name="upload" size={15} /> Import backup
            </button>
          </div>
        </div>
        <div className="path-box" title={server.configPath}>
          <Icon name="folder" size={15} />
          <code>{server.configPath}</code>
        </div>
      </div>

      <div className="settings-section">
        <h3>Diagnostics</h3>
        <div className="settings-row">
          <div>
            <strong>Log file</strong>
            <small>Connection, action and keyboard-helper errors are written here.</small>
          </div>
          <button type="button" className="button secondary" onClick={() => void window.phonedek.openLogs()}>
            <Icon name="terminal" size={15} /> Open logs
          </button>
        </div>
        <div className="about-grid">
          <span>Version</span>
          <strong>{server.version}</strong>
          <span>Platform</span>
          <strong>{server.platform}</strong>
          <span>Protocol</span>
          <strong>v1</strong>
        </div>
      </div>

      <div className="settings-section">
        <h3>About</h3>
        <p className="muted">
          PhoneDeck turns an Android phone into a wireless Stream Deck. The desktop app owns the configuration and runs
          the actions; the phone renders the deck and sends presses over your local network.
        </p>
      </div>
    </Modal>
  )
}
