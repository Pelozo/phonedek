import { createEmptyButton } from '@phonedek/shared'
import type { Action, CellSpan, ConfigAction, DeckButton, MixerAction } from '@phonedek/shared'

/** The mixer action is a phone-local launcher; the desktop never executes it. */
export const MIXER_ACTION_TITLE = 'Open mixer'
export const MIXER_ACTION_SUMMARY = 'Full-screen per-app mixer'
export const MIXER_ACTION_BODY =
  'Opens the full-screen per-app mixer on the phone. Drag a fader or tap mute there; nothing runs on this PC when this action is pressed directly.'

/** Short deck-preview badge. Shows capability, not a live value. */
export const MIXER_BADGE = 'MIXER'

export const MIXER_LAUNCHER_LABEL = 'Mixer'
export const MIXER_LAUNCHER_SUBLABEL = 'Tap to open'
export const MIXER_LAUNCHER_ICON = '🎚️'
export const DEFAULT_MIXER_SPAN: CellSpan = { columns: 3, rows: 2 }

/** Used when the desktop mixer is unavailable; the phone still opens its screen. */
export const MIXER_UNSUPPORTED_FALLBACK =
  'This desktop has no per-app audio mixer; the phone still opens the mixer screen.'

export function mixerAction(): MixerAction {
  return { type: 'mixer', action: 'open' }
}

export function isMixerAction(action: ConfigAction | { type: string }): action is MixerAction {
  return action.type === 'mixer'
}

export function hasMixerAction(actions: readonly ConfigAction[]): boolean {
  return actions.some(isMixerAction)
}

/** A launcher is a normal button carrying only the mixer action, never a control. */
export function hasMixerLauncher(button: Pick<DeckButton, 'actions' | 'control'>): boolean {
  return !button.control && button.actions.length === 1 && isMixerAction(button.actions[0]!)
}

/** Preferred footprint first, then a square option, then a safe 1×1. */
export function mixerSpanCandidates(): CellSpan[] {
  return [DEFAULT_MIXER_SPAN, { columns: 2, rows: 2 }, { columns: 1, rows: 1 }]
}

/**
 * Note shown after adding a launcher when the desktop mixer is unavailable.
 * Returns null when the mixer is advertised, so callers can skip the hint.
 */
export function mixerSupportNote(
  available: boolean,
  reason?: string | null,
): string | null {
  if (available) return null
  const clean = reason?.trim()
  return clean ? `Mixer launcher added — ${clean}` : `Mixer launcher added — ${MIXER_UNSUPPORTED_FALLBACK}`
}

export function createMixerLauncher(slot: number, span: CellSpan = DEFAULT_MIXER_SPAN): DeckButton {
  return {
    ...createEmptyButton(slot, MIXER_LAUNCHER_LABEL),
    icon: MIXER_LAUNCHER_ICON,
    sublabel: MIXER_LAUNCHER_SUBLABEL,
    span: { ...span },
    // `DeckButton.actions` still uses the legacy action union; the config
    // schema accepts `MixerAction` and the executor ignores it.
    actions: [mixerAction() as unknown as Action],
  }
}
