import type { Logger } from './logger'
import type { TwitchTokenProvider } from './twitch-auth'

export const TWITCH_HELIX_BASE_URL = 'https://api.twitch.tv/helix'

export interface TwitchUser {
  id: string
  login: string
  displayName: string
  profileImageUrl?: string
}

export interface TwitchStream {
  id: string
  userId: string
  userLogin: string
  userName: string
  gameId: string
  gameName: string
  type: string
  title: string
  viewerCount: number
  startedAt: string
  language?: string
}

export interface TwitchChannel {
  broadcasterId: string
  broadcasterLogin: string
  broadcasterName: string
  gameId: string
  gameName: string
  title: string
  language?: string
}

export interface TwitchCategory {
  id: string
  name: string
  boxArtUrl?: string
}

export interface TwitchMarker {
  id: string
  createdAt: string
  description: string
  positionSeconds: number
}

export interface TwitchRateLimit {
  limit: number
  remaining: number
  /** Epoch milliseconds from `Ratelimit-Reset`. */
  resetAt?: number
}

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'TwitchApiError'
  }
}

interface TwitchClientOptions {
  tokenProvider: TwitchTokenProvider
  baseUrl?: string
  fetch?: typeof fetch
  logger?: Logger
  now?: () => number
  /** Helix request timeout; a hung request must not stall control state. */
  requestTimeoutMs?: number
  /** Conservative local chat spacing; Twitch allows 20 messages/30 s. */
  chatIntervalMs?: number
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function dataArray(body: unknown): Record<string, unknown>[] {
  const data = record(body)['data']
  return Array.isArray(data) ? data.filter((item): item is Record<string, unknown> => {
    return typeof item === 'object' && item !== null && !Array.isArray(item)
  }) : []
}

function rateLimit(response: Response, now: number): TwitchRateLimit | null {
  const limit = Number(response.headers.get('ratelimit-limit'))
  const remaining = Number(response.headers.get('ratelimit-remaining'))
  const reset = Number(response.headers.get('ratelimit-reset'))
  if (!Number.isFinite(limit) && !Number.isFinite(remaining)) return null
  return {
    limit: Number.isFinite(limit) ? limit : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    ...(Number.isFinite(reset) ? { resetAt: (reset || 0) * 1000 || now } : {}),
  }
}

/**
 * Small typed Twitch Helix wrapper. All requests carry `Client-Id` and
 * `Authorization: Bearer`; one 401 triggers a single token refresh, then a
 * retry. Tokens never appear in errors or logs.
 */
export class TwitchClient {
  private readonly tokenProvider: TwitchTokenProvider
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly requestTimeoutMs: number
  private readonly chatIntervalMs: number
  private lastChatAt = Number.NEGATIVE_INFINITY
  private lastRateLimit: TwitchRateLimit | null = null

  constructor(options: TwitchClientOptions) {
    this.tokenProvider = options.tokenProvider
    this.baseUrl = (options.baseUrl ?? TWITCH_HELIX_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 10_000)
    this.chatIntervalMs = Math.max(0, options.chatIntervalMs ?? 1500)
  }

  get rateLimit(): TwitchRateLimit | null {
    return this.lastRateLimit ? { ...this.lastRateLimit } : null
  }

  async getUser(): Promise<TwitchUser | null> {
    const rows = dataArray(await this.request('/users'))
    const row = rows[0]
    if (!row) return null
    return {
      id: str(row['id']),
      login: str(row['login']),
      displayName: str(row['display_name']) || str(row['login']),
      ...(str(row['profile_image_url']) ? { profileImageUrl: str(row['profile_image_url']) } : {}),
    }
  }

  async getStream(userId: string): Promise<TwitchStream | null> {
    if (!userId) throw new TwitchApiError('Twitch user ID is missing.')
    const rows = dataArray(await this.request('/streams', { query: { user_id: userId } }))
    const row = rows[0]
    if (!row) return null
    return {
      id: str(row['id']),
      userId: str(row['user_id']),
      userLogin: str(row['user_login']),
      userName: str(row['user_name']),
      gameId: str(row['game_id']),
      gameName: str(row['game_name']),
      type: str(row['type']),
      title: str(row['title']),
      viewerCount: num(row['viewer_count']),
      startedAt: str(row['started_at']),
      ...(str(row['language']) ? { language: str(row['language']) } : {}),
    }
  }

  async getChannel(broadcasterId: string): Promise<TwitchChannel | null> {
    if (!broadcasterId) throw new TwitchApiError('Twitch broadcaster ID is missing.')
    const rows = dataArray(
      await this.request('/channels', { query: { broadcaster_id: broadcasterId } }),
    )
    const row = rows[0]
    if (!row) return null
    return {
      broadcasterId: str(row['broadcaster_id']),
      broadcasterLogin: str(row['broadcaster_login']),
      broadcasterName: str(row['broadcaster_name']),
      gameId: str(row['game_id']),
      gameName: str(row['game_name']),
      title: str(row['title']),
      ...(str(row['broadcaster_language'])
        ? { language: str(row['broadcaster_language']) }
        : {}),
    }
  }

