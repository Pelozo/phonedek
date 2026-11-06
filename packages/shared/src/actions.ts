import type {
  Action,
  KeyboardPlanStep,
  MacroStep,
  PagePlanStep,
  PlanStep,
} from './types'
import { normalizeCombo, isModifier } from './keys'

const DEFAULT_HOLD_MS = 35
const DEFAULT_CHAR_MS = 4

export interface PlanOptions {
  holdMs?: number
  perCharMs?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function stepToPlan(step: MacroStep, options: PlanOptions): KeyboardPlanStep {
  switch (step.type) {
    case 'hotkey':
      return {
        kind: 'keys',
        keys: normalizeCombo(step.keys),
        holdMs: clamp(step.holdMs ?? options.holdMs ?? DEFAULT_HOLD_MS, 0, 5000),
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
      }
  }
}

/**
 * Flatten a button's actions into an ordered execution plan.
 * Page actions are returned as units; the phone normally handles them locally,
 * while the desktop executor ignores them.
 */
export function actionsToPlan(actions: readonly Action[], options: PlanOptions = {}): PlanStep[] {
  const plan: PlanStep[] = []
  for (const action of actions) {
    switch (action.type) {
      case 'hotkey':
      case 'text':
      case 'media':
      case 'delay':
        plan.push(stepToPlan(action, options))
        break
      case 'macro':
        for (const step of action.steps) plan.push(stepToPlan(step, options))
        break
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
    }
  }
  return plan
}

export function pageActions(actions: readonly Action[]): PagePlanStep[] {
  return actionsToPlan(actions).filter((step): step is PagePlanStep => step.kind === 'page')
}

export function hasHostActions(actions: readonly Action[]): boolean {
  return actionsToPlan(actions).some((step) => step.kind !== 'page')
}

/* ------------------------------------------------------------------ */
/* Macro recorder                                                      */
/* ------------------------------------------------------------------ */

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
  private steps: MacroStep[] = []
  private held = new Set<string>()
  private heldOrder: string[] = []
  private pendingText = ''
  private lastTime: number | null = null
  private started = false
  private finished = false

  get isRecording(): boolean {
    return this.started && !this.finished
  }

  getSteps(): MacroStep[] {
    return structuredClone(this.steps)
  }

  record(event: RawKeyEvent): void {
    if (this.finished) return
    if (!this.started) {
      this.started = true
      this.lastTime = event.time
    }
    if (event.kind === 'down') this.onDown(event.key, event.time)
    else this.onUp(event.key, event.time)
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
          if (gap >= DELAY_THRESHOLD_MS && this.steps.length > 0) {
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

    const text = chordToText(chord)
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
    case 'hotkey':
      return step.keys.map((key) => key.length === 1 ? key.toUpperCase() : key).join(' + ')
    case 'text': {
      const oneLine = step.text.replace(/\s+/g, ' ').trim()
      return oneLine.length > 42 ? `"${oneLine.slice(0, 39)}…"` : `"${oneLine}"`
    }
    case 'delay':
      return `Wait ${step.ms} ms`
    case 'media':
      return `Media: ${step.key}`
    case 'mouse':
      return `Mouse ${step.action} (${step.button})`
  }
}

export function describeAction(action: Action): string {
  switch (action.type) {
    case 'hotkey':
      return action.keys.map((key) => key.length === 1 ? key.toUpperCase() : key).join(' + ')
    case 'text':
      return `Type "${action.text.replace(/\s+/g, ' ').slice(0, 36)}"`
    case 'macro':
      return `Macro · ${action.steps.length} step${action.steps.length === 1 ? '' : 's'}`
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
  }
}
