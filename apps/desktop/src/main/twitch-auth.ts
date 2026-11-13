import type { Logger } from './logger'
import type { SecretStore } from './secret-store'

/**
 * Twitch Device Code Flow (public client, no client secret).
 *
 * - `channel:manage:broadcast` — channel title/game, stream markers.
 * - `user:write:chat` — send a chat message as the authenticated user.
 *
 * `GET /helix/streams`, `/helix/users` and `/helix/channels` need no scopes,
 * only a user token. Public-client refresh tokens are single-use and expire
 * after 30 days of inactivity; the rotated bundle is persisted before use.
 */
export const TWITCH_SCOPES = ['channel:manage:broadcast', 'user:write:chat'] as const

export const TWITCH_SECRET_KEY = 'twitch.oauth'
export const TWITCH_AUTH_BASE = 'https://id.twitch.tv/oauth2'
export const TWITCH_HELIX_BASE = 'https://api.twitch.tv/helix'

/** Bundled/public client ID override, e.g. a build-time default. */
export function builtinTwitchClientId(): string {
  const fromEnv = process.env['PHONEDEK_TWITCH_CLIENT_ID']
  return typeof fromEnv === 'string' ? sanitizeTwitchClientId(fromEnv) : ''
}

export function sanitizeTwitchClientId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^[A-Za-z0-9]{1,64}$/.test(trimmed) ? trimmed : ''
}

export type TwitchAuthState = 'disabled' | 'unauthorized' | 'authorizing' | 'authorized' | 'error'

export interface TwitchTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  scopes: string[]
}

export interface TwitchAccount {
  userId: string
  login: string
  displayName?: string
}

export interface TwitchDeviceAuthorization {
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalMs: number
}

export interface TwitchAuthStatus {
  state: TwitchAuthState
  enabled: boolean
  account?: string
  login?: string
  userId?: string
  scopes: string[]
  device?: TwitchDeviceAuthorization
  expiresAt?: number
  lastError?: string
}

/** Token access used by the Helix client; keeps tokens out of its surface. */
export interface TwitchTokenProvider {
  readonly clientId: string
  getAccessToken(): Promise<string>
  refreshAccessToken(): Promise<string>
}

export class TwitchAuthError extends Error {
  constructor(
    message: string,
    readonly authRequired = false,
  ) {
    super(message)
    this.name = 'TwitchAuthError'
  }
}

export interface TwitchAuthOptions {
  clientId: string
  store: Pick<SecretStore, 'get' | 'set' | 'delete' | 'has'>
  enabled?: boolean
  scopes?: readonly string[]
  authBaseUrl?: string
  fetch?: typeof fetch
  logger?: Logger
  now?: () => number
  /** Tests can poll faster than Twitch's 1 s floor. */
  pollIntervalMs?: number
  requestTimeoutMs?: number
}

interface OAuthErrorBody {
  error?: unknown
  message?: unknown
  status?: unknown
  error_description?: unknown
}

const DEFAULT_POLL_INTERVAL_MS = 1000
const MAX_POLL_INTERVAL_MS = 60_000
const REFRESH_MARGIN_MS = 60_000

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function oauthReason(body: OAuthErrorBody): string {
  for (const key of ['message', 'error_description', 'error'] as const) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseScopes(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean)
  }
  return [...fallback]
}

function parseTokens(body: Record<string, unknown>, fallbackScopes: readonly string[], now: number): TwitchTokens | null {
  const accessToken = body['access_token']
  const refreshToken = body['refresh_token']
  if (typeof accessToken !== 'string' || !accessToken) return null
  const expiresIn = body['expires_in']
  const seconds =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : 3600
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    expiresAt: now + seconds * 1000,
    scopes: parseScopes(body['scope'] ?? body['scopes'], fallbackScopes),
  }
}

/**
 * DCF state machine + token store. Emits status changes; never exposes tokens
 * through `status`, IPC or logs.
 */
export class TwitchAuth implements TwitchTokenProvider {
  private readonly store: Pick<SecretStore, 'get' | 'set' | 'delete' | 'has'>
  private readonly scopes: readonly string[]
  private readonly authBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly pollIntervalMs: number
  private readonly requestTimeoutMs: number
  private readonly listeners = new Set<(status: TwitchAuthStatus) => void>()

  private currentClientId: string
  private enabled: boolean
  private tokens: TwitchTokens | null = null
  private account: TwitchAccount | null = null
  private device: TwitchDeviceAuthorization | null = null
  private timer: NodeJS.Timeout | null = null
  private refreshPromise: Promise<string> | null = null
  private pollBusy = false
  private state: TwitchAuthState = 'disabled'
  private lastError: string | undefined
  private disposed = false

