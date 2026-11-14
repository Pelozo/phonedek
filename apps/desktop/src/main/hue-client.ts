import { request as httpsRequest } from 'node:https'
import {
  HUE_DEFAULT_PORT,
  hueBrightnessFromPercent,
  hueColorTemperatureFromMired,
  miredFromHueColorTemperature,
  percentFromHueBrightness,
  type LightTarget,
} from '@phonedek/shared'
import {
  LatestWinsQueue,
  type LightDeviceClient,
  type LightDeviceState,
  type LightStatePatch,
} from './light-client'
import { isValidLightCredential } from './light-credentials'
import { sanitizeLightHost, type LightDeviceSettings } from './settings-store'

export interface HueBridgeInfo {
  id: string
  host: string
  port: number
}

export interface HueLightInfo {
  id: string
  name: string
  state: LightDeviceState
}

export interface HuePairResult {
  /** Generated application key. Store it in the SecretStore; never return it
   * from the IPC layer. */
  username: string
  host: string
  port: number
  /** The `devicetype` string sent to the bridge. */
  deviceType: string
}

export interface HueClientOptions {
  /** Hue application key (CLIP v1 username). */
  username: string
  /** Per-request timeout. Defaults to 3000 ms. */
  timeoutMs?: number
}

export class HueError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly host?: string,
    readonly port?: number,
    readonly code?: 'link-button' | 'auth' | 'invalid-response',
  ) {
    super(message)
    this.name = 'HueError'
  }
}

const DEFAULT_TIMEOUT_MS = 3000
const MAX_BODY_BYTES = 64 * 1024
const DISCOVERY_URL = 'https://discovery.meethue.com/'
const DEFAULT_ATTEMPTS = 1

function deviceLabel(device: { host: string; port?: number }): string {
  return `${device.host}:${device.port ?? HUE_DEFAULT_PORT}`
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '')
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new HueError('Hue value must be a finite number')
  return Math.max(min, Math.min(max, Math.round(value)))
}

function parseOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return false
}

/**
 * Parse one `/lights/<id>` object into app units.
 *
 * Hue `bri` is 1..254 and `ct` is 153..500 mireds. Lights that do not expose
 * `ct` (color-only strips) fall back to a neutral 250 mired.
 */
export function parseHueLightState(payload: unknown): LightDeviceState {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new HueError('Hue returned an invalid light payload', undefined, undefined, undefined, 'invalid-response')
  }
  const state = (payload as { state?: unknown }).state
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new HueError('Hue returned no light state', undefined, undefined, undefined, 'invalid-response')
  }
  const record = state as Record<string, unknown>
  const bri = typeof record.bri === 'number' ? record.bri : 0
  const ct = typeof record.ct === 'number' ? record.ct : 250
  return {
    on: parseOn(record.on),
    brightness: percentFromHueBrightness(bri),
    temperature: miredFromHueColorTemperature(ct),
  }
}

function parseHueLight(payload: unknown, id: string): HueLightInfo {
  const name =
    typeof (payload as { name?: unknown })?.name === 'string'
      ? ((payload as { name: string }).name.trim().slice(0, 64) || `Hue light ${id}`)
      : `Hue light ${id}`
  return { id, name, state: parseHueLightState(payload) }
}

/** Parse the `/lights` map, sorted by numeric Hue id where possible. */
export function parseHueLights(payload: unknown): HueLightInfo[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new HueError('Hue returned an invalid light list', undefined, undefined, undefined, 'invalid-response')
  }
  const entries = Object.entries(payload as Record<string, unknown>)
  const lights: HueLightInfo[] = []
  for (const [id, value] of entries) {
    try {
      lights.push(parseHueLight(value, id))
    } catch {
      // Skip one malformed light instead of losing the whole bridge.
    }
  }
  return lights.sort((a, b) => {
    const left = Number(a.id)
    const right = Number(b.id)
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right
    return a.id.localeCompare(b.id)
  })
}

interface HueResponse {
  status: number
  payload: unknown
}

