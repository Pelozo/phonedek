import { spawnSync } from 'node:child_process'
import type { AppVolumeMatch, MixerSession, MixerSnapshot } from '@phonedek/shared'
import { runCommandCapture, type CommandRunner } from './volume-source'
import type { Logger } from './logger'

/** One live audio session exposed by the mixer/state layer. */
export interface AppSession {
  /** Opaque desktop id, stable while the session lives. */
  id: string
  /** Normalized process/application name used for matching. */
  process: string
  /** Human-readable application or media name. */
  name: string
  /** 0..100 integer percent. */
  volume: number
  muted: boolean
  available?: boolean
}

export interface AppSessionMatch {
  session: AppSession | null
  /** Number of sessions that matched before picking the first. */
  count: number
  ambiguous: boolean
}

export interface AppVolumeReading {
  /** 0..100 integer percent. */
  level: number
  muted: boolean
  /** True when more than one session matched. */
  ambiguous?: boolean
  sessionCount?: number
  sessionId?: string
}

/** Read side used by `control-state-v1`; injected so tests stay offline. */
export interface AppVolumeReader {
  read(match: AppVolumeMatch): Promise<AppVolumeReading>
  listSessions?(): Promise<AppSession[]>
  invalidate(match?: AppVolumeMatch): void
  setKnown?(match: AppVolumeMatch, reading: AppVolumeReading): void
}

/** Platform adapter: enumerate sessions and write by opaque session id. */
export interface AppVolumeBackend {
  listSessions(): Promise<AppSession[]>
  setVolume(id: string, level: number): Promise<void>
  setMute(id: string, muted: boolean): Promise<void>
}

export const LINUX_SINK_INPUT_COMMAND = 'pactl'

export function linuxListSinkInputsArgs(): string[] {
  return ['list', 'sink-inputs']
}

export function linuxSinkInputVolumeArgs(id: string, level: number): string[] {
  return ['set-sink-input-volume', id, `${level}%`]
}

export function linuxSinkInputMuteArgs(id: string, muted: boolean): string[] {
  return ['set-sink-input-mute', id, muted ? '1' : '0']
}

/** Normalize a process/application name for case-insensitive matching. */
export function normalizeAppName(value: string): string {
  const base = value.trim().split(/[\\/]/).pop() ?? value.trim()
  return base.replace(/\.exe$/i, '').trim().toLowerCase()
}

export function appMatchKey(match: AppVolumeMatch): string {
  return normalizeAppName(match.process ?? '')
}

/** Pick the first session whose process or display name matches. */
export function matchAppSessions(
  sessions: readonly AppSession[],
  match: AppVolumeMatch,
): AppSessionMatch {
  const wanted = match.process?.trim() ? normalizeAppName(match.process) : ''
  if (!wanted) return { session: null, count: 0, ambiguous: false }
  const candidates = sessions.filter(
    (session) =>
      normalizeAppName(session.process) === wanted || normalizeAppName(session.name) === wanted,
  )
  return {
    session: candidates[0] ?? null,
    count: candidates.length,
    ambiguous: candidates.length > 1,
  }
}

export function clampAppLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error('App volume must be a finite number')
  return Math.max(0, Math.min(100, Math.round(level)))
}

function normalizeSession(raw: unknown, index: number): AppSession {
  const candidate = (raw ?? {}) as Record<string, unknown>
  const process = typeof candidate.process === 'string' ? candidate.process.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const rawVolume = Number(candidate.volume)
  const scalar = Number.isFinite(rawVolume)
    ? rawVolume > 1
      ? rawVolume / 100
      : rawVolume
    : 1
  const id =
    typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id.trim()
      : `session:${index}:${process || 'unknown'}`
  return {
    id: id.slice(0, 512),
    process: process || normalizeAppName(name) || `session-${index}`,
    name: name || process || `Audio session ${index + 1}`,
    volume: Math.round(Math.max(0, Math.min(1, scalar)) * 100),
    muted: candidate.muted === true,
    available: candidate.available !== false,
  }
}

/** Parse the Windows helper's `sessions` payload (scalar 0..1 volume). */
export function parseWindowsAudioSessions(payload: unknown): AppSession[] {
  const list = Array.isArray(payload)
    ? payload
    : (payload as { sessions?: unknown } | null | undefined)?.sessions
  if (!Array.isArray(list)) {
    throw new Error('Windows audio-session probe returned no session list')
  }
  return list.map((raw, index) => normalizeSession(raw, index))
}

