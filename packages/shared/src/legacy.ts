/**
 * Downgrade helpers: produce a config an older desktop can import.
 *
 * Rigs and event rules are additive in schema version 1, but pre-automation
 * desktops reject `type: 'rig'` outright (they treat the whole deck as corrupt).
 * This module removes only those newer pieces, leaving profiles, pages, slots,
 * controls and every non-rig action untouched.
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
  /** Buttons removed because nothing but rig wiring was left. */
  buttons: number
}

export interface LegacyConfigResult {
  config: DeckConfig
  removed: LegacyRemovedCounts
}

export function emptyLegacyRemovedCounts(): LegacyRemovedCounts {
  return { rigs: 0, rules: 0, rigActions: 0, rigStates: 0, buttons: 0 }
}

/** Structural check: old renderers type `Action` without the staged rig arm. */
function isRigAction(action: unknown): boolean {
  return typeof action === 'object' && action !== null && (action as { type?: unknown }).type === 'rig'
}

function isRigState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { type?: unknown }).type === 'rig'
}

/**
 * Strip rigs, rules and every rig reference from a config.
 *
 * The input is never mutated (the returned config is a deep clone). Buttons
 * keep their `slot` and order; a button is dropped only when removing its rig
 * action/state leaves an otherwise empty tile (no actions, control or state).
 * Control-only and status-only tiles without rig wiring are preserved.
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

        if (rigActionCount === 0 && !rigState) {
          buttons.push(button)
          continue
        }

        removed.rigActions += rigActionCount
        if (rigState) removed.rigStates += 1

        button.actions = button.actions.filter((action) => !isRigAction(action))
        if (rigState) delete button.state

        // Nothing interactive is left: drop the dead rig tile instead of
        // leaving a blank key in the old deck.
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
