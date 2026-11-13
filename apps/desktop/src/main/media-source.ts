import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { runCommandCapture, type CommandRunner } from './volume-source'
import type { Logger } from './logger'

/**
 * Active media session readback for the media scrub control (A3).
 *
 * The source is deliberately read-only apart from a direct seek: seeks never
 * travel through the keyboard executor queue, so a long macro cannot delay a
 * scrub. Linux uses `playerctl`/MPRIS, macOS uses AppleScript for Spotify and
 * Music only, and Windows uses a dedicated persistent SMTC probe.
 */
export interface MediaReading {
  /** Elapsed position in milliseconds. */
  positionMs: number
  /** Total duration in milliseconds; 0 for live/unknown streams. */
  durationMs: number
  playing: boolean
  title?: string
  artist?: string
}

/** A cached, single-flighted media reader. `null` means no active player. */
export interface MediaReader {
  read(): Promise<MediaReading | null>
  /** Drop the cached reading; the next read asks the OS. */
  invalidate(): void
  /** Trust a position just written by the phone until the next real poll. */
  setKnown?(reading: MediaReading): void
}

/** Reader plus seek writes for the media scrub control. */
export interface MediaController extends MediaReader {
  /** Seek to a normalized 0..1 position; returns the applied position in ms. */
  seekFraction(fraction: number): Promise<number>
  /** Seek to an absolute position; returns the clamped position in ms. */
  seekMs(positionMs: number): Promise<number>
}

/** A platform media backend. `read()` returns null when no session exists. */
export interface MediaBackend {
  read(): Promise<MediaReading | null>
  seekMs?(positionMs: number): Promise<void>
}

export const LINUX_MEDIA_COMMAND = 'playerctl'
export const MAC_MEDIA_COMMAND = '/usr/bin/osascript'

/**
 * One `playerctl metadata` call returns status, position and length together.
 * Position/length are microseconds; title/artist are the MPRIS fields.
 */
export const PLAYERCTL_MEDIA_FORMAT = [
  '{{status}}',
  '{{position}}',
  '{{mpris:length}}',
  '{{title}}',
  '{{artist}}',
].join('\t')

export function linuxMediaReadArgs(): string[] {
  return ['metadata', '--format', PLAYERCTL_MEDIA_FORMAT]
}

export function linuxMediaSeekArgs(positionMs: number): string[] {
  return ['position', (Math.max(0, positionMs) / 1000).toFixed(3)]
}

export type MacMediaPlayer = 'spotify' | 'music'

function macPlayerName(player: MacMediaPlayer): string {
  return player === 'spotify' ? 'Spotify' : 'Music'
}

/** Read the current track from one player without launching it. */
export function macMediaReadArgs(player: MacMediaPlayer): string[] {
  const name = macPlayerName(player)
  return [
    '-e',
    [
      `if application "${name}" is running then`,
      `  tell application "${name}"`,
      '    if player state is not stopped then',
      '      return (player position as text) & tab & (duration of current track as text) & tab & (player state as text) & tab & (name of current track) & tab & (artist of current track)',
      '    end if',
      '  end tell',
      'end if',
      'return ""',
    ].join('\n'),
  ]
}

export function macMediaSeekArgs(player: MacMediaPlayer, positionMs: number): string[] {
  const seconds = (Math.max(0, positionMs) / 1000).toFixed(3)
  return ['-e', `tell application "${macPlayerName(player)}" to set player position to ${seconds}`]
}

