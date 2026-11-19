import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AudioDeviceForm, AudioDeviceKind, AudioDeviceRef } from '@phonedek/shared'
import { windowsHelperLaunch, type HelperLaunch } from './key-sender'
import type { Logger } from './logger'

/** One live audio endpoint, as exposed to the desktop controller. */
export interface AudioDeviceEntry {
  /** Opaque SHA-256 prefix of the OS endpoint id; never the raw path. */
  id: string
  /** Sanitized friendly name, 1..120 characters. */
  name: string
  deviceKind: AudioDeviceKind
  form?: AudioDeviceForm
  current: boolean
  available: boolean
}

/** A point-in-time list of active output/input endpoints. */
export interface AudioDeviceSnapshot {
  available: boolean
  reason?: string
  output: AudioDeviceEntry[]
  input: AudioDeviceEntry[]
  currentOutputId?: string
  currentInputId?: string
  updatedAt: number
}

/** The platform-specific side of the controller (Windows helper today). */
export interface AudioDeviceBackend {
  list(): Promise<{
    output: AudioDeviceEntry[]
    input: AudioDeviceEntry[]
    currentOutputId?: string
    currentInputId?: string
  }>
  current(kind: AudioDeviceKind): Promise<AudioDeviceEntry>
  setDefault(kind: AudioDeviceKind, id: string, allRoles: boolean): Promise<AudioDeviceEntry>
  dispose(): void
}

/**
 * A cached controller for the OS default output/input.
 *
 * Errors never silently choose another device. `list()` reports an unavailable
 * snapshot with a reason; `current()`/`setDefault()`/`cycle()` throw short
 * user-facing errors.
 */
export interface AudioDeviceController {
  list(options?: { force?: boolean }): Promise<AudioDeviceSnapshot>
  current(kind: AudioDeviceKind): Promise<AudioDeviceEntry>
  setDefault(
    kind: AudioDeviceKind,
    ref: AudioDeviceRef,
    allRoles?: boolean,
  ): Promise<AudioDeviceEntry>
  cycle(
    kind: AudioDeviceKind,
    refs: AudioDeviceRef[],
    allRoles?: boolean,
  ): Promise<AudioDeviceEntry>
  dispose(): void
}

/** Low-level JSON request transport used by the Windows backend. */
export interface AudioDeviceTransport {
  request(payload: Record<string, unknown>, timeoutMs: number): Promise<unknown>
  dispose(): void
}

export const AUDIO_DEVICE_LIST_TTL_MS = 2000
export const AUDIO_DEVICE_CURRENT_TTL_MS = 900
export const AUDIO_DEVICE_LIST_TIMEOUT_MS = 5000
export const AUDIO_DEVICE_CURRENT_TIMEOUT_MS = 2000

const AUDIO_DEVICE_FORMS: ReadonlySet<string> = new Set([
  'speakers',
  'headphones',
  'headset',
  'microphone',
  'usb',
  'bluetooth',
  'hdmi',
  'virtual',
  'other',
])

/** Why the platform has no audio-device controller (null on Windows). */
export function audioDeviceUnsupportedReason(platform: NodeJS.Platform): string | null {
  if (platform === 'win32') return null
  return 'Audio device switching is only implemented on Windows in this build.'
}

/** Strip control characters/newlines, collapse whitespace and clamp the length. */
export function sanitizeAudioDeviceName(value: unknown, max = 120): string {
  if (typeof value !== 'string') return ''
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max).trim() : clean
}

/** NFKC + trim + collapse + lowercase, used only for friendly-name fallback. */
export function normalizeDeviceName(value: string | undefined): string {
  if (!value) return ''
  return sanitizeAudioDeviceName(value.normalize('NFKC'), 240).toLowerCase()
}

/** Short user-facing error text; never a raw helper stack or endpoint path. */
export function sanitizeAudioDeviceError(error: unknown, max = 200): string {
  const raw = error instanceof Error ? error.message : String(error)
  const clean = sanitizeAudioDeviceName(raw, max)
  return clean || 'Audio device operation failed'
}

export function isAudioDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{8,64}$/i.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

