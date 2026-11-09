import type {
  ControlStateEntry,
  ControlStateMessage,
  DeckButton,
  DeckConfig,
} from '@phonedek/shared'
import type { Logger } from './logger'
import type { VolumeReader, VolumeReading } from './volume-source'

/** Minimum allowed watch poll interval, matching the shared protocol schema. */
export const MIN_WATCH_INTERVAL_MS = 500
export const DEFAULT_WATCH_INTERVAL_MS = 1000
const WRITE_GRACE_MS = 1500

export interface AbsoluteVolumeControl {
  id: string
  label: string
}

/** A value-bearing slider/dial that reads and writes system output volume. */
export function isAbsoluteVolumeControl(button: DeckButton): boolean {
  const control = button.control
  return (
    control !== undefined &&
    control.kind !== 'trackpad' &&
    control.binding.type === 'volume' &&
    control.binding.mode === 'absolute'
  )
}

/**
 * Resolve the page's absolute-volume controls. Returns null when the profile
 * or page does not exist; unknown requested ids are ignored.
 */
export function resolveAbsoluteVolumeControls(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  requestedIds?: string[],
): AbsoluteVolumeControl[] | null {
  const profile = config.profiles.find((item) => item.id === profileId)
  const page = profile?.pages.find((item) => item.id === pageId)
  if (!profile || !page) return null

  const requested = requestedIds ? new Set(requestedIds) : null
  return page.buttons
    .filter(isAbsoluteVolumeControl)
    .filter((button) => requested === null || requested.has(button.id))
    .slice(0, 32)
    .map((button) => ({ id: button.id, label: button.label }))
}

export interface ControlStateSubscription {
  profileId: string
  pageId: string
  /** Resolved absolute-volume control ids (0..32). Empty still gets one empty snapshot. */
  controlIds: string[]
  intervalMs: number
  send: (message: ControlStateMessage) => void
}

export interface ControlStateServiceOptions {
  reader: VolumeReader
  logger?: Logger
  now?: () => number
  defaultIntervalMs?: number
  writeGraceMs?: number
}

interface Subscription extends ControlStateSubscription {
  /** Signature last delivered to this client, per control. */
  lastSent: Map<string, string>
  /** When this subscription last evaluated/sent a periodic message. */
  lastPolledAt: number | null
}

function clampInterval(intervalMs: number | undefined, fallback: number): number {
  if (intervalMs === undefined || !Number.isFinite(intervalMs)) return fallback
  return Math.max(MIN_WATCH_INTERVAL_MS, Math.min(5000, Math.round(intervalMs)))
}

function stateSignature(entry: ControlStateEntry): string {
  if (!entry.available) return '0'
  return `1|${entry.value?.toFixed(4) ?? ''}|${entry.muted === undefined ? '' : entry.muted ? '1' : '0'}`
}

function controlKey(profileId: string, pageId: string, controlId: string): string {
  return `${profileId}\u0000${pageId}\u0000${controlId}`
}

function readingEntry(
  controlId: string,
  reading: VolumeReading | null,
  error: string | null,
): ControlStateEntry {
  if (!reading || error) {
    return {
      controlId,
      revision: 0,
      available: false,
      detail: error ? error.slice(0, 60) : 'Unavailable',
    }
  }
  const level = Math.max(0, Math.min(100, Math.round(reading.level)))
  return {
    controlId,
    revision: 0,
    value: level / 100,
    available: true,
    detail: `${level}%`,
    ...(reading.muted === undefined ? {} : { muted: reading.muted }),
  }
}

/**
 * Turns `watch` subscriptions into batched `controlState` snapshots.
 *
 * - One read per tick for all controls and clients (the reader also caches).
 * - Immediate snapshot on subscribe, then change-only messages per client at
 *   the requested interval.
 * - Monotonic per-control revisions and never throws into the server.
 * - Stops its timer when no subscription has a state-bearing control.
 */
export class ControlStateService {
  private readonly reader: VolumeReader
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly defaultIntervalMs: number
  private readonly writeGraceMs: number
  private readonly subscriptions = new Map<string, Subscription>()
  /** Latest state per profile/page/control, including while nobody watches it. */
  private readonly entries = new Map<string, ControlStateEntry>()
  private readonly revisions = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private suppressUntil = 0
  private disposed = false

  constructor(options: ControlStateServiceOptions) {
    this.reader = options.reader
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.defaultIntervalMs = clampInterval(options.defaultIntervalMs, DEFAULT_WATCH_INTERVAL_MS)
    this.writeGraceMs = Math.max(0, options.writeGraceMs ?? WRITE_GRACE_MS)
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  /** Add or replace the single subscription for this connection. */
  subscribe(clientId: string, subscription: ControlStateSubscription): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const sub: Subscription = {
      profileId: subscription.profileId,
      pageId: subscription.pageId,
      controlIds: [...new Set(subscription.controlIds)].slice(0, 32),
      intervalMs: clampInterval(subscription.intervalMs, this.defaultIntervalMs),
      send: subscription.send,
      lastSent: new Map(),
      lastPolledAt: null,
    }
    this.subscriptions.set(clientId, sub)

    return this.enqueue(async () => {
      // A newer watch replaced this one while the queue was busy.
      if (this.subscriptions.get(clientId) !== sub) return
      if (sub.controlIds.length === 0) {
        this.sendStates(sub, [])
        this.schedule()
        return
      }
      await this.refresh(sub)
    })
  }

