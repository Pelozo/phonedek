import { existsSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { KeyboardPlanStep, MediaKey, MouseAction, MouseButton } from '@phonedek/shared'
import type { Logger } from './logger'

export interface KeySender {
  send(step: KeyboardPlanStep): Promise<void>
  dispose?(): void
}

interface PendingCommand {
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Persistent PowerShell helper: pays the startup cost once, then ~1ms per chord. */
export class WindowsKeySender implements KeySender {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, PendingCommand>()
  private stdoutBuffer = ''
  private stderrTail = ''
  private nextId = 0
  private readonly helperPath: string
  private readonly logger?: Logger
  private disposed = false

  constructor(helperPath: string, logger?: Logger) {
    this.helperPath = helperPath
    this.logger = logger
  }

  async prewarm(): Promise<void> {
    try {
      await this.ensureStarted()
    } catch (error) {
      this.logger?.warn(`Keyboard helper failed to start: ${(error as Error).message}`)
    }
  }

  async send(step: KeyboardPlanStep): Promise<void> {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('Keyboard helper is not running')
    const id = String(++this.nextId)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.logger?.error('Keyboard helper timed out; restarting')
        this.kill()
        reject(new Error('Keyboard helper timed out'))
      }, 30_000)

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

  dispose(): void {
    this.disposed = true
    this.kill()
  }

  private ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Keyboard sender was disposed'))
    if (this.child && !this.child.killed) return Promise.resolve()
    if (this.starting) return this.starting
    if (!existsSync(this.helperPath)) {
      return Promise.reject(
        new Error(`Keyboard helper not found at ${this.helperPath}. Reinstall PhoneDeck.`),
      )
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.helperPath,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      this.child = child
      this.stdoutBuffer = ''
      this.stderrTail = ''

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.logger?.error('Keyboard helper startup timed out')
        this.kill()
        reject(new Error('Keyboard helper startup timed out'))
      }, 20_000)

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.onStdout(chunk, () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }))

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-4000)
      })

      child.on('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`Could not start PowerShell: ${error.message}`))
        }
        this.failAll(new Error(`Keyboard helper error: ${error.message}`))
      })

      child.on('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `Keyboard helper exited during startup (code ${code ?? 'unknown'}). ${this.stderrTail.trim()}`,
            ),
          )
        }
        if (!this.disposed) {
          this.logger?.warn(`Keyboard helper exited with code ${code ?? 'unknown'}`)
        }
        this.child = null
        this.starting = null
        this.failAll(new Error('Keyboard helper stopped unexpectedly'))
      })
    }).finally(() => {
      // Allow a later send() to retry if startup failed.
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
      let message: { ready?: boolean; id?: string; ok?: boolean; error?: string }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        this.logger?.warn(`Unexpected helper output: ${line.slice(0, 200)}`)
        continue
      }
      if (message.ready) {
        this.logger?.info('Keyboard helper ready')
        ready()
        continue
      }
      if (!message.id) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve()
      else pending.reject(new Error(message.error ?? 'Keyboard helper failed'))
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
    this.failAll(new Error('Keyboard helper was stopped'))
  }
}

const LINUX_KEYS: Record<string, string> = {
  CTRL: 'ctrl',
  ALT: 'alt',
  SHIFT: 'shift',
  WIN: 'super',
  ENTER: 'Return',
  TAB: 'Tab',
  ESC: 'Escape',
  SPACE: 'space',
  BACKSPACE: 'BackSpace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  PGUP: 'Prior',
  PGDN: 'Next',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  PRINTSCREEN: 'Print',
  CAPSLOCK: 'Caps_Lock',
  NUMLOCK: 'Num_Lock',
  SCROLLLOCK: 'Scroll_Lock',
  PAUSE: 'Pause',
  MENU: 'Menu',
  ';': 'semicolon',
  '=': 'equal',
  ',': 'comma',
  '-': 'minus',
  '.': 'period',
  '/': 'slash',
  '\\': 'backslash',
  '`': 'grave',
  '[': 'bracketleft',
  ']': 'bracketright',
  "'": 'apostrophe',
  '+': 'plus',
  '*': 'asterisk',
}