  constructor(options: TwitchAuthOptions) {
    this.store = options.store
    this.currentClientId = sanitizeTwitchClientId(options.clientId)
    this.enabled = options.enabled === true
    this.scopes = options.scopes ?? TWITCH_SCOPES
    this.authBaseUrl = (options.authBaseUrl ?? TWITCH_AUTH_BASE).replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 15_000)
    if (!this.enabled) this.state = 'disabled'
  }

  get clientId(): string {
    return this.currentClientId
  }

  get status(): TwitchAuthStatus {
    return {
      state: this.state,
      enabled: this.enabled,
      scopes: [...(this.tokens?.scopes ?? this.scopes)],
      ...(this.account
        ? {
            account: this.account.displayName ?? this.account.login,
            login: this.account.login,
            userId: this.account.userId,
          }
        : {}),
      ...(this.device ? { device: { ...this.device } } : {}),
      ...(this.tokens ? { expiresAt: this.tokens.expiresAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  /** True only when a token is loaded and the account was validated. */
  get connected(): boolean {
    return this.state === 'authorized' && this.tokens !== null
  }

  get hasToken(): boolean {
    return this.tokens !== null || this.store.has(TWITCH_SECRET_KEY)
  }

  onStatus(listener: (status: TwitchAuthStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  configure(input: { clientId?: string; enabled?: boolean }): void {
    const nextClientId =
      input.clientId === undefined ? this.currentClientId : sanitizeTwitchClientId(input.clientId)
    if (nextClientId !== this.currentClientId) {
      this.currentClientId = nextClientId
      // Tokens are bound to the client ID that issued them.
      this.clearTokens()
      this.lastError = nextClientId ? 'Twitch Client ID changed; connect Twitch again.' : undefined
    }
    if (input.enabled !== undefined) this.enabled = input.enabled
    if (!this.enabled) {
      this.cancelDeviceFlow()
      this.setState('disabled')
      return
    }
    if (this.state === 'disabled') this.setState('unauthorized')
  }

  /** Load a stored bundle and validate it. Safe to call again (Reconnect). */
  async start(): Promise<void> {
    if (this.disposed) return
    if (!this.enabled) {
      this.setState('disabled')
      return
    }
    if (!this.currentClientId) {
      this.lastError = 'Twitch Client ID is not set.'
      this.setState('unauthorized')
      return
    }
    if (!this.tokens) this.tokens = this.loadTokens()
    if (!this.tokens) {
      this.setState('unauthorized')
      return
    }
    if (this.tokens.expiresAt <= this.now() + 1000) {
      try {
        await this.refreshAccessToken()
      } catch {
        return
      }
    }
    try {
      await this.validateCurrent()
      this.lastError = undefined
      this.setState('authorized')
    } catch (error) {
      if (error instanceof TwitchAuthError && error.authRequired) {
        this.setState('unauthorized')
        return
      }
      this.lastError = `Could not verify the Twitch token: ${message(error)}`
      this.setState('error')
    }
  }

  /**
   * Begin the device flow. Returns the user code and verification URL so the
   * renderer can show/open them; polling continues in the background.
   */
  async startDeviceFlow(): Promise<TwitchDeviceAuthorization> {
    if (!this.enabled) throw new TwitchAuthError('Twitch is disabled.')
    if (!this.currentClientId) throw new TwitchAuthError('Twitch Client ID is not set.')
    if (this.device) return { ...this.device }

    const response = await this.request(`${this.authBaseUrl}/device`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.currentClientId,
        scopes: this.scopes.join(' '),
      }),
    })
    const body = (await readJson(response)) as Record<string, unknown>
    if (!response.ok) {
      throw new TwitchAuthError(
        oauthReason(body) || `Twitch rejected the device request (HTTP ${response.status}).`,
      )
    }
    const deviceCode = body['device_code']
    const userCode = body['user_code']
    const verificationUri = body['verification_uri']
    if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
      throw new TwitchAuthError('Twitch returned an incomplete device authorization.')
    }
    const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : 1800
    const serverInterval = typeof body['interval'] === 'number' ? body['interval'] : 5
    const intervalMs = Math.max(this.pollIntervalMs, serverInterval * 1000)
    this.device = {
      userCode,
      verificationUri,
      expiresAt: this.now() + Math.max(1, expiresIn) * 1000,
      intervalMs,
    }
    this.pendingDeviceCode = deviceCode
    this.lastError = undefined
    this.setState('authorizing')
    this.logger?.info('Twitch device authorization started')
    this.schedulePoll(intervalMs)
    return { ...this.device }
  }

  /** Abandon a pending device flow; an existing authorization is unaffected. */
  cancelDeviceFlow(): void {
    this.stopPolling()
    this.device = null
    this.pendingDeviceCode = null
    if (!this.enabled) this.setState('disabled')
    else this.setState(this.tokens ? 'authorized' : 'unauthorized')
  }

  /** Forget the account and delete the stored token bundle. */
  disconnect(): void {
    this.stopPolling()
    this.device = null
    this.pendingDeviceCode = null
    this.tokens = null
    this.account = null
    this.refreshPromise = null
    this.store.delete(TWITCH_SECRET_KEY)
    this.lastError = undefined
    this.setState(this.enabled ? 'unauthorized' : 'disabled')
    this.logger?.info('Twitch disconnected')
  }

  async getAccessToken(): Promise<string> {
    if (!this.enabled) throw new TwitchAuthError('Twitch is disabled.', true)
    if (!this.currentClientId) throw new TwitchAuthError('Twitch Client ID is not set.', true)
    if (!this.tokens) this.tokens = this.loadTokens()
    if (!this.tokens) throw new TwitchAuthError('Twitch is not connected.', true)
    if (this.tokens.expiresAt > this.now() + REFRESH_MARGIN_MS) return this.tokens.accessToken
    return this.refreshAccessToken()
  }

  /** Force a single-flight refresh (used once after a Helix 401). */
  refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise
    const run = (async (): Promise<string> => {
      if (!this.tokens) this.tokens = this.loadTokens()
      const refreshToken = this.tokens?.refreshToken
      if (!this.currentClientId) throw new TwitchAuthError('Twitch Client ID is not set.', true)
      if (!refreshToken) {
        this.clearTokens('Twitch is not connected.')
        throw new TwitchAuthError('Twitch is not connected.', true)
      }
      let response: Response
      try {
        response = await this.request(`${this.authBaseUrl}/token`, {
          method: 'POST',
          body: new URLSearchParams({
            client_id: this.currentClientId,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        })
      } catch (error) {
        this.lastError = `Twitch token refresh failed: ${message(error)}`
        this.setState('error')
        throw new TwitchAuthError(this.lastError)
      }
      const body = await readJson(response)
      const next = parseTokens(body, this.scopes, this.now())
      if (!response.ok || !next) {
        const reason = oauthReason(body) || `HTTP ${response.status}`
        this.clearTokens(`Twitch authorization expired. Connect Twitch again. (${reason})`)
        this.logger?.warn(`Twitch token refresh was rejected: ${reason}`)
        throw new TwitchAuthError('Twitch authorization expired. Connect Twitch again.', true)
      }
      // Twitch rotates the refresh token; keep the previous one only if the
      // server omitted it, so a valid grant is never dropped.
      const rotated = { ...next, refreshToken: next.refreshToken || refreshToken }
      // Persist the rotated bundle before handing out the new access token.
      this.persist(rotated)
      this.tokens = rotated
      this.lastError = undefined
      this.setState('authorized')
      this.logger?.info('Twitch access token refreshed')
      return next.accessToken
    })()
    this.refreshPromise = run
    return run.finally(() => {
      this.refreshPromise = null
    })
  }

  async getAccount(): Promise<TwitchAccount> {
    if (!this.tokens) throw new TwitchAuthError('Twitch is not connected.', true)
    const known = this.account
    if (known) return { ...known }
    await this.validateCurrent()
    const validated = this.account
    if (!validated) throw new TwitchAuthError('Twitch account is not available.', true)
    return { ...validated }
  }

  dispose(): void {
    this.disposed = true
    this.stopPolling()
    this.listeners.clear()
  }

  private pendingDeviceCode: string | null = null

  private async validateCurrent(): Promise<void> {
    if (!this.tokens) throw new TwitchAuthError('Twitch is not connected.', true)
    let token = this.tokens.accessToken
    let response = await this.validateRequest(token)
    if (response.status === 401) {
      token = await this.refreshAccessToken()
      response = await this.validateRequest(token)
    }
    const body = (await readJson(response)) as Record<string, unknown>
    if (response.status === 401) {
      this.clearTokens('Twitch authorization expired. Connect Twitch again.')
      throw new TwitchAuthError('Twitch authorization expired. Connect Twitch again.', true)
    }
    if (!response.ok) {
      throw new Error(oauthReason(body) || `HTTP ${response.status}`)
    }
    const userId = body['user_id']
    const login = body['login']
    if (typeof userId === 'string' && typeof login === 'string') {
      this.account = { userId, login }
    }
    if (this.tokens) {
      this.tokens = {
        ...this.tokens,
        scopes: parseScopes(body['scopes'], this.tokens.scopes),
        ...(typeof body['expires_in'] === 'number' && body['expires_in'] > 0
          ? { expiresAt: this.now() + body['expires_in'] * 1000 }
          : {}),
      }
      this.persist(this.tokens)
    }
  }

  private validateRequest(token: string): Promise<Response> {
    return this.request(`${this.authBaseUrl}/validate`, {
      method: 'GET',
      headers: { Authorization: `OAuth ${token}` },
    })
  }

  private async pollDevice(): Promise<void> {
    if (this.disposed || this.pollBusy || !this.device || !this.pendingDeviceCode) return
    const device = this.device
    if (this.now() >= device.expiresAt) {
      this.failDevice('The Twitch code expired. Start again.')
      return
    }
    this.pollBusy = true
    try {
      const response = await this.request(`${this.authBaseUrl}/token`, {
        method: 'POST',
        body: new URLSearchParams({
          client_id: this.currentClientId,
          scopes: this.scopes.join(' '),
          device_code: this.pendingDeviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      const body = (await readJson(response)) as Record<string, unknown>
      if (response.ok) {
        const tokens = parseTokens(body, this.scopes, this.now())
        if (!tokens) {
          this.failDevice('Twitch returned an invalid token response.')
          return
        }
        this.stopPolling()
        this.device = null
        this.pendingDeviceCode = null
        this.tokens = tokens
        this.persist(tokens)
        this.lastError = undefined
        this.setState('authorized')
        this.logger?.info('Twitch authorization completed')
        try {
          await this.validateCurrent()
          this.setState('authorized')
        } catch (error) {
          this.logger?.warn(`Twitch token validation after authorization failed: ${message(error)}`)
        }
        return
      }

      const reason = oauthReason(body).toLowerCase()
      if (reason.includes('authorization_pending') || reason.includes('pending')) {
        this.schedulePoll(device.intervalMs)
        return
      }
      if (reason.includes('slow_down') || reason.includes('slow down')) {
        const next = Math.min(MAX_POLL_INTERVAL_MS, device.intervalMs + 5000)
        this.device = { ...device, intervalMs: next }
        this.schedulePoll(next)
        return
      }
      if (reason.includes('access_denied') || reason.includes('denied')) {
        this.failDevice('Twitch authorization was denied.')
        return
      }
      if (reason.includes('expired') || reason.includes('invalid device code')) {
        this.failDevice('The Twitch code expired. Start again.')
        return
      }
      // Network hiccup / 5xx: keep the flow alive and try again.
      this.lastError = oauthReason(body) || `Twitch returned HTTP ${response.status}.`
      this.setState('authorizing')
      this.schedulePoll(device.intervalMs)
    } catch (error) {
      this.lastError = `Twitch authorization check failed: ${message(error)}`
      this.setState('authorizing')
      this.schedulePoll(device.intervalMs)
    } finally {
      this.pollBusy = false
    }
  }

  private failDevice(reason: string): void {
    this.stopPolling()
    this.device = null
    this.pendingDeviceCode = null
    this.lastError = reason
    this.setState(this.tokens ? 'authorized' : 'unauthorized')
    this.logger?.warn(`Twitch device authorization failed: ${reason}`)
  }

  private schedulePoll(delayMs: number): void {
    this.stopPolling()
    if (this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.pollDevice()
    }, Math.max(1, delayMs))
    this.timer.unref?.()
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private loadTokens(): TwitchTokens | null {
    const raw = this.store.get(TWITCH_SECRET_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<TwitchTokens>
      if (
        typeof parsed.accessToken === 'string' &&
        parsed.accessToken.length > 0 &&
        typeof parsed.refreshToken === 'string' &&
        typeof parsed.expiresAt === 'number'
      ) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          scopes: parseScopes(parsed.scopes, this.scopes),
        }
      }
    } catch (error) {
      this.logger?.warn(`Stored Twitch token was invalid: ${message(error)}`)
    }
    this.store.delete(TWITCH_SECRET_KEY)
    return null
  }

  private persist(tokens: TwitchTokens): void {
    this.store.set(TWITCH_SECRET_KEY, JSON.stringify(tokens))
  }

  private clearTokens(reason?: string): void {
    this.tokens = null
    this.account = null
    this.store.delete(TWITCH_SECRET_KEY)
    if (reason) this.lastError = reason
    this.setState(this.enabled ? 'unauthorized' : 'disabled')
  }

  private setState(state: TwitchAuthState): void {
    this.state = state
    const status = this.status
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch (error) {
        this.logger?.warn(`Twitch status listener failed: ${message(error)}`)
      }
    }
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(this.requestTimeoutMs)
        : undefined
    return this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(signal ? { signal } : {}),
    })
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = (await response.json()) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
