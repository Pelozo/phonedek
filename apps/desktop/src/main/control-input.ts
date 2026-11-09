import { controlToActions } from '@phonedek/shared'
import type {
  Action,
  ControlSpec,
  InputMessage,
  InputResult,
  PressResult,
} from '@phonedek/shared'
import type { Logger } from './logger'

export interface ControlInputTarget {
  control: ControlSpec
  /** Human-readable button label used in executor logs. */
  label: string
}

export interface ControlInputRouterOptions {
  /** Usually `executor.execute`; it already serializes keyboard work. */
  execute: (actions: Action[], label: string) => Promise<PressResult>
  /** Absolute volume: value is normalized 0..1. Usually `executor.executeVolume(value*100)`. */
  applyAbsolute?: (control: ControlSpec, value: number, label: string) => Promise<PressResult>
  logger?: Logger
  /** Coalescing window for move events. Default 50 ms. */
  flushMs?: number
}

interface PendingControl {
  control: ControlSpec
  label: string
  delta: number
  /** Latest absolute value (0..1), or null when no value is pending. */
  value: number | null
  timer: NodeJS.Timeout | null
  running: Promise<InputResult> | null
}

const DEFAULT_FLUSH_MS = 50

/**
 * Coalesces high-frequency control moves into a small number of action batches.
 *
 * - One pending batch per profile/page/control; moves accumulate while a batch
 *   is in flight instead of queueing one execution per move.
 * - A 50 ms timer flushes accumulated deltas; `end` forces an immediate flush
 *   and waits for it so the matching `inputResult` is accurate.
 * - `start` resets any unflushed delta/value from an interrupted gesture.
 * - Relative volume/scroll still use `execute`; absolute volume uses
 *   `applyAbsolute` with the latest 0..1 value.
 */
export class ControlInputRouter {
  private readonly pending = new Map<string, PendingControl>()
  private readonly execute: ControlInputRouterOptions['execute']
  private readonly applyAbsolute?: ControlInputRouterOptions['applyAbsolute']
  private readonly logger?: Logger
  private readonly flushMs: number
  private disposed = false

  constructor(options: ControlInputRouterOptions) {
    this.execute = options.execute
    this.applyAbsolute = options.applyAbsolute
    this.logger = options.logger
    this.flushMs = Math.max(1, options.flushMs ?? DEFAULT_FLUSH_MS)
  }

  handle(message: InputMessage, target: ControlInputTarget): Promise<InputResult> {
    if (this.disposed) return Promise.resolve({ ok: false, error: 'Control input is shutting down.' })

    const unsupported = this.unsupportedReason(target.control)
    if (unsupported) return Promise.resolve({ ok: false, error: unsupported })

    const key = `${message.profileId}\u0000${message.pageId}\u0000${message.controlId}`
    let state = this.pending.get(key)
    if (!state) {
      state = {
        control: target.control,
        label: target.label,
        delta: 0,
        value: null,
        timer: null,
        running: null,
      }
      this.pending.set(key, state)
    } else {
      state.control = target.control
      state.label = target.label
    }

    switch (message.phase) {
      case 'start':
        this.cancelTimer(state)
        state.delta = 0
        state.value = null
        return Promise.resolve({ ok: true })
      case 'move': {
        if (this.isValueControl(target.control)) {
          const value = message.value
          if (value !== undefined && Number.isFinite(value)) {
            state.value = Math.max(0, Math.min(1, value))
          }
        } else {
          const delta = message.delta
          if (delta !== undefined && Number.isFinite(delta)) state.delta += delta
        }
        this.schedule(state)
        return Promise.resolve({ ok: true })
      }
      case 'end': {
        this.cancelTimer(state)
        const current = state
        return this.flush(current, true).then((result) => {
          if (!current.running && current.delta === 0 && current.value === null) {
            this.pending.delete(key)
          }
          return result
        })
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const state of this.pending.values()) this.cancelTimer(state)
    this.pending.clear()
  }

  private isValueControl(control: ControlSpec): boolean {
    if (control.binding.type === 'mic') return true
    return control.binding.type === 'volume' && control.binding.mode === 'absolute'
  }

  private unsupportedReason(control: ControlSpec): string | null {
    if (this.isValueControl(control)) {
      if (control.emit !== 'value') {
        return control.binding.type === 'mic'
          ? 'Mic gain requires a value control.'
          : 'Absolute volume requires a value control.'
      }
      if (!this.applyAbsolute) {
        return control.binding.type === 'mic'
          ? 'Microphone gain is not available on this desktop.'
          : 'Absolute volume is not available on this desktop.'
      }
      return null
    }
    if (control.emit !== 'delta') {
      return 'Absolute controls are not supported yet. Use a relative control.'
    }
    if (control.binding.type !== 'volume' && control.binding.type !== 'scroll') {
      return 'This control binding is not supported yet.'
    }
    return null
  }

  private schedule(state: PendingControl): void {
    if (state.timer || state.running || (state.delta === 0 && state.value === null)) return
    state.timer = setTimeout(() => {
      state.timer = null
      void this.flush(state, false)
    }, this.flushMs)
    state.timer.unref?.()
  }

  private cancelTimer(state: PendingControl): void {
    if (!state.timer) return
    clearTimeout(state.timer)
    state.timer = null
  }

  private async flush(state: PendingControl, force: boolean): Promise<InputResult> {
    // Coalesce while the previous batch is executing.
    while (state.running) {
      await state.running
    }

    if (state.value !== null) {
      const value = state.value
      state.value = null
      const apply = this.applyAbsolute
      if (!apply) return { ok: false, error: 'Value controls are not available on this desktop.' }
      return this.runExecution(state, () => apply(state.control, value, state.label), force)
    }

    if (state.delta === 0) return { ok: true }

    const actions = controlToActions(state.control, state.delta)
    // A capped batch consumes the accumulated delta; e.g. 100 volume units
    // become at most 20 media steps.
    state.delta = 0
    if (actions.length === 0) return { ok: true }

    return this.runExecution(state, () => this.execute(actions, state.label), force)
  }

  private async runExecution(
    state: PendingControl,
    operation: () => Promise<PressResult>,
    force: boolean,
  ): Promise<InputResult> {
    const execution = (async (): Promise<InputResult> => {
      try {
        return await operation()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.warn(`Control input failed: ${message}`)
        return { ok: false, error: message }
      }
    })()

    state.running = execution
    let result: InputResult
    try {
      result = await execution
    } finally {
      state.running = null
    }

    if (force) {
      // Values/deltas that arrived while this batch ran must flush before `end`.
      if (state.value !== null || state.delta !== 0) return this.flush(state, true)
    } else if (state.value !== null || state.delta !== 0) {
      this.schedule(state)
    }
    return result
  }
}
