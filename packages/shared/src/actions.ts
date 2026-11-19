import type {
  Action,
  AppVolumeAction,
  AppVolumePlanStep,
  AudioDeviceAction,
  AudioDevicePlanStep,
  AudioDeviceRef,
  ConfigAction,
  ControlSpec,
  ExecutableAction,
  KeyboardPlanStep,
  LightAction,
  LightPlanStep,
  MacroStep,
  MouseButton,
  MouseStep,
  ObsAction,
  ObsPlanStep,
  PagePlanStep,
  PlannableAction,
  PlanStep,
  RigRunAction,
  StreamerBotAction,
  StreamerBotPlanStep,
  TwitchAction,
  TwitchPlanStep,
} from './types'
import { normalizeCombo, normalizeModifiers, isModifier, formatCombo } from './keys'

const DEFAULT_HOLD_MS = 35
const DEFAULT_CHAR_MS = 4
const DEFAULT_SHORTCUT_TRAVEL_STEPS = 20
/** One flush never emits more than this many chords (repeat included). */
export const MAX_SHORTCUT_CHORDS_PER_FLUSH = 10

/** Raw input delta that corresponds to one shortcut chord slice. */
export function shortcutDeltaPerStep(control: ControlSpec): number {
  if (control.binding.type !== 'shortcut') return 1
  if (control.kind === 'dial') return 1
  const steps = control.binding.travelSteps ?? DEFAULT_SHORTCUT_TRAVEL_STEPS
  return 100 / steps
}

function shortcutChordCount(control: ControlSpec, delta: number): number {
  if (control.binding.type !== 'shortcut') return 0
  const repeat = Math.max(1, Math.min(5, Math.round(control.binding.repeat ?? 1)))
  const magnitude = Math.abs(delta)
  // Sliders emit one chord per travel slice; dials emit one per detent/unit.
  const slices =
    control.kind === 'slider'
      ? Math.round((magnitude * (control.binding.travelSteps ?? DEFAULT_SHORTCUT_TRAVEL_STEPS)) / 100)
      : Math.round(magnitude)
  return Math.max(0, Math.min(MAX_SHORTCUT_CHORDS_PER_FLUSH, slices * repeat))
}

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

/** Map every OBS action variant to its plan step, dropping absent optional fields. */
function obsActionToPlan(action: ObsAction): ObsPlanStep {
  switch (action.action) {
    case 'toggleMute':
      return { kind: 'obs', action: 'toggleMute', ...(action.input ? { input: action.input } : {}) }
    case 'setScene':
      return { kind: 'obs', action: 'setScene', ...(action.scene ? { scene: action.scene } : {}) }
    case 'toggleStream':
    case 'startStream':
    case 'stopStream':
    case 'toggleRecord':
    case 'startRecord':
    case 'stopRecord':
    case 'startReplay':
    case 'stopReplay':
    case 'toggleReplay':
    case 'saveReplay':
    case 'toggleVirtualCam':
      return { kind: 'obs', action: action.action }
    case 'setSourceVisibility':
      return {
        kind: 'obs',
        action: 'setSourceVisibility',
        ...(action.scene ? { scene: action.scene } : {}),
        source: action.source,
        visible: action.visible,
      }
    case 'toggleSourceVisibility':
      return {
        kind: 'obs',
        action: 'toggleSourceVisibility',
        ...(action.scene ? { scene: action.scene } : {}),
        source: action.source,
      }
    case 'addMarker':
      return { kind: 'obs', action: 'addMarker', ...(action.name ? { name: action.name } : {}) }
  }
}

/** Map every Twitch action variant to its plan step. */
function twitchActionToPlan(action: TwitchAction): TwitchPlanStep {
  switch (action.action) {
    case 'sendChat':
      return { kind: 'twitch', action: 'sendChat', message: action.message }
    case 'createMarker':
      return {
        kind: 'twitch',
        action: 'createMarker',
        ...(action.description ? { description: action.description } : {}),
      }
    case 'setTitle':
      return { kind: 'twitch', action: 'setTitle', title: action.title }
    case 'setGame':
      return { kind: 'twitch', action: 'setGame', game: action.game }
  }
}

