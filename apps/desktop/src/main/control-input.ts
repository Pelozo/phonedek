import { controlToActions, normalizeCombo, shortcutDeltaPerStep } from '@phonedek/shared'
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
  /** Connection that sent the gesture; used to release held keys on close. */
  clientId?: string
}

export interface ControlInputRouterOptions {
  /** Usually `executor.execute`; it already serializes keyboard work. */
  execute: (actions: Action[], label: string) => Promise<PressResult>
  /** Absolute volume: value is normalized 0..1. Usually `executor.executeVolume(value*100)`. */
  applyAbsolute?: (control: ControlSpec, value: number, label: string) => Promise<PressResult>
  logger?: Logger
  /** Coalescing window for move events. Default 50 ms. */
  flushMs?: number
  /** Milliseconds of gesture silence before held shortcut keys are released. */
  watchdogMs?: number
}

interface PendingControl {
  control: ControlSpec
  label: string
  clientId?: string
  delta: number
  /** Latest absolute value (0..1), or null when no value is pending. */
  value: number | null
  timer: NodeJS.Timeout | null
  running: Promise<InputResult> | null
  /** Shortcut keys held down for the current gesture, if any. */
  holdKeys: string[] | null
  /** Keys actually down; kept separately if the config changes mid-gesture. */
  heldKeys: string[] | null
  holdActive: boolean
  watchdog: NodeJS.Timeout | null
}

const DEFAULT_FLUSH_MS = 50
const DEFAULT_WATCHDOG_MS = 6_000
const EPSILON = 1e-9

function holdKeysOf(control: ControlSpec): string[] | null {
  if (control.binding.type !== 'shortcut') return null
  if (!control.binding.holdKeys || control.binding.holdKeys.length === 0) return null
  try {
    return normalizeCombo(control.binding.holdKeys)
  } catch {
    return null
  }
}

/**
 * Coalesces high-frequency control moves into a small number of action batches.
 *
 * - One pending batch per profile/page/control; moves accumulate while a batch
 *   is in flight instead of queueing one execution per move.
 * - A 50 ms timer flushes accumulated deltas; `end` forces an immediate flush
 *   and waits for it so the matching `inputResult` is accurate.
 * - `start` resets any unflushed delta/value from an interrupted gesture but
 *   never releases held keys.
 * - Relative volume/scroll still use `execute`; absolute volume uses
 *   `applyAbsolute` with the latest 0..1 value.
 * - Shortcut wheels hold `holdKeys` down from the first non-zero move until
 *   `end`, `cancel`, a client disconnect or the stuck-key watchdog. Slider
 *   movement is accumulated until a whole `travelSteps` slice is reached.
 */
export class ControlInputRouter {
  private readonly pending = new Map<string, PendingControl>()
  private readonly execute: ControlInputRouterOptions['execute']
  private readonly applyAbsolute?: ControlInputRouterOptions['applyAbsolute']
  private readonly logger?: Logger
  private readonly flushMs: number
  private readonly watchdogMs: number
  /** The single shortcut gesture that currently holds keys, if any. */
  private held: PendingControl | null = null
  private disposed = false

