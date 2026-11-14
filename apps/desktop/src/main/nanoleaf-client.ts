import {
  NANOLEAF_DEFAULT_PORT,
  miredFromNanoleafKelvin,
  nanoleafKelvinFromMired,
  type LightTarget,
} from '@phonedek/shared'
import {
  LatestWinsQueue,
  type LightDeviceClient,
  type LightDeviceState,
  type LightStatePatch,
} from './light-client'
import { isValidLightCredential } from './light-credentials'
import type { LightDeviceSettings } from './settings-store'

export interface NanoleafClientOptions {
  /** OpenAPI auth token, obtained by holding the power button and calling
   * `POST /api/v1/new`. Never logged or sent outside the LAN. */
  token: string
  timeoutMs?: number
  /** Test seam / custom transport. */
  fetchImpl?: typeof fetch
}

export class NanoleafError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly host?: string,
    readonly port?: number,
  ) {
    super(message)
    this.name = 'NanoleafError'
  }
}

const DEFAULT_TIMEOUT_MS = 3000
const MAX_BODY_BYTES = 64 * 1024
const DEFAULT_KELVIN = 4000

function deviceLabel(device: { host: string; port?: number }): string {
  return `${device.host}:${device.port ?? NANOLEAF_DEFAULT_PORT}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new NanoleafError('Nanoleaf value must be a finite number')
  return Math.max(min, Math.min(max, Math.round(value)))
}

function nestedValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const inner = (value as { value?: unknown }).value
    if (typeof inner === 'number') return inner
    if (typeof inner === 'boolean') return inner ? 1 : 0
  }
  return undefined
}

function nestedOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Boolean((value as { value?: unknown }).value)
  }
  return false
}

/**
 * Parse the OpenAPI panel document. Nanoleaf expresses `on`, `brightness`
 * (0..100) and `ct` (Kelvin) as `{value}` objects; some firmware also returns
 * bare numbers, so both forms are accepted.
 */
export function parseNanoleafState(payload: unknown): LightDeviceState {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new NanoleafError('Nanoleaf returned an invalid payload')
  }
  const state = (payload as { state?: unknown }).state
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new NanoleafError('Nanoleaf returned no device state')
  }
  const record = state as Record<string, unknown>
  const brightness = nestedValue(record.brightness)
  const kelvin = nestedValue(record.ct)
  return {
    on: nestedOn(record.on),
    brightness: clampInt(brightness ?? 0, 0, 100),
    temperature: miredFromNanoleafKelvin(
      typeof kelvin === 'number' && kelvin > 0 ? kelvin : DEFAULT_KELVIN,
    ),
  }
}

/** HTTP client for one Nanoleaf controller or Light Panels device. */
export class NanoleafClient implements LightDeviceClient {
  readonly device: LightDeviceSettings
  private readonly token: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly writes: LatestWinsQueue
  private lastState: LightDeviceState | null = null

  constructor(device: LightDeviceSettings, options: NanoleafClientOptions) {
    const token = options.token?.trim()
    if (!token || !isValidLightCredential(token)) {
      throw new NanoleafError(
        `Nanoleaf token is missing for ${device.name}. Enter the device token again.`,
        undefined,
        device.host,
        device.port,
      )
    }
    this.device = { ...device, type: 'nanoleaf', port: device.port ?? NANOLEAF_DEFAULT_PORT }
    this.token = token
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.writes = new LatestWinsQueue((patch) => this.writeOnce(patch))
  }

  get endpoint(): string {
    return deviceLabel(this.device)
  }

  async getState(): Promise<LightDeviceState> {
    const payload = await this.request('GET')
    const state = parseNanoleafState(payload)
    this.lastState = state
    return state
  }

  setState(patch: LightStatePatch): Promise<LightDeviceState> {
    return this.writes.submit(normalizePatch(patch))
  }

  setTarget(target: LightTarget | 'power', value: number): Promise<LightDeviceState> {
    if (target === 'power') return this.setState({ on: value >= 50 })
    if (target === 'brightness') return this.setState({ brightness: clampInt(value, 0, 100) })
    return this.setState({ temperature: clampInt(value, 143, 344) })
  }

  private async writeOnce(patch: LightStatePatch): Promise<LightDeviceState> {
    const base = this.lastState ?? (await this.getState())
    const normalized = normalizePatch(patch)
    const next: LightDeviceState = { ...base, ...normalized }

    const body: Record<string, unknown> = {}
    if (normalized.on !== undefined) body.on = { value: normalized.on }
    if (normalized.brightness !== undefined) {
      body.brightness = { value: clampInt(normalized.brightness, 0, 100) }
    }
    if (normalized.temperature !== undefined) {
      body.ct = { value: nanoleafKelvinFromMired(normalized.temperature) }
    }
    if (Object.keys(body).length === 0) return base

    await this.request('PUT', body)
    this.lastState = next
    return next
  }

  private async request(method: 'GET' | 'PUT', body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref?.()
    // The token is part of the path by protocol. It is intentionally never
    // included in a thrown message or log line.
    const path = `/api/v1/${encodeURIComponent(this.token)}/${method === 'PUT' ? 'state' : ''}`
    const url = `http://${deviceLabel(this.device)}${path}`

    try {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method,
          // Never follow a redirect: the auth token lives in the path, and a
          // rogue device must not be able to forward it to another origin.
          redirect: 'error',
          headers:
            body === undefined
              ? { Accept: 'application/json' }
              : { Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new NanoleafError(
            `Nanoleaf at ${this.endpoint} timed out after ${this.timeoutMs} ms`,
            undefined,
            this.device.host,
            this.device.port,
          )
        }
        throw new NanoleafError(
          `Could not reach Nanoleaf at ${this.endpoint}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          undefined,
          this.device.host,
          this.device.port,
        )
      }

      if (!response.ok) {
        throw new NanoleafError(
          `Nanoleaf at ${this.endpoint} returned HTTP ${response.status}`,
          response.status,
          this.device.host,
          this.device.port,
        )
      }

      const text = (await response.text()).slice(0, MAX_BODY_BYTES)
      if (!text.trim()) return null
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new NanoleafError(
          `Nanoleaf at ${this.endpoint} returned invalid JSON`,
          response.status,
          this.device.host,
          this.device.port,
        )
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizePatch(patch: LightStatePatch): LightStatePatch {
  const normalized: LightStatePatch = {}
  if (patch.on !== undefined) normalized.on = Boolean(patch.on)
  if (patch.brightness !== undefined) normalized.brightness = clampInt(patch.brightness, 0, 100)
  if (patch.temperature !== undefined) normalized.temperature = clampInt(patch.temperature, 143, 344)
  return normalized
}
