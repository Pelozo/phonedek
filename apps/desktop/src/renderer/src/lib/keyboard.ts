import { createEmptyButton } from '@phonedek/shared'
import type { Action, CellSpan, ConfigAction, DeckButton, KeyboardAction } from '@phonedek/shared'

/** The keyboard action is a phone-local launcher; the desktop never executes it. */
export const KEYBOARD_ACTION_TITLE = 'Open phone keyboard'
export const KEYBOARD_ACTION_SUMMARY = 'Full-screen phone keyboard'
export const KEYBOARD_ACTION_BODY =
  'Opens the full-screen keyboard on your phone. Typing goes to the active window on this PC. Nothing runs on this PC when this action is pressed directly.'

/** Short deck-preview badge. Shows capability, not a live value. */
export const KEYBOARD_BADGE = 'KEYBOARD'

export const KEYBOARD_LAUNCHER_LABEL = 'Keyboard'
export const KEYBOARD_LAUNCHER_SUBLABEL = 'Tap to type'
export const KEYBOARD_LAUNCHER_ICON = '⌨️'
export const DEFAULT_KEYBOARD_SPAN: CellSpan = { columns: 2, rows: 1 }

export function keyboardAction(): KeyboardAction {
  return { type: 'keyboard', action: 'open' }
}

export function isKeyboardAction(action: ConfigAction): action is KeyboardAction {
  return action.type === 'keyboard'
}

export function hasKeyboardAction(actions: readonly ConfigAction[]): boolean {
  return actions.some(isKeyboardAction)
}

/** A launcher is a normal button carrying only the keyboard action, never a control. */
export function hasKeyboardLauncher(button: Pick<DeckButton, 'actions' | 'control'>): boolean {
  return !button.control && button.actions.length === 1 && isKeyboardAction(button.actions[0]!)
}

/** Preferred footprint first, then the bigger option, then a safe 1×1. */
export function keyboardSpanCandidates(): CellSpan[] {
  return [DEFAULT_KEYBOARD_SPAN, { columns: 3, rows: 2 }, { columns: 1, rows: 1 }]
}

export function createKeyboardLauncher(
  slot: number,
  span: CellSpan = DEFAULT_KEYBOARD_SPAN,
): DeckButton {
  return {
    ...createEmptyButton(slot, KEYBOARD_LAUNCHER_LABEL),
    icon: KEYBOARD_LAUNCHER_ICON,
    sublabel: KEYBOARD_LAUNCHER_SUBLABEL,
    span: { ...span },
    // `DeckButton.actions` still uses the legacy action union; the config
    // schema accepts `KeyboardAction` and the executor ignores it.
    actions: [keyboardAction() as unknown as Action],
  }
}
