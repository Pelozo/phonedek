import type {
  ControlStateEntry,
  ControlStateMessage,
  DeckButton,
  DeckConfig,
  ObsStateTarget,
} from '@phonedek/shared'
import type { Logger } from './logger'
import type { VolumeReader, VolumeReading } from './volume-source'
import type { MicReader, MicReading } from './microphone-source'
import type { ObsInputReading, ObsStateReader, ObsStatusReading } from './obs-source'

/** Minimum allowed watch poll interval, matching the shared protocol schema. */
export const MIN_WATCH_INTERVAL_MS = 500
export const DEFAULT_WATCH_INTERVAL_MS = 1000
const WRITE_GRACE_MS = 1500

export type ControlStateSource = 'volume' | 'mic' | 'obs'

export interface StateControl {
  id: string
  label: string
  source: ControlStateSource
  /** OBS input name; omitted = the desktop's first-audio-input fallback. */
  input?: string
  /** Display maximum for OBS controls; defaults to 100 for volume/mic. */
  max?: number
  /** Read-only status target from a button `state` binding. */
  target?: ObsStateTarget
  /** Scene name for the `scene` status target (also marks which scene is live). */
  scene?: string
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

/** A normal button with an OBS read-only `state` binding (status tile). */
export function isObsStateButton(button: DeckButton): boolean {
  return button.state?.type === 'obs'
}

/** A value-bearing slider/dial that reads and writes one OBS input. */
export function isObsVolumeControl(button: DeckButton): boolean {
  const control = button.control
  return (
    control !== undefined &&
    control.kind !== 'trackpad' &&
    control.binding.type === 'obs' &&
    control.binding.target === 'inputVolume' &&
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
    if (requested !== null && !requested.has(button.id)) continue
    const state = button.state
    if (state?.type === 'obs') {
      controls.push({
        id: button.id,
        label: button.label,
        source: 'obs',
        target: state.target,
        ...(state.input ? { input: state.input } : {}),
        ...(state.scene ? { scene: state.scene } : {}),
        ...(state.target === 'inputVolume' ? { max: 200 } : {}),
      })
      if (controls.length >= 32) break
      continue
    }
    const obs = isObsVolumeControl(button) ? button.control : null
    const source: ControlStateSource | null = isAbsoluteVolumeControl(button)
      ? 'volume'
      : isMicGainControl(button)
        ? 'mic'
        : obs
          ? 'obs'
          : null
    if (!source) continue
    if (requested !== null && !requested.has(button.id)) continue
    if (source === 'obs' && obs && obs.kind !== 'trackpad' && obs.binding.type === 'obs') {
      controls.push({
        id: button.id,
        label: button.label,
        source,
        ...(obs.binding.input ? { input: obs.binding.input } : {}),
        max: obs.max ?? 200,
      })
    } else {
      controls.push({ id: button.id, label: button.label, source })
    }
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
  obsReader?: ObsStateReader | null
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
  if (!entry.available) return `0|${entry.detail ?? ''}|${entry.error ?? ''}`
  return [
    '1',
    entry.value?.toFixed(4) ?? '',
    entry.muted === undefined ? '' : entry.muted ? '1' : '0',
    entry.active === undefined ? '' : entry.active ? '1' : '0',
    entry.detail ?? '',
  ].join('|')
}

function isStatusReading(
  reading: VolumeReading | MicReading | ObsInputReading | ObsStatusReading,
): reading is ObsStatusReading {
  return typeof (reading as ObsStatusReading).detail === 'string'
}

function controlKey(profileId: string, pageId: string, controlId: string): string {
  return `${profileId}\u0000${pageId}\u0000${controlId}`
}

function obsUnavailableDetail(error: string): string {
  if (/switch/i.test(error)) return 'SWITCHING'
  if (/scene/i.test(error) && /not found|no current/i.test(error)) return 'NO SCENE'
  if (/source/i.test(error) && /not found/i.test(error)) return 'NO SOURCE'
  if (/not found|missing|no inputs?|not an audio input/i.test(error)) return 'NO INPUT'
  if (/not connected|not available|not identified|disabled|connection|timed out|closed/i.test(error)) {
    return 'NO OBS'
  }
  return error.slice(0, 60)
}

function readingEntry(
  controlId: string,
  source: ControlStateSource,
  reading: VolumeReading | MicReading | ObsInputReading | ObsStatusReading | null,
  error: string | null,
  max?: number,
): ControlStateEntry {
  if (!reading || error) {
    return {
      controlId,
      revision: 0,
      available: false,
      detail: error
        ? source === 'obs'
          ? obsUnavailableDetail(error)
          : error.slice(0, 60)
        : 'Unavailable',
      ...(error ? { error: error.slice(0, 200) } : {}),
    }
  }
  if (isStatusReading(reading)) {
    return {
      controlId,
      revision: 0,
      available: true,
      detail: reading.detail,
      ...(reading.value === undefined ? {} : { value: reading.value }),
      ...(reading.muted === undefined ? {} : { muted: reading.muted }),
      ...(reading.active === undefined ? {} : { active: reading.active }),
    }
  }
  const level = Math.max(0, reading.level)
  const ceiling = max !== undefined && Number.isFinite(max) && max > 0 ? max : 100
  const value = Math.max(0, Math.min(1, level / ceiling))
  const muted = reading.muted
  return {
    controlId,
    revision: 0,
    value,
    available: true,
    detail: muted ? 'MUTED' : `${Math.round(level)}%`,
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
  private readonly obsReader?: ObsStateReader | null
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
  /** Input/max metadata per profile/page/control, learned from the subscription. */
  private readonly controlMeta = new Map<string, StateControl>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private suppressUntil = 0
  private disposed = false

  constructor(options: ControlStateServiceOptions) {
    this.reader = options.reader
    this.micReader = options.micReader
    this.obsReader = options.obsReader
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
    const byId = new Map<string, StateControl>()
    for (const control of requested) byId.set(control.id, control)

    const controlIds = [...new Set(subscription.controlIds.length > 0
      ? subscription.controlIds
      : requested.map((control) => control.id))].slice(0, 32)
    for (const controlId of controlIds) {
      const key = controlKey(subscription.profileId, subscription.pageId, controlId)
      const control = byId.get(controlId)
      this.sources.set(key, control?.source ?? 'volume')
      if (control) this.controlMeta.set(key, control)
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

  /**
   * Push an OBS input volume just written by the phone. `level` is OBS percent
   * (100 = unity). Mirrors the mic/volume write path.
   */
  noteObsWritten(input: string | undefined, level: number, muted?: boolean): Promise<void> {
    if (this.disposed || !Number.isFinite(level)) return Promise.resolve()
    const reading: ObsInputReading = {
      level: Math.max(0, Math.min(2000, level)),
      muted: muted ?? false,
    }

    return this.enqueue(async () => {
      this.obsReader?.invalidate(input)
      this.obsReader?.setKnown(input, reading)
      this.suppressUntil = Math.max(this.suppressUntil, this.now() + this.writeGraceMs)
      await this.refresh(undefined, true)
    })
  }

  /** OBS event-driven refresh: send changed entries immediately. */
  noteObsChanged(input?: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    void input
    return this.enqueue(async () => {
      this.suppressUntil = Math.max(this.suppressUntil, this.now() + this.writeGraceMs)
      await this.refresh(undefined, false, true)
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
    this.controlMeta.clear()
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

  private async refresh(immediate?: Subscription, forceAll = false, forceChanged = false): Promise<void> {
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

    const obsControls = watched.filter((control) => control.source === 'obs')
    if (obsControls.length > 0) {
      // Continuous/volume reads group by input; status tiles group by target.
      const volume = obsControls.filter((control) => !control.target || control.target === 'inputVolume')
      const status = obsControls.filter(
        (control) => control.target !== undefined && control.target !== 'inputVolume',
      )

      const volumeGroups = new Map<string, typeof volume>()
      for (const control of volume) {
        const key = control.input ?? ''
        const group = volumeGroups.get(key)
        if (group) group.push(control)
        else volumeGroups.set(key, [control])
      }
      for (const [input, controls] of volumeGroups) {
        let reading: ObsInputReading | ObsStatusReading | null = null
        let error: string | null = null
        if (!this.obsReader) {
          error = 'OBS state is not available on this desktop.'
        } else {
          try {
            reading = controls.some((control) => control.target === 'inputVolume')
              ? await this.obsReader.readStatus('inputVolume', { input: input || undefined })
              : await this.obsReader.read(input || undefined)
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
        }
        for (const control of controls) {
          this.updateEntry(
            control.key,
            control.controlId,
            'obs',
            reading,
            error,
            control.max ?? 200,
          )
        }
      }

      const statusGroups = new Map<string, typeof status>()
      for (const control of status) {
        const key = `${control.target}\u0000${control.scene ?? ''}\u0000${control.input ?? ''}`
        const group = statusGroups.get(key)
        if (group) group.push(control)
        else statusGroups.set(key, [control])
      }
      for (const controls of statusGroups.values()) {
        const first = controls[0]!
        let reading: ObsStatusReading | null = null
        let error: string | null = null
        if (!this.obsReader) {
          error = 'OBS state is not available on this desktop.'
        } else {
          try {
            reading = await this.obsReader.readStatus(first.target!, {
              ...(first.scene ? { scene: first.scene } : {}),
              ...(first.input ? { input: first.input } : {}),
            })
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
        }
        for (const control of controls) {
          this.updateEntry(control.key, control.controlId, 'obs', reading, error)
        }
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
      if (!forceChanged && sub.lastPolledAt !== null && now - sub.lastPolledAt < sub.intervalMs) continue
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
    input?: string
    max?: number
    target?: ObsStateTarget
    scene?: string
  }> {
    const controls = new Map<
      string,
      {
        key: string
        controlId: string
        source: ControlStateSource
        input?: string
        max?: number
        target?: ObsStateTarget
        scene?: string
      }
    >()
    for (const sub of this.subscriptions.values()) {
      for (const controlId of sub.controlIds) {
        const key = controlKey(sub.profileId, sub.pageId, controlId)
        if (controls.has(key)) continue
        const meta = this.controlMeta.get(key)
        controls.set(key, {
          key,
          controlId,
          source: meta?.source ?? this.sources.get(key) ?? 'volume',
          ...(meta?.input ? { input: meta.input } : {}),
          ...(meta?.max !== undefined ? { max: meta.max } : {}),
          ...(meta?.target ? { target: meta.target } : {}),
          ...(meta?.scene ? { scene: meta.scene } : {}),
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
    reading: VolumeReading | MicReading | ObsInputReading | ObsStatusReading | null,
    error: string | null,
    max?: number,
  ): void {
    const existing = this.entries.get(key)
    const candidate = readingEntry(controlId, source, reading, error, max)
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
