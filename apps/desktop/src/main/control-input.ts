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
  logger?: Logger
  /** Coalescing window for move events. Default 50 ms. */
  flushMs?: number
}

interface PendingControl {
  control: ControlSpec
  label: string
  delta: number
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
 * - `start` resets any unflushed delta from an interrupted gesture.
 * - MVP only: relative volume and scroll. Absolute (`emit: 'value'`) controls
 *   return a clear unsupported error.
 */
export class ControlInputRouter {
  private readonly pending = new Map<string, PendingControl>()
  private readonly execute: ControlInputRouterOptions['execute']
  private readonly logger?: Logger
  private readonly flushMs: number
  private disposed = false

  constructor(options: ControlInputRouterOptions) {
    this.execute = options.execute
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
      state = { control: target.control, label: target.label, delta: 0, timer: null, running: null }
      this.pending.set(key, state)
    } else {
      state.control = target.control
      state.label = target.label
    }

    switch (message.phase) {
      case 'start':
        this.cancelTimer(state)
        state.delta = 0
        return Promise.resolve({ ok: true })
      case 'move': {
        const delta = message.delta
        if (delta !== undefined && Number.isFinite(delta)) state.delta += delta
        this.schedule(state)
        return Promise.resolve({ ok: true })
      }
      case 'end': {
        this.cancelTimer(state)
        const current = state
        return this.flush(current, true).then((result) => {
          if (!current.running && current.delta === 0) this.pending.delete(key)
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

  private unsupportedReason(control: ControlSpec): string | null {
    if (control.emit !== 'delta') {
      return 'Absolute controls are not supported yet. Use a relative control.'
    }
    if (control.binding.type !== 'volume' && control.binding.type !== 'scroll') {
      return 'This control binding is not supported yet.'
    }
    return null
  }

  private schedule(state: PendingControl): void {
    if (state.timer || state.running || state.delta === 0) return
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

    if (state.delta === 0) return { ok: true }

    const actions = controlToActions(state.control, state.delta)
    // A capped batch consumes the accumulated delta; e.g. 100 volume units
    // become at most 20 media steps.
    state.delta = 0
    if (actions.length === 0) return { ok: true }

    const execution = (async (): Promise<InputResult> => {
      try {
        return await this.execute(actions, state.label)
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
      // Deltas that arrived while this batch ran must flush before `end` acks.
      if (state.delta !== 0) return this.flush(state, true)
    } else if (state.delta !== 0) {
      this.schedule(state)
    }
    return result
  }
}
