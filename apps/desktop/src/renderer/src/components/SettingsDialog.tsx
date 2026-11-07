import { useEffect, useRef, useState } from 'react'
import { BRIGHTNESS_CAPABILITY } from '@phonedek/shared'
import type { ConnectedClient, DeckConfig } from '@phonedek/shared'
import type { ServerInfoView, SettingsView, UpdateStatus, PermissionStatus } from '../../../shared/api'
import {
  canCheckForUpdates,
  formatProgressDetail,
  summarizeUpdateStatus,
  updateProgressPercent,
} from '../../../shared/update-status'
import { Icon } from './Icons'
import { Modal, Slider, Toggle, useConfirm } from './Primitives'

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
  const confirm = useConfirm()

  useEffect(() => setNameDraft(serverName), [serverName])

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
        <h3>Phone</h3>
        {server.clients.length === 0 ? (
          <p className="phone-empty">No phones connected.</p>
        ) : (
          server.clients.map((client) => (
            <PhoneBrightnessRow key={client.id} client={client} onToast={onToast} />
          ))
        )}
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
