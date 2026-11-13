import type { TwitchPlanStep, TwitchStateTarget } from '@phonedek/shared'
import type { Logger } from './logger'
import type { TwitchAccount } from './twitch-auth'
import type { TwitchCategory, TwitchChannel, TwitchClient, TwitchStream } from './twitch-client'

/**
 * Read-only Twitch state for a button `state` binding.
 *
 * `detail` is the short display string: `LIVE`, `OFF`, a viewer count,
 * `1:23:45`, the title or the category. Offline live/viewers/uptime readings are
 * `available:false` so the tile can dim without pretending it is connected.
 */
export interface TwitchStatusReading {
  active?: boolean
  /** Normalized 0..1 where a meaningful scale exists; not used in the MVP. */
  value?: number
  /** Defaults to true when omitted. */
  available?: boolean
  detail: string
}

export interface TwitchStateReader {
  readStatus(target: TwitchStateTarget): Promise<TwitchStatusReading>
  invalidateStatus(target?: TwitchStateTarget): void
  execute(step: TwitchPlanStep): Promise<void>
}

/** Client surface used by the source (fake-friendly in tests). */
export interface TwitchClientLike {
  getStream(userId: string): Promise<TwitchStream | null>
  getChannel(broadcasterId: string): Promise<TwitchChannel | null>
  updateChannel(broadcasterId: string, patch: { title?: string; gameId?: string }): Promise<void>
  sendChat(broadcasterId: string, senderId: string, text: string): Promise<void>
  createMarker(userId: string, description?: string): Promise<unknown>
  getGameByName(name: string): Promise<TwitchCategory | null>
}

export interface TwitchAccountProvider {
  readonly connected: boolean
  getAccount(): Promise<TwitchAccount>
}

export interface TwitchStateSourceOptions {
  /** Live/viewers/uptime cache TTL. Twitch recommends polling ~30–60 s. */
  streamTtlMs?: number
  /** Channel title/game cache TTL. */
  channelTtlMs?: number
  now?: () => number
  logger?: Logger
}

const DEFAULT_STREAM_TTL_MS = 20_000
const DEFAULT_CHANNEL_TTL_MS = 30_000

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `1:23:45` for an hour or more, `3:07` below an hour. */
export function formatTwitchUptime(startedAt: string, now: number): string {
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return '0:00'
  const total = Math.max(0, Math.floor((now - start) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

interface CacheEntry<T> {
  value: T
  at: number
}

/**
 * Cached Helix reads plus action execution. It never polls on its own: the
 * control-state service drives reads only while a Twitch status tile is
 * watched, and the TTL keeps that to a handful of requests per minute.
 */
export class TwitchStateSource implements TwitchStateReader {
  private readonly streamTtlMs: number
  private readonly channelTtlMs: number
  private readonly now: () => number
  private readonly logger?: Logger
  private streamCache: CacheEntry<TwitchStream | null> | null = null
  private channelCache: CacheEntry<TwitchChannel | null> | null = null
  private streamInFlight: Promise<TwitchStream | null> | null = null
  private channelInFlight: Promise<TwitchChannel | null> | null = null

  constructor(
    private readonly client: TwitchClientLike | TwitchClient,
    private readonly auth: TwitchAccountProvider,
    options: TwitchStateSourceOptions = {},
  ) {
    this.streamTtlMs = Math.max(0, options.streamTtlMs ?? DEFAULT_STREAM_TTL_MS)
    this.channelTtlMs = Math.max(0, options.channelTtlMs ?? DEFAULT_CHANNEL_TTL_MS)
    this.now = options.now ?? Date.now
    this.logger = options.logger
  }

  get connected(): boolean {
    return this.auth.connected
  }

  async readStatus(target: TwitchStateTarget): Promise<TwitchStatusReading> {
    const account = await this.requireAccount()
    if (target === 'title' || target === 'game') {
      const channel = await this.readChannel(account.userId)
      if (!channel) throw new Error('Twitch channel information is not available.')
      if (target === 'title') {
        return { available: true, detail: channel.title.trim() || 'NO TITLE' }
      }
      return { available: true, detail: channel.gameName.trim() || 'NO GAME' }
    }

    const stream = await this.readStream(account.userId)
    if (!stream) return { available: false, detail: 'OFF' }
    if (target === 'live') return { active: true, available: true, detail: 'LIVE' }
    if (target === 'viewers') {
      return { active: true, available: true, detail: String(Math.max(0, stream.viewerCount)) }
    }
    return {
      active: true,
      available: true,
      detail: formatTwitchUptime(stream.startedAt, this.now()),
    }
  }

  invalidateStatus(target?: TwitchStateTarget): void {
    if (target === undefined || target === 'live' || target === 'viewers' || target === 'uptime') {
      this.streamCache = null
    }
    if (target === undefined || target === 'title' || target === 'game') {
      this.channelCache = null
    }
  }

  async execute(step: TwitchPlanStep): Promise<void> {
    const account = await this.requireAccount()
    try {
      switch (step.action) {
        case 'sendChat':
          await this.client.sendChat(account.userId, account.userId, step.message)
          break
        case 'createMarker':
          await this.client.createMarker(account.userId, step.description)
          break
        case 'setTitle':
          await this.client.updateChannel(account.userId, { title: step.title })
          break
        case 'setGame': {
          const category = await this.client.getGameByName(step.game)
          if (!category) throw new Error(`Twitch category "${step.game}" was not found.`)
          await this.client.updateChannel(account.userId, { gameId: category.id })
          break
        }
      }
    } finally {
      // A write may change live/title/game; refresh on the next state tick.
      this.invalidateStatus()
    }
  }

  private async requireAccount(): Promise<TwitchAccount> {
    if (!this.auth.connected) throw new Error('Twitch is not connected.')
    return this.auth.getAccount()
  }

  private async readStream(userId: string): Promise<TwitchStream | null> {
    const cached = this.streamCache
    if (cached && this.now() - cached.at < this.streamTtlMs) return cached.value
    if (this.streamInFlight) return this.streamInFlight
    const pending = (async (): Promise<TwitchStream | null> => {
      try {
        const value = await this.client.getStream(userId)
        this.streamCache = { value, at: this.now() }
        return value
      } catch (error) {
        this.logger?.warn(`Twitch stream read failed: ${message(error)}`)
        throw error
      } finally {
        this.streamInFlight = null
      }
    })()
    this.streamInFlight = pending
    return pending
  }

  private async readChannel(userId: string): Promise<TwitchChannel | null> {
    const cached = this.channelCache
    if (cached && this.now() - cached.at < this.channelTtlMs) return cached.value
    if (this.channelInFlight) return this.channelInFlight
    const pending = (async (): Promise<TwitchChannel | null> => {
      try {
        const value = await this.client.getChannel(userId)
        this.channelCache = { value, at: this.now() }
        return value
      } catch (error) {
        this.logger?.warn(`Twitch channel read failed: ${message(error)}`)
        throw error
      } finally {
        this.channelInFlight = null
      }
    })()
    this.channelInFlight = pending
    return pending
  }
}
