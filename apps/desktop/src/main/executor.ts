import { actionsToPlan } from '@phonedek/shared'
import type { Action, KeyboardPlanStep, PressResult } from '@phonedek/shared'
import type { HostActions } from './host-actions'
import type { KeySender } from './key-sender'
import type { Logger } from './logger'

const KEYBOARD_KINDS = new Set(['keys', 'text', 'delay', 'media', 'mouse'])

/**
 * Executes button action lists on the desktop. Runs are serialized so two
 * phones (or a chord + macro) never interleave their keystrokes.
 */
export class ActionExecutor {
  private queue: Promise<void> = Promise.resolve()
  private readonly keys: KeySender
  private readonly host: HostActions
  private readonly logger?: Logger

  constructor(keys: KeySender, host: HostActions, logger?: Logger) {
    this.keys = keys
    this.host = host
    this.logger = logger
  }

  execute(actions: readonly Action[], label = 'button'): Promise<PressResult> {
    const task = this.queue.then(() => this.run(actions, label))
    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async run(actions: readonly Action[], label: string): Promise<PressResult> {
    const plan = actionsToPlan(actions)
    if (plan.length === 0) {
      this.logger?.info(`Pressed "${label}" (no actions)`)
      return { ok: true }
    }

    this.logger?.info(`Pressed "${label}" (${plan.length} step${plan.length === 1 ? '' : 's'})`)
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
          default:
            if (KEYBOARD_KINDS.has(step.kind)) {
              await this.keys.send(step as KeyboardPlanStep)
            }
            break
        }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.error(`Action for "${label}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }
}
