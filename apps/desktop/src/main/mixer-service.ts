import type { MixerSnapshot, MixerStateMessage } from '@phonedek/shared'
import type { Logger } from './logger'

/** ~1 Hz: enough for a live fader, cheap over LAN. */
export const MIXER_POLL_INTERVAL_MS = 1000
/** Keep the wire payload bounded even if a host reports a huge session list. */
export const MAX_MIXER_SESSIONS = 128

/** Write/read surface needed by the mixer transport (AppVolumeSource). */
export interface MixerSource {
  snapshot(): Promise<MixerSnapshot>
  setVolumeById(id: string, level: number): Promise<void>
  setMuteById(id: string, muted: boolean): Promise<void>
  invalidate?(): void
}

export interface MixerSubscription {
  send: (message: MixerStateMessage) => void
}

export interface MixerCommandRequest {
  sessionId: string
  volume?: number
  muted?: boolean
}

export interface MixerCommandOutcome {
  ok: boolean
  error?: string
}

export interface MixerServiceOptions {
  /** Omitted when this host has no per-app audio backend. */
  source?: MixerSource | null
  logger?: Logger
  now?: () => number
  pollIntervalMs?: number
  /** Reason included in an unavailable snapshot. */
  unavailableReason?: string
  /** Called after a successful write so control tiles can refresh immediately. */
  onWriteApplied?: () => void | Promise<void>
}

interface Subscription extends MixerSubscription {
  /** Last snapshot signature delivered, so unchanged polls stay silent. */
  lastSignature: string | null
}

/** Content signature: `updatedAt` is deliberately excluded (it changes every poll). */
export function mixerSnapshotSignature(snapshot: MixerSnapshot): string {
  const sessions = snapshot.sessions
    .slice(0, MAX_MIXER_SESSIONS)
    .map(
      (session) =>
        `${session.id}\u0000${session.process}\u0000${session.name}\u0000${session.volume}\u0000${
          session.muted ? '1' : '0'
        }\u0000${session.available === false ? '0' : '1'}`,
    )
    .join('\u0001')
  return `${snapshot.available ? '1' : '0'}\u0000${snapshot.reason ?? ''}\u0000${sessions}`
}

function toStateMessage(snapshot: MixerSnapshot): MixerStateMessage {
  return {
    type: 'mixerState',
    available: snapshot.available,
    sessions: snapshot.sessions.slice(0, MAX_MIXER_SESSIONS).map((session) => ({
      id: session.id,
      process: session.process,
      name: session.name,
      volume: session.volume,
      muted: session.muted,
      ...(session.available === undefined ? {} : { available: session.available }),
    })),
    ...(snapshot.reason ? { reason: snapshot.reason } : {}),
    updatedAt: snapshot.updatedAt,
  }
}

/**
 * Live mixer transport for the phone's full-screen mixer.
 *
 * - One subscription per connection: immediate snapshot, then ~1 Hz polls
 *   while at least one client watches; the timer stops when nobody does.
 * - Unchanged snapshots are not re-sent (no state spam), and one enumeration
 *   per tick serves every subscriber.
 * - Commands write by session id through the cached `AppVolumeSource`
 *   (latest-wins coalescing, never the keyboard queue) and return a clear
 *   outcome for `mixerResult`.
 */
export class MixerService {
  private readonly source: MixerSource | null
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly pollIntervalMs: number
  private readonly unavailableReason: string
  private readonly onWriteApplied?: () => void | Promise<void>
  private readonly subscriptions = new Map<string, Subscription>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(options: MixerServiceOptions = {}) {
    this.source = options.source ?? null
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? MIXER_POLL_INTERVAL_MS)
    this.unavailableReason =
      options.unavailableReason ?? 'Per-app audio is not available on this desktop.'
    this.onWriteApplied = options.onWriteApplied
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  /** Add or replace this connection's single mixer subscription. */
  subscribe(clientId: string, subscription: MixerSubscription): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const sub: Subscription = { send: subscription.send, lastSignature: null }
    this.subscriptions.set(clientId, sub)
    return this.enqueue(async () => {
      if (this.subscriptions.get(clientId) !== sub) return
      const snapshot = await this.readSnapshot()
      // The client may have stopped (or replaced) the subscription during the read.
      if (this.subscriptions.get(clientId) !== sub) return
      this.deliver(snapshot, sub, true)
      this.schedule()
    })
  }

  unsubscribe(clientId: string): void {
    if (!this.subscriptions.delete(clientId)) return
    this.schedule()
  }

  /** Validate and apply one `mixerCommand` by session id. */
  async command(command: MixerCommandRequest): Promise<MixerCommandOutcome> {
    if (!this.source) {
      return { ok: false, error: this.unavailableReason }
    }
    const sessionId = typeof command.sessionId === 'string' ? command.sessionId.trim() : ''
    if (!sessionId || sessionId.length > 512) {
      return { ok: false, error: 'Invalid mixer session' }
    }
    if (
      command.volume !== undefined &&
      (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 100)
    ) {
      return { ok: false, error: 'Mixer volume must be between 0 and 100' }
    }
    if (command.muted !== undefined && typeof command.muted !== 'boolean') {
      return { ok: false, error: 'Mixer mute must be true or false' }
    }
    if (command.volume === undefined && command.muted === undefined) {
      return { ok: false, error: 'Mixer command requires a volume or mute value' }
    }

    try {
      if (command.volume !== undefined) {
        await this.source.setVolumeById(sessionId, command.volume)
      }
      if (command.muted !== undefined) {
        await this.source.setMuteById(sessionId, command.muted)
      }
      try {
        await this.onWriteApplied?.()
      } catch (error) {
        this.logger?.warn(
          `Mixer state refresh after write failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.subscriptions.clear()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run.catch((error: unknown) => {
      this.logger?.warn(
        `Mixer update failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  private async readSnapshot(): Promise<MixerSnapshot> {
    if (!this.source) {
      return {
        available: false,
        sessions: [],
        reason: this.unavailableReason,
        updatedAt: this.now(),
      }
    }
    try {
      const snapshot = await this.source.snapshot()
      return {
        ...snapshot,
        sessions: snapshot.sessions.slice(0, MAX_MIXER_SESSIONS),
        updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : this.now(),
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Mixer snapshot failed: ${reason}`)
      return {
        available: false,
        sessions: [],
        reason: reason.slice(0, 300),
        updatedAt: this.now(),
      }
    }
  }

  private deliver(snapshot: MixerSnapshot, sub: Subscription, force = false): void {
    if (this.disposed) return
    const signature = mixerSnapshotSignature(snapshot)
    if (!force && sub.lastSignature === signature) return
    sub.lastSignature = signature
    try {
      sub.send(toStateMessage(snapshot))
    } catch (error) {
      this.logger?.warn(
        `Could not send mixer state: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.disposed || this.subscriptions.size === 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.enqueue(() => this.poll())
    }, this.pollIntervalMs)
    this.timer.unref?.()
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.subscriptions.size === 0) return
    const snapshot = await this.readSnapshot()
    for (const sub of this.subscriptions.values()) this.deliver(snapshot, sub)
    this.schedule()
  }
}