/** Validate one endpoint row; invalid ids are dropped, names get a safe fallback. */
export function parseAudioDeviceEntry(
  value: unknown,
  fallbackKind: AudioDeviceKind,
): AudioDeviceEntry | null {
  const raw = asRecord(value)
  if (!raw) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!isAudioDeviceId(id)) return null
  const name = sanitizeAudioDeviceName(raw.name) || 'Unknown audio device'
  const form =
    typeof raw.form === 'string' && AUDIO_DEVICE_FORMS.has(raw.form)
      ? (raw.form as AudioDeviceForm)
      : undefined
  return {
    id,
    name,
    deviceKind: fallbackKind,
    ...(form ? { form } : {}),
    current: raw.current === true,
    available: raw.available !== false,
  }
}

function parseEntryList(value: unknown, kind: AudioDeviceKind): AudioDeviceEntry[] {
  const seen = new Set<string>()
  const entries: AudioDeviceEntry[] = []
  for (const item of asArray(value)) {
    const entry = parseAudioDeviceEntry(item, kind)
    if (!entry) continue
    const key = entry.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }
  return entries
}

function readCurrentId(value: unknown, entries: AudioDeviceEntry[]): string | undefined {
  if (isAudioDeviceId(value)) return value
  return entries.find((entry) => entry.current)?.id
}

/**
 * Parse a `list` helper response into a snapshot. The payload may be a single
 * object for an array field on old PowerShell builds; both are accepted.
 */
export function parseAudioDeviceListPayload(
  payload: unknown,
  now: number,
): AudioDeviceSnapshot {
  const raw = asRecord(payload)
  if (!raw) throw new Error('Audio device helper returned an invalid response.')
  if (raw.ok === false) {
    throw new Error(sanitizeAudioDeviceError(raw.error) || 'Audio device helper failed.')
  }
  if (raw.output === undefined && raw.input === undefined) {
    throw new Error('Audio device helper returned no device lists.')
  }

  const output = parseEntryList(raw.output, 'output')
  const input = parseEntryList(raw.input, 'input')
  const currentOutputId = readCurrentId(raw.currentOutputId, output)
  const currentInputId = readCurrentId(raw.currentInputId, input)

  return {
    available: true,
    output: markCurrent(output, currentOutputId),
    input: markCurrent(input, currentInputId),
    ...(currentOutputId ? { currentOutputId } : {}),
    ...(currentInputId ? { currentInputId } : {}),
    updatedAt: now,
  }
}

function markCurrent(
  entries: AudioDeviceEntry[],
  currentId: string | undefined,
): AudioDeviceEntry[] {
  if (!currentId) return entries
  const key = currentId.toLowerCase()
  return entries.map((entry) => ({
    ...entry,
    current: entry.id.toLowerCase() === key,
  }))
}

function parseDevicePayload(payload: unknown, kind: AudioDeviceKind): AudioDeviceEntry {
  const raw = asRecord(payload)
  if (!raw) throw new Error('Audio device helper returned an invalid response.')
  if (raw.ok === false) {
    throw new Error(sanitizeAudioDeviceError(raw.error) || 'Audio device helper failed.')
  }
  const device = parseAudioDeviceEntry(raw.device, kind)
  if (!device) throw new Error('Audio device helper returned no device.')
  return { ...device, deviceKind: kind, current: true }
}

/** Parse a `default` helper response. */
export function parseAudioDeviceDefaultPayload(
  payload: unknown,
  kind: AudioDeviceKind,
): AudioDeviceEntry {
  return parseDevicePayload(payload, kind)
}

/** Parse a `set` helper response. */
export function parseAudioDeviceSetPayload(
  payload: unknown,
  kind: AudioDeviceKind,
): AudioDeviceEntry {
  return parseDevicePayload(payload, kind)
}

/**
 * Resolve a config ref against a live list: exact opaque id first, then a
 * normalized full-name fallback. Duplicate names are ambiguous unless exactly
 * one of the matches is available; never guesses between two usable devices.
 */
export function resolveAudioDeviceRef(
  ref: AudioDeviceRef | undefined,
  entries: readonly AudioDeviceEntry[],
): AudioDeviceEntry | null {
  if (!ref || typeof ref !== 'object') return null
  const id = typeof ref.id === 'string' ? ref.id.trim() : ''
  if (id) {
    const byId = entries.find((entry) => entry.id.toLowerCase() === id.toLowerCase())
    if (byId) return byId
  }

  const name = sanitizeAudioDeviceName(ref.name)
  if (!name) return null
  const normalized = normalizeDeviceName(name)
  const matches = entries.filter((entry) => normalizeDeviceName(entry.name) === normalized)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]!
  const available = matches.filter((entry) => entry.available)
  if (available.length === 1) return available[0]!
  throw new Error(`Device name is ambiguous: ${name}`)
}

