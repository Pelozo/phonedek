import type {
  Action,
  ControlSpec,
  ExecutableAction,
  KeyboardPlanStep,
  MacroStep,
  PagePlanStep,
  PlanStep,
} from './types'
import { normalizeCombo, isModifier, formatCombo } from './keys'

const DEFAULT_HOLD_MS = 35
const DEFAULT_CHAR_MS = 4

export interface PlanOptions {
  holdMs?: number
  perCharMs?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function stepToPlan(step: MacroStep, options: PlanOptions): PlanStep {
  switch (step.type) {
    case 'hotkey':
      return {
        kind: 'keys',
        keys: normalizeCombo(step.keys),
        holdMs: clamp(step.holdMs ?? options.holdMs ?? DEFAULT_HOLD_MS, 0, 5000),
        action: step.action ?? 'press',
      }
    case 'text':
      return {
        kind: 'text',
        text: step.text,
        perCharMs: clamp(step.perCharMs ?? options.perCharMs ?? DEFAULT_CHAR_MS, 0, 1000),
      }
    case 'delay':
      return { kind: 'delay', ms: clamp(step.ms, 0, 60_000) }
    case 'media':
      return { kind: 'media', key: step.key }
    case 'mouse':
      return {
        kind: 'mouse',
        button: step.button,
        action: step.action,
        ...(step.x !== undefined ? { x: step.x } : {}),
        ...(step.y !== undefined ? { y: step.y } : {}),
        ...(step.direction ? { direction: step.direction } : {}),
        ...(step.amount !== undefined ? { amount: clamp(step.amount, 1, 100) } : {}),
      }
    case 'launch':
      return { kind: 'launch', path: step.path, args: step.args ?? [] }
    case 'url':
      return { kind: 'url', url: step.url }
    case 'command':
      return {
        kind: 'command',
        command: step.command,
        ...(step.cwd ? { cwd: step.cwd } : {}),
        hidden: step.hidden ?? true,
      }
  }
}

/**
 * Flatten a button's actions into an ordered execution plan.
 * Page actions are returned as units; the phone normally handles them locally,
 * while the desktop executor ignores them.
 */
export function actionsToPlan(actions: readonly ExecutableAction[], options: PlanOptions = {}): PlanStep[] {
  const plan: PlanStep[] = []
  for (const action of actions) {
    switch (action.type) {
      case 'hotkey':
      case 'text':
      case 'media':
      case 'delay':
        plan.push(stepToPlan(action, options))
        break
      case 'macro': {
        const repeat = clamp(action.repeat ?? 1, 1, 50)
        const repeatDelay = clamp(action.repeatDelayMs ?? 0, 0, 60_000)
        for (let run = 0; run < repeat; run += 1) {
          for (const step of action.steps) plan.push(stepToPlan(step, options))
          if (run < repeat - 1 && repeatDelay > 0) plan.push({ kind: 'delay', ms: repeatDelay })
        }
        break
      }
      case 'launch':
        plan.push({ kind: 'launch', path: action.path, args: action.args ?? [] })
        break
      case 'url':
        plan.push({ kind: 'url', url: action.url })
        break
      case 'command':
        plan.push({
          kind: 'command',
          command: action.command,
          ...(action.cwd ? { cwd: action.cwd } : {}),
          hidden: action.hidden ?? true,
        })
        break
      case 'page':
        plan.push({
          kind: 'page',
          direction: action.direction,
          ...(action.pageId ? { pageId: action.pageId } : {}),
        })
        break
      case 'mic':
        plan.push({ kind: 'mic', action: action.action })
        break
      case 'obs':
        plan.push({
          kind: 'obs',
          action: action.action,
          ...(action.input ? { input: action.input } : {}),
        })
        break
    }
  }
  return plan
}

export function pageActions(actions: readonly ExecutableAction[]): PagePlanStep[] {
  return actionsToPlan(actions).filter((step): step is PagePlanStep => step.kind === 'page')
}

export function hasHostActions(actions: readonly ExecutableAction[]): boolean {
  return actionsToPlan(actions).some((step) => step.kind !== 'page')
}

/* ------------------------------------------------------------------ */
/* Continuous controls                                                 */
/* ------------------------------------------------------------------ */

/**
 * Convert the MVP control bindings into existing actions.
 *
 * - `volume` (relative): one media volume step per unit of delta, capped at 20.
 *   `stepPercent` is display metadata for now, not applied here.
 * - `scroll`: one macro containing a mouse wheel action; positive delta means
 *   up/right, negative means down/left, flipped by `invert`. Amount is capped
 *   at 100.
 *
 * Absolute/value controls and trackpad (pointer) controls return an empty batch.
 */
export function controlToActions(control: ControlSpec, delta: number): Action[] {
  // Pointer input travels over the `pointer` message; never synthesise actions.
  if (control.kind === 'trackpad') return []
  if (!Number.isFinite(delta) || delta === 0) return []
  if (control.binding.type === 'mic') return []
  if (control.binding.type === 'obs') return []
  if (control.binding.type === 'volume' && control.binding.mode === 'absolute') return []
  const magnitude = Math.ceil(Math.abs(delta))

  switch (control.binding.type) {
    case 'volume': {
      const steps = Math.max(1, Math.min(20, magnitude))
      const key: 'volumeup' | 'volumedown' = delta > 0 ? 'volumeup' : 'volumedown'
      const actions: Action[] = []
      for (let index = 0; index < steps; index += 1) actions.push({ type: 'media', key })
      return actions
    }
    case 'scroll': {
      const amount = Math.max(1, Math.min(100, magnitude))
      const positive = (delta > 0) !== (control.binding.invert ?? false)
      const direction: 'up' | 'down' | 'left' | 'right' =
        control.binding.axis === 'vertical'
          ? positive
            ? 'up'
            : 'down'
          : positive
            ? 'right'
            : 'left'
      return [
        {
          type: 'macro',
          steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction, amount }],
        },
      ]
    }
    default:
      return []
  }
}

