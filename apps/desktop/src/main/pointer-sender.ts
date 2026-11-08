import { existsSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PointerButtonEvent } from '@phonedek/shared'
import {
  helperFailure,
  macHelperLaunch,
  windowsHelperLaunch,
  type HelperLaunch,
} from './key-sender'
import type { Logger } from './logger'

/** One pointer frame. Movement is already normalized; scroll is in notches. */
export interface PointerFrame {
  /** Fraction of the desktop height, +right. */
  dx?: number
  /** Fraction of the desktop height, +down. */
  dy?: number
  /** Wheel notches, +right. */
  scrollX?: number
  /** Wheel notches, +up. */
  scrollY?: number
  /** Ordered button transitions. */
  buttons?: PointerButtonEvent[]
}

/** Low-level transport used by {@link PointerSender}; injected in tests. */
export interface PointerTransport {
  send(frame: PointerFrame): Promise<void>
  dispose(): void
}

/** Minimal surface the pointer router needs. */
export interface PointerSenderLike {
  move(dx?: number, dy?: number): void
  scroll(scrollX?: number, scrollY?: number): void
  buttons(events: PointerButtonEvent[]): void
  dispose(): void
}

export interface VirtualScreen {
  x: number
  y: number
  width: number
  height: number
}

export interface PointerPoint {
  x: number
  y: number
}

