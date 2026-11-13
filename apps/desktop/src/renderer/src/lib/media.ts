import type { SliderOrDialControlSpec } from '@phonedek/shared'

/**
 * Media scrub is a value slider for the active player. The wire value is
 * normalized 0..1; only the released position is sent, and the phone renders
 * the elapsed/total time from `control-state-v1`.
 */
export function mediaScrubControl(): SliderOrDialControlSpec {
  return {
    kind: 'slider',
    axis: 'horizontal',
    emit: 'value',
    binding: { type: 'media', target: 'position' },
    min: 0,
    max: 1,
    step: 0.001,
    initial: 0,
    commit: 'end',
    display: 'time',
    haptics: true,
  }
}

/** Preferred footprint, then narrower fallbacks when the page is busy. */
export const MEDIA_SCRUB_SPANS: ReadonlyArray<{ columns: number; rows: number }> = [
  { columns: 4, rows: 1 },
  { columns: 3, rows: 1 },
  { columns: 1, rows: 1 },
]

/** Static editor placeholders. Never derived from a live player in the editor. */
export const MEDIA_PREVIEW_POSITION_MS = 0
export const MEDIA_PREVIEW_DURATION_MS = 3 * 60_000 + 45_000
export const MEDIA_SCRUB_BADGE = 'MEDIA · SEEK'

export const MEDIA_SCRUB_HINT =
  'Drag to seek · sends on release · Spotify/Music on macOS, active player on Windows/Linux'

/**
 * `mm:ss`, or `h:mm:ss` for long media. Mirrors the main-process formatter so
 * the editor preview and the phone readout use the same clock shape.
 */
export function formatMediaTime(positionMs: number): string {
  if (!Number.isFinite(positionMs)) return '0:00'
  const total = Math.max(0, Math.round(positionMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const secondsText = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
  return `${minutes}:${secondsText}`
}
