import { useEffect, useState } from 'react'
import type { ServerInfoView, SettingsView } from '../../../shared/api'
import { timeAgo } from '../lib/ui'
import { Icon } from './Icons'
import { Modal, Toggle } from './Primitives'

export function PairDialog({
  server,
  settings,
  onClose,
  onServerUpdate,
  onToast,
}: {
  server: ServerInfoView
  settings: SettingsView
  onClose: () => void
  onServerUpdate: (server: ServerInfoView) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [reveal, setReveal] = useState(false)
  const [port, setPort] = useState(String(settings.port))
  const [busy, setBusy] = useState(false)

  useEffect(() => setPort(String(settings.port)), [settings.port])

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await window.phonedek.copyText(text)
      onToast(`${label} copied`, 'success')
    } catch {
      onToast('Clipboard is unavailable. Select the text and copy manually.', 'error')
    }
  }

  const applyPort = async (): Promise<void> => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      onToast('Enter a port between 1024 and 65535', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await window.phonedek.setPort(value)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Could not change port', 'error')
      else onToast(`Server restarted on port ${value}`, 'success')
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (): Promise<void> => {
    if (!window.confirm('Rotate the pairing token? Every paired phone will be disconnected and must scan the new QR code.')) return
    setBusy(true)
    try {
      const result = await window.phonedek.rotateToken()
      if (result.state) onServerUpdate(result.state.server)
      if (result.ok) onToast('Pairing token rotated', 'success')
      else onToast(result.error ?? 'Could not rotate the token', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleDiscovery = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setDiscovery(enabled)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) onToast(result.error ?? 'Discovery failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Pair your phone"
      subtitle="Scan the QR code with your Android camera, or enter the details manually."
      onClose={onClose}
      wide
      footer={
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {server.error && (
        <div className="banner error">
          <Icon name="wifi" size={17} />
          <span>{server.error}</span>
        </div>
      )}

      <div className="pair-grid">
        <div className="pair-qr">
          {server.pair ? (
            <img src={server.pair.qrDataUrl} alt="PhoneDeck pairing QR code" />
          ) : (
            <div className="qr-placeholder">Server is not running</div>
          )}
          <div className="pair-status">
            <span className={server.running ? 'dot online' : 'dot offline'} />
            {server.running ? `Listening on port ${server.port}` : 'Server offline'}
            <button
              type="button"
              className="icon-button tiny"
              title="Refresh address and QR"
              onClick={async () => {
                const state = await window.phonedek.getState()
                onServerUpdate(state.server)
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>

        <div className="pair-details">
          <div className="pair-section">
            <h3>1. Connect the phone</h3>
            <ol className="steps-list">
              <li>Install the PhoneDeck Android APK and open it.</li>
              <li>Scan this QR with the normal camera app, or tap “Add server”.</li>
              <li>Keep the phone and PC on the same Wi-Fi network.</li>
            </ol>
          </div>

          <div className="pair-section">
            <h3>2. Server details</h3>
            <label className="field">
              <span>Pairing link</span>
              <div className="row gap">
                <input readOnly value={server.pair?.uri ?? ''} onFocus={(event) => event.target.select()} />
                <button type="button" className="button secondary" onClick={() => void copy(server.pair?.uri ?? '', 'Pairing link')}>
                  <Icon name="copy" size={15} /> Copy
                </button>
              </div>
            </label>
            <div className="two-col">
              <label className="field">
                <span>Host</span>
                <input readOnly value={server.pair?.host ?? '—'} />
              </label>
              <label className="field">
                <span>Port</span>
                <div className="row gap">
                  <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
                  <button type="button" className="button secondary" onClick={() => void applyPort()} disabled={busy}>
                    Apply
                  </button>
                </div>
              </label>
            </div>
            <label className="field">
              <span>Pairing token</span>
              <div className="row gap">
                <input readOnly type={reveal ? 'text' : 'password'} value={server.token} />
                <button type="button" className="button ghost" onClick={() => setReveal((value) => !value)}>
                  {reveal ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="icon-button bordered" onClick={() => void copy(server.token, 'Token')} aria-label="Copy token">
                  <Icon name="copy" size={15} />
                </button>
              </div>
            </label>
            <div className="row between">
              <Toggle
                label="LAN discovery"
                description="Phones find this PC automatically over UDP."
                checked={settings.discovery}
                onChange={(enabled) => void toggleDiscovery(enabled)}
                disabled={busy}
              />
              <button type="button" className="button danger ghost" onClick={() => void rotate()} disabled={busy}>
                <Icon name="refresh" size={15} /> Rotate token
              </button>
            </div>
          </div>

          <div className="pair-section">
            <h3>3. Connected devices</h3>
            {server.clients.length === 0 ? (
              <div className="device-empty">
                <Icon name="phone" size={18} /> No phones connected yet.
              </div>
            ) : (
              <div className="device-list">
                {server.clients.map((client) => (
                  <div className="device-row" key={client.id}>
                    <span className="dot online" />
                    <div>
                      <strong>{client.device?.name ?? 'Android device'}</strong>
                      <small>
                        {client.address}
                        {client.device?.model ? ` · ${client.device.model}` : ''} · connected {timeAgo(client.connectedAt)}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="banner info">
        <Icon name="wifi" size={17} />
        <span>
          If the phone cannot connect, allow PhoneDeck through Windows Defender Firewall for <strong>Private networks</strong>,
          and make sure your Wi-Fi does not isolate clients (guest networks often do).
        </span>
      </div>
    </Modal>
  )
}