function requestJson(
  device: { host: string; port?: number },
  path: string,
  options: {
    method: 'GET' | 'POST' | 'PUT'
    body?: unknown
    timeoutMs?: number
  },
): Promise<HueResponse> {
  const timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const port = device.port ?? HUE_DEFAULT_PORT
  const label = deviceLabel(device)
  const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body)

  return new Promise<HueResponse>((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: stripBrackets(device.host),
        port,
        path,
        method: options.method,
        // The Hue bridge ships a self-signed certificate. This relaxation is
        // scoped to the bridge connection only; discovery uses normal TLS.
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          ...(bodyText === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyText),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size <= MAX_BODY_BYTES) chunks.push(chunk)
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = response.statusCode ?? 0
          if (status >= 400) {
            const auth = status === 401 || status === 403
            reject(
              new HueError(
                auth
                  ? `Hue bridge at ${label} rejected the application key (HTTP ${status}). Pair the bridge again.`
                  : `Hue bridge at ${label} returned HTTP ${status}${
                      text.trim() ? `: ${text.trim().slice(0, 200)}` : ''
                    }`,
                status,
                device.host,
                port,
                auth ? 'auth' : undefined,
              ),
            )
            return
          }
          if (!text.trim()) {
            resolve({ status, payload: null })
            return
          }
          try {
            resolve({ status, payload: JSON.parse(text) as unknown })
          } catch {
            reject(
              new HueError(
                `Hue bridge at ${label} returned invalid JSON`,
                status,
                device.host,
                port,
                'invalid-response',
              ),
            )
          }
        })
      },
    )

    request.on('timeout', () => {
      request.destroy(
        new HueError(`Hue bridge at ${label} timed out after ${timeoutMs} ms`, undefined, device.host, port),
      )
    })
    request.on('error', (error) => {
      if (error instanceof HueError) {
        reject(error)
        return
      }
      reject(
        new HueError(
          `Could not reach Hue bridge at ${label}: ${error.message}`,
          undefined,
          device.host,
          port,
        ),
      )
    })
    if (bodyText !== undefined) request.write(bodyText)
    request.end()
  })
}

/**
 * `POST /api` pairing. Hue answers HTTP 200 with either
 * `[{success:{username}}]` or `[{error:{type:101}}]` until the physical link
 * button is pressed.
 */
export async function pairHueBridge(
  bridge: { host: string; port?: number },
  options: {
    attempts?: number
    retryDelayMs?: number
    timeoutMs?: number
    /** Application name before `#`; defaults to `phonedek`. */
    appName?: string
  } = {},
): Promise<HuePairResult> {
  const host = sanitizeLightHost(bridge.host)
  if (!host) throw new HueError('Hue bridge host must be a bare hostname or IP address')
  const port = bridge.port ?? HUE_DEFAULT_PORT
  const attempts = Math.max(1, Math.min(60, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS)))
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000)
  const deviceType = `${(options.appName ?? 'phonedek').slice(0, 20)}#${host}`.slice(0, 40)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { payload } = await requestJson(
      { host, port },
      '/api',
      { method: 'POST', body: { devicetype: deviceType }, timeoutMs: options.timeoutMs },
    )
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new HueError(
        `Hue bridge at ${deviceLabel({ host, port })} returned an invalid pairing response`,
        undefined,
        host,
        port,
        'invalid-response',
      )
    }

    const entry = payload[0]
    const success = (entry as { success?: { username?: unknown } })?.success
    if (success && typeof success.username === 'string') {
      const username = success.username.trim()
      if (!isValidLightCredential(username)) {
        throw new HueError(
          'Hue returned an application key that cannot be stored safely. Try pairing again.',
          undefined,
          host,
          port,
          'invalid-response',
        )
      }
      return { username, host, port, deviceType }
    }

    const error = (entry as { error?: { type?: unknown; description?: unknown } })?.error
    const type = typeof error?.type === 'number' ? error.type : undefined
    if (type === 101) {
      if (attempt < attempts) {
        await delay(retryDelayMs)
        continue
      }
      throw new HueError(
        'Press the link button on top of the Hue bridge, then try pairing again.',
        undefined,
        host,
        port,
        'link-button',
      )
    }

    const description =
      typeof error?.description === 'string' && error.description.trim()
        ? error.description.trim().slice(0, 200)
        : 'unknown error'
    throw new HueError(
      `Hue bridge at ${deviceLabel({ host, port })} refused pairing: ${description}`,
      undefined,
      host,
      port,
    )
  }

  throw new HueError('Hue pairing failed.', undefined, host, port, 'link-button')
}

/**
 * Find bridges through Philips' local discovery endpoint. This is a
 * convenience only: manual host entry always works and is the fallback when
 * the cloud discovery service is blocked or offline.
 */
