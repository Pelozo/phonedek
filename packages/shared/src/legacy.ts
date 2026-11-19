/**
 * Downgrade helpers: produce a config an older desktop can import.
 *
 * Rigs, event rules and audio-device actions are additive in schema version 1,
 * but pre-automation desktops reject `type: 'rig'` / `type: 'audioDevice'`
 * outright (they treat the whole deck as corrupt). This module removes only
 * those newer pieces, leaving profiles, pages, slots, controls and every other
 * action untouched.
 */

import type { DeckButton, DeckConfig } from './types'

export interface LegacyRemovedCounts {
  /** Configured rig presets that were dropped. */
  rigs: number
  /** Event rules that were dropped. */
  rules: number
  /** `rig` run actions removed from buttons. */
  rigActions: number
  /** `rig` status bindings removed from buttons. */
  rigStates: number
  /**
   * `audioDevice` actions removed from buttons. Set only when non-zero so a
   * pre-audio export keeps the previous count-object shape (and its existing
   * summaries/fixtures) unchanged.
   */
  audioActions?: number
  /** `audioDevice` status bindings removed from buttons. Set only when non-zero. */
  audioStates?: number
  /** Buttons removed because nothing but rig/audio wiring was left. */
  buttons: number
}

export interface LegacyConfigResult {
  config: DeckConfig
  removed: LegacyRemovedCounts
}

export function emptyLegacyRemovedCounts(): LegacyRemovedCounts {
  return { rigs: 0, rules: 0, rigActions: 0, rigStates: 0, buttons: 0 }
}

/** Structural check: old renderers type `Action` without the staged arms. */
function isRigAction(action: unknown): boolean {
  return typeof action === 'object' && action !== null && (action as { type?: unknown }).type === 'rig'
}

function isRigState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { type?: unknown }).type === 'rig'
}

function isAudioDeviceAction(action: unknown): boolean {
  return (
    typeof action === 'object' &&
    action !== null &&
    (action as { type?: unknown }).type === 'audioDevice'
  )
}

function isAudioDeviceState(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { type?: unknown }).type === 'audioDevice'
  )
}

function countAudio(
  removed: LegacyRemovedCounts,
  key: 'audioActions' | 'audioStates',
  count: number,
): void {
  if (count === 0) return
  removed[key] = (removed[key] ?? 0) + count
}

/**
 * Strip rigs, rules, audio-device wiring and every reference to them.
 *
 * The input is never mutated (the returned config is a deep clone). Buttons
 * keep their `slot` and order; a button is dropped only when removing its
 * staged actions/state leaves an otherwise empty tile (no actions, control or
 * state). Control-only and status-only tiles without staged wiring are kept.
 */
export function stripAutomationForLegacy(config: DeckConfig): LegacyConfigResult {
  const removed = emptyLegacyRemovedCounts()
  const next = structuredClone(config)

  removed.rigs = next.rigs?.length ?? 0
  removed.rules = next.rules?.length ?? 0
  delete next.rigs
  delete next.rules

  for (const profile of next.profiles) {
    for (const page of profile.pages) {
      const buttons: DeckButton[] = []
      for (const button of page.buttons) {
        const rigActionCount = button.actions.filter(isRigAction).length
        const rigState = isRigState(button.state)
        const audioActionCount = button.actions.filter(isAudioDeviceAction).length
        const audioState = isAudioDeviceState(button.state)

        if (rigActionCount + audioActionCount === 0 && !rigState && !audioState) {
          buttons.push(button)
          continue
        }

        removed.rigActions += rigActionCount
        if (rigState) removed.rigStates += 1
        countAudio(removed, 'audioActions', audioActionCount)
        if (audioState) countAudio(removed, 'audioStates', 1)

        button.actions = button.actions.filter(
          (action) => !isRigAction(action) && !isAudioDeviceAction(action),
        )
        if (rigState || audioState) delete button.state

        // Nothing interactive is left: drop the dead tile instead of leaving a
        // blank key in the old deck.
        if (button.actions.length === 0 && !button.control && !button.state) {
          removed.buttons += 1
          continue
        }
        buttons.push(button)
      }
      page.buttons = buttons
    }
  }

  return { config: next, removed }
}
