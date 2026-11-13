import { createEmptyButton } from '@phonedek/shared'
import type { DeckButton, TwitchStateTarget } from '@phonedek/shared'
import type { IconName } from '../components/Icons'

export interface TwitchStatusTilePreset {
  id: string
  /** Short deck label. */
  label: string
  icon: string
  menuIcon: IconName
  target: TwitchStateTarget
  menuLabel: string
  menuDescription: string
}

/**
 * Read-only Twitch status tiles. They intentionally carry no actions: tapping
 * one is silent. The phone paints the live value through control-state-v1.
 */
export const TWITCH_STATUS_TILES: readonly TwitchStatusTilePreset[] = [
  {
    id: 'twitch-status-live',
    label: 'Live',
    icon: '🔴',
    menuIcon: 'monitor',
    target: 'live',
    menuLabel: 'Twitch live status',
    menuDescription: '1 × 1 · LIVE or OFF readout · no tap action',
  },
  {
    id: 'twitch-status-viewers',
    label: 'Viewers',
    icon: '👁️',
    menuIcon: 'monitor',
    target: 'viewers',
    menuLabel: 'Twitch viewer count',
    menuDescription: '1 × 1 · live viewer count · no tap action',
  },
  {
    id: 'twitch-status-uptime',
    label: 'Uptime',
    icon: '⏱️',
    menuIcon: 'clock',
    target: 'uptime',
    menuLabel: 'Twitch stream uptime',
    menuDescription: '1 × 1 · elapsed stream time · no tap action',
  },
  {
    id: 'twitch-status-title',
    label: 'Title',
    icon: '📝',
    menuIcon: 'text',
    target: 'title',
    menuLabel: 'Twitch stream title',
    menuDescription: '1 × 1 · current channel title · no tap action',
  },
  {
    id: 'twitch-status-game',
    label: 'Game',
    icon: '🎮',
    menuIcon: 'grid',
    target: 'game',
    menuLabel: 'Twitch category',
    menuDescription: '1 × 1 · current category · no tap action',
  },
]

export function createTwitchStatusButton(
  preset: TwitchStatusTilePreset,
  slot: number,
): DeckButton {
  return {
    ...createEmptyButton(slot, preset.label),
    icon: preset.icon,
    state: { type: 'twitch', target: preset.target },
    actions: [],
  }
}
