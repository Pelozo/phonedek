import { useEffect, useState } from 'react'
import type { DeckConfig } from '@phonedek/shared'
import type { ServerInfoView, SettingsView, UpdateStatus } from '../../../shared/api'
import {
  canCheckForUpdates,
  formatProgressDetail,
  summarizeUpdateStatus,
  updateProgressPercent,
} from '../../../shared/update-status'
import { Icon } from './Icons'
import { Modal, Toggle } from './Primitives'

export function SettingsDialog({
  server,
  settings,
  serverName,
  updateStatus,
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
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      await onInstallUpdate()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
      setBusy(false)
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
          label="Start PhoneDeck with Windows"
          description="The deck keeps working after you sign in."
          checked={settings.launchAtLogin}
          onChange={(enabled) => void toggleLogin(enabled)}
          disabled={busy}
        />
      </div>

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
              Automatic updates only run in the installed Windows build. Development and Linux builds must be updated
              manually.
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
