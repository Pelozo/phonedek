import {
  formatKeyLabel,
  normalizeCombo,
  normalizeHostPlatform,
} from '@phonedek/shared'
import type {
  HostPlatform,
  ShortcutBinding,
  SliderOrDialControlSpec,
} from '@phonedek/shared'
import type { IconName } from '../components/Icons'

/**
 * Compact keyboard notation for tiles and inspector summaries.
 *
 * macOS uses the engraved modifier symbols (`⌃⇥`, `⌘⇥`); Windows and Linux use
 * short labels joined with `+` (`Ctrl+Tab`). This is intentionally separate from
 * `formatCombo`, which spells every key out for screen readers and descriptions.
 */
const MAC_SYMBOLS: Record<string, string> = {
  CTRL: '⌃',
  ALT: '⌥',
  SHIFT: '⇧',
  WIN: '⌘',
  TAB: '⇥',
  ENTER: '↩',
  ESC: '⎋',
  SPACE: '␣',
  BACKSPACE: '⌫',
  DELETE: '⌦',
  INSERT: '⌤',
  HOME: '↖',
  END: '↘',
  PGUP: '⇞',
  PGDN: '⇟',
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→',
}

function compactKey(key: string, platform: HostPlatform): string {
  if (platform === 'darwin') return MAC_SYMBOLS[key] ?? formatKeyLabel(key, platform).toUpperCase()
  return formatKeyLabel(key, platform)
}

/** `['CTRL','TAB']` -> `⌃⇥` on macOS, `Ctrl+Tab` elsewhere. */
export function formatKeysCompact(keys: readonly string[], platform?: string): string {
  const host = normalizeHostPlatform(platform)
  const labels = keys.map((key) => compactKey(key, host))
  return host === 'darwin' ? labels.join('') : labels.join('+')
}

export function shortcutReverseKeys(binding: ShortcutBinding): string[] {
  return binding.reverseKeys?.length ? binding.reverseKeys : binding.keys
}

export function shortcutReverseDiffers(binding: ShortcutBinding): boolean {
  return Boolean(
    binding.reverseKeys?.length &&
      formatKeysCompact(binding.reverseKeys) !== formatKeysCompact(binding.keys),
  )
}

/** Reverse chord for the tile's second line, or a plain note when both ways match. */
export function shortcutDirectionLabel(binding: ShortcutBinding, platform?: string): string {
  if (!shortcutReverseDiffers(binding)) return 'same chord both ways'
  return `↔ ${formatKeysCompact(binding.reverseKeys ?? [], platform)}`
}

/** Compact badge; a held modifier is the most useful thing to surface there. */
export function shortcutBadge(binding: ShortcutBinding, platform?: string): string {
  if (binding.holdKeys?.length) return `HOLD ${formatKeysCompact(binding.holdKeys, platform)}`
  return shortcutReverseDiffers(binding) ? '↔' : 'CHORD'
}

const DESTRUCTIVE_PATTERNS: Array<{
  keys: string[]
  label: string
  platforms?: HostPlatform[]
}> = [
  { keys: ['CTRL', 'ALT', 'DELETE'], label: 'Ctrl+Alt+Delete' },
  { keys: ['ALT', 'F4'], label: 'Alt+F4' },
  { keys: ['CTRL', 'SHIFT', 'ESC'], label: 'Ctrl+Shift+Esc' },
  { keys: ['WIN', 'L'], label: 'Win+L', platforms: ['win32', 'linux'] },
  { keys: ['WIN', 'Q'], label: 'Cmd+Q', platforms: ['darwin'] },
]

/**
 * Returns a warning label when a chord is a well-known destructive system
 * shortcut. The hold gesture (for example ALT) is part of the combined chord,
 * because that is what the desktop ends up sending.
 */
export function destructiveShortcutWarning(
  keys: readonly string[],
  holdKeys: readonly string[] = [],
  platform?: string,
): string | null {
  const host = normalizeHostPlatform(platform)
  let combo: string[]
  try {
    combo = normalizeCombo([...holdKeys, ...keys])
  } catch {
    return null
  }
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.platforms && !pattern.platforms.includes(host)) continue
    const target = normalizeCombo(pattern.keys)
    if (target.length === combo.length && target.every((key, index) => combo[index] === key)) {
      return pattern.label
    }
  }
  return null
}

export type ShortcutPresetId =
  | 'tabs'
  | 'app-switcher'
  | 'brush-size'
  | 'zoom'
  | 'seek'
  | 'zoom-slider'