function deviceRefLabel(ref: AudioDeviceRef | undefined): string {
  const name = sanitizeAudioDeviceName(ref?.name)
  if (name) return name
  const id = typeof ref?.id === 'string' ? ref.id.trim() : ''
  return id || 'unknown device'
}

function entriesFor(snapshot: AudioDeviceSnapshot, kind: AudioDeviceKind): AudioDeviceEntry[] {
  return kind === 'output' ? snapshot.output : snapshot.input
}

function cloneEntry(entry: AudioDeviceEntry): AudioDeviceEntry {
  return { ...entry }
}

function cloneSnapshot(snapshot: AudioDeviceSnapshot): AudioDeviceSnapshot {
  return {
    ...snapshot,
    output: snapshot.output.map(cloneEntry),
    input: snapshot.input.map(cloneEntry),
  }
}

interface Waiter {
  resolve: (entry: AudioDeviceEntry) => void
  reject: (error: unknown) => void
}

interface QueuedWrite {
  op: () => Promise<AudioDeviceEntry>
  waiters: Waiter[]
}

interface WriteQueue {
  next: QueuedWrite | null
}

export interface AudioDeviceControllerOptions {
  now?: () => number
  listTtlMs?: number
  currentTtlMs?: number
  logger?: Logger
}

/**
 * Shared controller: 2 s list cache, 900 ms current cache, single-flight reads,
 * per-kind latest-wins writes, and no silent device fallback.
 */
export class CachedAudioDeviceController implements AudioDeviceController {
  private listCache: { snapshot: AudioDeviceSnapshot; at: number } | null = null
  private listInFlight: Promise<AudioDeviceSnapshot> | null = null
  private cacheEpoch = 0
  private readonly currentCache = new Map<AudioDeviceKind, { entry: AudioDeviceEntry; at: number }>()
  private readonly currentInFlight = new Map<AudioDeviceKind, Promise<AudioDeviceEntry>>()
  private readonly writes = new Map<AudioDeviceKind, WriteQueue>()
  private readonly now: () => number
  private readonly listTtlMs: number
  private readonly currentTtlMs: number
  private readonly logger?: Logger

  constructor(
    private readonly backend: AudioDeviceBackend,
    options: AudioDeviceControllerOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.listTtlMs = Math.max(0, options.listTtlMs ?? AUDIO_DEVICE_LIST_TTL_MS)
    this.currentTtlMs = Math.max(0, options.currentTtlMs ?? AUDIO_DEVICE_CURRENT_TTL_MS)
    this.logger = options.logger
  }

  async list(options: { force?: boolean } = {}): Promise<AudioDeviceSnapshot> {
    const now = this.now()
    if (!options.force && this.listCache && now - this.listCache.at < this.listTtlMs) {
      return cloneSnapshot(this.listCache.snapshot)
    }
    if (this.listInFlight) return this.listInFlight
    const epoch = this.cacheEpoch

    const pending = (async (): Promise<AudioDeviceSnapshot> => {
      try {
        const raw = await this.backend.list()
        const snapshot: AudioDeviceSnapshot = {
          available: true,
          output: raw.output.map(cloneEntry),
          input: raw.input.map(cloneEntry),
          ...(raw.currentOutputId ? { currentOutputId: raw.currentOutputId } : {}),
          ...(raw.currentInputId ? { currentInputId: raw.currentInputId } : {}),
          updatedAt: this.now(),
        }
        // A write may have completed while enumeration was in flight; do not
        // cache or seed a snapshot that predates it.
        if (epoch === this.cacheEpoch) {
          this.listCache = { snapshot, at: this.now() }
          this.seedCurrent('output', snapshot.currentOutputId, snapshot.output)
          this.seedCurrent('input', snapshot.currentInputId, snapshot.input)
        }
        return cloneSnapshot(snapshot)
      } catch (error) {
        const reason = sanitizeAudioDeviceError(error)
        this.logger?.warn(`Audio device list failed: ${reason}`)
        return {
          available: false,
          reason,
          output: [],
          input: [],
          updatedAt: this.now(),
        }
      }
    })()

    this.listInFlight = pending.finally(() => {
      this.listInFlight = null
    })
    return this.listInFlight
  }

