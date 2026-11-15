import { formatKeyLabel, normalizeHostPlatform } from '@phonedek/shared'
import type {
  ScrollBinding,
  ScrollModifier,
  SliderOrDialControlSpec,
} from '@phonedek/shared'
import type { IconName } from '../components/Icons'
import { formatKeysCompact } from './shortcut'

/** Checkbox order in the inspector; canonicalized again by the schema. */
export const SCROLL_MODIFIERS: ReadonlyArray<ScrollModifier> = ['CTRL', 'SHIFT', 'ALT', 'WIN']

export function scrollModifierLabel(modifier: ScrollModifier, platform?: string): string {
  return formatKeyLabel(modifier, platform)
}

/**
 * Compact tile/inspector badge. Ctrl+vertical wheel is the well-known zoom
 * gesture, so it gets the short `ZOOM` label; horizontal wheel gets `SCROLL H`.
 */
export function scrollBadge(binding: ScrollBinding): string {
  const modifiers = binding.modifiers ?? []
  if (binding.axis === 'vertical' && modifiers.length === 1 && modifiers[0] === 'CTRL') {
    return 'ZOOM'
  }
  // Shift+wheel is the horizontal-scroll fallback for apps without a native
  // horizontal wheel, so surface it as horizontal even though the axis is vertical.
  const horizontalIntent =
    binding.axis === 'horizontal' ||
    (binding.axis === 'vertical' && modifiers.length === 1 && modifiers[0] === 'SHIFT')
  const axis = horizontalIntent ? 'SCROLL H' : 'SCROLL'
  return modifiers.length > 0 ? `${axis} · ${modifiers.join('+')}` : axis
}

/** One-line inspector summary, e.g. `Ctrl+wheel · Vertical · inverted`. */
export function scrollSummary(binding: ScrollBinding, platform?: string): string {
  const host = normalizeHostPlatform(platform)
  const modifiers = binding.modifiers ?? []
  const horizontalIntent =
    binding.axis === 'horizontal' ||
    (binding.axis === 'vertical' && modifiers.length === 1 && modifiers[0] === 'SHIFT')
  const axis = horizontalIntent ? 'Horizontal' : 'Vertical'
  const gesture =
    modifiers.length > 0 ? `${formatKeysCompact(modifiers, host)}+wheel` : `${axis} wheel`
  const tail = binding.invert ? 'inverted' : 'natural'
  return modifiers.length > 0 ? `${gesture} · ${axis} · ${tail}` : `${gesture} · ${tail}`
}

export type ScrollPresetId = 'vertical' | 'horizontal' | 'zoom' | 'shift-horizontal'

export interface ScrollPreset {
  id: ScrollPresetId
  /** Add-control menu and toast name. */
  name: string
  /** Tile label. */
  label: string
  /** One-line Add-control description. */
  description: string
  menuIcon: IconName
  /** Emoji fallback shown on the deck tile. */
  tileIcon: string
  section: 'Navigation' | 'View'
  binding: () => ScrollBinding
}

/** Add-control presets for wheel controls. All use the 2 × 1 dial shape. */
export const SCROLL_PRESETS: readonly ScrollPreset[] = [
  {
    id: 'vertical',
    name: 'Scroll wheel',
    label: 'Scroll',
    description: '2 × 1 · one vertical mouse-wheel notch per step',
    menuIcon: 'mouse',
    tileIcon: '🖱️',
    section: 'Navigation',
    binding: () => ({ type: 'scroll', axis: 'vertical' }),
  },
  {
    id: 'horizontal',
    name: 'Horizontal scroll',
    label: 'Scroll H',
    description: '2 × 1 · left/right wheel for timelines and wide canvases',
    menuIcon: 'mouse',
    tileIcon: '↔️',
    section: 'View',
    binding: () => ({ type: 'scroll', axis: 'horizontal' }),
  },
  {
    id: 'zoom',
    name: 'Zoom wheel',
    label: 'Zoom',
    description: '2 × 1 · Ctrl + wheel zoom in Chrome, Figma and Photoshop',
    menuIcon: 'search',
    tileIcon: '🔍',
    section: 'View',
    binding: () => ({ type: 'scroll', axis: 'vertical', modifiers: ['CTRL'] }),
  },
  {
    id: 'shift-horizontal',
    name: 'Shift + horizontal',
    label: 'Shift scroll',
    description: '2 × 1 · Shift + vertical wheel for apps without horizontal wheel',
    menuIcon: 'mouse',
    tileIcon: '⇧',
    section: 'View',
    binding: () => ({ type: 'scroll', axis: 'vertical', modifiers: ['SHIFT'] }),
  },
]

export function scrollPreset(id: ScrollPresetId): ScrollPreset {
  const preset = SCROLL_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`Unknown scroll preset: ${id}`)
  return preset
}

/** Add-control menu kinds that map to a scroll preset. */
export type ScrollControlKind = 'scroll' | 'scroll-horizontal' | 'scroll-zoom' | 'scroll-shift'

export function scrollPresetForKind(kind: ScrollControlKind): ScrollPreset {
  if (kind === 'scroll-horizontal') return scrollPreset('horizontal')
  if (kind === 'scroll-zoom') return scrollPreset('zoom')
  if (kind === 'scroll-shift') return scrollPreset('shift-horizontal')
  return scrollPreset('vertical')
}

export function scrollControlKind(id: ScrollPresetId): ScrollControlKind {
  if (id === 'horizontal') return 'scroll-horizontal'
  if (id === 'zoom') return 'scroll-zoom'
  if (id === 'shift-horizontal') return 'scroll-shift'
  return 'scroll'
}

export function isScrollControlKind(kind: string): kind is ScrollControlKind {
  return (
    kind === 'scroll' ||
    kind === 'scroll-horizontal' ||
    kind === 'scroll-zoom' ||
    kind === 'scroll-shift'
  )
}

/** Build the same delta-control shape the other Add-control entries use. */
export function scrollPresetControl(preset: ScrollPreset): SliderOrDialControlSpec {
  return {
    kind: 'dial',
    emit: 'delta',
    binding: preset.binding(),
    step: 1,
    haptics: true,
  }
}

/** Keep the canonical modifier order while toggling a checkbox. */
export function toggleScrollModifier(
  current: readonly ScrollModifier[] | undefined,
  modifier: ScrollModifier,
): ScrollModifier[] | undefined {
  const next = SCROLL_MODIFIERS.filter(
    (key) => (current ?? []).includes(key) !== (key === modifier),
  )
  return next.length > 0 ? next : undefined
}
