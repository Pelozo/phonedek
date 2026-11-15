import { basename } from 'node:path'
import { actionsToPlan, isScreenshotShortcut } from '@phonedek/shared'
import type {
  AppVolumeAction,
  ConfigAction,
  KeyboardPlanStep,
  PlanGroup,
  PlanStep,
  PressResult,
  StreamerBotAction,
} from '@phonedek/shared'
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

/** How a failed group affects the rest of the plan. */
export type PlanRunMode = 'failFast' | 'continue'

/** One group finished (successfully or not); `index` is 1-based. */
export interface PlanProgress {
  index: number
  total: number
  label: string
  ok: boolean
  error?: string
}

export interface PlanFailure {
  /** 1-based group index. */
  index: number
  label: string
  error: string
}

/**
 * Result of running one or more groups in a single queue slot.
 *
 * `completed` counts groups that finished successfully, so a fail-fast plan
 * that dies on step 3 of 9 reports `completed: 2`. `ok` is false whenever a
 * group failed, the run was aborted or the deadline passed.
 */
export interface PlanResult extends PressResult {
  completed: number
  total: number
  failures: PlanFailure[]
  cancelled: boolean
  timedOut: boolean
  /** True when a failure stopped the remaining groups (fail-fast). */
  stoppedOnFailure: boolean
}

export interface ExecutePlanOptions {
  /** Default `failFast`; a group's own `continueOnError` wins. */
  mode?: PlanRunMode
  /** Wall-clock budget for the whole plan, measured from the first group. */
  deadlineMs?: number
  /** Abort between steps; an in-flight host call is never cancelled. */
  signal?: AbortSignal
  /** Called once per group after it finishes, with a 1-based index. */
  onProgress?: (progress: PlanProgress) => void
}