  async current(kind: AudioDeviceKind): Promise<AudioDeviceEntry> {
    const cached = this.currentCache.get(kind)
    if (cached && this.now() - cached.at < this.currentTtlMs) {
      return cloneEntry(cached.entry)
    }
    const inFlight = this.currentInFlight.get(kind)
    if (inFlight) return inFlight

    const pending = (async (): Promise<AudioDeviceEntry> => {
      const entry = await this.backend.current(kind)
      if (!entry.available) throw new Error(`Device is not available: ${entry.name}`)
      const normalized = { ...entry, deviceKind: kind, current: true }
      this.currentCache.set(kind, { entry: normalized, at: this.now() })
      return cloneEntry(normalized)
    })()

    this.currentInFlight.set(kind, pending)
    try {
      return await pending
    } finally {
      this.currentInFlight.delete(kind)
    }
  }

  async setDefault(
    kind: AudioDeviceKind,
    ref: AudioDeviceRef,
    allRoles = true,
  ): Promise<AudioDeviceEntry> {
    const snapshot = await this.list({ force: true })
    if (!snapshot.available) {
      throw new Error(snapshot.reason ?? 'Audio device switching is unavailable.')
    }
    const entries = entriesFor(snapshot, kind)
    const entry = resolveAudioDeviceRef(ref, entries)
    if (!entry) throw new Error(`Device not found: ${deviceRefLabel(ref)}`)
    if (!entry.available) throw new Error(`Device is not available: ${entry.name}`)
    return this.writeEntry(kind, entry, allRoles)
  }

  async cycle(
    kind: AudioDeviceKind,
    refs: AudioDeviceRef[],
    allRoles = true,
  ): Promise<AudioDeviceEntry> {
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new Error('Cycle has no audio devices.')
    }

    const snapshot = await this.list({ force: true })
    if (!snapshot.available) {
      throw new Error(snapshot.reason ?? 'Audio device switching is unavailable.')
    }
    const entries = entriesFor(snapshot, kind)

    const targets: AudioDeviceEntry[] = []
    const seen = new Set<string>()
    let firstError: Error | null = null
    for (const ref of refs) {
      let entry: AudioDeviceEntry | null = null
      try {
        entry = resolveAudioDeviceRef(ref, entries)
      } catch (error) {
        firstError ??= new Error(sanitizeAudioDeviceError(error))
        continue
      }
      if (!entry || !entry.available) continue
      const key = entry.id.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(entry)
    }

    if (targets.length === 0) {
      if (firstError) throw firstError
      throw new Error(`Device not found: ${deviceRefLabel(refs[0])}`)
    }

    const currentId = kind === 'output' ? snapshot.currentOutputId : snapshot.currentInputId

    // One available target is a successful no-op; Windows already uses it or
    // the other configured targets are unplugged.
    if (targets.length === 1) {
      const target = targets[0]!
      if (currentId && target.id.toLowerCase() === currentId.toLowerCase()) {
        return this.markCurrent(kind, target)
      }
      return cloneEntry(target)
    }

