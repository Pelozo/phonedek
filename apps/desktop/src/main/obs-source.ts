import type { ObsPlanStep, ObsStateTarget } from '@phonedek/shared'
import type { Logger } from './logger'
import { ObsRequestError } from './obs-client'

/** A cached OBS input level/mute reading. */
export interface ObsInputReading {
  /** Input level in percent: `inputVolumeMul * 100`, e.g. 150 = 150% = +3.5 dB. */
  level: number
  muted: boolean
}

/**
 * Normalized status reading for a read-only OBS tile.
 *
 * `detail` is the short display string (`LIVE`, `OFF`, `REC`, `REPLAY`,
 * `VCAM`, `MUTED`, `42%`, or a scene name). `value` is used by volume tiles.
 */
export interface ObsStatusReading {
  active?: boolean
  value?: number
  muted?: boolean
  detail: string
}

export interface ObsInputInfo {
  name: string
  kind: string
  audio: boolean
}

/** OBS volume/mute state reader and writer used by control state and actions. */
export interface ObsStatusOptions {
  scene?: string
  input?: string
}

export interface ObsStateReader {
  read(input?: string): Promise<ObsInputReading>
  invalidate(input?: string): void
  setKnown(input: string | undefined, reading: ObsInputReading): void
  listInputs(force?: boolean): Promise<ObsInputInfo[]>
  /** Returns the resolved input name. */
  setVolume(input: string | undefined, percent: number): Promise<string>
  toggleMute(input?: string): Promise<{ input: string; muted: boolean }>
  /** Read-only status for a button `state` binding. */
  readStatus(target: ObsStateTarget, options?: ObsStatusOptions): Promise<ObsStatusReading>
  /** Drop cached status readings; omitted = every target. */
  invalidateStatus(target?: ObsStateTarget): void
}

/** Source/write control surface used by `runObsAction` in the executor. */
export interface ObsActionRunner {
  execute(step: ObsPlanStep): Promise<void>
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
  sceneTtlMs?: number
  /** Debounce for event-driven control-state notifications. */
  notifyDebounceMs?: number
  now?: () => number
  logger?: Logger
}

const DEFAULT_TTL_MS = 900
const DEFAULT_LIST_TTL_MS = 30_000
const DEFAULT_NOTIFY_DEBOUNCE_MS = 100
/** Scene/source lookups tolerate OBS renames for a short window. */
const DEFAULT_SCENE_TTL_MS = 900
/** Matches the default OBS volume control ceiling (0..200%). */
const OBS_STATUS_VOLUME_MAX = 200

/** obs-websocket v5 request names for each output transition. */
const OUTPUT_REQUESTS: Record<
  'stream' | 'record' | 'replay' | 'virtualCam',
  Record<'start' | 'stop' | 'toggle', string>
> = {
  stream: { start: 'StartStream', stop: 'StopStream', toggle: 'ToggleStream' },
  record: { start: 'StartRecord', stop: 'StopRecord', toggle: 'ToggleRecord' },
  replay: { start: 'StartReplayBuffer', stop: 'StopReplayBuffer', toggle: 'ToggleReplayBuffer' },
  virtualCam: { start: 'StartVirtualCam', stop: 'StopVirtualCam', toggle: 'ToggleVirtualCam' },
}

function statusKey(target: ObsStateTarget, options: ObsStatusOptions): string {
  return `${target}\u0000${options.scene ?? ''}\u0000${options.input ?? ''}`
}

function shortTimecode(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const withoutMillis = value.replace(/\.\d+$/, '')
  return withoutMillis.replace(/^00:/, '')
}

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

interface ObsSceneInfo {
  name: string
  index: number
}

interface ObsSceneList {
  currentProgramSceneName: string
  currentPreviewSceneName?: string
  scenes: ObsSceneInfo[]
}

interface ObsSceneItem {
  sceneItemId: number
  sourceName: string
  sceneItemEnabled: boolean
}