export interface ShortcutPreset {
  id: ShortcutPresetId
  /** Menu item and toast name. */
  name: string
  /** Tile label, platform-aware where the gesture differs. */
  label: (platform: HostPlatform) => string
  /** One-line menu description. */
  description: string
  /** Icon used in the Add-control menu. */
  menuIcon: IconName
  /** Emoji fallback shown on the deck tile. */
  tileIcon: string
  section: 'Navigation' | 'Editing'
  kind: 'dial' | 'slider'
  span: { columns: number; rows: number }
  binding: (platform: HostPlatform) => ShortcutBinding
}

/** Add-control presets for the shortcut wheel. Tap stays silent by design. */
export const SHORTCUT_PRESETS: readonly ShortcutPreset[] = [
  {
    id: 'tabs',
    name: 'Browser tabs',
    label: () => 'Tabs',
    description: 'Ctrl+Tab / Ctrl+Shift+Tab',
    menuIcon: 'layers',
    tileIcon: '🗂️',
    section: 'Navigation',
    kind: 'dial',
    span: { columns: 2, rows: 1 },
    binding: () => ({
      type: 'shortcut',
      keys: ['CTRL', 'TAB'],
      reverseKeys: ['CTRL', 'SHIFT', 'TAB'],
    }),
  },
  {
    id: 'app-switcher',
    name: 'App switcher',
    label: (platform) => (platform === 'darwin' ? 'Cmd+Tab' : 'Alt+Tab'),
    description: 'Hold the switcher key while stepping through windows',
    menuIcon: 'app',
    tileIcon: '🔀',
    section: 'Navigation',
    kind: 'dial',
    span: { columns: 2, rows: 1 },
    binding: (platform) => ({
      type: 'shortcut',
      keys: ['TAB'],
      reverseKeys: ['SHIFT', 'TAB'],
      holdKeys: [platform === 'darwin' ? 'WIN' : 'ALT'],
    }),
  },
  {
    id: 'zoom',
    name: 'Zoom',
    label: () => 'Zoom',
    description: 'Ctrl + / −',
    menuIcon: 'search',
    tileIcon: '🔍',
    section: 'Navigation',
    kind: 'dial',
    span: { columns: 2, rows: 1 },
    binding: () => ({
      type: 'shortcut',
      keys: ['CTRL', '+'],
      reverseKeys: ['CTRL', '-'],
    }),
  },
  {
    id: 'seek',
    name: 'Seek',
    label: () => 'Seek',
    description: 'Right / left arrow',
    menuIcon: 'play',
    tileIcon: '⏩',
    section: 'Navigation',
    kind: 'dial',
    span: { columns: 2, rows: 1 },
    binding: () => ({
      type: 'shortcut',
      keys: ['RIGHT'],
      reverseKeys: ['LEFT'],
    }),
  },
  {
    id: 'zoom-slider',
    name: 'Zoom slider',
    label: () => 'Zoom',
    description: '3 × 1 · 20 slices across the track',
    menuIcon: 'search',
    tileIcon: '🔍',
    section: 'Navigation',
    kind: 'slider',
    span: { columns: 3, rows: 1 },
    binding: () => ({
      type: 'shortcut',
      keys: ['CTRL', '+'],
      reverseKeys: ['CTRL', '-'],
      travelSteps: 20,
    }),
  },
  {
    id: 'brush-size',
    name: 'Brush size',
    label: () => 'Brush size',
    description: '[ / ]',
    menuIcon: 'sliders',
    tileIcon: '🖌️',
    section: 'Editing',
    kind: 'dial',
    span: { columns: 2, rows: 1 },
    binding: () => ({
      type: 'shortcut',
      keys: ['['],
      reverseKeys: [']'],
    }),
  },
]

export function shortcutPreset(id: ShortcutPresetId): ShortcutPreset {
  const preset = SHORTCUT_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`Unknown shortcut preset: ${id}`)
  return preset
}

/** Build the same kind of delta control the other Add-control entries use. */
export function shortcutPresetControl(
  preset: ShortcutPreset,
  platform: string,
): SliderOrDialControlSpec {
  const host = normalizeHostPlatform(platform)
  return {
    kind: preset.kind,
    ...(preset.kind === 'slider' ? { axis: 'horizontal' as const } : {}),
    emit: 'delta',
    binding: preset.binding(host),
    step: 1,
    haptics: true,
  }
}
