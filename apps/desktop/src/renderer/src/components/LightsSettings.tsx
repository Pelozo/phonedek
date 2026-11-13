import { useEffect, useState } from 'react'
import type {
  LightDeviceView,
  LightStatusView,
  ServerInfoView,
  SettingsView,
} from '../../../shared/api'
import {
  LIGHT_DEFAULT_PORT,
  MAX_LIGHT_DEVICES,
  lightEndpoint,
  lightHostError,
  lightNameError,
  lightPortError,
  lightStatusSummary,
  nextLightId,
} from '../lib/lights'
import { Icon } from './Icons'
import { Toggle } from './Primitives'

interface LightDraft {
  id: string
  name: string
  host: string
  port: string
}

function toDrafts(lights: readonly LightDeviceView[]): LightDraft[] {
  return lights.map((light) => ({
    id: light.id,
    name: light.name,
    host: light.host,
    port: String(light.port),
  }))
}

function draftSignature(lights: readonly LightDraft[]): string {
  return JSON.stringify(
    lights.map((light) => ({
      id: light.id,
      name: light.name.trim(),
      host: light.host.trim(),
      port: light.port.trim(),
    })),
  )
}

function savedSignature(lights: readonly LightDeviceView[]): string {
  return JSON.stringify(
    lights.map((light) => ({
      id: light.id,
      name: light.name,
      host: light.host,
      port: String(light.port),
    })),
  )
}

/**
 * Settings → Lights. The device list is a draft until Save lights; Test /
 * refresh asks the main process to read every saved device once and shows the
 * live power/brightness/temperature or the connection error.
 */