export async function discoverHueBridges(options: {
  fetchImpl?: typeof fetch
  url?: string
  timeoutMs?: number
} = {}): Promise<HueBridgeInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    let response: Response
    try {
      response = await fetchImpl(options.url ?? DISCOVERY_URL, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HueError(`Hue discovery timed out after ${timeoutMs} ms`)
      }
      throw new HueError(
        `Could not reach Hue discovery: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new HueError(`Hue discovery returned HTTP ${response.status}`, response.status)
    }
    const payload = (await response.json()) as unknown
    if (!Array.isArray(payload)) {
      throw new HueError('Hue discovery returned an invalid payload', undefined, undefined, undefined, 'invalid-response')
    }

    const bridges: HueBridgeInfo[] = []
    const seen = new Set<string>()
    for (const entry of payload) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      const host = sanitizeLightHost(record.internalipaddress)
      if (!host) continue
      const port =
        typeof record.port === 'number' && Number.isInteger(record.port) && record.port >= 1 && record.port <= 65535
          ? record.port
          : HUE_DEFAULT_PORT
      const id =
        typeof record.id === 'string' && record.id.trim()
          ? record.id.trim().slice(0, 64)
          : `${host}:${port}`
      const key = `${host}:${port}`
      if (seen.has(key)) continue
      seen.add(key)
      bridges.push({ id, host, port })
    }
    return bridges
  } finally {
    clearTimeout(timer)
  }
}

/** HTTPS client for one light on a Philips Hue bridge (CLIP v1). */
export class HueClient implements LightDeviceClient {
  readonly device: LightDeviceSettings
  private readonly username: string
  private readonly timeoutMs: number
  private readonly writes: LatestWinsQueue
  private lastState: LightDeviceState | null = null
  private resolvedLightId: string | null = null

  constructor(device: LightDeviceSettings, options: HueClientOptions) {
    const username = options.username?.trim()
    if (!username || !isValidLightCredential(username)) {
      throw new HueError(
        `Hue application key is missing for ${device.name}. Pair the bridge again.`,
        undefined,
        device.host,
        device.port,
      )
    }
    this.device = { ...device, type: 'hue', port: device.port ?? HUE_DEFAULT_PORT }
    this.username = username
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.writes = new LatestWinsQueue((patch) => this.writeOnce(patch))
  }

  get bridge(): string {
    return deviceLabel(this.device)
  }

  /** Current target id, when the device settings pin one. */
  get lightId(): string | null {
    return this.device.lightId ?? this.resolvedLightId
  }

  async getState(): Promise<LightDeviceState> {
    const id = await this.resolveLightId()
    const { payload } = await this.request(`/api/${encodeURIComponent(this.username)}/lights/${encodeURIComponent(id)}`, 'GET')
    assertHueSuccess(payload, this.bridge)
    const state = parseHueLightState(payload)
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

  /** List every light exposed by this bridge (pairing/picker support). */
  async listLights(): Promise<HueLightInfo[]> {
    const { payload } = await this.request(`/api/${encodeURIComponent(this.username)}/lights`, 'GET')
    assertHueSuccess(payload, this.bridge)
    return parseHueLights(payload)
  }

  private async resolveLightId(): Promise<string> {
    if (this.device.lightId) return this.device.lightId
    if (this.resolvedLightId) return this.resolvedLightId
    const lights = await this.listLights()
    if (lights.length === 0) {
      throw new HueError(
        `Hue bridge at ${this.bridge} reports no lights`,
        undefined,
        this.device.host,
        this.device.port,
      )
    }
    this.resolvedLightId = lights[0]!.id
    return this.resolvedLightId
  }

  private async writeOnce(patch: LightStatePatch): Promise<LightDeviceState> {
    const base = this.lastState ?? (await this.getState())
    const normalized = normalizePatch(patch)
    const next: LightDeviceState = { ...base, ...normalized }
    const id = await this.resolveLightId()

    const body: Record<string, unknown> = {}
    if (normalized.on !== undefined) body.on = normalized.on
    if (normalized.brightness !== undefined) body.bri = hueBrightnessFromPercent(normalized.brightness)
    if (normalized.temperature !== undefined) {
      body.ct = hueColorTemperatureFromMired(normalized.temperature)
    }
    if (Object.keys(body).length === 0) return base

    const { payload } = await this.request(
      `/api/${encodeURIComponent(this.username)}/lights/${encodeURIComponent(id)}/state`,
      'PUT',
      body,
    )
    assertHueSuccess(payload, this.bridge)
    this.lastState = next
    return next
  }

  private request(path: string, method: 'GET' | 'PUT', body?: unknown): Promise<HueResponse> {
    return requestJson(this.device, path, { method, body, timeoutMs: this.timeoutMs })
  }
}

function assertHueSuccess(payload: unknown, label: string): void {
  if (payload === null) return
  if (!Array.isArray(payload)) return
  for (const entry of payload) {
    const error = (entry as { error?: { description?: unknown; type?: unknown } })?.error
    if (!error) continue
    const description =
      typeof error.description === 'string' && error.description.trim()
        ? error.description.trim().slice(0, 200)
        : `error ${String(error.type ?? 'unknown')}`
    throw new HueError(`Hue bridge at ${label} rejected the request: ${description}`)
  }
}

function normalizePatch(patch: LightStatePatch): LightStatePatch {
  const normalized: LightStatePatch = {}
  if (patch.on !== undefined) normalized.on = Boolean(patch.on)
  if (patch.brightness !== undefined) normalized.brightness = clampInt(patch.brightness, 0, 100)
  if (patch.temperature !== undefined) normalized.temperature = clampInt(patch.temperature, 143, 344)
  return normalized
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
