import { spawnSync } from 'node:child_process'
import { runCommandCapture, type CommandRunner } from './volume-source'

/** Default capture-device gain, as an integer percent plus optional mute flag. */
export interface MicReading {
  /** 0..100 integer percent, matching the helper's 0..1 scalar. */
  level: number
  muted?: boolean
}

/** A cached, single-flighted microphone source used by control state. */
export interface MicReader {
  read(): Promise<MicReading>
  /** Drop the cached reading; the next read asks the OS. */
  invalidate(): void
  /** Trust a value just written by the phone until the next real poll. */
  setKnown?(reading: MicReading): void
}

/** A microphone source that can also apply phone writes. */
export interface Microphone extends MicReader {
  setGain(level: number): Promise<void>
  /** Toggle mute and return the state the host applied. */
  toggleMute(): Promise<MicReading>
}

interface MicBackend {
  read(): Promise<MicReading>
  setGain(level: number): Promise<void>
  setMute(muted: boolean): Promise<void>
}

export const MAC_INPUT_COMMAND = '/usr/bin/osascript'

export function macInputGainArgs(level: number): string[] {
  return ['-e', `set volume input volume ${level}`]
}

/** Read the input gain only; macOS has no `input muted` property. */
export function macInputReadArgs(): string[] {
  return ['-e', 'input volume of (get volume settings)']
}

export const LINUX_INPUT_COMMAND = 'pactl'

export function linuxInputGainArgs(level: number): string[] {
  return ['set-source-volume', '@DEFAULT_SOURCE@', `${level}%`]
}

export function linuxInputVolumeReadArgs(): string[] {
  return ['get-source-volume', '@DEFAULT_SOURCE@']
}

export function linuxInputMuteReadArgs(): string[] {
  return ['get-source-mute', '@DEFAULT_SOURCE@']
}

export function linuxInputMuteArgs(muted: boolean): string[] {
  return ['set-source-mute', '@DEFAULT_SOURCE@', muted ? '1' : '0']
}

export function clampMicLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error('Microphone gain must be a finite number')
  return Math.max(0, Math.min(100, Math.round(level)))
}

/** Parse the integer macOS returns for `input volume of (get volume settings)`. */
export function parseMacInputOutput(raw: string): number {
  const match = /^\s*(\d{1,3})\s*$/.exec(raw.trim())
  if (!match) throw new Error(`Could not parse macOS input volume output: ${raw.trim().slice(0, 80)}`)
  return Math.max(0, Math.min(100, Number(match[1])))
}

/** Parse the first `NN%` from `pactl get-source-volume` output. */
export function parsePactlSourceVolumeOutput(raw: string): number {
  const match = /(\d{1,3})\s*%/.exec(raw)
  if (!match) throw new Error(`Could not parse pactl source volume output: ${raw.trim().slice(0, 120)}`)
  return Math.max(0, Math.min(100, Number(match[1])))
}

/** Parse `Mute: yes` from `pactl get-source-mute`. */
export function parsePactlSourceMuteOutput(raw: string): boolean {
  const match = /Mute:\s*(yes|no)/i.exec(raw)
  if (!match) throw new Error(`Could not parse pactl source mute output: ${raw.trim().slice(0, 120)}`)
  return match[1]!.toLowerCase() === 'yes'
}

/** Convert the helper's 0..1 capture scalar into a 0..100 percent reading. */
export function parseWindowsInputPayload(payload: { value?: unknown; muted?: unknown }): MicReading {
  const scalar = Number(payload.value)
  if (!Number.isFinite(scalar)) throw new Error('Windows microphone probe returned no gain')
  return {
    level: Math.round(Math.max(0, Math.min(1, scalar)) * 100),
    ...(typeof payload.muted === 'boolean' ? { muted: payload.muted } : {}),
  }
}

