import { existsSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { windowsHelperLaunch, type HelperLaunch } from './key-sender'
import type { Logger } from './logger'

/** System output volume reading, as an integer percent plus optional mute flag. */
export interface VolumeReading {
  /** 0..100 integer percent, matching `HostActions.setVolume`. */
  level: number
  muted?: boolean
}

/** A cached, single-flighted volume source. */
export interface VolumeReader {
  read(): Promise<VolumeReading>
  /** Drop the cached reading; the next read asks the OS. */
  invalidate(): void
  /** Trust a value just written by the phone until the next real poll. */
  setKnown?(reading: VolumeReading): void
}

export interface CommandResult {
  stdout: string
  stderr: string
  code: number
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

export const MAC_VOLUME_READ_COMMAND = '/usr/bin/osascript'
export function macVolumeReadArgs(): string[] {
  return [
    '-e',
    'set s to get volume settings',
    '-e',
    'return (output volume of s as text) & "," & (output muted of s as string)',
  ]
}

export const LINUX_VOLUME_READ_COMMAND = 'pactl'
export function linuxVolumeReadArgs(): string[] {
  return ['get-sink-volume', '@DEFAULT_SINK@']
}
export function linuxMuteReadArgs(): string[] {
  return ['get-sink-mute', '@DEFAULT_SINK@']
}

/** Parse `"42,false"` (or two lines) from the macOS AppleScript probe. */
export function parseMacVolumeOutput(raw: string): VolumeReading {
  const match = /^\s*(\d{1,3})\s*(?:,\s*(true|false|yes|no))?\s*$/i.exec(raw.trim())
  if (!match) throw new Error(`Could not parse macOS volume output: ${raw.trim().slice(0, 80)}`)
  const level = Math.max(0, Math.min(100, Number(match[1])))
  const muteText = match[2]?.toLowerCase()
  return {
    level,
    ...(muteText === undefined ? {} : { muted: muteText === 'true' || muteText === 'yes' }),
  }
}

/** Parse the first `NN%` from `pactl get-sink-volume` output. */
export function parsePactlVolumeOutput(raw: string): VolumeReading {
  const match = /(\d{1,3})\s*%/.exec(raw)
  if (!match) throw new Error(`Could not parse pactl volume output: ${raw.trim().slice(0, 120)}`)
  return { level: Math.max(0, Math.min(100, Number(match[1]))) }
}

/** Parse `Mute: yes` from `pactl get-sink-mute`. */
export function parsePactlMuteOutput(raw: string): boolean {
  const match = /Mute:\s*(yes|no)/i.exec(raw)
  if (!match) throw new Error(`Could not parse pactl mute output: ${raw.trim().slice(0, 120)}`)
  return match[1]!.toLowerCase() === 'yes'
}

/** Convert the helper's 0..1 Core Audio scalar into a 0..100 percent reading. */
export function parseWindowsVolumePayload(payload: { value?: unknown; muted?: unknown }): VolumeReading {
  const scalar = Number(payload.value)
  if (!Number.isFinite(scalar)) throw new Error('Windows volume probe returned no level')
  return {
    level: Math.round(Math.max(0, Math.min(1, scalar)) * 100),
    ...(typeof payload.muted === 'boolean' ? { muted: payload.muted } : {}),
  }
}

/** Run a short-lived probe and capture stdout/stderr without a shell. */
export function runCommandCapture(
  command: string,
  args: string[],
  timeoutMs = 2000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      reject(new Error(`${command} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-4000)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start ${command}: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}

function commandAvailable(command: string): boolean {
  try {
    return spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Cache a reader for slightly under the 1 Hz idle poll and share in-flight reads. */
export class CachedVolumeReader implements VolumeReader {
  private cached: { reading: VolumeReading; at: number } | null = null
  private inFlight: Promise<VolumeReading> | null = null
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly source: () => Promise<VolumeReading>,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 900)
    this.now = options.now ?? Date.now
  }

  read(): Promise<VolumeReading> {
    const now = this.now()
    if (this.cached && now - this.cached.at < this.ttlMs) {
      return Promise.resolve({ ...this.cached.reading })
    }
    if (this.inFlight) return this.inFlight

    const pending = (async (): Promise<VolumeReading> => {
      const reading = normalizeReading(await this.source())
      this.cached = { reading, at: this.now() }
      return { ...reading }
    })()
    this.inFlight = pending.finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  invalidate(): void {
    this.cached = null
  }

  setKnown(reading: VolumeReading): void {
    this.cached = { reading: normalizeReading(reading), at: this.now() }
  }
}

function normalizeReading(reading: VolumeReading): VolumeReading {
  if (!Number.isFinite(reading.level)) throw new Error('Volume reader returned no level')
  return {
    level: Math.max(0, Math.min(100, Math.round(reading.level))),
    ...(reading.muted === undefined ? {} : { muted: reading.muted }),
  }
}

export interface VolumeReaderOptions {
  /** Test seam; omitted = a short-lived process capture. */
  runCommand?: CommandRunner
  /** Windows dedicated helper probe. Without it Windows has no reader. */
  windowsRead?: () => Promise<VolumeReading>
  ttlMs?: number
  now?: () => number
  /** Test seam for the Linux `pactl` availability check. */
  isCommandAvailable?: (command: string) => boolean
}

/**
 * Build a platform reader, or null when this host cannot read system volume.
 * Windows requires the dedicated JSONL probe; Linux requires `pactl`; macOS
 * uses the built-in `osascript`.
 */
export function createVolumeReader(
  platform: NodeJS.Platform,
  options: VolumeReaderOptions = {},
): VolumeReader | null {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs
  if (platform === 'win32') {
    if (!options.windowsRead) return null
    const read = options.windowsRead
    return new CachedVolumeReader(read, { ttlMs, now })
  }

  if (platform === 'darwin') {
    const run = options.runCommand ?? runCommandCapture
    return new CachedVolumeReader(async () => {
      const stdout = await runChecked(run, MAC_VOLUME_READ_COMMAND, macVolumeReadArgs())
      return parseMacVolumeOutput(stdout)
    }, { ttlMs, now })
  }

  if (platform === 'linux') {
    const available = options.isCommandAvailable ?? commandAvailable
    if (!options.runCommand && !available(LINUX_VOLUME_READ_COMMAND)) return null
    const run = options.runCommand ?? runCommandCapture
    return new CachedVolumeReader(async () => {
      const volumeOutput = await runChecked(run, LINUX_VOLUME_READ_COMMAND, linuxVolumeReadArgs())
      const reading = parsePactlVolumeOutput(volumeOutput)
      try {
        const muteOutput = await runChecked(run, LINUX_VOLUME_READ_COMMAND, linuxMuteReadArgs())
        reading.muted = parsePactlMuteOutput(muteOutput)
      } catch {
        // Mute is optional; volume readback still works without it.
      }
      return reading
    }, { ttlMs, now })
  }

  return null
}

interface ProbeCommand {
  resolve: (payload: { value?: unknown; muted?: unknown }) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Dedicated persistent Windows helper used only for `get-volume` probes.
 *
 * A second helper instance is deliberate: a macro can be sleeping inside a
 * `delay` step without delaying the volume read. The state service caches and
 * single-flights calls, so this process stays idle unless a phone is watching.
 */
export class HelperVolumeProbe {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, ProbeCommand>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private nextId = 0
  private disposed = false

  constructor(
    private readonly helperPath: string,
    private readonly logger?: Logger,
    private readonly launch: HelperLaunch = windowsHelperLaunch(helperPath),
    private readonly timeoutMs = 2000,
  ) {}

  async read(): Promise<VolumeReading> {
    const payload = await this.sendStep({ kind: 'get-volume' })
    return parseWindowsVolumePayload(payload)
  }

  dispose(): void {
    this.disposed = true
    this.kill()
  }

  private async sendStep(step: object): Promise<{ value?: unknown; muted?: unknown }> {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('Volume probe helper is not running')
    const id = String(++this.nextId)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.logger?.warn('Volume probe timed out')
        // A dedicated probe can be restarted safely; the keyboard helper is
        // never touched by this timeout.
        this.kill()
        reject(new Error('Volume probe timed out'))
      }, this.timeoutMs)
      timer.unref?.()

      this.pending.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(`${JSON.stringify({ id, steps: [step] })}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Volume probe was disposed'))
    if (this.child && !this.child.killed) return Promise.resolve()
    if (this.starting) return this.starting
    if (!existsSync(this.helperPath)) {
      return Promise.reject(new Error(`Volume probe helper not found at ${this.helperPath}`))
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.launch.command, this.launch.args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      this.stdoutBuffer = ''
      this.stderrTail = ''

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.kill()
        reject(new Error('Volume probe helper startup timed out'))
      }, 20_000)
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
          reject(new Error(`Could not start ${this.launch.label}: ${error.message}`))
        }
        this.failAll(new Error(`Volume probe helper error: ${error.message}`))
      })
      child.once('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `Volume probe helper exited during startup (code ${code ?? 'unknown'}). ${this.stderrTail.trim()}`,
            ),
          )
        }
        if (!this.disposed) {
          this.logger?.warn(`Volume probe helper exited with code ${code ?? 'unknown'}`)
        }
        this.child = null
        this.starting = null
        this.failAll(new Error('Volume probe helper stopped unexpectedly'))
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
      let message: {
        ready?: boolean
        id?: string
        ok?: boolean
        error?: string
        value?: unknown
        muted?: unknown
      }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        this.logger?.warn(`Unexpected volume probe output: ${line.slice(0, 200)}`)
        continue
      }
      if (message.ready) {
        ready()
        continue
      }
      if (!message.id) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve({ value: message.value, muted: message.muted })
      else pending.reject(new Error(message.error ?? 'Volume probe failed'))
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
    this.failAll(new Error('Volume probe helper was stopped'))
  }
}

export { errorMessage }
