import { useState } from 'react'
import type { DeckConfig } from '@phonedek/shared'
import type { ServerInfoView, SettingsView } from '../../../shared/api'
import { Icon } from './Icons'
import { Modal, Toggle } from './Primitives'

export function SettingsDialog({
  server,
  settings,
  onClose,
  onServerUpdate,
  onConfigImported,
  onToast,
}: {
  server: ServerInfoView
  settings: SettingsView
  onClose: () => void
  onServerUpdate: (server: ServerInfoView) => void
  onConfigImported: (config: DeckConfig) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [busy, setBusy] = useState(false)

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
        <h3>Configuration</h3>
        <div className="settings-row">
          <div>
            <strong>Export / import</strong>
            <small>JSON profiles, pages and actions. Background images stay in PhoneDeck's data folder.</small>
          </div>
          <div className="row gap">
            <button type="button" className="button secondary" onClick={() => void exportConfig()} disabled={busy}>
              <Icon name="download" size={15} /> Export
            </button>
            <button type="button" className="button secondary" onClick={() => void importConfig()} disabled={busy}>
              <Icon name="upload" size={15} /> Import
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