    const index = currentId
      ? targets.findIndex((entry) => entry.id.toLowerCase() === currentId.toLowerCase())
      : -1
    // Current not in the list (external switch, stale id) starts at the first.
    const target = index >= 0 ? targets[(index + 1) % targets.length]! : targets[0]!
    if (currentId && target.id.toLowerCase() === currentId.toLowerCase()) {
      return this.markCurrent(kind, target)
    }
    return this.writeEntry(kind, target, allRoles)
  }

  dispose(): void {
    this.backend.dispose()
    this.cacheEpoch += 1
    this.listCache = null
    this.listInFlight = null
    this.currentCache.clear()
    this.currentInFlight.clear()
    this.writes.clear()
  }

  private markCurrent(kind: AudioDeviceKind, entry: AudioDeviceEntry): AudioDeviceEntry {
    const current = { ...entry, deviceKind: kind, current: true }
    this.currentCache.set(kind, { entry: current, at: this.now() })
    return cloneEntry(current)
  }

  private seedCurrent(
    kind: AudioDeviceKind,
    currentId: string | undefined,
    entries: readonly AudioDeviceEntry[],
  ): void {
    if (!currentId) return
    const entry = entries.find((candidate) => candidate.id === currentId)
    if (entry) {
      this.currentCache.set(kind, {
        entry: { ...entry, deviceKind: kind, current: true },
        at: this.now(),
      })
    }
  }

  private async writeEntry(
    kind: AudioDeviceKind,
    entry: AudioDeviceEntry,
    allRoles: boolean,
  ): Promise<AudioDeviceEntry> {
    // Invalidate any list that may be in flight before and after the write, so
    // a stale pre-write snapshot cannot repopulate the 2 s cache.
    this.cacheEpoch += 1
    this.listCache = null
    let written: AudioDeviceEntry
    try {
      written = await this.queueWrite(kind, () =>
        this.backend.setDefault(kind, entry.id, allRoles),
      )
    } catch (error) {
      const message = sanitizeAudioDeviceError(error)
      if (/device not found/i.test(message)) {
        throw new Error(`Device not found: ${entry.name}`)
      }
      throw new Error(message)
    }
    this.cacheEpoch += 1
    const normalized = { ...written, deviceKind: kind, current: true }
    this.listCache = null
    this.currentCache.set(kind, { entry: normalized, at: this.now() })
    return cloneEntry(normalized)
  }

  /**
   * Serialize writes per kind. While one write runs, newer calls replace a
   * single pending write (latest wins) and share its outcome, so fast tapping
   * cannot hammer COM while the last tap still applies.
   */
  private queueWrite(
    kind: AudioDeviceKind,
    op: () => Promise<AudioDeviceEntry>,
  ): Promise<AudioDeviceEntry> {
    const existing = this.writes.get(kind)
    return new Promise<AudioDeviceEntry>((resolve, reject) => {
      if (!existing) {
        const queue: WriteQueue = { next: null }
        this.writes.set(kind, queue)
        void this.drainWrite(kind, queue, op, [{ resolve, reject }])
        return
      }
      if (existing.next) {
        existing.next.op = op
        existing.next.waiters.push({ resolve, reject })
      } else {
        existing.next = { op, waiters: [{ resolve, reject }] }
      }
    })
  }

  private async drainWrite(
    kind: AudioDeviceKind,
    queue: WriteQueue,
    op: () => Promise<AudioDeviceEntry>,
    waiters: Waiter[],
  ): Promise<void> {
    try {
      const entry = await op()
      for (const waiter of waiters) waiter.resolve(entry)
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error)
    }

    const next = queue.next
    queue.next = null
    if (next) {
      void this.drainWrite(kind, queue, next.op, next.waiters)
      return
    }
    this.writes.delete(kind)
  }
}

export interface WindowsAudioDeviceBackendOptions {
  helperPath: string
  launch?: HelperLaunch
  transport?: AudioDeviceTransport
  logger?: Logger
}

/** JSON backend for `resources/audio-device-helper.ps1`. */
export class WindowsAudioDeviceBackend implements AudioDeviceBackend {
  private readonly transport: AudioDeviceTransport
  private disposed = false

  constructor(options: WindowsAudioDeviceBackendOptions) {
    this.transport =
      options.transport ??
      new HelperJsonlTransport({
        helperPath: options.helperPath,
        launch: options.launch ?? {
          ...windowsHelperLaunch(options.helperPath),
          label: 'PowerShell audio device helper',
        },
        ...(options.logger ? { logger: options.logger } : {}),
      })
  }

  async list(): Promise<{
    output: AudioDeviceEntry[]
    input: AudioDeviceEntry[]
    currentOutputId?: string
    currentInputId?: string
  }> {
    const payload = await this.transport.request({ command: 'list' }, AUDIO_DEVICE_LIST_TIMEOUT_MS)
    const snapshot = parseAudioDeviceListPayload(payload, Date.now())
    return {
      output: snapshot.output,
      input: snapshot.input,
      ...(snapshot.currentOutputId ? { currentOutputId: snapshot.currentOutputId } : {}),
      ...(snapshot.currentInputId ? { currentInputId: snapshot.currentInputId } : {}),
    }
  }

  async current(kind: AudioDeviceKind): Promise<AudioDeviceEntry> {
    const payload = await this.transport.request(
      { command: 'default', kind },
      AUDIO_DEVICE_CURRENT_TIMEOUT_MS,
    )
    return parseAudioDeviceDefaultPayload(payload, kind)
  }

  async setDefault(
    kind: AudioDeviceKind,
    id: string,
    allRoles: boolean,
  ): Promise<AudioDeviceEntry> {
    const payload = await this.transport.request(
      { command: 'set', kind, deviceId: id, allRoles },
      AUDIO_DEVICE_LIST_TIMEOUT_MS,
    )
    return parseAudioDeviceSetPayload(payload, kind)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.transport.dispose()
  }
}