function commandAvailable(command: string): boolean {
  try {
    return spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

async function runChecked(run: CommandRunner, command: string, args: string[]): Promise<string> {
  const result = await run(command, args)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `${command} exited with ${result.code}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
  return result.stdout
}

/** Cache a microphone reader for slightly under the 1 Hz idle poll. */
export class CachedMicrophone implements Microphone {
  private cached: { reading: MicReading; at: number } | null = null
  private inFlight: Promise<MicReading> | null = null
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly backend: MicBackend,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 900)
    this.now = options.now ?? Date.now
  }

  read(): Promise<MicReading> {
    const now = this.now()
    if (this.cached && now - this.cached.at < this.ttlMs) {
      return Promise.resolve({ ...this.cached.reading })
    }
    if (this.inFlight) return this.inFlight

    const pending = (async (): Promise<MicReading> => {
      const reading = normalizeReading(await this.backend.read())
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

  setKnown(reading: MicReading): void {
    this.cached = { reading: normalizeReading(reading), at: this.now() }
  }

  async setGain(level: number): Promise<void> {
    await this.backend.setGain(clampMicLevel(level))
    this.invalidate()
  }

  async toggleMute(): Promise<MicReading> {
    // Read the real host state, not a stale poll, before flipping it.
    this.invalidate()
    const current = await this.read()
    await this.backend.setMute(!(current.muted ?? false))
    // Read back so emulated mute (macOS restores a saved gain) and OS
    // rounding are reflected exactly.
    this.invalidate()
    return this.read()
  }
}

function normalizeReading(reading: MicReading): MicReading {
  return {
    level: clampMicLevel(reading.level),
    ...(reading.muted === undefined ? {} : { muted: reading.muted }),
  }
}

export interface MicrophoneOptions {
  /** Test seam; omitted = a short-lived process capture. */
  runCommand?: CommandRunner
  /** Windows capture endpoint adapter backed by the keyboard/volume helper. */
  windows?: MicBackend
  ttlMs?: number
  now?: () => number
  /** Test seam for the Linux `pactl` availability check. */
  isCommandAvailable?: (command: string) => boolean
}

function linuxMicError(platformMessage: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(
    `${platformMessage} Install PulseAudio/PipeWire and ensure "pactl" is on PATH. ${detail}`,
  )
}

/**
 * Build a default-capture-device controller, or null when the platform has no
 * microphone backend. A missing device still returns a controller; reads then
 * throw a clear error and control state reports `available: false`.
 */
export function createMicrophone(
  platform: NodeJS.Platform,
  options: MicrophoneOptions = {},
): Microphone | null {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs

  if (platform === 'win32') {
    if (!options.windows) return null
    return new CachedMicrophone(options.windows, { ttlMs, now })
  }

  if (platform === 'darwin') {
    const run = options.runCommand ?? runCommandCapture
    // macOS has no system input mute. Mute is emulated: remember the gain,
    // set it to 0, and restore it on unmute. Apps with their own mute (Zoom,
    // Meet) and per-app capture are not reflected here.
    let muted = false
    let savedLevel = 50
    let lastLevel = 50

    const readMac = async (): Promise<MicReading> => {
      const stdout = await runChecked(run, MAC_INPUT_COMMAND, macInputReadArgs())
      lastLevel = parseMacInputOutput(stdout)
      return { level: lastLevel, muted }
    }
    const setMacGain = async (level: number): Promise<void> => {
      const value = clampMicLevel(level)
      await runChecked(run, MAC_INPUT_COMMAND, macInputGainArgs(value))
      lastLevel = value
      muted = false
    }
    const setMacMute = async (value: boolean): Promise<void> => {
      if (value === muted) return
      if (value) {
        const current = await readMac()
        savedLevel = current.level > 0 ? current.level : lastLevel > 0 ? lastLevel : 50
        await runChecked(run, MAC_INPUT_COMMAND, macInputGainArgs(0))
        muted = true
      } else {
        await runChecked(run, MAC_INPUT_COMMAND, macInputGainArgs(savedLevel))
        muted = false
      }
    }

    return new CachedMicrophone(
      { read: readMac, setGain: setMacGain, setMute: setMacMute },
      { ttlMs, now },
    )
  }

  if (platform === 'linux') {
    const available = options.isCommandAvailable ?? commandAvailable
    if (!options.runCommand && !available(LINUX_INPUT_COMMAND)) return null
    const run = options.runCommand ?? runCommandCapture
    const backend: MicBackend = {
      async read() {
        let volumeOutput: string
        let muteOutput: string
        try {
          volumeOutput = await runChecked(run, LINUX_INPUT_COMMAND, linuxInputVolumeReadArgs())
          muteOutput = await runChecked(run, LINUX_INPUT_COMMAND, linuxInputMuteReadArgs())
        } catch (error) {
          throw linuxMicError('Could not read the default microphone.', error)
        }
        return {
          level: parsePactlSourceVolumeOutput(volumeOutput),
          muted: parsePactlSourceMuteOutput(muteOutput),
        }
      },
      async setGain(level) {
        try {
          await runChecked(run, LINUX_INPUT_COMMAND, linuxInputGainArgs(clampMicLevel(level)))
        } catch (error) {
          throw linuxMicError('Could not set microphone gain with pactl.', error)
        }
      },
      async setMute(value) {
        try {
          await runChecked(run, LINUX_INPUT_COMMAND, linuxInputMuteArgs(value))
        } catch (error) {
          throw linuxMicError('Could not set microphone mute with pactl.', error)
        }
      },
    }
    return new CachedMicrophone(backend, { ttlMs, now })
  }

  return null
}