/* ------------------------------------------------------------------ */
/* Macro recorder                                                      */
/* ------------------------------------------------------------------ */

export interface MacroRecorderOptions {
  /** Insert timed delays for pauses between actions. */
  captureDelays?: boolean
  /** Coalesce plain typing into text steps instead of individual key presses. */
  coalesceText?: boolean
}

export interface RawKeyEvent {
  kind: 'down' | 'up'
  /** Canonical key name from keyFromEvent(). */
  key: string
  /** Milliseconds. */
  time: number
}

const TEXT_GAP_MS = 500
const DELAY_THRESHOLD_MS = 140
const MAX_RECORDED_DELAY_MS = 2000

function chordToText(chord: readonly string[]): string | null {
  if (chord.length !== 1) return null
  const key = chord[0]!
  if (isModifier(key)) return null
  if (key === 'SPACE') return ' '
  if (key === 'ENTER') return '\n'
  if (key === 'TAB') return '\t'
  if (/^[A-Z]$/.test(key)) return key.toLowerCase()
  if (key.length === 1) return key
  return null
}

/**
 * Turns a live keyboard stream into macro steps:
 * - chords become `hotkey` steps,
 * - plain typing is coalesced into `text` steps,
 * - human pauses become bounded `delay` steps.
 */
export class MacroRecorder {
  private readonly options: Required<MacroRecorderOptions>
  private steps: MacroStep[] = []
  private held = new Set<string>()
  private heldOrder: string[] = []
  private pendingText = ''
  private lastTime: number | null = null
  private started = false
  private finished = false
  private paused = false

  constructor(options: MacroRecorderOptions = {}) {
    this.options = { captureDelays: options.captureDelays ?? true, coalesceText: options.coalesceText ?? true }
  }

  get isRecording(): boolean {
    return this.started && !this.finished
  }

  get isPaused(): boolean {
    return this.paused
  }

  getSteps(): MacroStep[] {
    return structuredClone(this.steps)
  }

  /** Steps plus the text currently being typed, for a live preview. */
  getPreviewSteps(): MacroStep[] {
    const preview = structuredClone(this.steps)
    if (this.pendingText) preview.push({ type: 'text', text: this.pendingText })
    return preview
  }

  get canUndo(): boolean {
    return this.pendingText.length > 0 || this.steps.length > 0
  }

  record(event: RawKeyEvent): void {
    if (this.finished || this.paused) return
    if (!this.started) {
      this.started = true
      this.lastTime = event.time
    }
    if (event.kind === 'down') this.onDown(event.key, event.time)
    else this.onUp(event.key, event.time)
  }

  pause(time: number): void {
    if (this.finished) return
    this.flushText()
    this.paused = true
    this.lastTime = time
    this.held.clear()
    this.heldOrder = []
  }

  resume(time: number): void {
    if (this.finished) return
    this.paused = false
    this.lastTime = time
  }

  /** Remove the most recently completed step (or the pending text buffer). */
  undoLast(): MacroStep[] {
    if (this.finished) return this.getSteps()
    if (this.pendingText) {
      this.pendingText = ''
    } else {
      this.steps.pop()
    }
    return this.getSteps()
  }

  finish(): MacroStep[] {
    if (this.finished) return this.getSteps()
    this.flushText()
    this.finished = true
    this.held.clear()
    this.heldOrder = []
    return this.getSteps()
  }

  cancel(): void {
    this.steps = []
    this.pendingText = ''
    this.held.clear()
    this.heldOrder = []
    this.started = false
    this.finished = true
    this.paused = false
  }