  constructor(options: ControlInputRouterOptions) {
    this.execute = options.execute
    this.applyAbsolute = options.applyAbsolute
    this.logger = options.logger
    this.flushMs = Math.max(1, options.flushMs ?? DEFAULT_FLUSH_MS)
    this.watchdogMs = Math.max(1, options.watchdogMs ?? DEFAULT_WATCHDOG_MS)
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
        ...(target.clientId ? { clientId: target.clientId } : {}),
        delta: 0,
        value: null,
        timer: null,
        running: null,
        holdKeys: holdKeysOf(target.control),
        heldKeys: null,
        holdActive: false,
        watchdog: null,
      }
      this.pending.set(key, state)
    } else {
      state.control = target.control
      state.label = target.label
      if (target.clientId) state.clientId = target.clientId
      state.holdKeys = holdKeysOf(target.control)
    }

    // A gesture on another control must not strand the previous gesture's
    // held keys. The release is queued synchronously before any new down/chord.
    if (this.held && this.held !== state) {
      void this.releaseHold(this.held, 'another control started')
    }

    switch (message.phase) {
      case 'start':
        this.cancelTimer(state)
        state.delta = 0
        state.value = null
        this.touchWatchdog(state)
        return Promise.resolve({ ok: true })
      case 'move': {
        if (this.isValueControl(target.control)) {
          const value = message.value
          if (value !== undefined && Number.isFinite(value)) {
            state.value = Math.max(0, Math.min(1, value))
          }
        } else {
          const delta = message.delta
          if (delta !== undefined && Number.isFinite(delta)) {
            state.delta += delta
            // Hold modifiers from the first actual movement, never from start.
            if (delta !== 0 && target.control.binding.type === 'shortcut') {
              this.pressHold(state)
            }
          }
        }
        this.touchWatchdog(state)
        this.schedule(state)
        return Promise.resolve({ ok: true })
      }
      case 'end': {
        this.cancelTimer(state)
        const current = state
        return this.flush(current, true).then(async (result) => {
          await this.releaseHold(current, 'gesture ended')
          this.clearWatchdog(current)
          if (!current.running && current.delta === 0 && current.value === null) {
            this.pending.delete(key)
          }
          return result
        })
      }
    }
  }

  /** Abort every gesture and release held shortcut keys. */
  async cancel(reason = 'control input cancelled'): Promise<void> {
    if (this.held) await this.releaseHold(this.held, reason)
    for (const state of this.pending.values()) {
      this.cancelTimer(state)
      this.clearWatchdog(state)
      state.delta = 0
      state.value = null
    }
  }

  /** Release keys held by this connection; call from the WS close handler. */
  clientDisconnected(clientId: string): void {
    for (const state of this.pending.values()) {
      if (state.clientId !== clientId) continue
      this.cancelTimer(state)
      state.delta = 0
      state.value = null
    }
    const held = this.held
    if (!held) return
    if (held.clientId && held.clientId !== clientId) return
    void this.releaseHold(held, 'control client disconnected')
  }

  /** Release held keys and stop all timers. Safe to call twice. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.held) await this.releaseHold(this.held, 'control input shutting down')
    for (const state of this.pending.values()) {
      this.cancelTimer(state)
      this.clearWatchdog(state)
    }
    this.pending.clear()
  }

  private isValueControl(control: ControlSpec): boolean {
    if (control.binding.type === 'mic') return true
    if (control.binding.type === 'obs') return true
    return control.binding.type === 'volume' && control.binding.mode === 'absolute'
  }

  private unsupportedReason(control: ControlSpec): string | null {
    if (this.isValueControl(control)) {
      if (control.emit !== 'value') {
        if (control.binding.type === 'mic') return 'Mic gain requires a value control.'
        if (control.binding.type === 'obs') return 'OBS input volume requires a value control.'
        return 'Absolute volume requires a value control.'
      }
      if (!this.applyAbsolute) {
        if (control.binding.type === 'mic') return 'Microphone gain is not available on this desktop.'
        if (control.binding.type === 'obs') return 'OBS input volume is not available on this desktop.'
        return 'Absolute volume is not available on this desktop.'
      }
      return null
    }
    if (control.emit !== 'delta') {
      return 'Absolute controls are not supported yet. Use a relative control.'
    }
    if (
      control.binding.type !== 'volume' &&
      control.binding.type !== 'scroll' &&
      control.binding.type !== 'shortcut'
    ) {
      return 'This control binding is not supported yet.'
    }
    return null
  }

  /** Whether accumulated movement is worth flushing now. */
  private ready(state: PendingControl): boolean {
    if (state.value !== null) return true
    if (state.delta === 0) return false
    if (state.control.binding.type !== 'shortcut') return true
    return Math.abs(state.delta) >= shortcutDeltaPerStep(state.control) - EPSILON
  }

  private schedule(state: PendingControl): void {
    if (state.timer || state.running || !this.ready(state)) return
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

    let delta = state.delta
    if (state.control.binding.type === 'shortcut') {
      // Fire only whole slices; keep the remainder for the next move. At the
      // end of a gesture the sub-slice remainder is simply dropped.
      const step = shortcutDeltaPerStep(state.control)
      const slices = Math.trunc(delta / step)
      if (slices === 0) {
        if (force) state.delta = 0
        return { ok: true }
      }
      delta = slices * step
      state.delta -= delta
      if (force) state.delta = 0
    } else {
      // A capped batch consumes the accumulated delta; e.g. 100 volume units
      // become at most 20 media steps.
      state.delta = 0
    }

    const actions = controlToActions(state.control, delta)
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
    } else if (this.ready(state)) {
      this.schedule(state)
    }
    return result
  }

  /**
   * Press the gesture's hold keys exactly once, on the first non-zero move.
   * `execute` is serialized, so this down is queued before every chord flush.
   */
  private pressHold(state: PendingControl): void {
    if (state.holdActive || !state.holdKeys || state.holdKeys.length === 0) return
    if (this.held && this.held !== state) {
      void this.releaseHold(this.held, 'another control started')
    }
    state.holdActive = true
    this.held = state
    this.touchWatchdog(state)
    const keys = [...state.holdKeys]
    state.heldKeys = [...keys]
    this.logger?.info(`Holding ${keys.join('+')} for "${state.label}"`)
    void this.runHold(state, { type: 'hotkey', keys, holdMs: 0, action: 'down' })
  }

  private async releaseHold(state: PendingControl, reason: string): Promise<void> {
    this.clearWatchdog(state)
    if (!state.holdActive) {
      if (this.held === state) this.held = null
      return
    }
    state.holdActive = false
    if (this.held === state) this.held = null
    const keys = state.heldKeys ?? state.holdKeys
    state.heldKeys = null
    if (!keys || keys.length === 0) return
    this.logger?.info(`Releasing ${keys.join('+')} for "${state.label}" (${reason})`)
    await this.runHold(state, { type: 'hotkey', keys: [...keys], holdMs: 0, action: 'up' })
  }

  private async runHold(state: PendingControl, action: Action): Promise<void> {
    try {
      const result = await this.execute([action], `${state.label} hold`)
      if (!result.ok) {
        this.logger?.warn(`Shortcut hold failed for "${state.label}": ${result.error ?? 'unknown error'}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Shortcut hold failed for "${state.label}": ${message}`)
    }
  }

  private touchWatchdog(state: PendingControl): void {
    this.clearWatchdog(state)
    if (!state.holdActive) return
    state.watchdog = setTimeout(() => {
      state.watchdog = null
      void this.onWatchdog(state)
    }, this.watchdogMs)
    state.watchdog.unref?.()
  }

  private async onWatchdog(state: PendingControl): Promise<void> {
    if (this.disposed || !state.holdActive) return
    this.logger?.warn(`Shortcut hold timed out for "${state.label}"; releasing keys`)
    this.cancelTimer(state)
    state.delta = 0
    await this.releaseHold(state, 'stuck-key watchdog')
  }

  private clearWatchdog(state: PendingControl): void {
    if (!state.watchdog) return
    clearTimeout(state.watchdog)
    state.watchdog = null
  }
}
