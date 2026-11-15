/**
 * Settings is split into a small, fixed set of categories. The desktop shell
 * mounts every category so drafts and status polling survive navigation; the
 * dialog only hides the inactive ones.
 */
export const SETTINGS_CATEGORIES = [
  {
    id: 'general',
    index: '01',
    label: 'General',
    description: 'Deck identity, startup, capture folder and backups.',
  },
  {
    id: 'input',
    index: '02',
    label: 'Input',
    description: 'What a paired phone may control, and the macOS permission.',
  },
  {
    id: 'integrations',
    index: '03',
    label: 'Integrations',
    description: 'OBS Studio, Twitch, Streamer.bot, Elgato, Hue and Nanoleaf lights, and game launch switching.',
  },
  {
    id: 'phone',
    index: '04',
    label: 'Phone',
    description: 'Connected phones and their per-device display settings.',
  },
  {
    id: 'about',
    index: '05',
    label: 'About',
    description: 'Version, updates and diagnostic logs.',
  },
] as const

export type SettingsCategoryId = (typeof SETTINGS_CATEGORIES)[number]['id']
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategoryId = 'general'

export function isSettingsCategoryId(value: string | null | undefined): value is SettingsCategoryId {
  return SETTINGS_CATEGORIES.some((category) => category.id === value)
}

/** Deep links may carry a stale or partial value; fall back to General. */
export function resolveSettingsCategory(value?: string | null): SettingsCategoryId {
  return isSettingsCategoryId(value) ? value : DEFAULT_SETTINGS_CATEGORY
}

export function settingsCategory(id: SettingsCategoryId): SettingsCategory {
  const match = SETTINGS_CATEGORIES.find((category) => category.id === id)
  return match ?? SETTINGS_CATEGORIES[0]
}