/**
 * Parse `pactl list sink-inputs` text into sessions.
 *
 * Matching uses `application.process.binary` first, then `application.name`,
 * so both `firefox` and `Firefox` select the same session. `id` is the Pactl
 * sink-input index.
 */
export function parsePactlSinkInputs(raw: string): AppSession[] {
  const blocks = raw.split(/\n(?=Sink Input #\d+)/)
  const sessions: AppSession[] = []
  for (const block of blocks) {
    const header = /^\s*Sink Input #(\d+)/m.exec(block)
    if (!header) continue
    const id = header[1]!
    const readProperty = (name: string): string => {
      const match = new RegExp(`^\\s*${name.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(
        block,
      )
      return match?.[1]?.trim() ?? ''
    }
    const applicationName = readProperty('application.name')
    const binary = readProperty('application.process.binary')
    const mediaName = readProperty('media.name')
    const process = normalizeAppName(binary || applicationName || mediaName) || `sink-input-${id}`
    const name = applicationName || mediaName || binary || `Sink input ${id}`
    const volumeMatch = /Volume:[\s\S]*?(\d{1,3})\s*%/.exec(block)
    const muteMatch = /Mute:\s*(yes|no)/i.exec(block)
    sessions.push({
      id,
      process,
      name,
      volume: volumeMatch ? Math.max(0, Math.min(100, Number(volumeMatch[1]))) : 100,
      muted: muteMatch ? muteMatch[1]!.toLowerCase() === 'yes' : false,
      available: true,
    })
  }
  return sessions
}

function commandAvailable(command: string): boolean {
  try {
    return spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

async function runChecked(
  run: CommandRunner,
  command: string,
  args: string[],
): Promise<string> {
  const result = await run(command, args)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `${command} exited with ${result.code}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
  return result.stdout
}

/** Adapter for the persistent Windows helper probe (never the keyboard queue). */
export interface WindowsAppVolumeTransport {
  listAudioSessions(): Promise<{ sessions?: unknown } | unknown[]>
  setAppVolume(id: string, level: number): Promise<void>
  setAppMute(id: string, muted: boolean): Promise<void>
}

export function createWindowsAppVolumeBackend(
  transport: WindowsAppVolumeTransport,
): AppVolumeBackend {
  return {
    async listSessions() {
      return parseWindowsAudioSessions(await transport.listAudioSessions())
    },
    async setVolume(id, level) {
      await transport.setAppVolume(id, clampAppLevel(level))
    },
    async setMute(id, muted) {
      await transport.setAppMute(id, muted)
    },
  }
}

export interface LinuxAppVolumeOptions {
  runCommand?: CommandRunner
  isCommandAvailable?: (command: string) => boolean
}

export function createLinuxAppVolumeBackend(
  options: LinuxAppVolumeOptions = {},
): AppVolumeBackend {
  const run = options.runCommand ?? runCommandCapture
  return {
    async listSessions() {
      try {
        const stdout = await runChecked(run, LINUX_SINK_INPUT_COMMAND, linuxListSinkInputsArgs())
        return parsePactlSinkInputs(stdout)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Could not list per-app audio with pactl. Install PulseAudio/PipeWire and ensure "pactl" is on PATH. ${detail}`,
        )
      }
    },
    async setVolume(id, level) {
      try {
        await runChecked(
          run,
          LINUX_SINK_INPUT_COMMAND,
          linuxSinkInputVolumeArgs(id, clampAppLevel(level)),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Could not set per-app volume with pactl. ${detail}`)
      }
    },
    async setMute(id, muted) {
      try {
        await runChecked(
          run,
          LINUX_SINK_INPUT_COMMAND,
          linuxSinkInputMuteArgs(id, muted),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Could not set per-app mute with pactl. ${detail}`)
      }
    },
  }
}

export interface AppVolumeSourceOptions {
  /** Windows helper transport; omitted on win32 means no mixer support. */
  windowsTransport?: WindowsAppVolumeTransport
  /** Test seams for Linux. */
  runCommand?: CommandRunner
  isCommandAvailable?: (command: string) => boolean
  /** Session-list cache TTL; slightly under the 1 Hz idle poll. */
  ttlMs?: number
  now?: () => number
  logger?: Logger
}

/**
 * Cached, single-flighted per-app audio controller.
 *
 * - One session enumeration serves every control on a page (~900 ms TTL).
 * - Reads pick the first matching session and report ambiguity.
 * - Absolute volume/mute writes are latest-wins per match key: while one write
 *   is in flight, intermediate slider values collapse into the newest one.
 * - `toggleMute` reads the live host state before flipping it.
 */
export class AppVolumeSource implements AppVolumeReader {
  private readonly backend: AppVolumeBackend
  private readonly logger?: Logger
  private readonly now: () => number
  private readonly ttlMs: number
  private cached: { sessions: AppSession[]; at: number } | null = null
  private inFlight: Promise<AppSession[]> | null = null
  private readonly volumeLoops = new Map<string, Promise<void>>()
  private readonly pendingVolume = new Map<string, number>()
  private readonly muteLoops = new Map<string, Promise<void>>()
  private readonly pendingMute = new Map<string, boolean>()

  constructor(backend: AppVolumeBackend, options: AppVolumeSourceOptions = {}) {
    this.backend = backend
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.ttlMs = Math.max(0, options.ttlMs ?? 900)
  }

  listSessions(): Promise<AppSession[]> {
    const at = this.now()
    if (this.cached && at - this.cached.at < this.ttlMs) {
      return Promise.resolve(this.cached.sessions.map((session) => ({ ...session })))
    }
    if (this.inFlight) return this.inFlight

    const pending = (async (): Promise<AppSession[]> => {
      const sessions = (await this.backend.listSessions()).map((session) => ({
        ...session,
        volume: clampAppLevel(session.volume),
      }))
      this.cached = { sessions, at: this.now() }
      return sessions.map((session) => ({ ...session }))
    })()
    this.inFlight = pending.finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  async read(match: AppVolumeMatch): Promise<AppVolumeReading> {
    const found = matchAppSessions(await this.listSessions(), match)
    this.reportAmbiguity(match, found)
    if (!found.session) {
      throw new Error(`No audio session matches "${match.process?.trim() || 'the requested app'}".`)
    }
    return {
      level: found.session.volume,
      muted: found.session.muted,
      sessionId: found.session.id,
      sessionCount: found.count,
      ...(found.ambiguous ? { ambiguous: true } : {}),
    }
  }

  async snapshot(): Promise<MixerSnapshot> {
    try {
      const sessions = await this.listSessions()
      const counts = new Map<string, number>()
      for (const session of sessions) {
        const key = normalizeAppName(session.process)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const ambiguous = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([process]) => process)
      return {
        available: true,
        sessions: sessions.map(
          (session): MixerSession => ({
            id: session.id,
            process: session.process,
            name: session.name,
            volume: session.volume,
            muted: session.muted,
            available: session.available ?? true,
          }),
        ),
        ...(ambiguous.length > 0 ? { ambiguous } : {}),
        updatedAt: this.now(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Mixer snapshot failed: ${message}`)
      return {
        available: false,
        sessions: [],
        reason: message.slice(0, 300),
        updatedAt: this.now(),
      }
    }
  }

  invalidate(): void {
    this.cached = null
  }

  /** Trust a value the phone just wrote until the next real enumeration. */
  setKnown(match: AppVolumeMatch, reading: AppVolumeReading): void {
    if (!this.cached) return
    const found = matchAppSessions(this.cached.sessions, match)
    if (!found.session) return
    found.session.volume = clampAppLevel(reading.level)
    found.session.muted = reading.muted
    this.cached.at = this.now()
  }

  /** Latest-wins write of one matched session's volume (0..100). */
  setVolume(match: AppVolumeMatch, level: number): Promise<void> {
    const value = clampAppLevel(level)
    const key = appMatchKey(match)
    this.pendingVolume.set(key, value)
    const running = this.volumeLoops.get(key)
    if (running) return running

    const loop = (async (): Promise<void> => {
      try {
        while (this.pendingVolume.has(key)) {
          const next = this.pendingVolume.get(key)!
          this.pendingVolume.delete(key)
          await this.applyVolume(match, next)
        }
      } finally {
        this.volumeLoops.delete(key)
      }
    })()
    this.volumeLoops.set(key, loop)
    return loop
  }

  /** Latest-wins volume write by mixer session id. */
  setVolumeById(id: string, level: number): Promise<void> {
    const value = clampAppLevel(level)
    const key = `id:${id}`
    this.pendingVolume.set(key, value)
    const running = this.volumeLoops.get(key)
    if (running) return running

    const loop = (async (): Promise<void> => {
      try {
        while (this.pendingVolume.has(key)) {
          const next = this.pendingVolume.get(key)!
          this.pendingVolume.delete(key)
          await this.applyVolumeById(id, next)
        }
      } finally {
        this.volumeLoops.delete(key)
      }
    })()
    this.volumeLoops.set(key, loop)
    return loop
  }

  /** Latest-wins mute write per matched session. */
  setMute(match: AppVolumeMatch, muted: boolean): Promise<void> {
    const key = appMatchKey(match)
    this.pendingMute.set(key, muted)
    const running = this.muteLoops.get(key)
    if (running) return running

    const loop = (async (): Promise<void> => {
      try {
        while (this.pendingMute.has(key)) {
          const next = this.pendingMute.get(key)!
          this.pendingMute.delete(key)
          await this.applyMute(match, next)
        }
      } finally {
        this.muteLoops.delete(key)
      }
    })()
    this.muteLoops.set(key, loop)
    return loop
  }

  setMuteById(id: string, muted: boolean): Promise<void> {
    const key = `id:${id}`
    this.pendingMute.set(key, muted)
    const running = this.muteLoops.get(key)
    if (running) return running

    const loop = (async (): Promise<void> => {
      try {
        while (this.pendingMute.has(key)) {
          const next = this.pendingMute.get(key)!
          this.pendingMute.delete(key)
          await this.applyMuteById(id, next)
        }
      } finally {
        this.muteLoops.delete(key)
      }
    })()
    this.muteLoops.set(key, loop)
    return loop
  }

  /** Read the live host state, flip it, and return the applied reading. */
  async toggleMute(match: AppVolumeMatch): Promise<AppVolumeReading> {
    this.invalidate()
    const current = await this.read(match)
    const muted = !current.muted
    await this.setMute(match, muted)
    return { ...current, muted }
  }

  private async applyVolume(match: AppVolumeMatch, level: number): Promise<void> {
    const found = matchAppSessions(await this.listSessions(), match)
    this.reportAmbiguity(match, found)
    if (!found.session) {
      throw new Error(`No audio session matches "${match.process?.trim() || 'the requested app'}".`)
    }
    await this.backend.setVolume(found.session.id, level)
    this.patch(found.session.id, { volume: level })
  }

  private async applyVolumeById(id: string, level: number): Promise<void> {
    const session = await this.requireSession(id)
    await this.backend.setVolume(session.id, level)
    this.patch(session.id, { volume: level })
  }

  private async applyMute(match: AppVolumeMatch, muted: boolean): Promise<void> {
    const found = matchAppSessions(await this.listSessions(), match)
    this.reportAmbiguity(match, found)
    if (!found.session) {
      throw new Error(`No audio session matches "${match.process?.trim() || 'the requested app'}".`)
    }
    await this.backend.setMute(found.session.id, muted)
    this.patch(found.session.id, { muted })
  }

  private async applyMuteById(id: string, muted: boolean): Promise<void> {
    const session = await this.requireSession(id)
    await this.backend.setMute(session.id, muted)
    this.patch(session.id, { muted })
  }

  private async requireSession(id: string): Promise<AppSession> {
    const sessions = await this.listSessions()
    const session = sessions.find((candidate) => candidate.id === id)
    if (!session) throw new Error('That audio session is no longer available.')
    return session
  }

  private patch(id: string, fields: Partial<Pick<AppSession, 'volume' | 'muted'>>): void {
    if (!this.cached) return
    const session = this.cached.sessions.find((candidate) => candidate.id === id)
    if (!session) return
    if (fields.volume !== undefined) session.volume = fields.volume
    if (fields.muted !== undefined) session.muted = fields.muted
    this.cached.at = this.now()
  }

  private reportAmbiguity(match: AppVolumeMatch, found: AppSessionMatch): void {
    if (!found.ambiguous) return
    this.logger?.warn(
      `Multiple audio sessions match "${match.process ?? ''}" (${found.count}); using "${found.session?.name ?? 'the first'}".`,
    )
  }
}

/**
 * Build the platform mixer, or null when the host cannot control per-app audio.
 * macOS intentionally returns null: there is no public per-app volume API
 * without a virtual audio driver.
 */
export function createAppVolumeSource(
  platform: NodeJS.Platform,
  options: AppVolumeSourceOptions = {},
): AppVolumeSource | null {
  if (platform === 'win32') {
    if (!options.windowsTransport) return null
    return new AppVolumeSource(createWindowsAppVolumeBackend(options.windowsTransport), options)
  }
  if (platform === 'linux') {
    const available = options.isCommandAvailable ?? commandAvailable
    if (!options.runCommand && !available(LINUX_SINK_INPUT_COMMAND)) return null
    return new AppVolumeSource(createLinuxAppVolumeBackend(options), options)
  }
  return null
}
