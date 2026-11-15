import { useEffect, useState } from 'react'
import type { LightDeviceType } from '@phonedek/shared'
import type {
  HueBridgeView,
  HueLightView,
  LightDeviceInput,
  LightDeviceView,
  LightStatusView,
  ServerInfoView,
  SettingsView,
} from '../../../shared/api'
import {
  LIGHT_DEFAULT_PORT,
  LIGHT_PROVIDERS,
  MAX_LIGHT_DEVICES,
  lightCredentialError,
  lightEndpoint,
  lightHostError,
  lightNameError,
  lightPortError,
  lightProviderInfo,
  lightStatusSummary,
  lightTypeSwitch,
  nextLightId,
} from '../lib/lights'
import { Icon } from './Icons'
import { Toggle } from './Primitives'

interface LightDraft {
  id: string
  name: string
  type: LightDeviceType
  host: string
  port: string
  /** Provider-side Hue light id; empty means the bridge's first light. */
  lightId: string
  /**
   * Transient only: a Nanoleaf token the user just typed. Never seeded from
   * saved settings and never included in signatures or status output.
   */
  credential: string
}

interface CredentialOverride {
  username?: string
  token?: string
}

interface PairProgress {
  id: string
  seconds: number
}

function toDrafts(lights: readonly LightDeviceView[]): LightDraft[] {
  return lights.map((light) => ({
    id: light.id,
    name: light.name,
    type: light.type ?? 'elgato',
    host: light.host,
    port: String(light.port),
    lightId: light.lightId ?? '',
    credential: '',
  }))
}

function draftSignature(lights: readonly LightDraft[]): string {
  return JSON.stringify(
    lights.map((light) => ({
      id: light.id,
      name: light.name.trim(),
      type: light.type,
      host: light.host.trim(),
      port: light.port.trim(),
      lightId: light.lightId.trim(),
    })),
  )
}