interface PendingProbe {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface HelperJsonlTransportOptions {
  helperPath: string
  launch: HelperLaunch
  logger?: Logger
  startupTimeoutMs?: number
}

/**
 * Persistent PowerShell helper process with one JSON request per line. Keeping
 * Add-Type warm makes set/cycle fast without spawning PowerShell per press.
 */
export class HelperJsonlTransport implements AudioDeviceTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, PendingProbe>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private helperError = ''
  private nextId = 0
  private disposed = false
  private readonly startupTimeoutMs: number

  constructor(private readonly options: HelperJsonlTransportOptions) {
    this.startupTimeoutMs = Math.max(1000, options.startupTimeoutMs ?? 20_000)
  }

  async request(payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('Audio device helper is not running')
    const id = String(++this.nextId)

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.options.logger?.warn('Audio device helper timed out')
        this.kill()
        reject(new Error(`Audio device helper timed out after ${timeoutMs} ms`))
      }, Math.max(200, timeoutMs))
      timer.unref?.()

      this.pending.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.kill()
  }

  private ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Audio device helper was disposed'))
    if (this.child && !this.child.killed) return Promise.resolve()
    if (this.starting) return this.starting
    if (!this.options.helperPath) {
      return Promise.reject(new Error('Audio device helper path is not configured'))
    }
    if (!existsSync(this.options.helperPath)) {
      return Promise.reject(
        new Error(`Audio device helper not found at ${this.options.helperPath}`),
      )
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.options.launch.command, [...this.options.launch.args, '--jsonl'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      this.stdoutBuffer = ''
      this.stderrTail = ''
      this.helperError = ''

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.kill()
        reject(new Error('Audio device helper startup timed out'))
      }, this.startupTimeoutMs)
      timer.unref?.()

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) =>
        this.onStdout(chunk, () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve()
        }),
      )

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-4000)
      })

      child.once('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`Could not start ${this.options.launch.label}: ${error.message}`))
        }
        this.failAll(new Error(`Audio device helper error: ${error.message}`))
      })
      child.once('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `Audio device helper exited during startup (code ${code ?? 'unknown'}). ${this.helperError || this.stderrTail.trim()}`,
            ),
          )
        }
        if (!this.disposed) {
          this.options.logger?.warn(`Audio device helper exited with code ${code ?? 'unknown'}`)
        }
        this.child = null
        this.starting = null
        this.failAll(new Error('Audio device helper stopped unexpectedly'))
      })
    }).finally(() => {
      if (!this.child) this.starting = null
    })

    return this.starting
  }

  private onStdout(chunk: string, ready: () => void): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue

      let message: Record<string, unknown>
      try {
        const parsed = JSON.parse(line) as unknown
        const record = asRecord(parsed)
        if (!record) throw new Error('not an object')
        message = record
      } catch {
        this.options.logger?.warn(`Unexpected audio device helper output: ${line.slice(0, 200)}`)
        continue
      }

      if (message.ready === true) {
        ready()
        continue
      }
      if (message.ok === false) {
        this.helperError =
          sanitizeAudioDeviceError(message.error) || 'Audio device helper failed'
      }
      const id = typeof message.id === 'string' ? message.id : ''
      if (!id) continue
      const pending = this.pending.get(id)
      if (!pending) continue
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (message.ok === false) {
        pending.reject(
          new Error(sanitizeAudioDeviceError(message.error) || 'Audio device helper failed'),
        )
      } else {
        pending.resolve(message)
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private kill(): void {
    const child = this.child
    this.child = null
    this.starting = null
    if (child && !child.killed) {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }
    this.failAll(new Error('Audio device helper was stopped'))
  }
}

export interface AudioDeviceSourceOptions extends AudioDeviceControllerOptions {
  helperPath?: string
  backend?: AudioDeviceBackend
  transport?: AudioDeviceTransport
}

/**
 * Build the desktop audio-device controller. Windows gets a real Core Audio
 * helper; every other platform stays unsupported in this phase, with the reason
 * available through `audioDeviceUnsupportedReason`.
 */
export function createAudioDeviceController(
  platform: NodeJS.Platform,
  options: AudioDeviceSourceOptions = {},
): AudioDeviceController | null {
  if (platform !== 'win32') return null

  const backend =
    options.backend ??
    new WindowsAudioDeviceBackend({
      helperPath: options.helperPath ?? '',
      ...(options.transport ? { transport: options.transport } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    })
  return new CachedAudioDeviceController(backend, options)
}
