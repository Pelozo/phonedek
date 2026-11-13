import { createEmptyButton } from '@phonedek/shared'
import type { Action, DeckButton, LightAction, LightTarget } from '@phonedek/shared'
import type { IconName } from '../components/Icons'

export interface LightStatusTilePreset {
  id: string
  /** Short deck label. */
  label: string
  icon: string
  menuIcon: IconName
  target: LightTarget
  /** Optional matching output action; read-only targets omit it. */
  action?: LightAction
  menuLabel: string
  menuDescription: string
}

/**
 * Local-light status tiles. Power carries a toggle action; brightness and
 * temperature are deliberately read-only. The phone paints the live value
 * through control-state-v1 and the editor only shows a static LIGHT badge.
 */
export const LIGHT_STATUS_TILES: readonly LightStatusTilePreset[] = [
  {
    id: 'light-status-power',
    label: 'Light',
    icon: '💡',
    menuIcon: 'light',
    target: 'power',
    action: { type: 'light', action: 'togglePower' },
    menuLabel: 'Light power status',
    menuDescription: '1 × 1 · ON/OFF tile, tap toggles the light',
  },
  {
    id: 'light-status-brightness',
    label: 'Bright',
    icon: '🔆',
    menuIcon: 'sliders',
    target: 'brightness',
    menuLabel: 'Light brightness status',
    menuDescription: '1 × 1 · 0–100% readout · no tap action',
  },
  {
    id: 'light-status-temperature',
    label: 'Temp',
    icon: '🌡️',
    menuIcon: 'temperature',
    target: 'temperature',
    menuLabel: 'Light temperature status',
    menuDescription: '1 × 1 · mired readout · no tap action',
  },
]

export function createLightStatusButton(
  preset: LightStatusTilePreset,
  slot: number,
  light?: string,
): DeckButton {
  const id = light?.trim()
  return {
    ...createEmptyButton(slot, preset.label),
    icon: preset.icon,
    state: { type: 'light', target: preset.target, ...(id ? { light: id } : {}) },
    actions: preset.action
      ? [
          structuredClone({
            ...preset.action,
            ...(id ? { light: id } : {}),
          }) as unknown as Action,
        ]
      : [],
  }
}