  unsubscribe(clientId: string): void {
    if (!this.subscriptions.delete(clientId)) return
    this.schedule()
  }

  /**
   * Push the value the phone just wrote. The cache is invalidated, the written
   * value is trusted for a short grace period, and every subscriber gets an
   * immediate snapshot so the slider that moved sees the real host value.
   */
  noteVolumeWritten(level: number, muted?: boolean): Promise<void> {
    if (this.disposed || !Number.isFinite(level)) return Promise.resolve()
    const reading: VolumeReading = {
      level: Math.max(0, Math.min(100, Math.round(level))),
      ...(muted === undefined ? {} : { muted }),
    }

    return this.enqueue(async () => {
      this.reader.invalidate()
      this.reader.setKnown?.(reading)
      this.suppressUntil = Math.max(this.suppressUntil, this.now() + this.writeGraceMs)
      await this.refresh(undefined, true)
    })
  }

  /** Test/manual hook: evaluate and send changed state immediately. */
  pollNow(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return this.enqueue(() => this.refresh())
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.subscriptions.clear()
    this.entries.clear()
    this.revisions.clear()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run.catch((error: unknown) => {
      this.logger?.warn(
        `Control state update failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  private async refresh(immediate?: Subscription, forceAll = false): Promise<void> {
    if (this.disposed) return

    const watched = this.watchedKeys()
    if (watched.length > 0) {
      let reading: VolumeReading | null = null
      let error: string | null = null
      try {
        reading = await this.reader.read()
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      }
      for (const key of watched) this.updateEntry(key, reading, error)
    }

    const now = this.now()
    for (const sub of [...this.subscriptions.values()]) {
      if (immediate === sub) {
        this.sendStates(sub, this.entriesFor(sub))
        sub.lastPolledAt = now
        continue
      }
      if (forceAll) {
        this.sendStates(sub, this.entriesFor(sub))
        sub.lastPolledAt = now
        continue
      }
      if (sub.controlIds.length === 0) continue
      if (sub.lastPolledAt !== null && now - sub.lastPolledAt < sub.intervalMs) continue
      sub.lastPolledAt = now

      const changed = this.entriesFor(sub).filter(
        (entry) => sub.lastSent.get(entry.controlId) !== stateSignature(entry),
      )
      if (changed.length > 0) this.sendStates(sub, changed)
    }

    this.schedule()
  }

  private watchedKeys(): string[] {
    const keys = new Set<string>()
    for (const sub of this.subscriptions.values()) {
      for (const controlId of sub.controlIds) {
        keys.add(controlKey(sub.profileId, sub.pageId, controlId))
      }
    }
    return [...keys]
  }

  private entriesFor(sub: Subscription): ControlStateEntry[] {
    const entries: ControlStateEntry[] = []
    for (const controlId of sub.controlIds) {
      const entry = this.entries.get(controlKey(sub.profileId, sub.pageId, controlId))
      if (entry) entries.push(entry)
    }
    return entries
  }

  private updateEntry(key: string, reading: VolumeReading | null, error: string | null): void {
    const existing = this.entries.get(key)
    const controlId = key.slice(key.lastIndexOf('\u0000') + 1)
    const candidate = readingEntry(controlId, reading, error)
    if (existing && stateSignature(existing) === stateSignature(candidate)) return

    const revision = (existing?.revision ?? this.revisions.get(key) ?? 0) + 1
    const entry: ControlStateEntry = { ...candidate, revision }
    this.revisions.set(key, revision)
    this.entries.set(key, entry)
  }

  private sendStates(sub: Subscription, states: ControlStateEntry[]): void {
    if (this.disposed) return
    const message: ControlStateMessage = {
      type: 'controlState',
      profileId: sub.profileId,
      pageId: sub.pageId,
      states,
    }
    try {
      sub.send(message)
    } catch (error) {
      this.logger?.warn(
        `Could not send control state: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    for (const state of states) sub.lastSent.set(state.controlId, stateSignature(state))
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.disposed) return

    const intervals = [...this.subscriptions.values()]
      .filter((sub) => sub.controlIds.length > 0)
      .map((sub) => sub.intervalMs)
    if (intervals.length === 0) return

    let delay = Math.min(...intervals)
    const now = this.now()
    if (this.suppressUntil > now) delay = Math.max(delay, this.suppressUntil - now)

    this.timer = setTimeout(() => {
      this.timer = null
      void this.enqueue(() => this.refresh())
    }, Math.max(0, delay))
    this.timer.unref?.()
  }
}