interface StatusCacheEntry {
  reading: ObsStatusReading
  at: number
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
  private readonly statusCache = new Map<string, StatusCacheEntry>()
  private readonly statusInFlight = new Map<string, Promise<ObsStatusReading>>()
  private readonly sceneItemsCache = new Map<string, { items: ObsSceneItem[]; at: number }>()
  private readonly sceneItemsInFlight = new Map<string, Promise<ObsSceneItem[]>>()
  private sceneListCache: { list: ObsSceneList; at: number } | null = null
  private sceneListInFlight: Promise<ObsSceneList> | null = null
  private controlChain: Promise<unknown> = Promise.resolve()
  private readonly sceneTtlMs: number
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
    this.sceneTtlMs = Math.max(0, options.sceneTtlMs ?? DEFAULT_SCENE_TTL_MS)
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

  /**
   * Read-only status for a button `state` binding. Cached per target/options
   * for `ttlMs` and single-flighted, exactly like input volume reads.
   */
  async readStatus(target: ObsStateTarget, options: ObsStatusOptions = {}): Promise<ObsStatusReading> {
    this.assertReady()
    const key = statusKey(target, options)
    const now = this.now()
    const cached = this.statusCache.get(key)
    if (cached && now - cached.at < this.ttlMs) return { ...cached.reading }
    const already = this.statusInFlight.get(key)
    if (already) return already.then((reading) => ({ ...reading }))

    const pending = (async (): Promise<ObsStatusReading> => {
      try {
        const reading = await this.fetchStatus(target, options)
        this.statusCache.set(key, { reading: { ...reading }, at: this.now() })
        return { ...reading }
      } catch (error) {
        throw this.mapStatusError(target, options, error)
      } finally {
        this.statusInFlight.delete(key)
      }
    })()

    this.statusInFlight.set(key, pending)
    return pending
  }

  invalidateStatus(target?: ObsStateTarget): void {
    if (target === undefined) {
      this.statusCache.clear()
      return
    }
    const prefix = `${target}\u0000`
    for (const key of [...this.statusCache.keys()]) {
      if (key.startsWith(prefix)) this.statusCache.delete(key)
    }
  }

  /** Execute a planned OBS action against the live socket. */
  async execute(step: ObsPlanStep): Promise<void> {
    switch (step.action) {
      case 'toggleMute':
        await this.toggleMute(step.input)
        break
      case 'setScene':
        await this.setScene(step.scene)
        break
      case 'toggleStream':
        await this.setOutput('stream', 'toggle')
        break
      case 'startStream':
        await this.setOutput('stream', 'start')
        break
      case 'stopStream':
        await this.setOutput('stream', 'stop')
        break
      case 'toggleRecord':
        await this.setOutput('record', 'toggle')
        break
      case 'startRecord':
        await this.setOutput('record', 'start')
        break
      case 'stopRecord':
        await this.setOutput('record', 'stop')
        break
      case 'startReplay':
        await this.setOutput('replay', 'start')
        break
      case 'stopReplay':
        await this.setOutput('replay', 'stop')
        break
      case 'saveReplay':
        await this.saveReplay()
        break
      case 'toggleVirtualCam':
        await this.setOutput('virtualCam', 'toggle')
        break
      case 'setSourceVisibility':
        await this.setSourceVisibility(step.scene, step.source, step.visible)
        break
      case 'toggleSourceVisibility':
        await this.setSourceVisibility(step.scene, step.source)
        break
      case 'addMarker':
        await this.addMarker(step.name)
        break
    }
    this.invalidateStatus()
    this.scheduleNotify(undefined)
  }

  /** Switch the program scene; omitted = the first scene in OBS's list. */
  setScene(scene?: string): Promise<{ scene: string }> {
    return this.serializeWrite(async () => {
      this.assertReady()
      const name = scene?.trim()
        ? scene.trim()
        : (await this.sceneList()).scenes[0]?.name
      if (!name) throw new Error('OBS has no scenes.')
      try {
        await this.client.request('SetCurrentProgramScene', { sceneName: name })
      } catch (error) {
        throw this.mapSceneError(name, error)
      }
      if (this.sceneListCache) {
        this.sceneListCache.list = {
          ...this.sceneListCache.list,
          currentProgramSceneName: name,
        }
      }
      this.invalidateStatus('scene')
      this.scheduleNotify(undefined)
      return { scene: name }
    })
  }