  /** Update title and/or game; Twitch requires at least one property. */
  async updateChannel(
    broadcasterId: string,
    patch: { title?: string; gameId?: string },
  ): Promise<void> {
    if (!broadcasterId) throw new TwitchApiError('Twitch broadcaster ID is missing.')
    const body: Record<string, string> = {}
    if (patch.title !== undefined) body['title'] = patch.title
    if (patch.gameId !== undefined) body['game_id'] = patch.gameId
    if (Object.keys(body).length === 0) throw new TwitchApiError('Nothing to update on Twitch.')
    await this.request('/channels', {
      method: 'PATCH',
      query: { broadcaster_id: broadcasterId },
      body,
    })
  }

  async sendChat(broadcasterId: string, senderId: string, text: string): Promise<void> {
    if (!broadcasterId || !senderId) throw new TwitchApiError('Twitch user ID is missing.')
    const now = this.now()
    if (this.chatIntervalMs > 0 && now - this.lastChatAt < this.chatIntervalMs) {
      throw new TwitchApiError(
        'Twitch chat is rate limited locally. Wait a moment before sending again.',
        429,
        'chat_rate_limited',
      )
    }
    this.lastChatAt = now
    const rows = dataArray(
      await this.request('/chat/messages', {
        method: 'POST',
        body: { broadcaster_id: broadcasterId, sender_id: senderId, message: text },
      }),
    )
    const row = rows[0]
    if (!row) throw new TwitchApiError('Twitch did not accept the chat message.')
    if (row['is_sent'] === false) {
      const drop = record(row['drop_reason'])
      const reason = str(drop['message']) || str(drop['code']) || 'the channel rejected the message'
      throw new TwitchApiError(`Twitch did not send the chat message: ${reason}.`)
    }
  }

  async createMarker(userId: string, description?: string): Promise<TwitchMarker> {
    if (!userId) throw new TwitchApiError('Twitch user ID is missing.')
    const body: Record<string, string> = { user_id: userId }
    if (description) body['description'] = description
    let payload: unknown
    try {
      payload = await this.request('/streams/markers', { method: 'POST', body })
    } catch (error) {
      if (error instanceof TwitchApiError && error.status === 404) {
        throw new TwitchApiError(
          'Twitch could not create a marker. The stream may be offline, VOD may be disabled, or the stream just started.',
          404,
          error.code,
        )
      }
      throw error
    }
    const rows = dataArray(payload)
    const row = rows[0]
    if (!row) throw new TwitchApiError('Twitch did not create a stream marker.')
    return {
      id: str(row['id']),
      createdAt: str(row['created_at']),
      description: str(row['description']),
      positionSeconds: num(row['position_seconds']),
    }
  }

  async searchCategories(query: string, first = 10): Promise<TwitchCategory[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    return dataArray(
      await this.request('/search/categories', {
        query: { query: trimmed, first: Math.max(1, Math.min(100, first)) },
      }),
    ).map((row) => ({
      id: str(row['id']),
      name: str(row['name']),
      ...(str(row['box_art_url']) ? { boxArtUrl: str(row['box_art_url']) } : {}),
    }))
  }

  /** Resolve a user-entered category name, preferring an exact match. */
  async getGameByName(name: string): Promise<TwitchCategory | null> {
    const trimmed = name.trim()
    if (!trimmed) return null
    const categories = await this.searchCategories(trimmed, 20)
    return (
      categories.find((category) => category.name.toLowerCase() === trimmed.toLowerCase()) ??
      categories[0] ??
      null
    )
  }

  private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let token = await this.tokenProvider.getAccessToken()
    let response = await this.send(url, options, token)
    if (response.status === 401) {
      this.logger?.warn('Twitch returned 401; refreshing the access token once')
      token = await this.tokenProvider.refreshAccessToken()
      response = await this.send(url, options, token)
    }

    this.lastRateLimit = rateLimit(response, this.now())
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
      throw new TwitchApiError(
        retryAfterMs
          ? `Twitch rate limit reached. Try again in ${Math.ceil(retryAfterMs / 1000)} s.`
          : 'Twitch rate limit reached. Try again shortly.',
        429,
        'rate_limited',
        retryAfterMs,
      )
    }

    if (!response.ok) {
      const body = await readBody(response)
      const error = record(body)['error']
      const detail = record(body)
      const reason =
        str(detail['message']) ||
        str(detail['error_description']) ||
        (typeof error === 'string' ? error : '') ||
        `HTTP ${response.status}`
      throw new TwitchApiError(this.errorMessage(response.status, reason), response.status, str(detail['code']) || undefined)
    }

    if (response.status === 204) return null
    return readBody(response)
  }

  private send(url: URL, options: RequestOptions, token: string): Promise<Response> {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(this.requestTimeoutMs)
        : undefined
    return this.fetchImpl(url, {
      method: options.method ?? 'GET',
      ...(signal ? { signal } : {}),
      headers: {
        Accept: 'application/json',
        'Client-Id': this.tokenProvider.clientId,
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
  }

  private errorMessage(status: number, reason: string): string {
    if (status === 400) return `Twitch rejected the request: ${reason}.`
    if (status === 401) return 'Twitch authorization expired. Reconnect Twitch.'
    if (status === 403) return 'Twitch did not allow this action. Check the connected account and scopes.'
    if (status === 404) {
      return `Twitch could not find that resource. The stream may be offline or the category may not exist. (${reason})`
    }
    if (status >= 500) return `Twitch is unavailable right now (HTTP ${status}). Try again shortly.`
    return `Twitch request failed: ${reason}.`
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Format the current error for UI/logs without leaking tokens. */
export function twitchErrorMessage(error: unknown): string {
  return message(error)
}