/** Map every local-light action variant to its plan step. */
function lightActionToPlan(action: LightAction): LightPlanStep {
  switch (action.action) {
    case 'setPower':
      return {
        kind: 'light',
        action: 'setPower',
        ...(action.light ? { light: action.light } : {}),
        on: action.on,
      }
    case 'togglePower':
      return {
        kind: 'light',
        action: 'togglePower',
        ...(action.light ? { light: action.light } : {}),
      }
  }
}

/** Map every per-app volume action variant to its plan step. */
function appVolumeActionToPlan(action: AppVolumeAction): AppVolumePlanStep {
  switch (action.action) {
    case 'setMute':
      return {
        kind: 'appVolume',
        action: 'setMute',
        match: { ...action.match },
        muted: action.muted,
      }
    case 'toggleMute':
      return {
        kind: 'appVolume',
        action: 'toggleMute',
        match: { ...action.match },
      }
  }
}

/** Copy a Streamer.bot action into its plan step (args are cloned). */
function streamerBotActionToPlan(action: StreamerBotAction): StreamerBotPlanStep {
  return {
    kind: 'streamerbot',
    action: 'doAction',
    actionName: action.actionName,
    ...(action.args ? { args: { ...action.args } } : {}),
  }
}

function copyDeviceRef(ref: AudioDeviceRef): AudioDeviceRef {
  return {
    ...(ref.id !== undefined ? { id: ref.id } : {}),
    ...(ref.name !== undefined ? { name: ref.name } : {}),
  }
}

/** Map every audio-device variant to its plan step (refs are cloned). */
function audioDeviceActionToPlan(action: AudioDeviceAction): AudioDevicePlanStep {
  if (action.action === 'set') {
    return {
      kind: 'audioDevice',
      action: 'set',
      deviceKind: action.kind,
      device: copyDeviceRef(action.device),
      ...(action.allRoles !== undefined ? { allRoles: action.allRoles } : {}),
    }
  }
  return {
    kind: 'audioDevice',
    action: 'cycle',
    deviceKind: action.kind,
    devices: action.devices.map(copyDeviceRef),
    ...(action.allRoles !== undefined ? { allRoles: action.allRoles } : {}),
  }
}

/**
 * Flatten a button's actions into an ordered execution plan.
 * Page actions are returned as units; the phone normally handles them locally,
 * while the desktop executor ignores them.
 */
export function actionsToPlan(
  actions: readonly (
    | ConfigAction
    | AppVolumeAction
    | StreamerBotAction
    | RigRunAction
    | AudioDeviceAction
  )[],
  options: PlanOptions = {},
): PlanStep[] {
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
        plan.push(obsActionToPlan(action))
        break
      case 'twitch':
        plan.push(twitchActionToPlan(action))
        break
      case 'light':
        plan.push(lightActionToPlan(action))
        break
      case 'appVolume':
        plan.push(appVolumeActionToPlan(action))
        break
      case 'streamerbot':
        plan.push(streamerBotActionToPlan(action))
        break
      case 'audioDevice':
        plan.push(audioDeviceActionToPlan(action))
        break
      case 'keyboard':
        // Phone-local launcher: the phone opens its keyboard panel without a
        // press, and the desktop never sees a plan step for it.
        break
      case 'mixer':
        // Phone-local per-app mixer launcher; no desktop plan step.
        break
      case 'rig':
        // A rig starts through the desktop rig runner, not as an inline plan
        // step. `rigToPlan` expands its steps; this plain plan stays empty.
        break
    }
  }
  return plan
}

export function pageActions(actions: readonly ConfigAction[]): PagePlanStep[] {
  return actionsToPlan(actions).filter((step): step is PagePlanStep => step.kind === 'page')
}

