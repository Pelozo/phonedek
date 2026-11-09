import type { Logger } from './logger'
import { ObsRequestError } from './obs-client'

/** A cached OBS input level/mute reading. */
export interface ObsInputReading {
  /** Input level in percent: `inputVolumeMul * 100`, e.g. 150 = 150% = +3.5 dB. */
  level: number
  muted: boolean
}

export interface ObsInputInfo {
  name: string
  kind: string
  audio: boolean
}

/** OBS volume/mute state reader and writer used by control state and actions. */
export interface ObsStateReader {
  read(input?: string): Promise<ObsInputReading>
  invalidate(input?: string): void
  setKnown(input: string | undefined, reading: ObsInputReading): void
  listInputs(force?: boolean): Promise<ObsInputInfo[]>
  /** Returns the resolved input name. */
  setVolume(input: string | undefined, percent: number): Promise<string>
  toggleMute(input?: string): Promise<{ input: string; muted: boolean }>
}

/** Minimal ObsClient surface required by the source (fake-friendly). */
export interface ObsClientLike {
  readonly connected: boolean
  readonly paused?: boolean
  request<T = Record<string, unknown>>(type: string, data?: object): Promise<T>
  onEvent(listener: (type: string, data: Record<string, unknown>) => void): () => void
}

export interface ObsStateSourceOptions {
  ttlMs?: number
  listTtlMs?: number
  /** Debounce for event-driven control-state notifications. */
  notifyDebounceMs?: number
  now?: () => number
  logger?: Logger
}

const DEFAULT_TTL_MS = 900
const DEFAULT_LIST_TTL_MS = 30_000
const DEFAULT_NOTIFY_DEBOUNCE_MS = 100

/** Normalized 0..1 slider value → OBS percentage using the control's max. */
export function obsControlPercent(value: number, max = 200): number {
  if (!Number.isFinite(value)) throw new Error('OBS volume value must be a finite number')
  const ceiling = Number.isFinite(max) && max > 0 ? Math.min(max, 2000) : 200
  return Math.max(0, Math.min(ceiling, value * ceiling))
}

/** OBS percent → linear `inputVolumeMul` (100% = 1.0, 200% = 2.0). */
export function obsPercentToMul(percent: number): number {
  if (!Number.isFinite(percent)) throw new Error('OBS volume percent must be a finite number')
  return Math.max(0, Math.min(2000, percent)) / 100
}

/** `inputVolumeMul` → percent, clamped to OBS's practical 0..2000 range. */
export function obsMulToPercent(mul: number): number {
  if (!Number.isFinite(mul)) throw new Error('OBS input volume multiplier is not finite')
  return Math.max(0, Math.min(2000, mul * 100))
}

/** Heuristic for OBS input kinds that carry audio (used only for the fallback). */
export function isAudioInputKind(kind: string): boolean {
  return /input_capture|output_capture|audio|ndi|jack|alsa|pulse|wasapi|coreaudio/i.test(kind)
}

interface CacheEntry {
  reading: ObsInputReading
  at: number
}

interface PendingWrite {
  percent: number
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>
}

interface WriteState {
  inflight: boolean
  latest: PendingWrite | null
}

/**
 * Per-input cache, input list/fallback/alias resolution, write coalescing and
 * event-driven cache updates on top of an ObsClient.
 */
export class ObsStateSource implements ObsStateReader {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<ObsInputReading>>()
  private readonly aliases = new Map<string, string>()
  private readonly writes = new Map<string, WriteState>()
  private readonly changeListeners = new Set<(input?: string) => void>()
  private readonly unsubscribe: () => void
  private readonly ttlMs: number
  private readonly listTtlMs: number
  private readonly notifyDebounceMs: number
  private readonly now: () => number
  private readonly logger?: Logger
  private listCache: { inputs: ObsInputInfo[]; at: number } | null = null
  private listInFlight: Promise<ObsInputInfo[]> | null = null
  private fallbackKnown: ObsInputReading | null = null
  private sceneSwitching = false
  private notifyTimer: NodeJS.Timeout | null = null
  private notifyAll = false
  private notifyInput: string | undefined
  private disposed = false

