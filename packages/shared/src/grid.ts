import type {
  DeckButton,
  DeckConfig,
  DeckPage,
  DeckProfile,
  GridSettings,
  PageAction,
  ProfileTheme,
} from './types'
import { createEmptyPage, createEmptyProfile } from './defaults'
import { newId } from './ids'

export function capacity(grid: GridSettings): number {
  return grid.columns * grid.rows
}

export function touch(config: DeckConfig, now: Date = new Date()): DeckConfig {
  return { ...config, updatedAt: now.toISOString() }
}

export function getProfile(config: DeckConfig, profileId: string): DeckProfile | undefined {
  return config.profiles.find((profile) => profile.id === profileId)
}

export function getPage(profile: DeckProfile, pageId: string): DeckPage | undefined {
  return profile.pages.find((page) => page.id === pageId)
}

export function getButton(page: DeckPage, buttonId: string): DeckButton | undefined {
  return page.buttons.find((button) => button.id === buttonId)
}

export function buttonsBySlot(page: DeckPage): DeckButton[] {
  return [...page.buttons].sort((a, b) => a.slot - b.slot)
}

function mapProfile(config: DeckConfig, profileId: string, fn: (profile: DeckProfile) => DeckProfile): DeckConfig {
  return {
    ...config,
    profiles: config.profiles.map((profile) => (profile.id === profileId ? fn(profile) : profile)),
  }
}

function mapPage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  fn: (page: DeckPage) => DeckPage,
): DeckConfig {
  return mapProfile(config, profileId, (profile) => ({
    ...profile,
    pages: profile.pages.map((page) => (page.id === pageId ? fn(page) : page)),
  }))
}

export function updateProfileMeta(
  config: DeckConfig,
  profileId: string,
  patch: Partial<Pick<DeckProfile, 'name' | 'defaultPageId'>>,
  now: Date = new Date(),
): DeckConfig {
  const next = mapProfile(config, profileId, (profile) => ({ ...profile, ...patch }))
  return touch(next, now)
}

export function updatePageMeta(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  patch: Partial<Pick<DeckPage, 'name' | 'background'>>,
  now: Date = new Date(),
): DeckConfig {
  const next = mapPage(config, profileId, pageId, (page) => ({ ...page, ...patch }))
  return touch(next, now)
}

export function updateGrid(
  config: DeckConfig,
  profileId: string,
  patch: Partial<GridSettings>,
  now: Date = new Date(),
): DeckConfig {
  const next = mapProfile(config, profileId, (profile) => ({
    ...profile,
    grid: { ...profile.grid, ...patch },
  }))
  return touch(next, now)
}

export function updateTheme(
  config: DeckConfig,
  profileId: string,
  patch: Partial<ProfileTheme>,
  now: Date = new Date(),
): DeckConfig {
  const next = mapProfile(config, profileId, (profile) => ({
    ...profile,
    theme: { ...profile.theme, ...patch },
  }))
  return touch(next, now)
}

/** Resize a grid, dropping buttons that no longer fit. Returns the new config. */
export function resizeGrid(
  config: DeckConfig,
  profileId: string,
  columns: number,
  rows: number,
  now: Date = new Date(),
): DeckConfig {
  const cols = Math.max(1, Math.min(10, Math.round(columns)))
  const rws = Math.max(1, Math.min(10, Math.round(rows)))
  const limit = cols * rws
  const next = mapProfile(config, profileId, (profile) => ({
    ...profile,
    grid: { ...profile.grid, columns: cols, rows: rws },
    pages: profile.pages.map((page) => ({
      ...page,
      buttons: page.buttons.filter((button) => button.slot < limit),
    })),
  }))
  return touch(next, now)
}

export function addButton(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  button: DeckButton,
  now: Date = new Date(),
): DeckConfig {
  const profile = getProfile(config, profileId)
  if (!profile) throw new Error('Unknown profile')
  const page = getPage(profile, pageId)
  if (!page) throw new Error('Unknown page')
  if (button.slot < 0 || button.slot >= capacity(profile.grid)) throw new Error('Slot is outside the grid')
  if (page.buttons.some((existing) => existing.slot === button.slot)) throw new Error('Slot is already occupied')

  const next = mapPage(config, profileId, pageId, (current) => ({
    ...current,
    buttons: [...current.buttons, structuredClone(button)].sort((a, b) => a.slot - b.slot),
  }))
  return touch(next, now)
}

export function removeButton(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  buttonId: string,
  now: Date = new Date(),
): DeckConfig {
  const next = mapPage(config, profileId, pageId, (page) => ({
    ...page,
    buttons: page.buttons.filter((button) => button.id !== buttonId),
  }))
  return touch(next, now)
}

export function updateButton(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  buttonId: string,
  patch: Partial<Omit<DeckButton, 'id' | 'slot'>>,
  now: Date = new Date(),
): DeckConfig {
  const next = mapPage(config, profileId, pageId, (page) => ({
    ...page,
    buttons: page.buttons.map((button) =>
      button.id === buttonId ? { ...button, ...structuredClone(patch) } : button,
    ),
  }))
  return touch(next, now)
}