  /** Start/stop/toggle one OBS output. */
  setOutput(
    output: 'stream' | 'record' | 'replay' | 'virtualCam',
    action: 'start' | 'stop' | 'toggle',
  ): Promise<void> {
    return this.serializeWrite(async () => {
      this.assertReady()
      const type = OUTPUT_REQUESTS[output][action]
      try {
        await this.client.request(type)
      } catch (error) {
        if (error instanceof ObsRequestError && error.code === 204) {
          throw new Error(`OBS does not support ${type} on this version.`)
        }
        throw error
      }
      this.invalidateStatus()
      this.scheduleNotify(undefined)
    })
  }

  saveReplay(): Promise<void> {
    return this.serializeWrite(async () => {
      this.assertReady()
      try {
        await this.client.request('SaveReplayBuffer')
      } catch (error) {
        if (error instanceof ObsRequestError && error.code === 204) {
          throw new Error('OBS does not support saving the replay buffer on this version.')
        }
        throw error
      }
      this.scheduleNotify(undefined)
    })
  }

  /**
   * Set or toggle a source's visibility in a scene. `scene` omitted = the
   * current program scene; `visible` omitted = invert the current state.
   */
  setSourceVisibility(
    scene: string | undefined,
    source: string,
    visible?: boolean,
  ): Promise<{ scene: string; source: string; visible: boolean }> {
    return this.serializeWrite(async () => {
      this.assertReady()
      const sceneName = scene?.trim() || (await this.sceneList()).currentProgramSceneName
      if (!sceneName) throw new Error('OBS has no current program scene.')
      let items = await this.sceneItems(sceneName)
      let item = items.find((candidate) => candidate.sourceName === source)
      if (!item) {
        items = await this.sceneItems(sceneName, true)
        item = items.find((candidate) => candidate.sourceName === source)
      }
      if (!item) {
        throw new Error(`OBS source "${source}" was not found in scene "${sceneName}".`)
      }
      const target = visible ?? !item.sceneItemEnabled
      try {
        await this.client.request('SetSceneItemEnabled', {
          sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: target,
        })
      } catch (error) {
        throw this.mapSceneError(sceneName, error)
      }
      item.sceneItemEnabled = target
      this.invalidateStatus('scene')
      this.scheduleNotify(undefined)
      return { scene: sceneName, source, visible: target }
    })
  }

  /** Add a recording chapter marker (Hybrid MP4, OBS 30.2+/obs-websocket 5.5+). */
  addMarker(name?: string): Promise<void> {
    return this.serializeWrite(async () => {
      this.assertReady()
      try {
        await this.client.request('CreateRecordChapter', name ? { chapterName: name } : {})
      } catch (error) {
        if (error instanceof ObsRequestError && (error.code === 204 || error.code === 702)) {
          throw new Error(
            'OBS could not add a chapter marker (requires OBS 30.2+ and a Hybrid MP4 recording).',
          )
        }
        throw error
      }
      this.scheduleNotify(undefined)
    })
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
    this.statusCache.clear()
    this.statusInFlight.clear()
    this.sceneItemsCache.clear()
    this.sceneItemsInFlight.clear()
    this.sceneListCache = null
    this.sceneListInFlight = null
    this.controlChain = Promise.resolve()
    this.listCache = null
    this.listInFlight = null
  }

  private assertReady(): void {
    if (this.disposed) throw new Error('OBS is not connected.')
    if (!this.client.connected) throw new Error('OBS is not connected.')
    if (this.client.paused || this.sceneSwitching) {
      throw new Error('OBS is switching scene collections.')
    }
  }