  constructor(
    private readonly client: ObsClientLike,
    options: ObsStateSourceOptions = {},
  ) {
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS)
    this.listTtlMs = Math.max(0, options.listTtlMs ?? DEFAULT_LIST_TTL_MS)
    this.notifyDebounceMs = Math.max(0, options.notifyDebounceMs ?? DEFAULT_NOTIFY_DEBOUNCE_MS)
    this.now = options.now ?? Date.now
    this.logger = options.logger
    this.unsubscribe = client.onEvent((type, data) => this.handleEvent(type, data))
  }

  async read(input?: string): Promise<ObsInputReading> {
    const name = await this.effectiveInput(input)
    return this.readResolved(name)
  }

  invalidate(input?: string): void {
    if (input === undefined) {
      this.cache.clear()
      this.fallbackKnown = null
      return
    }
    this.cache.delete(this.resolveAlias(input))
  }

  setKnown(input: string | undefined, reading: ObsInputReading): void {
    const normalized = normalizeReading(reading)
    if (input === undefined) {
      this.fallbackKnown = normalized
      return
    }
    const name = this.resolveAlias(input)
    this.cache.set(name, { reading: normalized, at: this.now() })
  }

  listInputs(force = false): Promise<ObsInputInfo[]> {
    if (this.disposed) return Promise.resolve([])
    if (!this.client.connected) return Promise.reject(new Error('OBS is not connected.'))
    if (this.client.paused || this.sceneSwitching) {
      return Promise.reject(new Error('OBS is switching scene collections.'))
    }
    const now = this.now()
    if (!force && this.listCache && now - this.listCache.at < this.listTtlMs) {
      return Promise.resolve(cloneInputs(this.listCache.inputs))
    }
    if (this.listInFlight) return this.listInFlight.then(cloneInputs)

    const pending = (async (): Promise<ObsInputInfo[]> => {
      try {
        const response = await this.client.request<Record<string, unknown>>('GetInputList')
        const inputs = Array.isArray(response['inputs'])
          ? response['inputs']
              .filter((item): item is Record<string, unknown> => isRecord(item))
              .map((item) => {
                const name = typeof item['inputName'] === 'string' ? item['inputName'] : ''
                const kind =
                  typeof item['unversionedInputKind'] === 'string'
                    ? item['unversionedInputKind']
                    : typeof item['inputKind'] === 'string'
                      ? item['inputKind']
                      : ''
                return { name, kind, audio: isAudioInputKind(kind) }
              })
              .filter((item) => item.name.length > 0)
          : []
        this.listCache = { inputs, at: this.now() }
        return cloneInputs(inputs)
      } catch (error) {
        throw this.mapError('input list', error)
      } finally {
        this.listInFlight = null
      }
    })()

    this.listInFlight = pending
    return pending
  }

  setVolume(input: string | undefined, percent: number): Promise<string> {
    if (!Number.isFinite(percent)) {
      return Promise.reject(new Error('OBS volume percent must be a finite number'))
    }
    const value = Math.max(0, Math.min(2000, percent))
    return this.effectiveInput(input).then(
      (name) =>
        new Promise<string>((resolve, reject) => {
          let state = this.writes.get(name)
          if (!state) {
            state = { inflight: false, latest: null }
            this.writes.set(name, state)
          }
          const waiter = { resolve: () => resolve(name), reject }
          if (state.latest) {
            state.latest.percent = value
            state.latest.waiters.push(waiter)
          } else {
            state.latest = { percent: value, waiters: [waiter] }
          }
          void this.drainWrite(name)
        }),
    )
  }

  async toggleMute(input?: string): Promise<{ input: string; muted: boolean }> {
    const name = await this.effectiveInput(input)
    try {
      const response = await this.client.request<Record<string, unknown>>('ToggleInputMute', {
        inputName: name,
      })
      const muted = response['inputMuted'] === true
      const existing = this.cache.get(name)?.reading
      if (existing) {
        this.setKnown(name, { ...existing, muted })
        return { input: name, muted }
      }
      try {
        const reading = await this.read(name)
        this.setKnown(name, { ...reading, muted })
      } catch {
        this.setKnown(name, { level: 100, muted })
      }
      return { input: name, muted }
    } catch (error) {
      throw this.mapError(name, error)
    }
  }

  /** Listen for event-driven changes; the service debounces its own refreshes. */
  onChange(listener: (input?: string) => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = null
    this.changeListeners.clear()
    this.cache.clear()
    this.inFlight.clear()
    this.writes.clear()
    this.listCache = null
    this.listInFlight = null
  }

  private async effectiveInput(input?: string): Promise<string> {
    if (this.disposed) throw new Error('OBS is not connected.')
    if (!this.client.connected) throw new Error('OBS is not connected.')
    if (this.client.paused || this.sceneSwitching) {
      throw new Error('OBS is switching scene collections.')
    }
    if (input !== undefined) return this.resolveAlias(input)
    const inputs = await this.listInputs()
    if (inputs.length === 0) throw new Error('OBS has no inputs.')
    return (inputs.find((item) => item.audio) ?? inputs[0]!).name
  }

  private async readResolved(name: string): Promise<ObsInputReading> {
    if (this.disposed) throw new Error('OBS is not connected.')
    if (!this.client.connected) throw new Error('OBS is not connected.')
    if (this.client.paused || this.sceneSwitching) {
      throw new Error('OBS is switching scene collections.')
    }
    const now = this.now()
    const cached = this.cache.get(name)
    if (cached && now - cached.at < this.ttlMs) return { ...cached.reading }
    if (!cached && this.fallbackKnown) {
      this.cache.set(name, { reading: { ...this.fallbackKnown }, at: now })
      return { ...this.fallbackKnown }
    }
    const already = this.inFlight.get(name)
    if (already) return already

    const pending = (async (): Promise<ObsInputReading> => {
      try {
        const [volume, mute] = await Promise.all([
          this.client.request<Record<string, unknown>>('GetInputVolume', { inputName: name }),
          this.client.request<Record<string, unknown>>('GetInputMute', { inputName: name }),
        ])
        const mul = Number(volume['inputVolumeMul'])
        if (!Number.isFinite(mul)) throw new Error('OBS returned no input volume.')
        const reading: ObsInputReading = {
          level: obsMulToPercent(mul),
          muted: mute['inputMuted'] === true,
        }
        this.cache.set(name, { reading, at: this.now() })
        return { ...reading }
      } catch (error) {
        throw this.mapError(name, error)
      }
    })()

    this.inFlight.set(name, pending)
    try {
      return await pending
    } finally {
      this.inFlight.delete(name)
    }
  }

  private drainWrite(name: string): void {
    const state = this.writes.get(name)
    if (!state || state.inflight) return
    state.inflight = true
    void (async () => {
      try {
        while (state.latest) {
          const batch = state.latest
          state.latest = null
          try {
            await this.client.request('SetInputVolume', {
              inputName: name,
              inputVolumeMul: obsPercentToMul(batch.percent),
            })
            const existing = this.cache.get(name)?.reading
            this.cache.set(name, {
              reading: { level: batch.percent, muted: existing?.muted ?? false },
              at: this.now(),
            })
            for (const waiter of batch.waiters) waiter.resolve()
          } catch (error) {
            const mapped = this.mapError(name, error)
            for (const waiter of batch.waiters) waiter.reject(mapped)
          }
        }
      } finally {
        state.inflight = false
        if (!state.latest) this.writes.delete(name)
      }
    })()
  }

  private resolveAlias(name: string): string {
    let current = name
    const seen = new Set<string>()
    while (this.aliases.has(current) && !seen.has(current)) {
      seen.add(current)
      current = this.aliases.get(current)!
    }
    return current
  }

  private handleEvent(type: string, data: Record<string, unknown>): void {
    switch (type) {
      case 'InputVolumeChanged': {
        const name = this.eventName(data, 'inputName')
        if (!name) return
        const mul = Number(data['inputVolumeMul'])
        if (!Number.isFinite(mul)) return
        if (this.cache.has(name)) {
          const existing = this.cache.get(name)!.reading
          this.setKnown(name, { level: obsMulToPercent(mul), muted: existing.muted })
        }
        this.scheduleNotify(name)
        return
      }
      case 'InputMuteStateChanged': {
        const name = this.eventName(data, 'inputName')
        if (!name) return
        if (this.cache.has(name)) {
          const existing = this.cache.get(name)!.reading
          this.setKnown(name, { ...existing, muted: data['inputMuted'] === true })
        }
        this.scheduleNotify(name)
        return
      }
      case 'InputNameChanged': {
        const oldName = typeof data['oldInputName'] === 'string' ? data['oldInputName'] : ''
        const newName = typeof data['inputName'] === 'string' ? data['inputName'] : ''
        if (!oldName || !newName) return
        this.aliases.set(oldName, newName)
        for (const [alias, target] of [...this.aliases]) {
          if (target === oldName) this.aliases.set(alias, newName)
        }
        const cached = this.cache.get(oldName)
        if (cached) {
          this.cache.delete(oldName)
          this.cache.set(newName, cached)
        }
        this.listCache = null
        this.scheduleNotify(newName)
        return
      }
      case 'InputCreated':
      case 'InputRemoved': {
        const name = this.eventName(data, 'inputName')
        this.listCache = null
        if (type === 'InputRemoved' && name) this.cache.delete(name)
        this.scheduleNotify(name)
        return
      }
      case 'CurrentSceneCollectionChanging': {
        this.sceneSwitching = true
        this.scheduleNotify(undefined)
        return
      }
      case 'CurrentSceneCollectionChanged': {
        this.sceneSwitching = false
        this.listCache = null
        this.cache.clear()
        this.aliases.clear()
        this.fallbackKnown = null
        this.scheduleNotify(undefined)
        return
      }
      default:
        return
    }
  }

  private eventName(data: Record<string, unknown>, key: string): string | undefined {
    const name = typeof data[key] === 'string' ? data[key] : undefined
    return name ? this.resolveAlias(name) : undefined
  }

  private scheduleNotify(input: string | undefined): void {
    if (this.disposed) return
    if (input === undefined) {
      this.notifyAll = true
    } else {
      this.notifyInput = input
    }
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      const all = this.notifyAll
      const single = this.notifyInput
      this.notifyAll = false
      this.notifyInput = undefined
      for (const listener of [...this.changeListeners]) {
        try {
          listener(all ? undefined : single)
        } catch (error) {
          this.logger?.warn(
            `OBS change listener failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }, this.notifyDebounceMs)
    this.notifyTimer.unref?.()
  }

  private mapError(name: string, error: unknown): Error {
    if (error instanceof ObsRequestError) {
      if (error.code === 600) return new Error(`OBS input "${name}" was not found`)
      if (error.code === 605) return new Error(`"${name}" is not an audio input`)
      if (error.code === 207) return new Error('OBS is switching scene collections.')
    }
    if (!this.client.connected) return new Error('OBS is not connected.')
    return error instanceof Error ? error : new Error(String(error))
  }
}

function normalizeReading(reading: ObsInputReading): ObsInputReading {
  if (!Number.isFinite(reading.level)) throw new Error('OBS input level must be a finite number')
  return {
    level: Math.max(0, Math.min(2000, reading.level)),
    muted: reading.muted === true,
  }
}

function cloneInputs(inputs: ObsInputInfo[]): ObsInputInfo[] {
  return inputs.map((item) => ({ ...item }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