/** `mm:ss`, or `h:mm:ss` for long media. */
export function formatMediaTime(positionMs: number): string {
  if (!Number.isFinite(positionMs)) return '0:00'
  const total = Math.max(0, Math.round(positionMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const secondsText = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
  return `${minutes}:${secondsText}`
}

/** `1:23 / 3:45`, or just elapsed when the duration is unknown. */
export function formatMediaDetail(positionMs: number, durationMs: number): string {
  const elapsed = formatMediaTime(positionMs)
  return durationMs > 0 ? `${elapsed} / ${formatMediaTime(durationMs)}` : elapsed
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
}

/** Parse a `playerctl metadata --format` line. */
export function parsePlayerctlOutput(raw: string): MediaReading | null {
  const text = raw.trim()
  if (!text) return null
  if (/^no players? found/i.test(text)) return null

  const line = text.split(/\r?\n/, 1)[0]!.trim()
  if (!line) return null
  const fields = line.split('\t')
  if (fields.length < 3) {
    throw new Error(`Could not parse playerctl output: ${line.slice(0, 120)}`)
  }

  const status = (fields[0] ?? '').trim()
  if (/^stopped$/i.test(status)) return null

  const positionUs = Number((fields[1] ?? '').trim())
  const durationUs = Number((fields[2] ?? '').trim())
  if (!Number.isFinite(positionUs)) {
    throw new Error(`Could not parse playerctl position: ${line.slice(0, 120)}`)
  }

  const durationMs = Number.isFinite(durationUs) && durationUs > 0 ? Math.round(durationUs / 1000) : 0
  const positionMs = Math.round(Math.max(0, positionUs) / 1000)
  const title = cleanText(fields[3])
  const artist = cleanText(fields[4])
  return {
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    playing: /^playing$/i.test(status),
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  }
}

/**
 * Parse the tab-separated AppleScript result for Spotify or Music.
 *
 * Spotify reports `player position` in seconds and `duration` in milliseconds;
 * Music reports both in seconds. The state field is playing/paused/stopped.
 */
export function parseMacMediaOutput(raw: string, player: MacMediaPlayer): MediaReading | null {
  const text = raw.trim()
  if (!text || /^missing value$/i.test(text)) return null

  const fields = text.split('\t')
  if (fields.length < 3) {
    throw new Error(`Could not parse ${player} media output: ${text.slice(0, 120)}`)
  }

  const state = (fields[2] ?? '').trim().toLowerCase()
  if (state === 'stopped') return null

  const positionSeconds = Number((fields[0] ?? '').trim())
  const durationRaw = Number((fields[1] ?? '').trim())
  if (!Number.isFinite(positionSeconds)) {
    throw new Error(`Could not parse ${player} player position: ${text.slice(0, 120)}`)
  }

  const positionMs = Math.max(0, Math.round(positionSeconds * 1000))
  const durationMs =
    Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.round(player === 'spotify' ? durationRaw : durationRaw * 1000)
      : 0
  const title = cleanText(fields[3])
  const artist = cleanText(fields[4])
  return {
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    playing: state === 'playing',
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  }
}

/** Raw JSON payload emitted by the Windows SMTC probe. */
export interface WindowsMediaPayload {
  positionMs?: unknown
  durationMs?: unknown
  playing?: unknown
  title?: unknown
  artist?: unknown
}

/** Convert and clamp the Windows SMTC payload. `null` means no session. */
export function parseWindowsMediaPayload(
  payload: WindowsMediaPayload | null | undefined,
): MediaReading | null {
  if (!payload) return null
  const position = Number(payload.positionMs)
  const duration = Number(payload.durationMs)
  if (!Number.isFinite(position) || !Number.isFinite(duration)) {
    throw new Error('Windows media probe returned no position')
  }
  const durationMs = Math.max(0, Math.round(duration))
  const positionMs = Math.max(0, Math.round(position))
  const title = cleanText(payload.title)
  const artist = cleanText(payload.artist)
  return {
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    playing: payload.playing === true,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  }
}

/** Map a normalized 0..1 scrub value to a clamped millisecond position. */
export function mediaSeekTargetMs(fraction: number, durationMs: number): number {
  if (!Number.isFinite(fraction)) throw new Error('Media position must be a finite number')
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('Seek is not supported for this media session.')
  }
  return Math.round(Math.max(0, Math.min(1, fraction)) * Math.max(0, durationMs))
}

function normalizeReading(reading: MediaReading): MediaReading {
  const duration = Number(reading.durationMs)
  const position = Number(reading.positionMs)
  if (!Number.isFinite(duration) || !Number.isFinite(position)) {
    throw new Error('Media reader returned no position')
  }
  const durationMs = Math.max(0, Math.round(duration))
  const positionMs = Math.max(0, Math.round(position))
  const title = cleanText(reading.title)
  const artist = cleanText(reading.artist)
  return {
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    playing: reading.playing === true,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  }
}

function copyReading(reading: MediaReading | null): MediaReading | null {
  return reading ? { ...reading } : null
}

/** Cache media reads for roughly the poll interval and share in-flight reads. */
export class CachedMediaReader implements MediaController {
  private cached: { reading: MediaReading | null; at: number } | null = null
  private inFlight: Promise<MediaReading | null> | null = null
  private seeking: Promise<void> | null = null
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly backend: MediaBackend,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 900)
    this.now = options.now ?? Date.now
  }

  read(): Promise<MediaReading | null> {
    // While a seek is in flight, return the optimistic target instead of
    // re-reading the player and racing the write with stale state.
    if (this.seeking && this.cached) {
      return Promise.resolve(copyReading(this.cached.reading))
    }
    const now = this.now()
    if (this.cached && now - this.cached.at < this.ttlMs) {
      return Promise.resolve(copyReading(this.cached.reading))
    }
    if (this.inFlight) return this.inFlight

    const pending = (async (): Promise<MediaReading | null> => {
      const reading = await this.backend.read()
      const normalized = reading ? normalizeReading(reading) : null
      this.cached = { reading: normalized, at: this.now() }
      return copyReading(normalized)
    })()
    this.inFlight = pending.finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  invalidate(): void {
    this.cached = null
  }

  setKnown(reading: MediaReading): void {
    this.cached = { reading: normalizeReading(reading), at: this.now() }
  }

  async seekFraction(fraction: number): Promise<number> {
    const current = await this.read()
    if (!current) throw new Error('No active media player.')
    return this.seekMs(mediaSeekTargetMs(fraction, current.durationMs))
  }

  async seekMs(positionMs: number): Promise<number> {
    if (!Number.isFinite(positionMs)) throw new Error('Media position must be a finite number')
    const current = await this.read()
    if (!current) throw new Error('No active media player.')
    if (!(current.durationMs > 0)) {
      throw new Error('Seek is not supported for this media session.')
    }
    if (!this.backend.seekMs) {
      throw new Error('Seek is not supported by the active media player.')
    }

    const target = Math.round(Math.max(0, Math.min(current.durationMs, positionMs)))
    // Optimistic local state: state snapshots and further drags see the target
    // until the player catches up or the cache expires.
    this.cached = { reading: { ...current, positionMs: target }, at: this.now() }

    const pending = this.backend.seekMs(target).then(
      () => undefined,
      (error: unknown) => {
        // The seek failed, so the optimistic position is a lie. Drop it and let
        // the next poll report the real player state.
        this.invalidate()
        throw error instanceof Error ? error : new Error(String(error))
      },
    )
    this.seeking = pending
    try {
      await pending
    } finally {
      if (this.seeking === pending) this.seeking = null
    }
    return target
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

function isNoPlayersMessage(message: string): boolean {
  return /no players? found|no player.*(running|active)/i.test(message)
}

export interface MediaSourceOptions {
  /** Test seam; omitted = a short-lived process capture. */
  runCommand?: CommandRunner
  /** Windows SMTC backend, normally a `WindowsMediaProbe`. */
  windowsBackend?: MediaBackend | null
  ttlMs?: number
  now?: () => number
}

/**
 * Build the platform media source. Linux and macOS always return a source so
 * "no player" is reported as `available: false` instead of hiding the control;
 * Windows needs the injected SMTC probe.
 */
export function createMediaController(
  platform: NodeJS.Platform,
  options: MediaSourceOptions = {},
): MediaController | null {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs

  if (platform === 'win32') {
    if (!options.windowsBackend) return null
    return new CachedMediaReader(options.windowsBackend, { ttlMs, now })
  }

  if (platform === 'darwin') {
    const run = options.runCommand ?? runCommandCapture
    let activePlayer: MacMediaPlayer | null = null
    const read = async (): Promise<MediaReading | null> => {
      let lastError: unknown = null
      for (const player of ['spotify', 'music'] as const) {
        try {
          const stdout = await runChecked(run, MAC_MEDIA_COMMAND, macMediaReadArgs(player))
          const reading = parseMacMediaOutput(stdout, player)
          if (reading) {
            activePlayer = player
            return reading
          }
        } catch (error) {
          // Try the next player, but keep the error so a real permission or
          // AppleScript failure surfaces as NO PLAYER instead of a silent null.
          lastError = error
        }
      }
      if (lastError) {
        throw lastError instanceof Error ? lastError : new Error(String(lastError))
      }
      return null
    }
    const backend: MediaBackend = {
      read,
      async seekMs(positionMs: number) {
        if (!activePlayer) {
          const reading = await read()
          if (!reading) throw new Error('No active media player.')
        }
        await runChecked(run, MAC_MEDIA_COMMAND, macMediaSeekArgs(activePlayer!, positionMs))
      },
    }
    return new CachedMediaReader(backend, { ttlMs, now })
  }

  if (platform === 'linux') {
    const run = options.runCommand ?? runCommandCapture
    const backend: MediaBackend = {
      async read() {
        let stdout: string
        try {
          stdout = await runChecked(run, LINUX_MEDIA_COMMAND, linuxMediaReadArgs())
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (isNoPlayersMessage(message)) return null
          throw new Error(`Could not read media state with playerctl. ${message}`)
        }
        return parsePlayerctlOutput(stdout)
      },
      async seekMs(positionMs: number) {
        try {
          await runChecked(run, LINUX_MEDIA_COMMAND, linuxMediaSeekArgs(positionMs))
        } catch (error) {
          throw new Error(
            `Could not seek with playerctl. ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      },
    }
    return new CachedMediaReader(backend, { ttlMs, now })
  }

  return null
}

/**
 * Persistent Windows SMTC probe (PowerShell + WinRT interop).
 *
 * Windows PowerShell 5.1 is required for the WinRT `ContentType` type literals;
 * PowerShell 7 can load WinRT but is not guaranteed on user machines. The probe
 * is a separate process, so it never blocks the keyboard helper. If WinRT
 * activation fails, `read()` throws and control state degrades to `NO PLAYER`.
 */
export const WINDOWS_MEDIA_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' -and
  $_.GetParameters()[0].ParameterType.Name -notlike 'IAsyncOperationWithProgress*'
})[0]
function Await-Result($operation, [Type]$resultType) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
function Get-MediaSession {
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $manager = Await-Result ($managerType::RequestAsync()) $managerType
  $sessions = @($manager.GetSessions())
  if ($sessions.Count -eq 0) { return $null }
  foreach ($session in $sessions) {
    try {
      if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { return $session }
    } catch { }
  }
  return $sessions[0]
}
function Read-Media {
  $session = Get-MediaSession
  if ($null -eq $session) { return $null }
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $props = Await-Result ($session.TryGetMediaPropertiesAsync()) $propsType
  $timeline = $session.GetTimelineProperties()
  $playback = $session.GetPlaybackInfo()
  $playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
  $start = $timeline.StartTime.TotalMilliseconds
  $end = $timeline.EndTime.TotalMilliseconds
  $pos = $timeline.Position.TotalMilliseconds
  if ($playing) {
    try {
      $elapsed = ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalMilliseconds
      if ($elapsed -gt 0) { $pos += $elapsed }
    } catch { }
  }
  $duration = 0.0
  if ($end -gt $start) { $duration = $end - $start }
  if ($pos -lt 0) { $pos = 0 }
  if ($duration -gt 0 -and $pos -gt $duration) { $pos = $duration }
  $result = @{
    positionMs = [math]::Round($pos)
    durationMs = [math]::Round($duration)
    playing = $playing
  }
  if ($null -ne $props.Title) { $result.title = [string]$props.Title }
  if ($null -ne $props.Artist) { $result.artist = [string]$props.Artist }
  return $result
}
function Seek-Media([double]$positionMs) {
  $session = Get-MediaSession
  if ($null -eq $session) { throw 'No active media player.' }
  $ticks = [TimeSpan]::FromMilliseconds($positionMs).Ticks
  $ok = Await-Result ($session.TryChangePlaybackPositionAsync($ticks)) ([bool])
  if (-not $ok) { throw 'The active media player rejected the seek.' }
}
@{ ready = $true } | ConvertTo-Json -Compress
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }
  $id = ''
  try {
    $request = $line | ConvertFrom-Json
    $id = [string]$request.id
    if ($request.cmd -eq 'read') {
      $reading = Read-Media
      $response = @{ id = $id; ok = $true; reading = $reading }
    } elseif ($request.cmd -eq 'seek') {
      Seek-Media ([double]$request.positionMs)
      $response = @{ id = $id; ok = $true }
    } else {
      throw "Unknown media command: $($request.cmd)"
    }
  } catch {
    $response = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  $response | ConvertTo-Json -Compress -Depth 5
}
`

interface ProbeResponse {
  ready?: boolean
  id?: string
  ok?: boolean
  error?: string
  reading?: WindowsMediaPayload | null
}

interface ProbePending {
  resolve: (response: ProbeResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Persistent JSONL SMTC probe. Separate from the keyboard/volume helper. */
export class WindowsMediaProbe implements MediaBackend {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, ProbePending>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private nextId = 0
  private disposed = false

  constructor(
    private readonly logger?: Logger,
    private readonly command = 'powershell.exe',
    private readonly timeoutMs = 4000,
  ) {}

  async read(): Promise<MediaReading | null> {
    const response = await this.send({ cmd: 'read' })
    return parseWindowsMediaPayload(response.reading)
  }

  async seekMs(positionMs: number): Promise<void> {
    if (!Number.isFinite(positionMs)) throw new Error('Media position must be a finite number')
    await this.send({ cmd: 'seek', positionMs: Math.max(0, Math.round(positionMs)) })
  }

  dispose(): void {
    this.disposed = true
    this.kill()
  }

  private async send(body: { cmd: 'read' | 'seek'; positionMs?: number }): Promise<ProbeResponse> {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('Media probe is not running')
    const id = String(++this.nextId)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.logger?.warn('Media probe timed out')
        this.kill()
        reject(new Error('Media probe timed out'))
      }, this.timeoutMs)
      timer.unref?.()

      this.pending.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(`${JSON.stringify({ id, ...body })}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Media probe was disposed'))
    if (this.child && !this.child.killed) return Promise.resolve()
    if (this.starting) return this.starting

    this.starting = new Promise<void>((resolve, reject) => {
      // -EncodedCommand avoids Windows command-line quoting/newline limits for
      // the embedded script. PowerShell expects UTF-16LE base64.
      const encoded = Buffer.from(WINDOWS_MEDIA_HELPER_SCRIPT, 'utf16le').toString('base64')
      const child = spawn(
        this.command,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      this.child = child
      this.stdoutBuffer = ''
      this.stderrTail = ''

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.kill()
        reject(new Error('Media probe startup timed out'))
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
          reject(new Error(`Could not start the Windows media probe: ${error.message}`))
        }
        this.failAll(new Error(`Media probe error: ${error.message}`))
      })
      child.once('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `Media probe exited during startup (code ${code ?? 'unknown'}). ${this.stderrTail.trim()}`,
            ),
          )
        }
        if (!this.disposed) {
          this.logger?.warn(`Media probe exited with code ${code ?? 'unknown'}`)
        }
        this.child = null
        this.starting = null
        this.failAll(new Error('Media probe stopped unexpectedly'))
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
      const line = this.stdoutBuffer.slice(0, newline).trim().replace(/^\uFEFF/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let message: ProbeResponse
      try {
        message = JSON.parse(line) as ProbeResponse
      } catch {
        this.logger?.warn(`Unexpected media probe output: ${line.slice(0, 200)}`)
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
      if (message.ok) pending.resolve(message)
      else pending.reject(new Error(message.error ?? 'Media probe failed'))
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
    this.failAll(new Error('Media probe was stopped'))
  }
}
