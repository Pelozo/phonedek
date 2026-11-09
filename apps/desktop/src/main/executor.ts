import { basename } from 'node:path'
import { actionsToPlan, isScreenshotShortcut } from '@phonedek/shared'
import type { ExecutableAction, KeyboardPlanStep, PressResult } from '@phonedek/shared'
import type { HostActions } from './host-actions'
import type { KeySender } from './key-sender'
import type { Logger } from './logger'

const KEYBOARD_KINDS = new Set(['keys', 'text', 'delay', 'media', 'mouse'])

export interface ExecutorOptions {
  /** Host platform; defaults to the running process. Injected in tests. */
  platform?: NodeJS.Platform
  /** Called after a successful macOS screenshot with the absolute saved path. */
  onScreenshot?: (path: string) => void
}

/**
 * Executes button action lists on the desktop. Runs are serialized so two
 * phones (or a chord + macro) never interleave their keystrokes.
 */
export class ActionExecutor {
  private queue: Promise<void> = Promise.resolve()
  private readonly keys: KeySender
  private readonly host: HostActions
  private readonly logger?: Logger
  private readonly platform: NodeJS.Platform
  private readonly onScreenshot?: (path: string) => void

  constructor(keys: KeySender, host: HostActions, logger?: Logger, options: ExecutorOptions = {}) {
    this.keys = keys
    this.host = host
    this.logger = logger
    this.platform = options.platform ?? process.platform
    this.onScreenshot = options.onScreenshot
  }

  execute(actions: readonly ExecutableAction[], label = 'button'): Promise<PressResult> {
    const task = this.queue.then(() => this.run(actions, label))
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  /** Set absolute system volume through the same serialized queue as presses. */
  executeVolume(level: number, label = 'volume'): Promise<PressResult> {
    const task = this.queue.then(() => this.runVolume(level, label))
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  /** Set default microphone gain (0..100) through the serialized queue. */
  executeInputGain(level: number, label = 'microphone'): Promise<PressResult> {
    const task = this.queue.then(() => this.runInputGain(level, label))
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  /** Toggle default microphone mute through the serialized queue. */
  executeInputMute(label = 'microphone'): Promise<PressResult> {
    const task = this.queue.then(() => this.runInputMute(label))
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async runVolume(level: number, label: string): Promise<PressResult> {
    if (!Number.isFinite(level)) return { ok: false, error: 'Volume level must be a finite number' }
    const value = Math.max(0, Math.min(100, Math.round(level)))
    this.logger?.info(`Set volume to ${value}% for "${label}"`)
    try {
      await this.host.setVolume(value)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Volume action for "${label}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }

  private async runInputGain(level: number, label: string): Promise<PressResult> {
    if (!Number.isFinite(level)) {
      return { ok: false, error: 'Microphone gain must be a finite number' }
    }
    const value = Math.max(0, Math.min(100, Math.round(level)))
    this.logger?.info(`Set microphone gain to ${value}% for "${label}"`)
    try {
      await this.host.setInputGain(value)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Microphone gain action for "${label}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }

  private async runInputMute(label: string): Promise<PressResult> {
    this.logger?.info(`Toggled microphone mute for "${label}"`)
    try {
      await this.host.toggleInputMute()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Microphone mute action for "${label}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }

  private async run(actions: readonly ExecutableAction[], label: string): Promise<PressResult> {
    const plan = actionsToPlan(actions)
    if (plan.length === 0) {
      this.logger?.info(`Pressed "${label}" (no actions)`)
      return { ok: true }
    }

    this.logger?.info(`Pressed "${label}" (${plan.length} step${plan.length === 1 ? '' : 's'})`)
    const screenshots: string[] = []
    try {
      for (const step of plan) {
        switch (step.kind) {
          case 'launch':
            await this.host.launch(step.path, step.args)
            break
          case 'url':
            await this.host.openUrl(step.url)
            break
          case 'command':
            await this.host.runCommand(step.command, step.cwd, step.hidden)
            break
          case 'page':
            // Page navigation is handled on the phone; never execute it here.
            break
          case 'mic':
            await this.host.toggleInputMute()
            break
          case 'obs':
            if (!this.host.toggleObsInputMute) {
              throw new Error('OBS is not available on this desktop.')
            }
            await this.host.toggleObsInputMute(step.input)
            break
          default:
            if (KEYBOARD_KINDS.has(step.kind)) {
              // Win+Shift+S is the screenshot intent on Windows (Snipping Tool)
              // and maps to Cmd+Shift+S ("Save As…") on macOS. Capture the
              // full screen directly instead of sending the shortcut.
              if (
                (this.platform === 'darwin' || this.platform === 'win32') &&
                step.kind === 'keys' &&
                step.action === 'press' &&
                isScreenshotShortcut(step.keys)
              ) {
                const path = await this.host.screenshot()
                screenshots.push(path)
                try {
                  this.onScreenshot?.(path)
                } catch (error) {
                  this.logger?.warn(
                    `Screenshot notification failed: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
                this.logger?.info(`Captured the screen for "${label}"`)
                break
              }
              await this.keys.send(step as KeyboardPlanStep)
            }
            break
        }
      }
      if (screenshots.length === 1) {
        return { ok: true, message: `Screenshot saved to Desktop: ${basename(screenshots[0]!)}` }
      }
      if (screenshots.length > 1) {
        return { ok: true, message: `${screenshots.length} screenshots saved to Desktop` }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Action for "${label}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }
}
