import { useEffect, useState } from 'react'
import type {
  ServerInfoView,
  SettingsView,
  StreamerBotSettingsInput,
  StreamerBotStatus,
} from '../../../shared/api'
import {
  isLoopbackStreamerbotHost,
  streamerbotEndpoint,
  streamerbotHostError,
  streamerbotPortError,
  streamerbotStatusSummary,
} from '../lib/streamerbot'
import { Icon } from './Icons'
import { Toggle, useConfirm } from './Primitives'

interface TestResult {
  ok: boolean
  message: string
}

/**
 * Settings → Integrations → Streamer.bot. The password is write-only: the
 * renderer only ever learns whether one is stored, and never receives it back.
 */
export function StreamerbotSettings({
  server,
  settings,
  onServerUpdate,
  onToast,
}: {
  server: ServerInfoView
  settings: SettingsView
  onServerUpdate: (server: ServerInfoView) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [status, setStatus] = useState<StreamerBotStatus>(server.streamerbotStatus)
  const [hostDraft, setHostDraft] = useState(settings.streamerbotHost)
  const [portDraft, setPortDraft] = useState(String(settings.streamerbotPort))
  const [passwordDraft, setPasswordDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const confirm = useConfirm()

  const summary = streamerbotStatusSummary(status)
  const endpoint = streamerbotEndpoint(status)
  const dirty =
    hostDraft.trim() !== settings.streamerbotHost ||
    Number(portDraft) !== settings.streamerbotPort ||
    passwordDraft.length > 0
  const hostError = streamerbotHostError(hostDraft)
  const portError = streamerbotPortError(portDraft)
  const loopback = isLoopbackStreamerbotHost(hostDraft)

  useEffect(() => setStatus(server.streamerbotStatus), [server.streamerbotStatus])
  useEffect(() => setHostDraft(settings.streamerbotHost), [settings.streamerbotHost])
  useEffect(() => setPortDraft(String(settings.streamerbotPort)), [settings.streamerbotPort])
  useEffect(() => {
    if (!settings.streamerbotHasPassword) setPasswordDraft('')
  }, [settings.streamerbotHasPassword])

  // Poll while Settings is open so connection attempts, retries and the
  // instance name appear without closing the dialog.
  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.phonedek.getStreamerbotStatus()
        if (active) setStatus(next)
      } catch {
        // Informational only; keep the rest of Settings usable.
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

  const refreshStatus = async (): Promise<StreamerBotStatus | null> => {
    try {
      const next = await window.phonedek.getStreamerbotStatus()
      setStatus(next)
      return next
    } catch {
      return null
    }
  }

  const waitForStatus = async (): Promise<StreamerBotStatus | null> => {
    let last: StreamerBotStatus | null = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      try {
        last = await window.phonedek.getStreamerbotStatus()
        setStatus(last)
        if (last.state !== 'connecting' && last.state !== 'reconnecting') return last
      } catch {
        // Keep polling; the next attempt may succeed.
      }
    }
    return last
  }

  const draftInput = (): StreamerBotSettingsInput | null => {
    const host = hostDraft.trim()
    if (hostError) {
      onToast(hostError, 'error')
      return null
    }
    const port = Number(portDraft)
    if (portError) {
      onToast(portError, 'error')
      return null
    }
    if (passwordDraft.length > 256) {
      onToast('Streamer.bot passwords are limited to 256 characters', 'error')
      return null
    }
    return {
      host,
      port,
      ...(passwordDraft.length > 0 ? { password: passwordDraft } : {}),
    }
  }

  const applyResult = (result: Awaited<ReturnType<typeof window.phonedek.setStreamerbotSettings>>): void => {
    if (result.state) {
      onServerUpdate(result.state.server)
      setStatus(result.state.server.streamerbotStatus)
    }
  }

  const save = async (): Promise<void> => {
    const input = draftInput()
    if (!input) return
    setBusy(true)
    setTestResult(null)
    try {
      const result = await window.phonedek.setStreamerbotSettings(input)
      applyResult(result)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update Streamer.bot settings', 'error')
        await refreshStatus()
        return
      }
      setPasswordDraft('')
      onToast('Streamer.bot settings saved', 'success')
      await refreshStatus()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    setTestResult(null)
    try {
      // Enabling also commits valid drafts so the toggle never connects with a
      // host/port the user just replaced on screen.
      const input = enabled ? draftInput() : null
      if (enabled && !input) return
      const result = await window.phonedek.setStreamerbotSettings(
        enabled ? { ...input, enabled: true } : { enabled: false },
      )
      applyResult(result)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update Streamer.bot control', 'error')
        await refreshStatus()
        return
      }
      if (enabled && passwordDraft.length > 0) setPasswordDraft('')
      onToast(
        enabled ? 'Streamer.bot control enabled' : 'Streamer.bot control disabled',
        'success',
      )
      await refreshStatus()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const clearPassword = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Clear Streamer.bot password',
      message: 'Remove the stored Streamer.bot WebSocket password?',
      warning: 'Only do this when the Streamer.bot WebSocket server has authentication disabled.',
      confirmLabel: 'Clear password',
      danger: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await window.phonedek.setStreamerbotSettings({ clearPassword: true })
      applyResult(result)
      if (!result.ok) {
        onToast(result.error ?? 'Could not clear the Streamer.bot password', 'error')
        return
      }
      setPasswordDraft('')
      onToast('Streamer.bot password cleared', 'success')
      await refreshStatus()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async (): Promise<void> => {
    const input = draftInput()
    if (!input) return
    setBusy(true)
    setTestResult(null)
    try {
      // A config change restarts the client; cycle the switch so Test always
      // makes a fresh attempt instead of waiting behind the reconnect backoff.
      if (settings.streamerbotEnabled) {
        await window.phonedek.setStreamerbotSettings({ enabled: false })
      }
      const enabled = await window.phonedek.setStreamerbotSettings({ ...input, enabled: true })
      applyResult(enabled)
      if (!enabled.ok) {
        const message = enabled.error ?? 'Could not start Streamer.bot control'
        setTestResult({ ok: false, message })
        onToast(message, 'error')
        return
      }
      if (passwordDraft.length > 0) setPasswordDraft('')

      const next = await waitForStatus()
      if (!next) {
        const message = 'No status response from the desktop process.'
        setTestResult({ ok: false, message })
        onToast(message, 'error')
        return
      }
      const nextSummary = streamerbotStatusSummary(next)
      const connected = next.state === 'connected'
      setTestResult({
        ok: connected,
        message: connected
          ? `Connected · ${nextSummary.detail}`
          : `${nextSummary.label} — ${nextSummary.detail}`,
      })
      onToast(
        connected ? 'Streamer.bot connected' : `${nextSummary.label}: ${nextSummary.detail}`,
        connected ? 'success' : 'error',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTestResult({ ok: false, message })
      onToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section streamerbot-settings">
      <h3>Streamer.bot</h3>
      <Toggle
        label="Trigger Streamer.bot actions from the deck"
        description="Runs actions in a local Streamer.bot instance over its WebSocket server. Same trust level as a command action."
        checked={settings.streamerbotEnabled}
        onChange={(enabled) => void toggleEnabled(enabled)}
        disabled={busy}
      />

      <div className={`streamerbot-status ${summary.tone}`}>
        <span
          className={`dot ${
            summary.tone === 'ok' ? 'online' : summary.tone === 'error' ? 'error' : 'offline'
          }`}
          aria-hidden="true"
        />
        <div>
          <strong>{summary.label}</strong>
          <small>{summary.detail}</small>
        </div>
        <span className="mono streamerbot-status-endpoint">{endpoint}</span>
      </div>

      {status.state === 'connected' && (
        <div className="streamerbot-meta">
          <div>
            <span>Instance</span>
            <strong>{status.instanceName?.trim() || 'Streamer.bot'}</strong>
          </div>
          <div>
            <span>Version</span>
            <strong className="mono">{status.version?.trim() || 'Unknown'}</strong>
          </div>
          <div>
            <span>Actions</span>
            <strong className="mono">
              {typeof status.actionCount === 'number' ? status.actionCount : '—'}
            </strong>
          </div>
        </div>
      )}

      <div className="two-col">
        <label className="field">
          <span>Host</span>
          <input
            value={hostDraft}
            placeholder="127.0.0.1"
            spellCheck={false}
            disabled={busy}
            aria-invalid={hostError ? true : undefined}
            onChange={(event) => setHostDraft(event.target.value)}
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
            value={portDraft}
            placeholder="8080"
            disabled={busy}
            aria-invalid={portError ? true : undefined}
            onChange={(event) => setPortDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </label>
      </div>
      {(hostError || portError) && (
        <p className="hint error-text">{hostError ?? portError}</p>
      )}
      {!hostError && !loopback && (
        <p className="hint">
          This host is not loopback. The Streamer.bot WebSocket is not encrypted, so only use a
          host on a trusted LAN.
        </p>
      )}

      <label className="field">
        <span>
          WebSocket password{' '}
          <em className="tag">{settings.streamerbotHasPassword ? 'Stored' : 'Not set'}</em>
        </span>
        <input
          type="password"
          value={passwordDraft}
          maxLength={256}
          autoComplete="new-password"
          disabled={busy}
          placeholder={settings.streamerbotHasPassword ? 'Stored' : 'Not set'}
          onChange={(event) => setPasswordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
      </label>
      <p className="hint">
        Stored encrypted on this PC only; it is never displayed again and never sent to the phone.
        Leave blank to keep the current password.
      </p>

      <div className="row gap">
        <button
          type="button"
          className="button secondary small"
          onClick={() => void save()}
          disabled={busy || !dirty || hostError !== null || portError !== null}
        >
          <Icon name="save" size={14} /> Save
        </button>
        <button
          type="button"
          className="button primary small"
          onClick={() => void testConnection()}
          disabled={busy || hostError !== null || portError !== null}
          title="Save these settings, restart the connection and report the live result"
        >
          <Icon name="refresh" size={14} /> Test connection
        </button>
        {settings.streamerbotHasPassword && (
          <button
            type="button"
            className="button ghost small"
            onClick={() => void clearPassword()}
            disabled={busy}
          >
            Clear password
          </button>
        )}
      </div>

      {testResult && (
        <p
          className={`streamerbot-test-result ${testResult.ok ? 'ok' : 'error'}`}
          aria-live="polite"
        >
          {testResult.message}
        </p>
      )}

      <p className="hint">
        In Streamer.bot: Servers/Clients → HTTP Server → enable the WebSocket server (default port
        8080). Test connection enables Streamer.bot control if it was off.
      </p>
    </div>
  )
}