function finiteOr(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Convert normalized pointer deltas to physical pixels.
 *
 * Windows applies this against the monitor under the cursor after enabling
 * per-monitor-v2 DPI awareness; Linux/X11 uses the whole virtual display
 * height because X11 has no per-monitor DPI. Kept pure so the monitor/DPI
 * behaviour is unit-testable without a live desktop.
 */
export function pointerDeltaPixels(
  dx: number,
  dy: number,
  monitorHeight: number,
  sensitivity = 1,
): PointerPoint {
  const height = Math.max(1, finiteOr(monitorHeight, 1))
  const gain = clamp(finiteOr(sensitivity, 1), 0.05, 10)
  return {
    x: Math.round(finiteOr(dx) * height * gain),
    y: Math.round(finiteOr(dy) * height * gain),
  }
}

/** Clamp a point to the inclusive pixel bounds of a virtual screen. */
export function clampPointerTarget(point: PointerPoint, screen: VirtualScreen): PointerPoint {
  const width = Math.max(1, finiteOr(screen.width, 1))
  const height = Math.max(1, finiteOr(screen.height, 1))
  const left = finiteOr(screen.x)
  const top = finiteOr(screen.y)
  return {
    x: clamp(Math.round(finiteOr(point.x)), left, left + width - 1),
    y: clamp(Math.round(finiteOr(point.y)), top, top + height - 1),
  }
}

/** Apply a pixel delta to the current cursor and clamp it to the desktop. */
export function pointerTarget(
  current: PointerPoint,
  delta: PointerPoint,
  screen: VirtualScreen,
): PointerPoint {
  return clampPointerTarget(
    { x: finiteOr(current.x) + finiteOr(delta.x), y: finiteOr(current.y) + finiteOr(delta.y) },
    screen,
  )
}

function copyButtons(events: PointerButtonEvent[]): PointerButtonEvent[] {
  return events.map((event) => ({ button: event.button, action: event.action }))
}

/**
 * Coalesces pointer frames while the helper is busy.
 *
 * Cursor movement is latest-wins (a stale move is worthless once a newer one
 * exists), scroll notches accumulate, and button transitions stay in an
 * ordered queue so a down/up pair can never be reordered or dropped. The
 * dedicated helper process is what keeps a sleeping macro from freezing the
 * cursor.
 */
export class PointerSender implements PointerSenderLike {
  private pending: PointerFrame = {}
  private pendingButtons: PointerButtonEvent[] = []
  private busy = false
  private disposed = false

  constructor(
    private readonly transport: PointerTransport,
    private readonly logger?: Logger,
  ) {}

  move(dx?: number, dy?: number): void {
    if (this.disposed) return
    if (dx !== undefined && Number.isFinite(dx)) this.pending.dx = dx
    if (dy !== undefined && Number.isFinite(dy)) this.pending.dy = dy
    this.schedule()
  }

  scroll(scrollX?: number, scrollY?: number): void {
    if (this.disposed) return
    if (scrollX !== undefined && Number.isFinite(scrollX)) {
      this.pending.scrollX = (this.pending.scrollX ?? 0) + scrollX
    }
    if (scrollY !== undefined && Number.isFinite(scrollY)) {
      this.pending.scrollY = (this.pending.scrollY ?? 0) + scrollY
    }
    this.schedule()
  }

  buttons(events: PointerButtonEvent[]): void {
    if (this.disposed || events.length === 0) return
    this.pendingButtons.push(...copyButtons(events))
    this.schedule()
  }

  dispose(): void {
    if (this.disposed) return
    const frame = this.takeFrame()
    this.disposed = true
    this.pending = {}
    this.pendingButtons = []
    if (!frame) {
      this.transport.dispose()
      return
    }
    // A held button must not stay down because the app is quitting. Send the
    // final release, then close the transport once the helper acknowledged it.
    let result: Promise<void>
    try {
      result = this.transport.send(frame)
    } catch (error) {
      result = Promise.reject(error)
    }
    void result
      .catch(() => undefined)
      .finally(() => this.transport.dispose())
  }

  private takeFrame(): PointerFrame | null {
    const frame: PointerFrame = {}
    if (this.pending.dx !== undefined) frame.dx = this.pending.dx
    if (this.pending.dy !== undefined) frame.dy = this.pending.dy
    if (this.pending.scrollX !== undefined) frame.scrollX = this.pending.scrollX
    if (this.pending.scrollY !== undefined) frame.scrollY = this.pending.scrollY
    if (this.pendingButtons.length > 0) {
      frame.buttons = this.pendingButtons
      this.pendingButtons = []
    }

    if (
      frame.dx === undefined &&
      frame.dy === undefined &&
      frame.scrollX === undefined &&
      frame.scrollY === undefined &&
      frame.buttons === undefined
    ) {
      return null
    }
    this.pending = {}
    return frame
  }

  private schedule(): void {
    if (this.disposed || this.busy) return

    const frame = this.takeFrame()
    if (!frame) return

    this.busy = true
    let result: Promise<void>
    try {
      result = this.transport.send(frame)
    } catch (error) {
      result = Promise.reject(error)
    }
    void result
      .catch((error: unknown) => {
        if (this.disposed) return
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.warn(`Pointer helper failed: ${message}`)
      })
      .finally(() => {
        this.busy = false
        this.schedule()
      })
  }
}

interface PendingCommand {
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Persistent dedicated helper process for the Windows/macOS input helper.
 * A second instance is intentional: the keyboard/macro helper can be sleeping
 * inside a `delay` step without adding latency to the cursor.
 */
export class HelperPointerTransport implements PointerTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, PendingCommand>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private nextId = 0
  private disposed = false
  private announcedReady = false

  constructor(
    private readonly helperPath: string,
    private readonly launch: HelperLaunch,
    private readonly logger?: Logger,
  ) {}

  send(frame: PointerFrame): Promise<void> {
    return this.sendFrame(frame)
  }

  dispose(): void {
    this.disposed = true
    this.kill()
  }

  private async sendFrame(frame: PointerFrame): Promise<void> {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('Pointer helper is not running')
    const id = String(++this.nextId)
    const step: Record<string, unknown> = { kind: 'pointer' }
    if (frame.dx !== undefined) step.dx = frame.dx
    if (frame.dy !== undefined) step.dy = frame.dy
    if (frame.scrollX !== undefined) step.scrollX = frame.scrollX
    if (frame.scrollY !== undefined) step.scrollY = frame.scrollY
    if (frame.buttons && frame.buttons.length > 0) step.buttons = frame.buttons

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.logger?.error('Pointer helper timed out; restarting')
        this.kill()
        reject(new Error('Pointer helper timed out'))
      }, 10_000)

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
    if (this.disposed) return Promise.reject(new Error('Pointer sender was disposed'))
    if (this.child && !this.child.killed) return Promise.resolve()
    if (this.starting) return this.starting
    if (!existsSync(this.helperPath)) {
      return Promise.reject(
        new Error(`Pointer helper not found at ${this.helperPath}. Reinstall PhoneDeck.`),
      )
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
        this.logger?.error('Pointer helper startup timed out')
        this.kill()
        reject(new Error('Pointer helper startup timed out'))
      }, 20_000)

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

      child.on('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`Could not start ${this.launch.label}: ${error.message}`))
        }
        this.failAll(new Error(`Pointer helper error: ${error.message}`))
      })

      child.on('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `Pointer helper exited during startup (code ${code ?? 'unknown'}). ${this.stderrTail.trim()}`,
            ),
          )
        }
        if (!this.disposed) {
          this.logger?.warn(`Pointer helper exited with code ${code ?? 'unknown'}`)
        }
        this.child = null
        this.starting = null
        this.failAll(new Error('Pointer helper stopped unexpectedly'))
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
        permission?: string
        accessibility?: boolean
      }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        this.logger?.warn(`Unexpected pointer helper output: ${line.slice(0, 200)}`)
        continue
      }
      if (message.ready) {
        if (!this.announcedReady) {
          this.announcedReady = true
          this.logger?.info('Pointer helper ready')
        }
        if (message.accessibility === false) {
          this.logger?.warn(
            'macOS Accessibility permission is not granted; pointer actions will fail until it is enabled in System Settings → Privacy & Security → Accessibility.',
          )
        }
        ready()
        continue
      }
      if (!message.id) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve()
      else pending.reject(helperFailure(message.error, message.permission))
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
    this.failAll(new Error('Pointer helper was stopped'))
  }
}