/**
 * Executes button action lists on the desktop. Runs are serialized so two
 * phones (or a chord + macro) never interleave their keystrokes.
 *
 * `executePlan` runs several groups in one queue slot, so a rig is atomic with
 * respect to every other press without changing the queue itself.
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

  /**
   * Run one button's actions. This stays a one-group plan so every existing
   * press/macro/screenshot behavior (and its `PressResult` shape) is unchanged.
   */
  execute(
    actions: readonly (ConfigAction | AppVolumeAction | StreamerBotAction)[],
    label = 'button',
  ): Promise<PressResult> {
    return this.executePlan([{ label, steps: actionsToPlan(actions) }], label).then((result) => {
      const press: PressResult = { ok: result.ok }
      if (result.error !== undefined) press.error = result.error
      if (result.message !== undefined) press.message = result.message
      return press
    })
  }

  /**
   * Run an ordered list of plan groups in one queue slot.
   *
   * The deadline and abort signal are checked before every group, never while
   * a host call is in flight. `delayMs` runs only after a successful group and
   * before the next one; it counts toward the deadline and stops on abort.
   */
  executePlan(
    groups: readonly PlanGroup[],
    label = 'rig',
    options: ExecutePlanOptions = {},
  ): Promise<PlanResult> {
    const task = this.queue.then(() => this.runPlan(groups, label, options))
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

  private async runPlan(
    groups: readonly PlanGroup[],
    label: string,
    options: ExecutePlanOptions,
  ): Promise<PlanResult> {
    const total = groups.length
    const steps = groups.reduce((count, group) => count + group.steps.length, 0)
    if (total === 1) {
      if (steps === 0) this.logger?.info(`Pressed "${label}" (no actions)`)
      else this.logger?.info(`Pressed "${label}" (${steps} step${steps === 1 ? '' : 's'})`)
    } else if (total > 1) {
      this.logger?.info(`Rig "${label}" started (${total} steps, ${steps} actions)`)
    } else {
      this.logger?.info(`Pressed "${label}" (no actions)`)
    }

    const startedAt = Date.now()
    const deadline =
      options.deadlineMs !== undefined && Number.isFinite(options.deadlineMs)
        ? startedAt + Math.max(0, options.deadlineMs)
        : undefined
    const screenshots: string[] = []
    const failures: PlanFailure[] = []
    let completed = 0
    let cancelled = false
    let timedOut = false
    let stoppedOnFailure = false

    for (let index = 0; index < total; index += 1) {
      const group = groups[index]
      if (!group) break

      if (options.signal?.aborted) {
        cancelled = true
        break
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        timedOut = true
        break
      }

      // Held keys are scoped to this group: a modifier intentionally held by an
      // earlier successful group must survive a later failure, while anything
      // pressed by the failing group is released before moving on.
      const heldByGroup = new Set<string>()
      try {
        await this.runSteps(group.steps, label, heldByGroup, screenshots)
        completed += 1
        this.emitProgress(options, {
          index: index + 1,
          total,
          label: group.label,
          ok: true,
        })

        if (index < total - 1 && (group.delayMs ?? 0) > 0) {
          const pause = await this.pause(group.delayMs ?? 0, deadline, options.signal)
          if (pause !== 'ok') {
            cancelled = pause === 'cancelled'
            timedOut = pause === 'timedOut'
            break
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.error(`Action for "${label}" failed: ${message}`)
        await this.releaseKeys(heldByGroup, label)
        failures.push({ index: index + 1, label: group.label, error: message })
        this.emitProgress(options, {
          index: index + 1,
          total,
          label: group.label,
          ok: false,
          error: message,
        })
        const keepGoing = group.continueOnError ?? options.mode === 'continue'
        if (!keepGoing) {
          stoppedOnFailure = true
          break
        }
      }
    }

    const ok = failures.length === 0 && !cancelled && !timedOut
    const result: PlanResult = {
      ok,
      completed,
      total,
      failures,
      cancelled,
      timedOut,
      stoppedOnFailure,
    }
    if (!ok) {
      if (cancelled) result.error = 'Cancelled'
      else if (timedOut) result.error = 'Timed out'
      else result.error = failures[0]?.error ?? 'Failed'
      return result
    }
    if (screenshots.length === 1) {
      result.message = `Screenshot saved to Desktop: ${basename(screenshots[0]!)}`
    } else if (screenshots.length > 1) {
      result.message = `${screenshots.length} screenshots saved to Desktop`
    }
    return result
  }

  /** Run the plan steps of one group; throws on the first failed step. */
  private async runSteps(
    plan: readonly PlanStep[],
    label: string,
    heldByRun: Set<string>,
    screenshots: string[],
  ): Promise<void> {
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
          if (this.host.runObsAction) {
            await this.host.runObsAction(step)
          } else if (step.action === 'toggleMute' && this.host.toggleObsInputMute) {
            await this.host.toggleObsInputMute(step.input)
          } else {
            throw new Error('OBS is not available on this desktop.')
          }
          break
        case 'twitch':
          if (!this.host.runTwitchAction) {
            throw new Error('Twitch is not available on this desktop.')
          }
          await this.host.runTwitchAction(step)
          break
        case 'light':
          if (!this.host.runLightAction) {
            throw new Error('Local lights are not available on this desktop.')
          }
          await this.host.runLightAction(step)
          break
        case 'appVolume':
          if (!this.host.runAppVolumeAction) {
            throw new Error('Per-app audio is not available on this desktop.')
          }
          await this.host.runAppVolumeAction(step)
          break
        case 'streamerbot':
          if (!this.host.runStreamerBotAction) {
            throw new Error('Streamer.bot is not available on this desktop.')
          }
          await this.host.runStreamerBotAction(step)
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
            const keyStep = step as KeyboardPlanStep
            await this.keys.send(keyStep)
            if (keyStep.kind === 'keys') {
              if (keyStep.action === 'down') {
                for (const key of keyStep.keys) heldByRun.add(key)
              } else if (keyStep.action === 'up') {
                for (const key of keyStep.keys) heldByRun.delete(key)
              }
            }
          }
          break
      }
    }
  }

  /** Release the keys held by a failed group (reverse press order). */
  private async releaseKeys(heldByRun: Set<string>, label: string): Promise<void> {
    if (heldByRun.size === 0) return
    const keys = [...heldByRun].reverse()
    heldByRun.clear()
    try {
      await this.keys.send({ kind: 'keys', keys, holdMs: 0, action: 'up' })
    } catch (releaseError) {
      this.logger?.warn(
        `Could not release ${keys.join('+')} after "${label}" failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
      )
    }
  }

  private emitProgress(options: ExecutePlanOptions, progress: PlanProgress): void {
    try {
      options.onProgress?.(progress)
    } catch (error) {
      this.logger?.warn(
        `Rig progress callback failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Wait `ms`, returning early on abort or deadline. A missing deadline waits
   * the full delay; a deadline inside the delay reports `timedOut`.
   */
  private async pause(
    ms: number,
    deadline: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<'ok' | 'cancelled' | 'timedOut'> {
    if (signal?.aborted) return 'cancelled'
    if (deadline !== undefined) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return 'timedOut'
      if (remaining <= ms) {
        const aborted = await this.wait(remaining, signal)
        return aborted ? 'cancelled' : 'timedOut'
      }
    }
    const aborted = await this.wait(ms, signal)
    return aborted ? 'cancelled' : 'ok'
  }

  /** Resolve true when the signal aborted during the wait, false on timeout. */
  private wait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(true)
        return
      }
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (aborted: boolean): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(aborted)
      }
      const onAbort = (): void => finish(true)
      timer = setTimeout(() => finish(false), Math.max(0, ms))
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