  /** Serialize action writes so two quick tiles cannot interleave OBS requests. */
  private serializeWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.controlChain.then(task, task)
    this.controlChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async fetchStatus(
    target: ObsStateTarget,
    options: ObsStatusOptions,
  ): Promise<ObsStatusReading> {
    switch (target) {
      case 'streaming': {
        const data = await this.client.request<Record<string, unknown>>('GetStreamStatus')
        const active = data['outputActive'] === true
        const time = shortTimecode(data['outputTimecode'])
        return { active, detail: active ? (time ? `LIVE ${time}` : 'LIVE') : 'OFF' }
      }
      case 'recording': {
        const data = await this.client.request<Record<string, unknown>>('GetRecordStatus')
        const active = data['outputActive'] === true
        const paused = data['outputPaused'] === true
        const time = shortTimecode(data['outputTimecode'])
        return {
          active,
          detail: active ? (paused ? 'REC PAUSED' : time ? `REC ${time}` : 'REC') : 'OFF',
        }
      }
      case 'replay': {
        const data = await this.client.request<Record<string, unknown>>('GetReplayBufferStatus')
        const active = data['outputActive'] === true
        return { active, detail: active ? 'REPLAY' : 'OFF' }
      }
      case 'virtualCam': {
        const data = await this.client.request<Record<string, unknown>>('GetVirtualCamStatus')
        const active = data['outputActive'] === true
        return { active, detail: active ? 'VCAM' : 'OFF' }
      }
      case 'scene': {
        const list = await this.sceneList()
        const current = list.currentProgramSceneName
        return {
          active: options.scene ? current === options.scene : true,
          detail: current || 'NO SCENE',
        }
      }
      case 'inputMute': {
        const reading = await this.read(options.input)
        return {
          active: reading.muted,
          muted: reading.muted,
          detail: reading.muted ? 'MUTED' : 'ON',
        }
      }
      case 'inputVolume': {
        const reading = await this.read(options.input)
        return {
          value: Math.max(0, Math.min(1, reading.level / OBS_STATUS_VOLUME_MAX)),
          muted: reading.muted,
          detail: reading.muted ? 'MUTED' : `${Math.round(reading.level)}%`,
        }
      }
    }
  }

  private sceneList(force = false): Promise<ObsSceneList> {
    this.assertReady()
    const now = this.now()
    if (!force && this.sceneListCache && now - this.sceneListCache.at < this.sceneTtlMs) {
      return Promise.resolve(cloneSceneList(this.sceneListCache.list))
    }
    if (this.sceneListInFlight) return this.sceneListInFlight.then(cloneSceneList)

    const pending = (async (): Promise<ObsSceneList> => {
      try {
        const data = await this.client.request<Record<string, unknown>>('GetSceneList')
        const current =
          typeof data['currentProgramSceneName'] === 'string'
            ? data['currentProgramSceneName']
            : ''
        const preview =
          typeof data['currentPreviewSceneName'] === 'string'
            ? data['currentPreviewSceneName']
            : undefined
        const scenes = Array.isArray(data['scenes'])
          ? data['scenes']
              .filter((item): item is Record<string, unknown> => isRecord(item))
              .map((item, position) => ({
                name: typeof item['sceneName'] === 'string' ? item['sceneName'] : '',
                index: typeof item['sceneIndex'] === 'number' ? item['sceneIndex'] : position,
              }))
              .filter((item) => item.name.length > 0)
              .sort((a, b) => a.index - b.index)
          : []
        const list = { currentProgramSceneName: current, ...(preview ? { currentPreviewSceneName: preview } : {}), scenes }
        this.sceneListCache = { list, at: this.now() }
        return list
      } catch (error) {
        throw this.mapSceneError('scene list', error)
      } finally {
        this.sceneListInFlight = null
      }
    })()

    this.sceneListInFlight = pending
    return pending
  }