  private onDown(key: string, time: number): void {
    if (this.held.has(key)) {
      this.lastTime = time
      return
    }

    if (this.lastTime !== null) {
      const gap = time - this.lastTime
      if (gap > 0) {
        if (this.pendingText && gap < TEXT_GAP_MS) {
          // Keep typing as one text step.
        } else {
          this.flushText()
          if (this.options.captureDelays && gap >= DELAY_THRESHOLD_MS && this.steps.length > 0) {
            this.pushDelay(Math.min(gap, MAX_RECORDED_DELAY_MS))
          }
        }
      }
    }

    this.held.add(key)
    this.heldOrder.push(key)
    this.lastTime = time
  }

  private onUp(key: string, time: number): void {
    if (!this.held.has(key)) return
    this.lastTime = time

    const chord = normalizeCombo(this.heldOrder)
    const hasNonModifier = chord.some((candidate) => !isModifier(candidate))

    this.held.delete(key)
    this.heldOrder = this.heldOrder.filter((candidate) => candidate !== key && this.held.has(candidate))

    if (!hasNonModifier) return

    const text = this.options.coalesceText ? chordToText(chord) : null
    if (text !== null) {
      this.pendingText += text
    } else {
      this.flushText()
      this.pushHotkey(chord)
    }

    // The non-modifier part of the chord is consumed. Keep only modifiers that
    // are still physically held so the next chord (e.g. Ctrl+C, Ctrl+V) works.
    for (const candidate of [...this.held]) {
      if (!isModifier(candidate)) {
        this.held.delete(candidate)
        this.heldOrder = this.heldOrder.filter((heldKey) => heldKey !== candidate)
      }
    }
  }

  private flushText(): void {
    if (!this.pendingText) return
    this.steps.push({ type: 'text', text: this.pendingText })
    this.pendingText = ''
  }

  private pushHotkey(keys: string[]): void {
    this.steps.push({ type: 'hotkey', keys })
  }

  private pushDelay(ms: number): void {
    const last = this.steps[this.steps.length - 1]
    if (last?.type === 'delay') {
      last.ms = Math.min(MAX_RECORDED_DELAY_MS, last.ms + Math.round(ms))
      return
    }
    this.steps.push({ type: 'delay', ms: Math.round(ms) })
  }
}

/** Human-readable single-line summary used in the action list. */
export function describeStep(step: MacroStep): string {
  switch (step.type) {
    case 'hotkey': {
      const combo = step.keys.map((key) => key.length === 1 ? key.toUpperCase() : key).join(' + ')
      if (step.action === 'down') return `Hold ${combo}`
      if (step.action === 'up') return `Release ${combo}`
      return combo
    }
    case 'text': {
      const oneLine = step.text.replace(/\s+/g, ' ').trim()
      return oneLine.length > 42 ? `"${oneLine.slice(0, 39)}…"` : `"${oneLine}"`
    }
    case 'delay':
      return `Wait ${step.ms} ms`
    case 'media':
      return `Media: ${step.key}`
    case 'mouse': {
      if (step.action === 'move') return `Move mouse to ${step.x ?? '?'}, ${step.y ?? '?'}`
      if (step.action === 'scroll') return `Scroll ${step.direction ?? 'down'} ${step.amount ?? 1}`
      return `Mouse ${step.action} (${step.button})`
    }
    case 'launch':
      return `Launch ${step.path.split(/[\\/]/).pop() ?? step.path}`
    case 'url':
      return `Open ${step.url}`
    case 'command':
      return `Run: ${step.command.slice(0, 42)}`
  }
}

export function describeAction(action: ExecutableAction, platform?: string): string {
  switch (action.type) {
    case 'hotkey':
      return formatCombo(action.keys, platform)
    case 'text':
      return `Type "${action.text.replace(/\s+/g, ' ').slice(0, 36)}"`
    case 'macro': {
      const repeat = action.repeat && action.repeat > 1 ? ` ×${action.repeat}` : ''
      return `Macro · ${action.steps.length} step${action.steps.length === 1 ? '' : 's'}${repeat}`
    }
    case 'launch':
      return `Launch ${action.path.split(/[\\/]/).pop() ?? action.path}`
    case 'url':
      return `Open ${action.url}`
    case 'command':
      return `Run: ${action.command.slice(0, 42)}`
    case 'media':
      return `Media: ${action.key}`
    case 'delay':
      return `Wait ${action.ms} ms`
    case 'page':
      return action.direction === 'goto'
        ? 'Go to page'
        : action.direction === 'next'
          ? 'Next page'
          : 'Previous page'
    case 'mic':
      return 'Toggle microphone mute'
    case 'obs':
      return action.input ? `Mute OBS "${action.input}"` : 'Mute OBS input'
  }
}
