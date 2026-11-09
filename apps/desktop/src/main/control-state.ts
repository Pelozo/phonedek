import type {
  ControlStateEntry,
  ControlStateMessage,
  DeckButton,
  DeckConfig,
} from '@phonedek/shared'
import type { Logger } from './logger'
import type { VolumeReader, VolumeReading } from './volume-source'
import type { MicReader, MicReading } from './microphone-source'

/** Minimum allowed watch poll interval, matching the shared protocol schema. */
export const MIN_WATCH_INTERVAL_MS = 500
export const DEFAULT_WATCH_INTERVAL_MS = 1000
const WRITE_GRACE_MS = 1500

export type ControlStateSource = 'volume' | 'mic'

export interface StateControl {
  id: string
  label: string
  source: ControlStateSource
}

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

/** A value-bearing slider/dial that reads and writes the default microphone. */
export function isMicGainControl(button: DeckButton): boolean {
  const control = button.control
  return (
    control !== undefined &&
    control.kind !== 'trackpad' &&
    control.binding.type === 'mic' &&
    control.binding.mode === 'gain' &&
    control.emit === 'value'
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
  const controls = resolveStateControls(config, profileId, pageId, requestedIds)
  if (!controls) return null
  return controls
    .filter((control) => control.source === 'volume')
    .map((control) => ({ id: control.id, label: control.label }))
}

/**
 * Resolve every control on a page that has a live state source (absolute
 * output volume or microphone gain). Unknown requested ids are ignored.
 */
export function resolveStateControls(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  requestedIds?: string[],
): StateControl[] | null {
  const profile = config.profiles.find((item) => item.id === profileId)
  const page = profile?.pages.find((item) => item.id === pageId)
  if (!profile || !page) return null

  const requested = requestedIds ? new Set(requestedIds) : null
  const controls: StateControl[] = []
  for (const button of page.buttons) {
    const source: ControlStateSource | null = isAbsoluteVolumeControl(button)
      ? 'volume'
      : isMicGainControl(button)
        ? 'mic'
        : null
    if (!source) continue
    if (requested !== null && !requested.has(button.id)) continue
    controls.push({ id: button.id, label: button.label, source })
    if (controls.length >= 32) break
  }
  return controls
}

export interface ControlStateSubscription {
  profileId: string
  pageId: string
  /** Resolved control ids (0..32). Empty still gets one empty snapshot. */
  controlIds: string[]
  /** Optional source per control; omitted = every id is absolute volume. */
  controls?: StateControl[]
  intervalMs: number
  send: (message: ControlStateMessage) => void
}

export interface ControlStateServiceOptions {
  reader?: VolumeReader
  micReader?: MicReader | null
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
  source: ControlStateSource,
  reading: VolumeReading | MicReading | null,
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
  const muted = reading.muted
  return {
    controlId,
    revision: 0,
    value: level / 100,
    available: true,
    detail: source === 'mic' && muted ? 'MUTED' : `${level}%`,
    ...(muted === undefined ? {} : { muted }),
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
  private readonly reader?: VolumeReader
  private readonly micReader?: MicReader | null
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly defaultIntervalMs: number
  private readonly writeGraceMs: number
  private readonly subscriptions = new Map<string, Subscription>()
  /** Latest state per profile/page/control, including while nobody watches it. */
  private readonly entries = new Map<string, ControlStateEntry>()
  private readonly revisions = new Map<string, number>()
  /** Source per profile/page/control, learned from the last subscription. */
  private readonly sources = new Map<string, ControlStateSource>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private suppressUntil = 0
  private disposed = false

  constructor(options: ControlStateServiceOptions) {
    this.reader = options.reader
    this.micReader = options.micReader
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
    const requested = subscription.controls
      ? subscription.controls
      : subscription.controlIds.map((id) => ({ id, label: '', source: 'volume' as const }))
    const bySource = new Map<string, ControlStateSource>()
    for (const control of requested) bySource.set(control.id, control.source)

    const controlIds = [...new Set(subscription.controlIds.length > 0
      ? subscription.controlIds
      : requested.map((control) => control.id))].slice(0, 32)
    for (const controlId of controlIds) {
      this.sources.set(
        controlKey(subscription.profileId, subscription.pageId, controlId),
        bySource.get(controlId) ?? 'volume',
      )
    }

    const sub: Subscription = {
      profileId: subscription.profileId,
      pageId: subscription.pageId,
      controlIds,
      ...(subscription.controls ? { controls: subscription.controls } : {}),
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
      this.reader?.invalidate()
      this.reader?.setKnown?.(reading)
      this.suppressUntil = Math.max(this.suppressUntil, this.now() + this.writeGraceMs)
      await this.refresh(undefined, true)
    })
  }

  /** Push a microphone gain/mute value the phone just wrote. */
  noteMicWritten(level: number, muted?: boolean): Promise<void> {
    if (this.disposed || !Number.isFinite(level)) return Promise.resolve()
    const reading: MicReading = {
      level: Math.max(0, Math.min(100, Math.round(level))),
      ...(muted === undefined ? {} : { muted }),
    }

    return this.enqueue(async () => {
      this.micReader?.invalidate()
      this.micReader?.setKnown?.(reading)
      this.suppressUntil = Math.max(this.suppressUntil, this.now() + this.writeGraceMs)
      await this.refresh(undefined, true)
    })
  }

  /** Invalidate the microphone cache and re-read (used after an unknown mute result). */
  noteMicChanged(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return this.enqueue(async () => {
      this.micReader?.invalidate()
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
    this.sources.clear()
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

    const watched = this.watchedControls()
    for (const source of ['volume', 'mic'] as const) {
      const controls = watched.filter((control) => control.source === source)
      if (controls.length === 0) continue

      let reading: VolumeReading | MicReading | null = null
      let error: string | null = null
      const reader = source === 'mic' ? this.micReader : this.reader
      if (!reader) {
        error =
          source === 'mic'
            ? 'Microphone state is not available on this desktop.'
            : 'Volume state is not available on this desktop.'
      } else {
        try {
          reading = await reader.read()
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught)
        }
      }
      for (const control of controls) {
        this.updateEntry(control.key, control.controlId, source, reading, error)
      }
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

  private watchedControls(): Array<{
    key: string
    controlId: string
    source: ControlStateSource
  }> {
    const controls = new Map<string, { key: string; controlId: string; source: ControlStateSource }>()
    for (const sub of this.subscriptions.values()) {
      for (const controlId of sub.controlIds) {
        const key = controlKey(sub.profileId, sub.pageId, controlId)
        if (controls.has(key)) continue
        controls.set(key, {
          key,
          controlId,
          source: this.sources.get(key) ?? 'volume',
        })
      }
    }
    return [...controls.values()]
  }

  private entriesFor(sub: Subscription): ControlStateEntry[] {
    const entries: ControlStateEntry[] = []
    for (const controlId of sub.controlIds) {
      const entry = this.entries.get(controlKey(sub.profileId, sub.pageId, controlId))
      if (entry) entries.push(entry)
    }
    return entries
  }

  private updateEntry(
    key: string,
    controlId: string,
    source: ControlStateSource,
    reading: VolumeReading | MicReading | null,
    error: string | null,
  ): void {
    const existing = this.entries.get(key)
    const candidate = readingEntry(controlId, source, reading, error)
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