function savedSignature(lights: readonly LightDeviceView[]): string {
  return JSON.stringify(
    lights.map((light) => ({
      id: light.id,
      name: light.name,
      type: light.type ?? 'elgato',
      host: light.host,
      port: String(light.port),
      lightId: light.lightId ?? '',
    })),
  )
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Turn the main process's retry timeout into a diagnostic users can act on. */
function huePairMessage(error: string | undefined): string {
  const raw = error?.trim()
  if (!raw) return 'The Hue bridge did not answer. Check the host and try again.'
  if (/link button/i.test(raw)) {
    return `${raw} PhoneDeck retried for about 30 seconds and did not see the button press.`
  }
  return raw
}

function credentialBadge(
  type: LightDeviceType,
  hasCredential: boolean,
): string | null {
  if (type === 'hue') return hasCredential ? 'KEY SET' : 'NOT PAIRED'
  if (type === 'nanoleaf') return hasCredential ? 'TOKEN SET' : 'NO TOKEN'
  return null
}

/**
 * Settings → Lights. The device list is a draft until Save lights; Test /
 * refresh asks the main process to read every saved device once and shows the
 * live power/brightness/temperature or the connection error.
 *
 * Hue application keys and Nanoleaf tokens are write-only: this component only
 * ever receives `hasCredential` booleans and keeps a typed token in local form
 * state until it is saved or the dialog closes.
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
  const [testingDevice, setTestingDevice] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const [pairing, setPairing] = useState<PairProgress | null>(null)
  const [pairErrors, setPairErrors] = useState<Record<string, string>>({})
  const [hueLights, setHueLights] = useState<Record<string, HueLightView[]>>({})
  const [hueListBusy, setHueListBusy] = useState<string | null>(null)
  const [hueListErrors, setHueListErrors] = useState<Record<string, string>>({})

  const [discoverFor, setDiscoverFor] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [bridges, setBridges] = useState<HueBridgeView[]>([])
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)

  const saved = savedSignature(settings.lights)
  useEffect(() => {
    setDrafts(toDrafts(settings.lights))
    setStatuses(null)
    setAttempted(false)
  }, [saved])

  // Pairing has no streaming progress API: show elapsed time and the retry
  // budget the main process uses (30 attempts, roughly one per second).
  const pairingId = pairing?.id ?? null
  useEffect(() => {
    if (!pairingId) return
    const timer = window.setInterval(() => {
      setPairing((current) =>
        current ? { ...current, seconds: current.seconds + 1 } : current,
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [pairingId])

  const dirty =
    draftSignature(drafts) !== saved ||
    drafts.some((draft) => draft.type === 'nanoleaf' && draft.credential.trim() !== '')

  const errors = drafts.map((draft) => ({
    name: lightNameError(draft.name),
    host: lightHostError(draft.host),
    port: lightPortError(draft.port),
  }))
  const credentialErrors = drafts.map((draft) =>
    draft.type === 'nanoleaf' ? lightCredentialError(draft.credential) : null,
  )
  const hasFieldErrors = errors.some((entry) => entry.name || entry.host || entry.port)
  const hasCredentialErrors = credentialErrors.some(Boolean)
  const hasErrors = hasFieldErrors || hasCredentialErrors

  const statusFor = (id: string): LightStatusView | undefined =>
    statuses?.find((status) => status.id === id)

  const applyServer = (next: ServerInfoView | undefined): void => {
    if (next) onServerUpdate(next)
  }

  const buildInputs = (overrides: Record<string, CredentialOverride> = {}): LightDeviceInput[] =>
    drafts.map((draft) => {
      const override = overrides[draft.id]
      const lightId = draft.lightId.trim()
      const input: LightDeviceInput = {
        id: draft.id,
        name: draft.name.trim(),
        type: draft.type,
        host: draft.host.trim(),
        port: Number(draft.port.trim()),
        ...(draft.type === 'hue' && lightId ? { lightId } : {}),
      }
      const token = draft.credential.trim()
      if (draft.type === 'nanoleaf' && token) input.token = token
      if (override?.username !== undefined) input.username = override.username
      if (override?.token !== undefined) input.token = override.token
      return input
    })

  /** Persist the draft list, clear transient credentials on success. */
  const persistLights = async (
    overrides: Record<string, CredentialOverride>,
    successMessage: string,
  ): Promise<boolean> => {
    const result = await window.phonedek.setLightSettings({
      lights: buildInputs(overrides),
    })
    applyServer(result.state?.server)
    if (!result.ok) {
      onToast(result.error ?? 'Could not save light settings', 'error')
      return false
    }
    setDrafts((current) => current.map((draft) => ({ ...draft, credential: '' })))
    setStatuses(null)
    onToast(successMessage, 'success')
    return true
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
      onToast(errorMessage(error), 'error')
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
        type: 'elgato',
        host: '',
        port: String(LIGHT_DEFAULT_PORT),
        lightId: '',
        credential: '',
      },
    ])
  }

  const updateDraft = (id: string, patch: Partial<Omit<LightDraft, 'id'>>): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  const changeType = (id: string, type: LightDeviceType): void => {
    // Switching provider applies its default port and drops every
    // provider-specific field (Hue light pick, Nanoleaf token).
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, type, ...lightTypeSwitch(type) } : draft)),
    )
    setPairErrors((current) => withoutKey(current, id))
    setHueListErrors((current) => withoutKey(current, id))
    setHueLights((current) => withoutKey(current, id))
  }

  const removeDraft = (id: string): void => {
    setDrafts((current) => current.filter((draft) => draft.id !== id))
    setStatuses((current) => current?.filter((status) => status.id !== id) ?? null)
    setPairErrors((current) => withoutKey(current, id))
    setHueListErrors((current) => withoutKey(current, id))
    setHueLights((current) => withoutKey(current, id))
    setPairing((current) => (current?.id === id ? null : current))
    setDiscoverFor((current) => (current === id ? null : current))
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
      const savedOk = await persistLights(
        {},
        drafts.length === 0
          ? 'All lights removed'
          : `Saved ${drafts.length} light${drafts.length === 1 ? '' : 's'}`,
      )
      if (savedOk) setAttempted(false)
    } catch (error) {
      onToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveToken = async (draft: LightDraft): Promise<void> => {
    setAttempted(true)
    if (hasErrors) {
      onToast('Fix the highlighted light fields before saving the token', 'error')
      return
    }
    setBusy(true)
    try {
      await persistLights(
        { [draft.id]: { token: draft.credential.trim() } },
        'Nanoleaf token saved',
      )
    } catch (error) {
      onToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const clearToken = async (draft: LightDraft): Promise<void> => {
    setBusy(true)
    try {
      await persistLights({ [draft.id]: { token: '' } }, 'Nanoleaf token cleared')
    } catch (error) {
      onToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const pairHue = async (draft: LightDraft): Promise<void> => {
    setAttempted(true)
    if (hasErrors) {
      onToast('Fix the highlighted light fields before pairing', 'error')
      return
    }
    setBusy(true)
    setPairErrors((current) => withoutKey(current, draft.id))
    setPairing({ id: draft.id, seconds: 0 })
    try {
      // Persist the draft first so pairing attaches the key to this exact
      // device (and so any other unsaved edits are not lost).
      const persisted = await window.phonedek.setLightSettings({ lights: buildInputs() })
      applyServer(persisted.state?.server)
      if (!persisted.ok) {
        const message = persisted.error ?? 'Could not save the Hue bridge before pairing'
        setPairErrors((current) => ({ ...current, [draft.id]: message }))
        onToast(message, 'error')
        return
      }
      // The pre-pair save may have persisted a typed Nanoleaf token; do not
      // keep the secret in form state once it has been written.
      setDrafts((current) => current.map((entry) => ({ ...entry, credential: '' })))

      const lightId = draft.lightId.trim()
      const result = await window.phonedek.pairHueLight({
        host: draft.host.trim(),
        port: Number(draft.port.trim()),
        deviceId: draft.id,
        name: draft.name.trim(),
        ...(lightId ? { lightId } : {}),
      })
      applyServer(result.state?.server)
      if (!result.ok) {
        const message = huePairMessage(result.error)
        setPairErrors((current) => ({ ...current, [draft.id]: message }))
        onToast(message, 'error')
        return
      }
      if (result.lights) {
        setHueLights((current) => ({ ...current, [draft.id]: result.lights! }))
      }
      setDrafts((current) => current.map((entry) => ({ ...entry, credential: '' })))
      setStatuses(null)
      onToast(
        result.lights && result.lights.length > 0
          ? `Hue bridge paired — ${result.lights.length} light${result.lights.length === 1 ? '' : 's'} found`
          : 'Hue bridge paired — no lights were listed yet',
        'success',
      )
    } catch (error) {
      const message = errorMessage(error)
      setPairErrors((current) => ({ ...current, [draft.id]: message }))
      onToast(message, 'error')
    } finally {
      setPairing(null)
      setBusy(false)
    }
  }

  const discoverBridges = async (id: string): Promise<void> => {
    if (busy || discovering) return
    setDiscoverFor(id)
    setDiscovering(true)
    setDiscoveryError(null)
    setBridges([])
    try {
      const result = await window.phonedek.discoverHueBridges()
      if (!result.ok) {
        setDiscoveryError(result.error ?? 'Hue discovery failed.')
        return
      }
      setBridges(result.bridges)
      if (result.bridges.length === 0) {
        setDiscoveryError('No bridges answered discovery. Enter the bridge IP address manually.')
      }
    } catch (error) {
      setDiscoveryError(errorMessage(error))
    } finally {
      setDiscovering(false)
    }
  }

  const loadHueLights = async (deviceId: string): Promise<void> => {
    if (busy || hueListBusy) return
    setHueListBusy(deviceId)
    setHueListErrors((current) => withoutKey(current, deviceId))
    try {
      const result = await window.phonedek.listHueLights(deviceId)
      if (!result.ok) {
        setHueListErrors((current) => ({
          ...current,
          [deviceId]: result.error ?? 'Could not list lights on this bridge.',
        }))
        return
      }
      setHueLights((current) => ({ ...current, [deviceId]: result.lights }))
      if (result.lights.length === 0) {
        setHueListErrors((current) => ({
          ...current,
          [deviceId]: 'The bridge reported no lights.',
        }))
      }
    } catch (error) {
      setHueListErrors((current) => ({ ...current, [deviceId]: errorMessage(error) }))
    } finally {
      setHueListBusy(null)
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
      onToast(errorMessage(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  const testDevice = async (device: LightDeviceView): Promise<void> => {
    if (busy || testing || testingDevice) return
    setTestingDevice(device.id)
    try {
      const status = await window.phonedek.testLight(device.id)
      if (!status) {
        onToast('The desktop did not return a reading for this light', 'error')
        return
      }
      setStatuses((current) => [
        ...(current ?? []).filter((entry) => entry.id !== device.id),
        status,
      ])
      const summary = lightStatusSummary(status)
      onToast(
        `${device.name} · ${summary.label}`,
        summary.tone === 'error' ? 'error' : 'success',
      )
    } catch (error) {
      onToast(errorMessage(error), 'error')
    } finally {
      setTestingDevice(null)
    }
  }

  return (
    <div className="settings-section lights-settings">
      <h3>Lights</h3>
      <Toggle
        label="Control local lights"
        description="Brightness, temperature and power for Elgato Key Light, Philips Hue and Nanoleaf devices on your LAN. PhoneDeck talks to each device directly — no manufacturer account or cloud service is used."
        checked={settings.lightsEnabled}
        onChange={(enabled) => void toggleEnabled(enabled)}
        disabled={busy}
      />

      <div className="light-device-toolbar">
        <span className="mono light-device-count">
          {drafts.length}/{MAX_LIGHT_DEVICES} DEVICES
        </span>
        {dirty && <span className="tag light-dirty-tag">Unsaved changes</span>}
        <span className="hint">Ports: Elgato 9123 · Hue 443 · Nanoleaf 16021.</span>
      </div>

      {drafts.length === 0 ? (
        <div className="light-empty">
          <Icon name="light" size={24} />
          <strong>No lights configured yet</strong>
          <p>
            Add an Elgato Key Light, a Philips Hue bridge or a Nanoleaf controller on the same
            network, enter its IP or hostname, then use Test / refresh. Hue bridges are paired with
            their physical link button; Nanoleaf uses a one-time setup token.
          </p>
          <p className="hint">
            Find the address in your router, Elgato Control Center, the Hue app or the Nanoleaf app.
            Manual host entry always works when discovery is blocked.
          </p>
        </div>
      ) : (
        <div className="light-device-list">
          {drafts.map((draft, index) => {
            const error = errors[index]!
            const credentialError = credentialErrors[index]!
            const provider = lightProviderInfo(draft.type)
            const savedLight = settings.lights.find((light) => light.id === draft.id)
            const savedDevice = Boolean(savedLight)
            const hasCredential = Boolean(savedLight?.hasCredential)
            const status = statusFor(draft.id)
            const summary = status ? lightStatusSummary(status) : null
            const pairError = pairErrors[draft.id]
            const listError = hueListErrors[draft.id]
            const lights = hueLights[draft.id]
            const isPairing = pairing?.id === draft.id
            const badge = credentialBadge(draft.type, hasCredential)
            const lightId = draft.lightId.trim()
            const savedLightOptionMissing =
              Boolean(lightId) && !lights?.some((light) => light.id === lightId)
            const attempts = Math.min(30, (pairing?.seconds ?? 0) + 1)
            const progress = Math.min(100, Math.round(((pairing?.seconds ?? 0) + 1) / 30 * 100))

            return (
              <div className="light-device" key={draft.id}>
                <div className="light-device-head">
                  <span className="mono light-device-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong>{draft.name.trim() || 'New light'}</strong>
                  <span className="tag">{provider.badge}</span>
                  {badge && (
                    <span
                      className={`tag light-credential-tag ${hasCredential ? 'set' : 'missing'}`}
                    >
                      {badge}
                    </span>
                  )}
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
                  <label className="field light-type-field">
                    <span>Type</span>
                    <select
                      value={draft.type}
                      aria-label={`Provider for ${draft.name.trim() || 'light'}`}
                      disabled={busy}
                      onChange={(event) =>
                        changeType(draft.id, event.target.value as LightDeviceType)
                      }
                    >
                      {LIGHT_PROVIDERS.map((entry) => (
                        <option key={entry.type} value={entry.type}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Host</span>
                    <input
                      value={draft.host}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={provider.hostPlaceholder}
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
                      placeholder={String(provider.port)}
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

                {draft.type === 'hue' && (
                  <div className="light-provider-panel">
                    <div className="light-provider-head">
                      <span className="mono light-provider-label">HUE BRIDGE</span>
                      <div className="light-provider-actions">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => void discoverBridges(draft.id)}
                          disabled={busy || discovering}
                          title="Ask Philips' local discovery service for bridges"
                        >
                          <Icon name="search" size={14} />
                          {discovering && discoverFor === draft.id ? 'Searching…' : 'Discover'}
                        </button>
                        <button
                          type="button"
                          className="button primary small"
                          onClick={() => void pairHue(draft)}
                          disabled={busy}
                          title="Press the link button on the bridge, then pair"
                        >
                          <Icon name="link" size={14} />
                          {isPairing ? 'Pairing…' : hasCredential ? 'Re-pair' : 'Pair'}
                        </button>
                      </div>
                    </div>

                    {isPairing && (
                      <div className="light-pair-prompt" role="status" aria-live="polite">
                        <Icon name="link" size={16} />
                        <div className="light-pair-copy">
                          <strong>Press the link button on top of the Hue bridge</strong>
                          <p>
                            PhoneDeck is retrying every second and will finish automatically once
                            the physical button press is registered. Keep this dialog open.
                          </p>
                          <div className="light-pair-progress">
                            <span className="light-pair-track" aria-hidden="true">
                              <span style={{ width: `${progress}%` }} />
                            </span>
                            <span className="mono light-pair-meta">
                              {pairing.seconds >= 30
                                ? `STILL WAITING · ${pairing.seconds}s`
                                : `${pairing.seconds}s · ATTEMPT ${attempts}/30`}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {pairError && (
                      <p className="light-pair-error" role="alert">
                        {pairError}
                      </p>
                    )}

                    {discoverFor === draft.id && (
                      <div className="light-discovery">
                        {discovering ? (
                          <span className="mono light-telemetry muted">SEARCHING FOR BRIDGES…</span>
                        ) : bridges.length > 0 ? (
                          <>
                            <span className="mono light-provider-label">FOUND</span>
                            <div className="light-discovery-list">
                              {bridges.map((bridge) => (
                                <button
                                  key={bridge.id}
                                  type="button"
                                  className="light-discovery-chip"
                                  onClick={() => {
                                    updateDraft(draft.id, {
                                      host: bridge.host,
                                      port: String(bridge.port),
                                    })
                                    setDiscoverFor(null)
                                  }}
                                >
                                  {lightEndpoint({ host: bridge.host, port: bridge.port })}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : discoveryError ? (
                          <p className="light-list-error" role="alert">
                            {discoveryError}
                          </p>
                        ) : null}
                      </div>
                    )}

                    <div className="light-hue-picker">
                      <label className="field">
                        <span>Light</span>
                        <select
                          value={draft.lightId}
                          disabled={busy || !savedDevice || !hasCredential}
                          onChange={(event) =>
                            updateDraft(draft.id, { lightId: event.target.value })
                          }
                        >
                          <option value="">First light (bridge default)</option>
                          {savedLightOptionMissing && (
                            <option value={lightId}>Saved light · {lightId}</option>
                          )}
                          {lights?.map((light) => (
                            <option key={light.id} value={light.id}>
                              {light.name} · {light.on ? 'ON' : 'OFF'} ·{' '}
                              {Math.round(light.brightness)}%
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => void loadHueLights(draft.id)}
                        disabled={
                          busy ||
                          !savedDevice ||
                          !hasCredential ||
                          hueListBusy === draft.id
                        }
                        title={
                          !savedDevice
                            ? 'Pair and save the bridge first'
                            : !hasCredential
                              ? 'Pair the bridge first'
                              : 'List the lights reported by this bridge'
                        }
                      >
                        <Icon name="refresh" size={14} />
                        {hueListBusy === draft.id ? 'Listing…' : 'List lights'}
                      </button>
                    </div>

                    {listError && (
                      <p className="light-list-error" role="alert">
                        {listError}
                      </p>
                    )}
                    <p className="light-provider-note">
                      Start pairing, then press the link button on top of the bridge. Manual host
                      entry is the fallback when discovery is blocked. The application key is
                      stored once and never shown again.
                    </p>
                  </div>
                )}

                {draft.type === 'nanoleaf' && (
                  <div className="light-provider-panel">
                    <div className="light-provider-head">
                      <span className="mono light-provider-label">NANOLEAF TOKEN</span>
                      <span className="mono light-provider-hint">
                        {hasCredential
                          ? 'Stored — enter a new token to replace it'
                          : 'No token stored'}
                      </span>
                    </div>
                    <div className="light-token-row">
                      <label className="field">
                        <span>OpenAPI token</span>
                        <input
                          type="password"
                          value={draft.credential}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder="Hold the power button 5–7 s, then paste the token"
                          aria-invalid={
                            attempted && credentialError ? true : undefined
                          }
                          disabled={busy}
                          onChange={(event) =>
                            updateDraft(draft.id, { credential: event.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => void saveToken(draft)}
                        disabled={busy || draft.credential.trim() === ''}
                      >
                        <Icon name="save" size={14} /> Save token
                      </button>
                      {hasCredential && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => void clearToken(draft)}
                          disabled={busy}
                        >
                          Clear token
                        </button>
                      )}
                    </div>
                    {attempted && credentialError && (
                      <p className="hint error-text">{credentialError}</p>
                    )}
                    <p className="light-provider-note">
                      Hold the controller’s power button for 5–7 seconds, then paste the token the
                      device exposes. The token is written once to the encrypted secret store and
                      is never read back into this screen.
                    </p>
                  </div>
                )}

                {draft.type === 'elgato' && (
                  <div className="light-provider-panel">
                    <p className="light-provider-note">{provider.note}</p>
                  </div>
                )}

                {savedDevice && savedLight && (
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
                        <span className="tag light-status-provider">
                          {lightProviderInfo(status?.type ?? savedLight.type).badge}
                        </span>
                      </div>
                    ) : (
                      <span className="mono light-telemetry muted">NOT TESTED</span>
                    )}
                    <div className="light-status-side">
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() => void testDevice(savedLight)}
                        disabled={busy || testing || testingDevice !== null}
                      >
                        <Icon name="refresh" size={14} />
                        {testingDevice === savedLight.id ? 'Testing…' : 'Test'}
                      </button>
                      <span className="mono light-endpoint">
                        {lightEndpoint({ host: draft.host.trim(), port: Number(draft.port) || 0 })}
                      </span>
                    </div>
                  </div>
                )}
                {!savedDevice && (
                  <span className="hint">
                    New device — Save lights to test it.
                    {draft.type === 'hue' ? ' Pairing saves it automatically.' : ''}
                  </span>
                )}
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