const LINUX_MEDIA: Record<MediaKey, string> = {
  playpause: 'XF86AudioPlay',
  next: 'XF86AudioNext',
  prev: 'XF86AudioPrev',
  stop: 'XF86AudioStop',
  volumeup: 'XF86AudioRaiseVolume',
  volumedown: 'XF86AudioLowerVolume',
  mute: 'XF86AudioMute',
}

const LINUX_MOUSE: Record<MouseButton, string> = { left: '1', middle: '2', right: '3' }
const LINUX_MOUSE_ACTION: Record<MouseAction, string> = {
  click: 'click',
  doubleclick: 'click',
  down: 'mousedown',
  up: 'mouseup',
  move: 'mousemove',
  scroll: 'click',
}

export class LinuxKeySender implements KeySender {
  private xdotool = false
  private readonly logger?: Logger

  constructor(logger?: Logger) {
    this.logger = logger
    this.xdotool = spawnSync('which', ['xdotool'], { stdio: 'ignore' }).status === 0
    if (!this.xdotool) {
      this.logger?.warn('xdotool is not installed; key actions will fail on this Linux host')
    }
  }

  async send(step: KeyboardPlanStep): Promise<void> {
    switch (step.kind) {
      case 'keys': {
        const keys = step.keys.map((key) => LINUX_KEYS[key] ?? key)
        if (step.action === 'down') {
          for (const key of keys) await this.run(['keydown', key])
        } else if (step.action === 'up') {
          for (const key of [...keys].reverse()) await this.run(['keyup', key])
        } else {
          await this.run(['key', '--clearmodifiers', '--delay', '12', keys.join('+')])
        }
        break
      }
      case 'text':
        await this.run(['type', '--clearmodifiers', '--delay', String(step.perCharMs), '--', step.text])
        break
      case 'delay':
        await new Promise((resolve) => setTimeout(resolve, step.ms))
        break
      case 'media':
        await this.run(['key', LINUX_MEDIA[step.key]])
        break
      case 'mouse': {
        if (step.x !== undefined && step.y !== undefined) {
          await this.run(['mousemove', String(step.x), String(step.y)])
        }
        if (step.action === 'move') break
        if (step.action === 'scroll') {
          const direction = step.direction ?? 'down'
          const button = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7'
          await this.run(['click', '--repeat', String(Math.max(1, Math.min(100, step.amount ?? 1))), button])
          break
        }
        if (step.action === 'doubleclick') {
          await this.run(['click', '--repeat', '2', LINUX_MOUSE[step.button]])
          break
        }
        await this.run([LINUX_MOUSE_ACTION[step.action], LINUX_MOUSE[step.button]])
        break
      }
    }
  }

  private run(args: string[]): Promise<void> {
    if (!this.xdotool) {
      return Promise.reject(new Error('xdotool is required on Linux. Install it with: sudo apt install xdotool'))
    }
    return new Promise((resolve, reject) => {
      const child = spawn('xdotool', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-2000)
      })
      child.on('error', (error) => reject(new Error(`xdotool failed: ${error.message}`)))
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`xdotool exited with ${code}: ${stderr.trim()}`))
      })
    })
  }
}

export class UnsupportedKeySender implements KeySender {
  constructor(private readonly platform: string) {}

  send(step: KeyboardPlanStep): Promise<void> {
    if (step.kind === 'delay') {
      return new Promise((resolve) => setTimeout(resolve, step.ms))
    }
    return Promise.reject(
      new Error(`Key actions are not implemented on ${this.platform}. PhoneDeck is Windows-first; launch/URL/command actions still work.`),
    )
  }
}

export function createKeySender(helperPath: string, platform: NodeJS.Platform, logger?: Logger): KeySender {
  if (platform === 'win32') return new WindowsKeySender(helperPath, logger)
  if (platform === 'linux') return new LinuxKeySender(logger)
  return new UnsupportedKeySender(platform)
}
