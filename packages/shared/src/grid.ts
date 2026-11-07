import type {
  CellSpan,
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

export interface ButtonFootprint {
  slot: number
  row: number
  column: number
  columns: number
  rows: number
  /** Row-major cell indices covered by the button, anchor first. */
  cells: number[]
}

const DEFAULT_SPAN: CellSpan = { columns: 1, rows: 1 }

function normalizeSpanValue(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)))
}

/** Effective footprint of a button. Omitted spans are 1x1; invalid values are clamped. */
export function buttonSpan(button: DeckButton): CellSpan {
  if (!button.span) return { ...DEFAULT_SPAN }
  return {
    columns: normalizeSpanValue(button.span.columns),
    rows: normalizeSpanValue(button.span.rows),
  }
}

/** Footprint for an anchor and span, or null when any covered cell is outside the grid. */
function footprintAt(slot: number, span: CellSpan, grid: GridSettings): ButtonFootprint | null {
  const columns = Math.round(grid.columns)
  const rows = Math.round(grid.rows)
  if (!Number.isInteger(slot) || columns < 1 || rows < 1) return null
  if (slot < 0 || slot >= columns * rows) return null

  const spanColumns = normalizeSpanValue(span.columns)
  const spanRows = normalizeSpanValue(span.rows)
  const row = Math.floor(slot / columns)
  const column = slot % columns
  if (column + spanColumns > columns || row + spanRows > rows) return null

  const cells: number[] = []
  for (let rowOffset = 0; rowOffset < spanRows; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < spanColumns; columnOffset += 1) {
      cells.push((row + rowOffset) * columns + (column + columnOffset))
    }
  }
  return { slot, row, column, columns: spanColumns, rows: spanRows, cells }
}

/** A button's footprint, or null when its span overflows the grid. */
export function buttonFootprint(button: DeckButton, grid: GridSettings): ButtonFootprint | null {
  return footprintAt(button.slot, buttonSpan(button), grid)
}

/** Every cell covered by any valid button footprint. */
export function occupiedCells(buttons: readonly DeckButton[], grid: GridSettings): Set<number> {
  const cells = new Set<number>()
  for (const button of buttons) {
    const footprint = buttonFootprint(button, grid)
    if (!footprint) continue
    for (const cell of footprint.cells) cells.add(cell)
  }
  return cells
}

/** True when a span at `slot` fits in the grid and does not touch another footprint. */
export function canPlaceButton(
  buttons: readonly DeckButton[],
  slot: number,
  span: CellSpan,
  grid: GridSettings,
  ignoreButtonId?: string,
): boolean {
  const footprint = footprintAt(slot, span, grid)
  if (!footprint) return false
  const occupied = occupiedCells(
    ignoreButtonId === undefined ? buttons : buttons.filter((button) => button.id !== ignoreButtonId),
    grid,
  )
  return footprint.cells.every((cell) => !occupied.has(cell))
}

/**
 * Keep buttons whose complete footprint fits and does not overlap an earlier
 * kept button. Order is preserved; earlier (lower slot) tiles win collisions.
 */
function pruneButtonsForGrid(buttons: readonly DeckButton[], grid: GridSettings): DeckButton[] {
  const order = buttons
    .map((button, index) => ({ button, index }))
    .sort((a, b) => a.button.slot - b.button.slot || a.index - b.index)
  const occupied = new Set<number>()
  const keep = new Set<number>()
  for (const { button, index } of order) {
    const footprint = buttonFootprint(button, grid)
    if (!footprint) continue
    if (footprint.cells.some((cell) => occupied.has(cell))) continue
    for (const cell of footprint.cells) occupied.add(cell)
    keep.add(index)
  }
  return buttons.filter((_, index) => keep.has(index))
}

export function capacity(grid: GridSettings): number {
  return grid.columns * grid.rows
}

/** Effective grid for a page: its own override or the profile default. */
export function pageGrid(profile: DeckProfile, page: DeckPage): GridSettings {
  return page.grid ?? profile.grid
}

/** Effective capacity of a page (honors the page grid override). */
export function pageCapacity(profile: DeckProfile, page: DeckPage): number {
  return capacity(pageGrid(profile, page))
}

/** Next free slot within the page's effective grid, or null when full. */
export function nextFreeSlotForPage(profile: DeckProfile, page: DeckPage): number | null {
  return nextFreeSlot(page, pageGrid(profile, page))
}

function clampGridValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeGrid(grid: GridSettings): GridSettings {
  return {
    columns: clampGridValue(grid.columns, 1, 10),
    rows: clampGridValue(grid.rows, 1, 10),
    gap: clampGridValue(grid.gap, 0, 60),
    padding: clampGridValue(grid.padding, 0, 80),
  }
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

/** Resize the profile default grid, dropping buttons that no longer fit. */
export function resizeGrid(
  config: DeckConfig,
  profileId: string,
  columns: number,
  rows: number,
  now: Date = new Date(),
): DeckConfig {
  const cols = Math.max(1, Math.min(10, Math.round(columns)))
  const rws = Math.max(1, Math.min(10, Math.round(rows)))
  const next = mapProfile(config, profileId, (profile) => ({
    ...profile,
    grid: { ...profile.grid, columns: cols, rows: rws },
    pages: profile.pages.map((page) => {
      // Pages with their own grid are unaffected by the profile default.
      if (page.grid) return page
      const grid = { ...profile.grid, columns: cols, rows: rws }
      return { ...page, buttons: pruneButtonsForGrid(page.buttons, grid) }
    }),
  }))
  return touch(next, now)
}

/**
 * Set a page's grid override and drop buttons outside the new capacity.
 * Other pages and the profile default are untouched.
 */
export function resizePageGrid(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  grid: GridSettings,
  now: Date = new Date(),
): DeckConfig {
  const normalized = normalizeGrid(grid)
  const next = mapPage(config, profileId, pageId, (page) => ({
    ...page,
    grid: normalized,
    buttons: pruneButtonsForGrid(page.buttons, normalized),
  }))
  return touch(next, now)
}

/**
 * Remove a page's grid override (inherit the profile default) and drop buttons
 * that do not fit the profile grid.
 */
export function clearPageGrid(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  now: Date = new Date(),
): DeckConfig {
  const profile = getProfile(config, profileId)
  if (!profile) return config
  const next = mapPage(config, profileId, pageId, (page) => {
    const rest = { ...page }
    delete rest.grid
    return {
      ...rest,
      buttons: pruneButtonsForGrid(rest.buttons, profile.grid),
    }
  })
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
  const grid = pageGrid(profile, page)
  const span = buttonSpan(button)
  if (button.slot < 0 || button.slot >= capacity(grid)) {
    throw new Error('Slot is outside the grid')
  }
  if (!buttonFootprint(button, grid)) {
    throw new Error(`Button footprint (${span.columns}x${span.rows}) is outside the grid`)
  }
  if (page.buttons.some((existing) => existing.slot === button.slot)) throw new Error('Slot is already occupied')
  if (!canPlaceButton(page.buttons, button.slot, span, grid)) {
    throw new Error('Button overlaps an existing button')
  }

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

/** Move a button to another anchor, swapping with a single occupant when possible. */
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
  const currentPage = getPage(profile, pageId)
  if (!currentPage) throw new Error('Unknown page')
  const moving = currentPage.buttons.find((button) => button.id === buttonId)
  if (!moving) throw new Error('Unknown button')

  const grid = pageGrid(profile, currentPage)
  const span = buttonSpan(moving)
  const target = footprintAt(targetSlot, span, grid)
  if (!target) {
    if (targetSlot < 0 || targetSlot >= capacity(grid)) throw new Error('Slot is outside the grid')
    throw new Error(`Button footprint (${span.columns}x${span.rows}) is outside the grid`)
  }
  if (targetSlot === moving.slot) return config

  const others = currentPage.buttons.filter((button) => button.id !== moving.id)
  const targetCells = new Set(target.cells)
  const blockers = others.filter((button) =>
    buttonFootprint(button, grid)?.cells.some((cell) => targetCells.has(cell)),
  )
  if (blockers.length > 1) {
    throw new Error(`Cannot move button: the target area overlaps ${blockers.length} buttons`)
  }

  // Preserve the editor's existing swap behavior for a single occupant. The
  // final layout is validated below, so a swap that cannot fit is rejected
  // instead of corrupting the grid.
  const proposed = others.map((button) =>
    blockers[0] && button.id === blockers[0].id ? { ...button, slot: moving.slot } : button,
  )
  proposed.push({ ...moving, slot: targetSlot })

  const occupied = new Set<number>()
  for (const button of proposed) {
    const footprint = buttonFootprint(button, grid)
    if (!footprint) {
      throw new Error(`Cannot move button: "${button.label}" does not fit at slot ${button.slot}`)
    }
    if (footprint.cells.some((cell) => occupied.has(cell))) {
      throw new Error('Cannot move button: the destination overlaps another button')
    }
    for (const cell of footprint.cells) occupied.add(cell)
  }

  const next = mapPage(config, profileId, pageId, (page) => ({
    ...page,
    buttons: proposed.sort((a, b) => a.slot - b.slot),
  }))
  return touch(next, now)
}

/**
 * Remove gaps by assigning slots 0..n in current slot order.
 *
 * Guard: if any button spans more than one cell, compaction is skipped. A naive
 * row-major rewrite would move anchors independently of their footprints and
 * could create overlaps; span-aware packing is intentionally deferred to the
 * editor phase. The page is returned untouched so controls and spans stay valid.
 */
export function compactPage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  now: Date = new Date(),
): DeckConfig {
  const profile = getProfile(config, profileId)
  const page = profile ? getPage(profile, pageId) : undefined
  if (!profile || !page) return config
  const hasSpanningTile = page.buttons.some((button) => {
    const span = buttonSpan(button)
    return span.columns !== 1 || span.rows !== 1
  })
  if (hasSpanningTile) return config

  const next = mapPage(config, profileId, pageId, (current) => ({
    ...current,
    buttons: buttonsBySlot(current).map((button, index) => ({ ...button, slot: index })),
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
  const used = occupiedCells(page.buttons, grid)
  for (let slot = 0; slot < capacity(grid); slot += 1) {
    if (!used.has(slot)) return slot
  }
  return null
}

export function defaultPageFor(profile: DeckProfile): DeckPage {
  return getPage(profile, profile.defaultPageId) ?? profile.pages[0]!
}