/** Move a button to another slot, swapping with any button already there. */
export function moveButton(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  buttonId: string,
  targetSlot: number,
  now: Date = new Date(),
): DeckConfig {
  const profile = getProfile(config, profileId)
  if (!profile) throw new Error('Unknown profile')
  if (targetSlot < 0 || targetSlot >= capacity(profile.grid)) throw new Error('Slot is outside the grid')
  const next = mapPage(config, profileId, pageId, (page) => {
    const moving = page.buttons.find((button) => button.id === buttonId)
    if (!moving) throw new Error('Unknown button')
    const occupant = page.buttons.find((button) => button.slot === targetSlot)
    return {
      ...page,
      buttons: page.buttons
        .map((button) => {
          if (button.id === moving.id) return { ...button, slot: targetSlot }
          if (occupant && button.id === occupant.id) return { ...button, slot: moving.slot }
          return button
        })
        .sort((a, b) => a.slot - b.slot),
    }
  })
  return touch(next, now)
}

/** Remove gaps by assigning slots 0..n in current slot order. */
export function compactPage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  now: Date = new Date(),
): DeckConfig {
  const next = mapPage(config, profileId, pageId, (page) => ({
    ...page,
    buttons: buttonsBySlot(page).map((button, index) => ({ ...button, slot: index })),
  }))
  return touch(next, now)
}

export function renamePage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  name: string,
  now: Date = new Date(),
): DeckConfig {
  const next = mapPage(config, profileId, pageId, (page) => ({ ...page, name }))
  return touch(next, now)
}

export function addPage(
  config: DeckConfig,
  profileId: string,
  name = 'New page',
  now: Date = new Date(),
): { config: DeckConfig; pageId: string } {
  const page = createEmptyPage(name)
  const next = mapProfile(config, profileId, (profile) => ({
    ...profile,
    pages: [...profile.pages, page],
  }))
  return { config: touch(next, now), pageId: page.id }
}

export function duplicatePage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  now: Date = new Date(),
): { config: DeckConfig; pageId: string } {
  const profile = getProfile(config, profileId)
  const page = profile ? getPage(profile, pageId) : undefined
  if (!profile || !page) throw new Error('Unknown page')
  const copy: DeckPage = {
    ...structuredClone(page),
    id: newId('page'),
    name: `${page.name} copy`,
    buttons: page.buttons.map((button) => ({ ...structuredClone(button), id: newId('btn') })),
  }
  const next = mapProfile(config, profileId, (current) => ({
    ...current,
    pages: [...current.pages, copy],
  }))
  return { config: touch(next, now), pageId: copy.id }
}

export function deletePage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  now: Date = new Date(),
): DeckConfig {
  const profile = getProfile(config, profileId)
  if (!profile) return config
  if (profile.pages.length <= 1) throw new Error('A profile needs at least one page')
  const remaining = profile.pages.filter((page) => page.id !== pageId)
  const next = mapProfile(config, profileId, (current) => ({
    ...current,
    pages: remaining,
    defaultPageId:
      current.defaultPageId === pageId ? (remaining[0]?.id ?? current.defaultPageId) : current.defaultPageId,
  }))
  return touch(next, now)
}

export function addProfile(
  config: DeckConfig,
  name = 'New profile',
  now: Date = new Date(),
): { config: DeckConfig; profileId: string } {
  const profile = createEmptyProfile(name)
  const next = { ...config, profiles: [...config.profiles, profile] }
  return { config: touch(next, now), profileId: profile.id }
}

export function duplicateProfile(
  config: DeckConfig,
  profileId: string,
  now: Date = new Date(),
): { config: DeckConfig; profileId: string } {
  const profile = getProfile(config, profileId)
  if (!profile) throw new Error('Unknown profile')
  const copy: DeckProfile = {
    ...structuredClone(profile),
    id: newId('profile'),
    name: `${profile.name} copy`,
    pages: profile.pages.map((page) => ({
      ...structuredClone(page),
      id: newId('page'),
      buttons: page.buttons.map((button) => ({ ...structuredClone(button), id: newId('btn') })),
    })),
  }
  copy.defaultPageId = copy.pages[0]!.id
  const next = { ...config, profiles: [...config.profiles, copy] }
  return { config: touch(next, now), profileId: copy.id }
}

export function deleteProfile(
  config: DeckConfig,
  profileId: string,
  now: Date = new Date(),
): DeckConfig {
  if (config.profiles.length <= 1) throw new Error('At least one profile is required')
  const remaining = config.profiles.filter((profile) => profile.id !== profileId)
  return touch(
    {
      ...config,
      profiles: remaining,
      defaultProfileId:
        config.defaultProfileId === profileId ? (remaining[0]?.id ?? config.defaultProfileId) : config.defaultProfileId,
    },
    now,
  )
}

/** Resolve next/prev/goto against a profile. Wraps around for next/prev. */
export function resolvePageId(profile: DeckProfile, currentPageId: string, action: PageAction): string {
  if (action.direction === 'goto') return action.pageId ?? currentPageId
  const current = profile.pages.findIndex((page) => page.id === currentPageId)
  const index = current < 0 ? 0 : current
  const delta = action.direction === 'next' ? 1 : -1
  const count = profile.pages.length
  return profile.pages[(index + delta + count) % count]?.id ?? currentPageId
}

export function nextFreeSlot(page: DeckPage, grid: GridSettings): number | null {
  const used = new Set(page.buttons.map((button) => button.slot))
  for (let slot = 0; slot < capacity(grid); slot += 1) {
    if (!used.has(slot)) return slot
  }
  return null
}

export function defaultPageFor(profile: DeckProfile): DeckPage {
  return getPage(profile, profile.defaultPageId) ?? profile.pages[0]!
}