  private sceneItems(sceneName: string, force = false): Promise<ObsSceneItem[]> {
    this.assertReady()
    const now = this.now()
    const cached = this.sceneItemsCache.get(sceneName)
    if (!force && cached && now - cached.at < this.sceneTtlMs) return Promise.resolve(cloneItems(cached.items))
    const inFlight = this.sceneItemsInFlight.get(sceneName)
    if (inFlight) return inFlight.then(cloneItems)

    const pending = (async (): Promise<ObsSceneItem[]> => {
      try {
        const data = await this.client.request<Record<string, unknown>>('GetSceneItemList', {
          sceneName,
        })
        const items = Array.isArray(data['sceneItems'])
          ? data['sceneItems']
              .filter((item): item is Record<string, unknown> => isRecord(item))
              .map((item) => ({
                sceneItemId: typeof item['sceneItemId'] === 'number' ? item['sceneItemId'] : 0,
                sourceName: typeof item['sourceName'] === 'string' ? item['sourceName'] : '',
                sceneItemEnabled: item['sceneItemEnabled'] !== false,
              }))
              .filter((item) => item.sceneItemId !== 0 && item.sourceName.length > 0)
          : []
        this.sceneItemsCache.set(sceneName, { items, at: this.now() })
        return items
      } catch (error) {
        throw this.mapSceneError(sceneName, error)
      } finally {
        this.sceneItemsInFlight.delete(sceneName)
      }
    })()

    this.sceneItemsInFlight.set(sceneName, pending)
    return pending
  }

  private mapSceneError(scene: string, error: unknown): Error {
    if (error instanceof ObsRequestError) {
      if (error.code === 600) return new Error(`OBS scene "${scene}" was not found`)
      if (error.code === 207) return new Error('OBS is switching scene collections.')
    }
    if (!this.client.connected) return new Error('OBS is not connected.')
    return error instanceof Error ? error : new Error(String(error))
  }

  private mapStatusError(
    target: ObsStateTarget,
    options: ObsStatusOptions,
    error: unknown,
  ): Error {
    if (error instanceof ObsRequestError) {
      if (error.code === 600) {
        if (target === 'scene') {
          return new Error(`OBS scene "${options.scene ?? ''}" was not found`)
        }
        return new Error(`OBS source for ${target} was not found`)
      }
      if (error.code === 605) return new Error(`OBS source for ${target} is not an audio input`)
      if (error.code === 207) return new Error('OBS is switching scene collections.')
    }
    if (!this.client.connected) return new Error('OBS is not connected.')
    return error instanceof Error ? error : new Error(String(error))
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
      case 'StreamStateChanged':
      case 'RecordStateChanged':
      case 'ReplayBufferStateChanged':
      case 'VirtualcamStateChanged': {
        this.invalidateStatus(
          type === 'StreamStateChanged'
            ? 'streaming'
            : type === 'RecordStateChanged'
              ? 'recording'
              : type === 'ReplayBufferStateChanged'
                ? 'replay'
                : 'virtualCam',
        )
        this.scheduleNotify(undefined)
        return
      }
      case 'CurrentProgramSceneChanged': {
        const name = typeof data['sceneName'] === 'string' ? data['sceneName'] : ''
        if (name && this.sceneListCache) {
          this.sceneListCache.list = { ...this.sceneListCache.list, currentProgramSceneName: name }
        }
        this.invalidateStatus('scene')
        this.scheduleNotify(undefined)
        return
      }
      case 'SceneItemEnableStateChanged':
      case 'SceneItemCreated':
      case 'SceneItemRemoved':
      case 'SceneItemListReindexed': {
        const scene = typeof data['sceneName'] === 'string' ? data['sceneName'] : ''
        if (scene) this.sceneItemsCache.delete(scene)
        this.scheduleNotify(undefined)
        return
      }
      case 'SceneCreated':
      case 'SceneRemoved':
      case 'SceneNameChanged': {
        this.sceneListCache = null
        this.sceneItemsCache.clear()
        this.invalidateStatus('scene')
        this.scheduleNotify(undefined)
        return
      }
      case 'ExitStarted': {
        this.invalidateStatus()
        this.sceneListCache = null
        this.sceneItemsCache.clear()
        this.scheduleNotify(undefined)
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
        this.statusCache.clear()
        this.sceneListCache = null
        this.sceneItemsCache.clear()
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

function cloneSceneList(list: ObsSceneList): ObsSceneList {
  return {
    ...list,
    scenes: list.scenes.map((scene) => ({ ...scene })),
  }
}

function cloneItems(items: ObsSceneItem[]): ObsSceneItem[] {
  return items.map((item) => ({ ...item }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
