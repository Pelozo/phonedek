import { useEffect, useState } from 'react'
import type {
  ServerInfoView,
  SettingsView,
  TwitchStatusView,
} from '../../../shared/api'
import {
  formatTwitchExpiry,
  twitchClientIdError,
  twitchClientIdOrEmpty,
  twitchStatusSummary,
  twitchVerificationHost,
  twitchVerificationUrl,
} from '../lib/twitch'
import { Icon } from './Icons'
import { Toggle, useConfirm } from './Primitives'

const TWITCH_DEV_APPS_URL = 'https://dev.twitch.tv/console/apps'

/**
 * Settings → Twitch. Polls the main process while mounted so the device-code
 * flow, expiry and account state stay current. Tokens never leave the main
 * process; this view only receives booleans and display fields.
 */
export function TwitchSettings({
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
  const [status, setStatus] = useState<TwitchStatusView>(server.twitchStatus)
  const [clientIdDraft, setClientIdDraft] = useState(settings.twitchClientId)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  const clientIdError = twitchClientIdError(clientIdDraft)
  const clientIdDirty = twitchClientIdOrEmpty(clientIdDraft) !== settings.twitchClientId
  const summary = twitchStatusSummary(status)
  const device = status.device
  const expires = formatTwitchExpiry(status.expiresAt)
  const deviceExpires = formatTwitchExpiry(device?.expiresAt)

  useEffect(() => setStatus(server.twitchStatus), [server.twitchStatus])
  useEffect(() => setClientIdDraft(settings.twitchClientId), [settings.twitchClientId])

  // Poll while the dialog is open: device-flow completion and token refresh are
  // not guaranteed to push a ServerInfo event on every state change.
  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.phonedek.getTwitchStatus()
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

  const refreshStatus = async (): Promise<void> => {
    try {
      setStatus(await window.phonedek.getTwitchStatus())
    } catch {
      // Keep the last known state.
    }
  }

  const applyServerResult = (next: ServerInfoView | undefined): void => {
    if (!next) return
    onServerUpdate(next)
    setStatus(next.twitchStatus)
  }

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setTwitchSettings({
        enabled,
        ...(enabled && clientIdDirty && !clientIdError
          ? { clientId: twitchClientIdOrEmpty(clientIdDraft) }
          : {}),
      })
      applyServerResult(result.state?.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update Twitch settings', 'error')
        await refreshStatus()
        return
      }
      if (enabled && clientIdDirty && !clientIdError) {
        setClientIdDraft(twitchClientIdOrEmpty(clientIdDraft))
      }
      onToast(enabled ? 'Twitch control enabled' : 'Twitch control disabled', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const commitClientId = async (): Promise<void> => {
    const trimmed = twitchClientIdOrEmpty(clientIdDraft)
    if (clientIdError) {
      onToast(clientIdError, 'error')
      return
    }
    if (trimmed === settings.twitchClientId) {
      setClientIdDraft(settings.twitchClientId)
      return
    }
    setBusy(true)
    try {
      const result = await window.phonedek.setTwitchSettings({ clientId: trimmed })
      applyServerResult(result.state?.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not save the Twitch Client ID', 'error')
        return
      }
      setClientIdDraft(trimmed)
      onToast(trimmed ? 'Twitch Client ID saved' : 'Twitch Client ID cleared', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      if (settings.twitchEnabled && clientIdDirty && !clientIdError) {
        const saved = await window.phonedek.setTwitchSettings({
          clientId: twitchClientIdOrEmpty(clientIdDraft),
        })
        applyServerResult(saved.state?.server)
        if (!saved.ok) {
          onToast(saved.error ?? 'Could not save the Twitch Client ID', 'error')
          return
        }
        setClientIdDraft(twitchClientIdOrEmpty(clientIdDraft))
      }

      const result = await window.phonedek.startTwitchAuth()
      if (!result.ok) {
        onToast(result.error ?? 'Could not start Twitch authorization', 'error')
        await refreshStatus()
        return
      }
      if (result.device) {
        setStatus((current) => ({
          ...current,
          state: 'authorizing',
          enabled: true,
          connected: false,
          device: result.device,
        }))
      }
      onToast('Twitch authorization started — enter the code on Twitch', 'info')
      await refreshStatus()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.cancelTwitchAuth()
      applyServerResult(result.state?.server)
      if (!result.ok) onToast(result.error ?? 'Could not cancel Twitch authorization', 'error')
      else onToast('Twitch authorization cancelled', 'info')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Disconnect Twitch',
      message: 'Remove the stored Twitch token from this PC?',
      warning: 'Chat, title, category, marker and status tiles stop working until you connect again.',
      confirmLabel: 'Disconnect Twitch',
      danger: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await window.phonedek.disconnectTwitch()
      applyServerResult(result.state?.server)
      if (!result.ok) onToast(result.error ?? 'Could not disconnect Twitch', 'error')
      else onToast('Twitch disconnected', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const openExternal = async (url: string): Promise<void> => {
    try {
      await window.phonedek.openExternal(url)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const copyCode = async (code: string): Promise<void> => {
    try {
      await window.phonedek.copyText(code)
      onToast('Verification code copied', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const authorizing = status.state === 'authorizing' || device !== undefined
  const connected = status.connected || status.state === 'authorized'

  return (
    <div className="settings-section twitch-settings">
      <h3>Twitch</h3>
      <Toggle
        label="Control Twitch through Helix"
        description="Chat, title, category, markers and live status. Sign-in uses Twitch's device code flow; no client secret is stored."
        checked={settings.twitchEnabled}
        onChange={(enabled) => void toggleEnabled(enabled)}
        disabled={busy}
      />

      <div className={`twitch-status ${summary.tone}`}>
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
        <span className="mono twitch-state-chip">{status.state.toUpperCase()}</span>
      </div>

      <label className="field">
        <span>
          Client ID{' '}
          {settings.twitchHasToken && <em className="tag">Token stored</em>}
        </span>
        <input
          value={clientIdDraft}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          placeholder="Public Client ID from your Twitch developer app"
          aria-invalid={clientIdError ? true : undefined}
          disabled={busy}
          onChange={(event) => setClientIdDraft(event.target.value)}
          onBlur={() => void commitClientId()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      </label>
      {clientIdError ? (
        <p className="hint error-text">{clientIdError}</p>
      ) : (
        <p className="hint">
          Public Client ID only — never paste a client secret. Create an app in the{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => void openExternal(TWITCH_DEV_APPS_URL)}
          >
            Twitch developer console
          </button>
          . Leave it blank only when this build ships a bundled Client ID.
        </p>
      )}

      <div className="row gap">
        <button
          type="button"
          className="button secondary small"
          onClick={() => void commitClientId()}
          disabled={busy || !clientIdDirty || clientIdError !== null}
        >
          Save Client ID
        </button>
        <button
          type="button"
          className="button primary small"
          onClick={() => void connect()}
          disabled={
            busy || !settings.twitchEnabled || authorizing || connected || clientIdError !== null
          }
          title={
            clientIdError
              ? clientIdError
              : !settings.twitchEnabled
                ? 'Enable Twitch control first'
                : connected
                  ? 'Twitch is already connected — disconnect to switch accounts'
                  : undefined
          }
        >
          <Icon name="link" size={14} /> Connect Twitch
        </button>
        {authorizing && (
          <button
            type="button"
            className="button ghost small"
            onClick={() => void cancel()}
            disabled={busy}
          >
            Cancel
          </button>
        )}
        {connected && (
          <button
            type="button"
            className="button ghost small"
            onClick={() => void disconnect()}
            disabled={busy}
          >
            Disconnect
          </button>
        )}
      </div>

      {device && (
        <div className="twitch-device">
          <div className="twitch-device-head">
            <span className="twitch-device-label">Verification code</span>
            <span className="twitch-device-status mono">
              <span className="dot offline" aria-hidden="true" /> WAITING
            </span>
          </div>
          <div className="twitch-device-code" aria-live="polite">
            {device.userCode}
          </div>
          <p className="twitch-device-copy">
            Enter this code at{' '}
            <strong>{twitchVerificationHost(device.verificationUri)}</strong> to authorize
            PhoneDeck. Waiting for authorization…
            {deviceExpires ? ` Code expires ${deviceExpires}.` : ''}
          </p>
          <div className="row gap">
            <button
              type="button"
              className="button secondary small"
              onClick={() => void openExternal(twitchVerificationUrl(device.verificationUri))}
            >
              <Icon name="link" size={14} /> Open Twitch activation
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={() => void copyCode(device.userCode)}
            >
              <Icon name="copy" size={14} /> Copy code
            </button>
          </div>
        </div>
      )}

      {authorizing && !device && (
        <div className="twitch-device twitch-device-waiting">
          <span className="twitch-device-label">Waiting for authorization…</span>
          <p className="twitch-device-copy">
            Finish the Twitch activation in your browser, then return here. Cancel and press
            Connect again to get a new code.
          </p>
        </div>
      )}

      {connected && (
        <div className="twitch-account">
          <div>
            <span>Account</span>
            <strong>{status.account?.trim() || status.login?.trim() || 'Connected'}</strong>
          </div>
          {status.login && (
            <div>
              <span>Login</span>
              <strong className="mono">{status.login}</strong>
            </div>
          )}
          {status.userId && (
            <div>
              <span>User ID</span>
              <strong className="mono">{status.userId}</strong>
            </div>
          )}
          {expires && (
            <div>
              <span>Token expires</span>
              <strong>{expires}</strong>
            </div>
          )}
        </div>
      )}

      {status.scopes.length > 0 && (
        <div className="twitch-scopes">
          <span className="twitch-scopes-label mono">
            {connected ? 'Granted scopes' : 'Requested scopes'}
          </span>
          <div className="twitch-scope-list">
            {status.scopes.map((scope) => (
              <span className="twitch-scope" key={scope}>
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="twitch-token-row">
        <span>Stored token on this PC</span>
        <strong className="mono">{settings.twitchHasToken ? 'YES' : 'NO'}</strong>
      </div>
      <p className="hint">
        Access and refresh tokens stay in the desktop main process. They are never displayed here
        and never sent to the phone. Disconnecting removes the stored token.
      </p>
    </div>
  )
}