function xdotoolAvailable(): boolean {
  try {
    return spawnSync('which', ['xdotool'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

function displayHeight(): number {
  try {
    const result = spawnSync('xdotool', ['getdisplaygeometry'], { encoding: 'utf8' })
    if (result.status !== 0) return 1080
    const height = Number.parseInt((result.stdout ?? '').trim().split(/\s+/)[1] ?? '', 10)
    return Number.isFinite(height) && height > 0 ? height : 1080
  } catch {
    return 1080
  }
}

const LINUX_BUTTON: Record<string, string> = { left: '1', middle: '2', right: '3' }

/**
 * Linux/X11 transport over one persistent `xdotool -` process. Spawning
 * xdotool per event costs 10-30 ms and would make 60 Hz movement unusable.
 */
export class XdotoolPointerTransport implements PointerTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private disposed = false
  private readonly height = displayHeight()

  constructor(private readonly logger?: Logger) {}

  send(frame: PointerFrame): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Pointer sender was disposed'))
    const child = this.ensureStarted()
    const commands: string[] = []

    if (frame.dx !== undefined || frame.dy !== undefined) {
      const delta = pointerDeltaPixels(frame.dx ?? 0, frame.dy ?? 0, this.height)
      if (delta.x !== 0 || delta.y !== 0) {
        commands.push(`mousemove_relative -- ${delta.x} ${delta.y}`)
      }
    }

    if (frame.scrollY !== undefined && frame.scrollY !== 0) {
      const button = frame.scrollY > 0 ? '4' : '5'
      const count = Math.max(1, Math.min(100, Math.trunc(Math.abs(frame.scrollY))))
      commands.push(`click --repeat ${count} ${button}`)
    }
    if (frame.scrollX !== undefined && frame.scrollX !== 0) {
      const button = frame.scrollX > 0 ? '7' : '6'
      const count = Math.max(1, Math.min(100, Math.trunc(Math.abs(frame.scrollX))))
      commands.push(`click --repeat ${count} ${button}`)
    }

    for (const event of frame.buttons ?? []) {
      const button = LINUX_BUTTON[event.button]
      if (!button) continue
      if (event.action === 'down') commands.push(`mousedown ${button}`)
      else if (event.action === 'up') commands.push(`mouseup ${button}`)
      else if (event.action === 'doubleclick') commands.push(`click --repeat 2 ${button}`)
      else commands.push(`click ${button}`)
    }

    if (commands.length === 0) return Promise.resolve()
    try {
      child.stdin.write(`${commands.join('\n')}\n`)
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  dispose(): void {
    this.disposed = true
    const child = this.child
    this.child = null
    if (!child || child.killed) return
    try {
      child.stdin.end()
      child.kill()
    } catch {
      // ignore
    }
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child
    const child = spawn('xdotool', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) this.logger?.warn(`xdotool: ${text.slice(0, 300)}`)
    })
    child.on('error', (error) => {
      this.logger?.warn(`xdotool pointer process failed: ${error.message}`)
      if (this.child === child) this.child = null
    })
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      if (!this.disposed) this.logger?.warn(`xdotool pointer process exited with code ${code ?? 'unknown'}`)
    })
    return child
  }
}

/** A sender that accepts frames and does nothing; used on unsupported hosts. */
export class NullPointerSender implements PointerSenderLike {
  move(): void {}
  scroll(): void {}
  buttons(): void {}
  dispose(): void {}
}

export interface PointerPlatformSupport {
  supported: boolean
  reason?: string
}

/**
 * Whether this host can inject pointer events. Wayland has no standard global
 * pointer API, so it must not advertise `pointer-v1` (XWayland still does not
 * expose one to unprivileged processes).
 */
export function pointerPlatformSupport(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): PointerPlatformSupport {
  if (platform === 'win32' || platform === 'darwin') return { supported: true }
  if (platform !== 'linux') {
    return { supported: false, reason: `Pointer control is not implemented on ${platform}.` }
  }
  const session = (env['XDG_SESSION_TYPE'] ?? '').toLowerCase()
  if (session === 'wayland' || env['WAYLAND_DISPLAY']) {
    return {
      supported: false,
      reason: 'Pointer control is not available on Wayland. Log in with an X11 session.',
    }
  }
  if (!env['DISPLAY']) {
    return { supported: false, reason: 'Pointer control needs an X11 display.' }
  }
  return { supported: true }
}

/**
 * Build the dedicated pointer sender for this platform. Returns null when the
 * host cannot inject pointers (Wayland, unsupported OS, missing xdotool).
 */
export function createPointerSender(
  platform: NodeJS.Platform,
  helperPath: string,
  logger?: Logger,
  env: NodeJS.ProcessEnv = process.env,
): PointerSender | null {
  if (platform === 'win32') {
    return new PointerSender(
      new HelperPointerTransport(helperPath, windowsHelperLaunch(helperPath), logger),
      logger,
    )
  }
  if (platform === 'darwin') {
    return new PointerSender(
      new HelperPointerTransport(helperPath, macHelperLaunch(helperPath), logger),
      logger,
    )
  }
  if (platform === 'linux') {
    if (!pointerPlatformSupport(platform, env).supported) return null
    if (!xdotoolAvailable()) {
      logger?.warn('Pointer control needs xdotool. Install it with: sudo apt install xdotool')
      return null
    }
    return new PointerSender(new XdotoolPointerTransport(logger), logger)
  }
  return null
}
