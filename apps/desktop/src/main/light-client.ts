import {
  ELGATO_TEMPERATURE_MAX,
  ELGATO_TEMPERATURE_MIN,
  LIGHT_DEFAULT_PORT,
  type LightTarget,
} from '@phonedek/shared'
import type { LightDeviceSettings } from './settings-store'

/** The subset of `/elgato/lights` the app reads and writes. */
export interface ElgatoLightState {
  on: boolean
  /** 0..100 */
  brightness: number
  /** Mireds, 143..344 (higher = warmer). */
  temperature: number
}

export type ElgatoLightPatch = Partial<ElgatoLightState>

export interface ElgatoClientOptions {
  /** Per-request timeout. Defaults to 3000 ms. */
  timeoutMs?: number
  /** Test seam / custom transport; receives the absolute URL and init. */
  fetchImpl?: typeof fetch
}

export class ElgatoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly host?: string,
    readonly port?: number,
  ) {
    super(message)
    this.name = 'ElgatoError'
  }
}

const DEFAULT_TIMEOUT_MS = 3000
const MAX_BODY_BYTES = 64 * 1024

function deviceLabel(device: { host: string; port?: number }): string {
  return `${device.host}:${device.port ?? LIGHT_DEFAULT_PORT}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new ElgatoError('Elgato value must be a finite number')
  return Math.max(min, Math.min(max, Math.round(value)))
}

function parseOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  throw new ElgatoError('Elgato response has no valid "on" value')
}

/**
 * Parse `{ numberOfLights, lights: [{ on, brightness, temperature }] }`.
 * Elgato firmware alternates between booleans and 0/1 for `on`; both work.
 */
export function parseElgatoLights(payload: unknown): ElgatoLightState {
  if (typeof payload !== 'object' || payload === null) {
    throw new ElgatoError('Elgato returned an invalid JSON payload')
  }
  const lights = (payload as { lights?: unknown }).lights
  if (!Array.isArray(lights) || lights.length === 0) {
    throw new ElgatoError('Elgato returned no lights')
  }
  const first = lights[0]
  if (typeof first !== 'object' || first === null) {
    throw new ElgatoError('Elgato returned an invalid light entry')
  }
  const record = first as Record<string, unknown>
  return {
    on: parseOn(record.on),
    brightness: clampInt(Number(record.brightness), 0, 100),
    temperature: clampInt(Number(record.temperature), ELGATO_TEMPERATURE_MIN, ELGATO_TEMPERATURE_MAX),
  }
}

/** Build the PUT body the device expects: exactly one light. */
export function elgatoPutBody(state: ElgatoLightState): {
  numberOfLights: 1
  lights: ElgatoLightState[]
} {
  return {
    numberOfLights: 1,
    lights: [
      {
        on: state.on,
        brightness: clampInt(state.brightness, 0, 100),
        temperature: clampInt(
          state.temperature,
          ELGATO_TEMPERATURE_MIN,
          ELGATO_TEMPERATURE_MAX,
        ),
      },
    ],
  }
}

/** HTTP client for one Elgato Key Light. No auth; the LAN is the trust boundary. */
export class ElgatoClient {
  readonly device: LightDeviceSettings
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private lastState: ElgatoLightState | null = null
  private pendingPatch: ElgatoLightPatch | null = null
  private pendingWrite: Promise<ElgatoLightState> | null = null

  constructor(device: LightDeviceSettings, options: ElgatoClientOptions = {}) {
    this.device = { ...device, port: device.port ?? LIGHT_DEFAULT_PORT }
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  get url(): string {
    return `http://${deviceLabel(this.device)}/elgato/lights`
  }

  /** GET the current state. Bypasses no cache; callers own caching. */
  async getState(): Promise<ElgatoLightState> {
    const state = await this.request<unknown>('GET')
    const parsed = parseElgatoLights(state)
    this.lastState = parsed
    return parsed
  }

  /**
   * PUT a partial state.
   *
   * Writes are latest-wins per light: while a PUT is in flight, newer patches
   * are merged into one pending write instead of queueing one request per
   * slider tick. Every caller whose patch was merged resolves with the final
   * state.
   */
  setState(patch: ElgatoLightPatch): Promise<ElgatoLightState> {
    const normalized = normalizePatch(patch)
    if (this.pendingWrite) {
      this.pendingPatch = { ...this.pendingPatch, ...normalized }
      return this.pendingWrite
    }

    const run = (async (): Promise<ElgatoLightState> => {
      try {
        let next = normalized
        let state = await this.writeOnce(next)
        while (this.pendingPatch) {
          next = this.pendingPatch
          this.pendingPatch = null
          state = await this.writeOnce({ ...state, ...next })
        }
        return state
      } catch (error) {
        // A failed write invalidates every patch merged while it was in
        // flight; callers already share this rejection.
        this.pendingPatch = null
        throw error
      }
    })()
    this.pendingWrite = run
    return run.finally(() => {
      if (this.pendingWrite === run) this.pendingWrite = null
    })
  }

  /** Set one target from a raw value. */
  setTarget(
    target: LightTarget | 'power',
    value: number,
  ): Promise<ElgatoLightState> {
    if (target === 'power') return this.setState({ on: value >= 50 })
    if (target === 'brightness') return this.setState({ brightness: clampInt(value, 0, 100) })
    return this.setState({
      temperature: clampInt(value, ELGATO_TEMPERATURE_MIN, ELGATO_TEMPERATURE_MAX),
    })
  }

  private async writeOnce(patch: ElgatoLightPatch): Promise<ElgatoLightState> {
    const base = this.lastState ?? (await this.getState())
    const body = elgatoPutBody({ ...base, ...patch })
    const state = parseElgatoLights(await this.request<unknown>('PUT', body))
    this.lastState = state
    return state
  }

  private async request<T>(method: 'GET' | 'PUT', body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref?.()
    try {
      let response: Response
      try {
        response = await this.fetchImpl(this.url, {
          method,
          // The device rejects browser-originated requests; Node does not send
          // Origin. Only JSON headers are added.
          headers:
            body === undefined
              ? { Accept: 'application/json' }
              : { Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ElgatoError(
            `Elgato light at ${deviceLabel(this.device)} timed out after ${this.timeoutMs} ms`,
            undefined,
            this.device.host,
            this.device.port,
          )
        }
        const reason = error instanceof Error ? error.message : String(error)
        throw new ElgatoError(
          `Could not reach Elgato light at ${deviceLabel(this.device)}: ${reason}`,
          undefined,
          this.device.host,
          this.device.port,
        )
      }

      const text = await readBody(response)
      if (!response.ok) {
        throw new ElgatoError(
          `Elgato light at ${deviceLabel(this.device)} returned HTTP ${response.status}${
            text.trim() ? `: ${text.trim().slice(0, 200)}` : ''
          }`,
          response.status,
          this.device.host,
          this.device.port,
        )
      }
      if (!text.trim()) {
        throw new ElgatoError(
          `Elgato light at ${deviceLabel(this.device)} returned an empty response`,
          response.status,
          this.device.host,
          this.device.port,
        )
      }
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ElgatoError(
          `Elgato light at ${deviceLabel(this.device)} returned invalid JSON`,
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

function normalizePatch(patch: ElgatoLightPatch): ElgatoLightPatch {
  const normalized: ElgatoLightPatch = {}
  if (patch.on !== undefined) normalized.on = Boolean(patch.on)
  if (patch.brightness !== undefined) normalized.brightness = clampInt(patch.brightness, 0, 100)
  if (patch.temperature !== undefined) {
    normalized.temperature = clampInt(
      patch.temperature,
      ELGATO_TEMPERATURE_MIN,
      ELGATO_TEMPERATURE_MAX,
    )
  }
  return normalized
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text()
  return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text
}

/** Kept for callers/tests that prefer an explicit URL over `client.url`. */
export function elgatoRequestUrl(device: { host: string; port?: number }): string {
  return `http://${deviceLabel(device)}/elgato/lights`
}