export function hasHostActions(actions: readonly ConfigAction[]): boolean {
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
 *   at 100. When `modifiers` is set the same macro also presses each modifier
 *   down before the wheel and releases them in reverse order after it, so the
 *   release steps are part of the plan even if wheel dispatch fails.
 * - `shortcut`: repeated `hotkey` actions; positive delta uses `keys` and
 *   negative uses `reverseKeys ?? keys`. Sliders emit one chord per
 *   `travelSteps` slice (a 100-unit full travel), dials one per detent. `repeat`
 *   multiplies the chord and the whole batch is capped at 10. `holdKeys` are
 *   managed by the desktop router and never become press actions.
 *
 * Absolute/value controls and trackpad (pointer) controls return an empty batch.
 */
export function controlToActions(control: ControlSpec, delta: number): Action[] {
  // Pointer input travels over the `pointer` message; never synthesise actions.
  if (control.kind === 'trackpad') return []
  if (!Number.isFinite(delta) || delta === 0) return []
  if (control.binding.type === 'mic') return []
  if (control.binding.type === 'obs') return []
  if (control.binding.type === 'light') return []
  if (control.binding.type === 'appVolume') return []
  if (control.binding.type === 'volume' && control.binding.mode === 'absolute') return []
  const magnitude = Math.ceil(Math.abs(delta))

  switch (control.binding.type) {
    case 'shortcut': {
      const count = shortcutChordCount(control, delta)
      if (count === 0) return []
      const chord = normalizeCombo(
        delta > 0 ? control.binding.keys : (control.binding.reverseKeys ?? control.binding.keys),
      )
      const actions: Action[] = []
      for (let index = 0; index < count; index += 1) {
        actions.push({ type: 'hotkey', keys: [...chord] })
      }
      return actions
    }
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
      const wheel: MacroStep = {
        type: 'mouse',
        button: 'left',
        action: 'scroll',
        direction,
        amount,
      }
      // Ignore invalid hand-edited modifiers rather than breaking a gesture;
      // the schema already rejects them on save.
      let modifiers: string[] = []
      try {
        modifiers = normalizeModifiers(control.binding.modifiers ?? [])
      } catch {
        modifiers = []
      }
      if (modifiers.length === 0) {
        return [{ type: 'macro', steps: [wheel] }]
      }
      return [
        {
          type: 'macro',
          steps: [
            ...modifiers.map((key): MacroStep => ({ type: 'hotkey', keys: [key], action: 'down' })),
            wheel,
            ...modifiers
              .slice()
              .reverse()
              .map((key): MacroStep => ({ type: 'hotkey', keys: [key], action: 'up' })),
          ],
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
  /** Record mouse buttons and wheel steps. Default true. */
  captureMouse?: boolean
  /** Record free mouse movement; drag paths are always recorded. Default false. */
  captureMouseMove?: boolean
  /** Minimum distance in screen pixels between recorded move steps. Default 4. */
  mouseMoveMinPx?: number
  /** Minimum time in milliseconds between recorded move steps. Default 40. */
  mouseMoveMinMs?: number
  /** Hard cap on recorded move steps per recording. Default 500. */
  maxMouseMoves?: number
}

export interface RawKeyEvent {
  kind: 'down' | 'up'
  /** Canonical key name from keyFromEvent(). */
  key: string
  /** Milliseconds. */
  time: number
}

/** Absolute screen coordinates throughout, matching the existing MouseStep. */
export interface RawMouseButtonEvent {
  kind: 'down' | 'up'
  button: MouseButton
  x: number
  y: number
  /** Milliseconds. */
  time: number
}

export interface RawMouseMoveEvent {
  kind: 'move'
  x: number
  y: number
  /** Milliseconds. */
  time: number
}

export interface RawMouseWheelEvent {
  kind: 'wheel'
  direction: 'up' | 'down' | 'left' | 'right'
  /** Positive notches, 1..100. Derived from rotation when omitted. */
  amount?: number
  /** Raw signed wheel rotation from the OS hook. */
  rotation?: number
  /** Milliseconds. */
  time: number
}

export type RawMouseEvent = RawMouseButtonEvent | RawMouseMoveEvent | RawMouseWheelEvent
/** Everything the recorder understands; key events have a `key` field. */
export type RawMacroEvent = RawKeyEvent | RawMouseEvent

const TEXT_GAP_MS = 500
const DELAY_THRESHOLD_MS = 140
const MAX_RECORDED_DELAY_MS = 2000
const DEFAULT_MOUSE_MOVE_MIN_PX = 4
const DEFAULT_MOUSE_MOVE_MIN_MS = 40
const DEFAULT_MAX_MOUSE_MOVES = 500

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

/** Normalize a wheel event to 1..100 notches; fall back to raw rotation. */
function wheelAmount(amount: number | undefined, rotation: number | undefined): number {
  const clicks =
    Number.isFinite(amount) && (amount as number) > 0
      ? (amount as number)
      : Number.isFinite(rotation)
        ? Math.abs(rotation as number) >= 120
          ? Math.abs(rotation as number) / 120
          : Math.abs(rotation as number)
        : 1
  return Math.max(1, Math.min(100, Math.round(clicks)))
}

/**
 * Turns a live keyboard/mouse stream into macro steps:
 * - chords become `hotkey` steps,
 * - plain typing is coalesced into `text` steps,
 * - human pauses become bounded `delay` steps,
 * - buttons/wheel become `mouse` steps and drag paths become sampled moves.
 */
export class MacroRecorder {
  private readonly options: Required<MacroRecorderOptions>
  private steps: MacroStep[] = []
  private held = new Set<string>()
  private heldOrder: string[] = []
  /** Modifiers already emitted as explicit `action: 'down'` steps. */
  private emittedModifiers = new Set<string>()
  private buttonsDown = new Set<MouseButton>()
  private lastMove: { x: number; y: number; time: number } | null = null
  private mouseMoves = 0
  private pendingText = ''
  private lastTime: number | null = null
  private started = false
  private finished = false
  private paused = false

  constructor(options: MacroRecorderOptions = {}) {
    this.options = {
      captureDelays: options.captureDelays ?? true,
      coalesceText: options.coalesceText ?? true,
      captureMouse: options.captureMouse ?? true,
      captureMouseMove: options.captureMouseMove ?? false,
      mouseMoveMinPx: Math.max(0, options.mouseMoveMinPx ?? DEFAULT_MOUSE_MOVE_MIN_PX),
      mouseMoveMinMs: Math.max(0, options.mouseMoveMinMs ?? DEFAULT_MOUSE_MOVE_MIN_MS),
      maxMouseMoves: Math.max(0, Math.round(options.maxMouseMoves ?? DEFAULT_MAX_MOUSE_MOVES)),
    }
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

  record(event: RawMacroEvent): void {
    if (this.finished || this.paused) return
    if (!this.started) {
      this.started = true
      this.lastTime = event.time
    }
    if ('key' in event) {
      if (event.kind === 'down') this.onDown(event.key, event.time)
      else this.onUp(event.key, event.time)
      return
    }
    this.onMouse(event)
  }

  pause(time: number): void {
    if (this.finished) return
    this.flushText()
    this.releaseEmittedModifiers()
    this.paused = true
    this.lastTime = time
    this.held.clear()
    this.heldOrder = []
    this.buttonsDown.clear()
    this.lastMove = null
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
    this.releaseEmittedModifiers()
    this.finished = true
    this.held.clear()
    this.heldOrder = []
    this.buttonsDown.clear()
    return this.getSteps()
  }

  cancel(): void {
    this.steps = []
    this.pendingText = ''
    this.held.clear()
    this.heldOrder = []
    this.emittedModifiers.clear()
    this.buttonsDown.clear()
    this.lastMove = null
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

    // A modifier already emitted explicitly for a mouse action gets an explicit
    // release when the user lets it go (Shift-click / Ctrl-click replay order).
    if (this.emittedModifiers.has(key)) {
      this.held.delete(key)
      this.heldOrder = this.heldOrder.filter((candidate) => candidate !== key && this.held.has(candidate))
      this.emittedModifiers.delete(key)
      this.flushText()
      this.pushHotkey([key], 'up')
      return
    }

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
      // Modifiers already held by an explicit down step must not be pressed a
      // second time by the chord.
      const keys = chord.filter((candidate) => !this.emittedModifiers.has(candidate))
      if (keys.length > 0) this.pushHotkey(keys)
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

  /* -------------------------- mouse recording -------------------------- */

  private onMouse(event: RawMouseEvent): void {
    if (!this.options.captureMouse) return

    if (event.kind === 'move') {
      this.onMouseMove(event)
      return
    }

    this.beforeMouseAction(event.time)

    if (event.kind === 'wheel') {
      const amount = wheelAmount(event.amount, event.rotation)
      this.pushMouse({ type: 'mouse', button: 'middle', action: 'scroll', direction: event.direction, amount })
      return
    }

    const x = Math.round(event.x)
    const y = Math.round(event.y)
    if (event.kind === 'down') this.buttonsDown.add(event.button)
    else this.buttonsDown.delete(event.button)
    // Anchor movement sampling at each button event so a 1px jitter right
    // after pressing does not become the first drag point.
    this.lastMove = { x, y, time: event.time }
    this.pushMouse({ type: 'mouse', button: event.button, action: event.kind, x, y })
  }

  private onMouseMove(event: RawMouseMoveEvent): void {
    const dragging = this.buttonsDown.size > 0
    if (!dragging && !this.options.captureMouseMove) return
    if (this.mouseMoves >= this.options.maxMouseMoves) return

    const x = Math.round(event.x)
    const y = Math.round(event.y)
    const previous = this.lastMove
    if (previous) {
      const dx = x - previous.x
      const dy = y - previous.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < this.options.mouseMoveMinPx) return
      if (event.time - previous.time < this.options.mouseMoveMinMs) return
      // Duplicate coordinates are pure jitter even with a stale timestamp.
      if (distance === 0) return
    }

    this.lastMove = { x, y, time: event.time }
    this.mouseMoves += 1
    this.lastTime = event.time
    this.pushMouse({ type: 'mouse', button: 'middle', action: 'move', x, y })
  }

  /** Flush text, add a bounded pause and emit modifier-down steps before a click. */
  private beforeMouseAction(time: number): void {
    this.flushText()
    if (this.lastTime !== null) {
      const gap = time - this.lastTime
      if (gap > 0 && this.options.captureDelays && gap >= DELAY_THRESHOLD_MS && this.steps.length > 0) {
        this.pushDelay(Math.min(gap, MAX_RECORDED_DELAY_MS))
      }
    }
    this.lastTime = time
    if (this.heldOrder.length > 0) {
      for (const key of normalizeCombo(this.heldOrder).filter((candidate) => isModifier(candidate))) {
        if (this.emittedModifiers.has(key)) continue
        this.emittedModifiers.add(key)
        this.pushHotkey([key], 'down')
      }
    }
  }

  private releaseEmittedModifiers(): void {
    if (this.emittedModifiers.size === 0) return
    for (const key of normalizeCombo([...this.emittedModifiers])) {
      this.pushHotkey([key], 'up')
    }
    this.emittedModifiers.clear()
  }

  private pushMouse(step: MouseStep): void {
    this.steps.push(step)
  }

  private flushText(): void {
    if (!this.pendingText) return
    this.steps.push({ type: 'text', text: this.pendingText })
    this.pendingText = ''
  }

  private pushHotkey(keys: string[], action?: 'down' | 'up'): void {
    this.steps.push(action ? { type: 'hotkey', keys, action } : { type: 'hotkey', keys })
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

export function describeAction(
  action: PlannableAction | AppVolumeAction | RigRunAction,
  platform?: string,
): string {  switch (action.type) {
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
      switch (action.action) {
        case 'toggleMute':
          return action.input ? `Mute OBS "${action.input}"` : 'Mute OBS input'
        case 'setScene':
          return action.scene ? `Switch OBS to "${action.scene}"` : 'Switch OBS scene'
        case 'toggleStream':
          return 'Toggle OBS stream'
        case 'startStream':
          return 'Start OBS stream'
        case 'stopStream':
          return 'Stop OBS stream'
        case 'toggleRecord':
          return 'Toggle OBS recording'
        case 'startRecord':
          return 'Start OBS recording'
        case 'stopRecord':
          return 'Stop OBS recording'
        case 'startReplay':
          return 'Start OBS replay buffer'
        case 'stopReplay':
          return 'Stop OBS replay buffer'
        case 'toggleReplay':
          return 'Toggle OBS replay buffer'
        case 'saveReplay':
          return 'Save OBS replay buffer'
        case 'toggleVirtualCam':
          return 'Toggle OBS virtual camera'
        case 'setSourceVisibility':
          return `${action.visible ? 'Show' : 'Hide'} OBS source "${action.source}"`
        case 'toggleSourceVisibility':
          return `Toggle OBS source "${action.source}"`
        case 'addMarker':
          return action.name ? `Add OBS marker "${action.name}"` : 'Add OBS chapter marker'
      }
    case 'twitch':
      switch (action.action) {
        case 'sendChat': {
          const oneLine = action.message.replace(/\s+/g, ' ').trim()
          return `Send Twitch chat "${oneLine.length > 36 ? `${oneLine.slice(0, 33)}…` : oneLine}"`
        }
        case 'createMarker':
          return action.description
            ? `Add Twitch marker "${action.description.slice(0, 40)}"`
            : 'Add Twitch stream marker'
        case 'setTitle': {
          const oneLine = action.title.replace(/\s+/g, ' ').trim()
          return `Set Twitch title "${oneLine.length > 40 ? `${oneLine.slice(0, 37)}…` : oneLine}"`
        }
        case 'setGame':
          return `Set Twitch category "${action.game.slice(0, 40)}"`
      }
    case 'light':
      switch (action.action) {
        case 'setPower':
          return action.light
            ? `Turn light "${action.light}" ${action.on ? 'on' : 'off'}`
            : `Turn the first light ${action.on ? 'on' : 'off'}`
        case 'togglePower':
          return action.light ? `Toggle light "${action.light}"` : 'Toggle the first light'
      }
    case 'appVolume': {
      const target = action.match.process ? `"${action.match.process}"` : 'app audio'
      if (action.action === 'toggleMute') return `Toggle mute for ${target}`
      return `${action.muted ? 'Mute' : 'Unmute'} ${target}`
    }
    case 'streamerbot': {
      const oneLine = action.actionName.replace(/\s+/g, ' ').trim()
      const label = oneLine.length > 40 ? `${oneLine.slice(0, 37)}…` : oneLine
      const argCount = action.args ? Object.keys(action.args).length : 0
      return argCount > 0
        ? `Streamer.bot "${label}" (${argCount} arg${argCount === 1 ? '' : 's'})`
        : `Streamer.bot "${label}"`
    }
    case 'rig':
      return `Run rig "${action.presetId}"`
    case 'audioDevice': {
      if (action.action === 'cycle') {
        return `Cycle ${action.kind} devices (${action.devices.length})`
      }
      const oneLine = (action.device.name ?? action.device.id ?? 'device')
        .replace(/\s+/g, ' ')
        .trim()
      const label = oneLine.length > 40 ? `${oneLine.slice(0, 39)}…` : oneLine
      return `Set ${action.kind} to "${label}"`
    }
  }
}
