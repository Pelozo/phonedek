import { createEmptyButton } from '@phonedek/shared'
import type { DeckButton, ObsAction, ObsStateTarget } from '@phonedek/shared'

export interface ObsStatusTilePreset {
  id: string
  /** Short deck label. */
  label: string
  icon: string
  menuIcon: 'wifi' | 'record' | 'refresh' | 'video'
  target: ObsStateTarget
  /** Convenience action that still runs when the tile is tapped. */
  action: ObsAction
  menuLabel: string
  menuDescription: string
}

/**
 * One-tap OBS status tiles. The state binding is read-only; the action is the
 * matching output toggle (replay saves the buffer instead of starting it).
 */
export const OBS_STATUS_TILES: readonly ObsStatusTilePreset[] = [
  {
    id: 'obs-status-stream',
    label: 'Stream',
    icon: '📡',
    menuIcon: 'wifi',
    target: 'streaming',
    action: { type: 'obs', action: 'toggleStream' },
    menuLabel: 'OBS stream status',
    menuDescription: '1 × 1 · LIVE tile, tap toggles streaming',
  },
  {
    id: 'obs-status-record',
    label: 'Record',
    icon: '⏺️',
    menuIcon: 'record',
    target: 'recording',
    action: { type: 'obs', action: 'toggleRecord' },
    menuLabel: 'OBS record status',
    menuDescription: '1 × 1 · REC tile, tap toggles recording',
  },
  {
    id: 'obs-status-replay',
    label: 'Replay',
    icon: '🔁',
    menuIcon: 'refresh',
    target: 'replay',
    action: { type: 'obs', action: 'saveReplay' },
    menuLabel: 'OBS replay status',
    menuDescription: '1 × 1 · REPLAY tile, tap saves the buffer',
  },
  {
    id: 'obs-status-vcam',
    label: 'VCam',
    icon: '🎥',
    menuIcon: 'video',
    target: 'virtualCam',
    action: { type: 'obs', action: 'toggleVirtualCam' },
    menuLabel: 'OBS VCam status',
    menuDescription: '1 × 1 · VCAM tile, tap toggles the virtual camera',
  },
]

export function createObsStatusButton(preset: ObsStatusTilePreset, slot: number): DeckButton {
  return {
    ...createEmptyButton(slot, preset.label),
    icon: preset.icon,
    state: { type: 'obs', target: preset.target },
    actions: [structuredClone(preset.action)],
  }
}