export function LightsSettings({
  settings,
  onServerUpdate,
  onToast,
}: {
  settings: SettingsView
  onServerUpdate: (server: ServerInfoView) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [drafts, setDrafts] = useState<LightDraft[]>(() => toDrafts(settings.lights))
  const [statuses, setStatuses] = useState<LightStatusView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const saved = savedSignature(settings.lights)
  useEffect(() => {
    setDrafts(toDrafts(settings.lights))
    setStatuses(null)
    setAttempted(false)
  }, [saved])

  const dirty = draftSignature(drafts) !== saved
  const errors = drafts.map((draft) => ({
    name: lightNameError(draft.name),
    host: lightHostError(draft.host),
    port: lightPortError(draft.port),
  }))
  const hasErrors = errors.some((entry) => entry.name || entry.host || entry.port)
  const statusFor = (id: string): LightStatusView | undefined =>
    statuses?.find((status) => status.id === id)

  const applyServer = (next: ServerInfoView | undefined): void => {
    if (next) onServerUpdate(next)
  }

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setLightSettings({ enabled })
      applyServer(result.state?.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update light control', 'error')
        return
      }
      onToast(enabled ? 'Local light control enabled' : 'Local light control disabled', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const addLight = (): void => {
    if (drafts.length >= MAX_LIGHT_DEVICES) {
      onToast(`At most ${MAX_LIGHT_DEVICES} lights can be configured`, 'error')
      return
    }
    setDrafts((current) => [
      ...current,
      {
        id: nextLightId(current),
        name: `Light ${current.length + 1}`,
        host: '',
        port: String(LIGHT_DEFAULT_PORT),
      },
    ])
  }

  const updateDraft = (id: string, patch: Partial<Omit<LightDraft, 'id'>>): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  const removeDraft = (id: string): void => {
    setDrafts((current) => current.filter((draft) => draft.id !== id))
    setStatuses((current) => current?.filter((status) => status.id !== id) ?? null)
    onToast('Light removed from the draft — Save lights to apply', 'info')
  }

  const saveLights = async (): Promise<void> => {
    setAttempted(true)
    if (hasErrors) {
      onToast('Fix the highlighted light fields before saving', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await window.phonedek.setLightSettings({
        lights: drafts.map((draft) => ({
          id: draft.id,
          name: draft.name.trim(),
          type: 'elgato',
          host: draft.host.trim(),
          port: Number(draft.port.trim()),
        })),
      })
      applyServer(result.state?.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not save light settings', 'error')
        return
      }
      setAttempted(false)
      setStatuses(null)
      onToast(
        drafts.length === 0
          ? 'All lights removed'
          : `Saved ${drafts.length} light${drafts.length === 1 ? '' : 's'}`,
        'success',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const testLights = async (): Promise<void> => {
    if (settings.lights.length === 0) {
      onToast('Save at least one light before testing it', 'info')
      return
    }
    setTesting(true)
    try {
      const list = await window.phonedek.getLightStatuses()
      setStatuses(list)
      const available = list.filter((status) => status.available).length
      onToast(
        list.length === 0
          ? 'The desktop returned no light status'
          : `${available}/${list.length} light${list.length === 1 ? '' : 's'} reachable`,
        available === list.length && list.length > 0 ? 'success' : 'info',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-section lights-settings">
      <h3>Lights</h3>
      <Toggle
        label="Control local Elgato lights"
        description="Brightness, temperature and power for Elgato Key Light devices on your LAN. PhoneDeck talks to each light directly over HTTP; no Elgato account is used."
        checked={settings.lightsEnabled}
        onChange={(enabled) => void toggleEnabled(enabled)}
        disabled={busy}
      />

      <div className="light-device-toolbar">
        <span className="mono light-device-count">
          {drafts.length}/{MAX_LIGHT_DEVICES} DEVICES
        </span>
        {dirty && <span className="tag light-dirty-tag">Unsaved changes</span>}
        <span className="hint">Key Light listens on port 9123 by default.</span>
      </div>

      {drafts.length === 0 ? (
        <div className="light-empty">
          <Icon name="light" size={24} />
          <strong>No lights configured yet</strong>
          <p>
            Add an Elgato Key Light on the same network, enter its IP or hostname, then use
            Test / refresh. PhoneDeck controls the light through its local HTTP API — no Elgato
            account or cloud service is involved.
          </p>
          <p className="hint">
            Find the address in your router or Elgato Control Center. Key Light Air and Mini use the
            same API on port 9123.
          </p>
        </div>
      ) : (
        <div className="light-device-list">
          {drafts.map((draft, index) => {
            const error = errors[index]!
            const status = statusFor(draft.id)
            const summary = status ? lightStatusSummary(status) : null
            const savedDevice = settings.lights.some((light) => light.id === draft.id)
            return (
              <div className="light-device" key={draft.id}>
                <div className="light-device-head">
                  <span className="mono light-device-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong>{draft.name.trim() || 'New light'}</strong>
                  <span className="tag">ELGATO</span>
                  <span className="mono light-device-id">{draft.id}</span>
                  <button
                    type="button"
                    className="icon-button tiny danger"
                    aria-label={`Remove ${draft.name.trim() || 'light'}`}
                    title="Remove this light from the draft"
                    onClick={() => removeDraft(draft.id)}
                    disabled={busy}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>

                <div className="light-device-fields">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={draft.name}
                      maxLength={40}
                      placeholder="Key Light"
                      aria-invalid={attempted && error.name ? true : undefined}
                      disabled={busy}
                      onChange={(event) => updateDraft(draft.id, { name: event.target.value })}
                      onBlur={() =>
                        updateDraft(draft.id, { name: draft.name.trim().slice(0, 40) })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Host</span>
                    <input
                      value={draft.host}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="192.168.1.42"
                      aria-invalid={attempted && error.host ? true : undefined}
                      disabled={busy}
                      onChange={(event) => updateDraft(draft.id, { host: event.target.value })}
                      onBlur={() => updateDraft(draft.id, { host: draft.host.trim() })}
                    />
                  </label>
                  <label className="field light-port-field">
                    <span>Port</span>
                    <input
                      value={draft.port}
                      inputMode="numeric"
                      spellCheck={false}
                      placeholder={String(LIGHT_DEFAULT_PORT)}
                      aria-invalid={attempted && error.port ? true : undefined}
                      disabled={busy}
                      onChange={(event) => updateDraft(draft.id, { port: event.target.value })}
                    />
                  </label>
                </div>

                {attempted && (error.name || error.host || error.port) && (
                  <p className="hint error-text">
                    {error.name ?? error.host ?? error.port}
                  </p>
                )}

                {savedDevice && (
                  <div className="light-device-status">
                    {summary ? (
                      <div className={`light-status-line ${summary.tone}`}>
                        <span
                          className={`dot ${
                            summary.tone === 'ok'
                              ? 'online'
                              : summary.tone === 'error'
                                ? 'error'
                                : 'offline'
                          }`}
                          aria-hidden="true"
                        />
                        <strong>{summary.label}</strong>
                        <small>{summary.detail}</small>
                      </div>
                    ) : (
                      <span className="mono light-telemetry muted">NOT TESTED</span>
                    )}
                    <span className="mono light-endpoint">
                      {lightEndpoint({ host: draft.host.trim(), port: Number(draft.port) || 0 })}
                    </span>
                  </div>
                )}
                {!savedDevice && <span className="hint">New device — Save lights to test it.</span>}
              </div>
            )
          })}
        </div>
      )}

      <div className="row gap light-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={addLight}
          disabled={busy || drafts.length >= MAX_LIGHT_DEVICES}
        >
          <Icon name="plus" size={14} /> Add light
        </button>
        <button
          type="button"
          className="button primary small"
          onClick={() => void saveLights()}
          disabled={busy || !dirty}
        >
          <Icon name="save" size={14} /> Save lights
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => void testLights()}
          disabled={testing || busy || settings.lights.length === 0}
          title={
            settings.lights.length === 0
              ? 'Save at least one light first'
              : 'Read power, brightness and temperature from every saved light'
          }
        >
          <Icon name="refresh" size={14} />
          {testing ? 'Testing…' : 'Test / refresh'}
        </button>
      </div>

      <p className="hint">
        Test / refresh reads every saved device once. Status tiles and controls keep working on the
        phone even while this dialog is closed. Lights are off until you enable control above.
      </p>
      {hasErrors && !attempted && (
        <p className="hint">An incomplete device stays in the draft until it has a name, host and port.</p>
      )}
    </div>
  )
}
