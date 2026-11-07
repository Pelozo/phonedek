import { describe, expect, it } from 'vitest'
import { createDefaultConfig, createEmptyButton } from '../src/defaults'
import {
  addButton,
  addPage,
  capacity,
  clearPageGrid,
  compactPage,
  duplicatePage,
  getProfile,
  moveButton,
  nextFreeSlot,
  nextFreeSlotForPage,
  pageCapacity,
  pageGrid,
  removeButton,
  resizeGrid,
  resizePageGrid,
  resolvePageId,
  updateButton,
} from '../src/grid'
import type { GridSettings } from '../src/types'

function grid(columns: number, rows: number): GridSettings {
  return { columns, rows, gap: 10, padding: 12 }
}

describe('grid helpers', () => {
  it('adds, updates, moves and removes buttons immutably', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const taller = resizeGrid(base, profileId, 5, 4)

    const added = addButton(taller, profileId, pageId, createEmptyButton(15))
    expect(taller.profiles[0]!.pages[0]!.buttons).toHaveLength(15)
    expect(added.profiles[0]!.pages[0]!.buttons).toHaveLength(16)
    const button = added.profiles[0]!.pages[0]!.buttons.find((item) => item.slot === 15)!

    const updated = updateButton(added, profileId, pageId, button.id, { label: 'Renamed' })
    expect(updated.profiles[0]!.pages[0]!.buttons.find((item) => item.id === button.id)!.label).toBe('Renamed')

    const moved = moveButton(updated, profileId, pageId, button.id, 0)
    const page = moved.profiles[0]!.pages[0]!
    expect(page.buttons.find((item) => item.id === button.id)!.slot).toBe(0)
    expect(page.buttons.find((item) => item.slot === 15)!.id).toBe('btn-vol-down')

    const removed = removeButton(moved, profileId, pageId, button.id)
    expect(removed.profiles[0]!.pages[0]!.buttons).toHaveLength(15)
  })

  it('resizes and drops out-of-range buttons', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const resized = resizeGrid(base, profileId, 3, 2)
    const profile = getProfile(resized, profileId)!
    expect(capacity(profile.grid)).toBe(6)
    expect(profile.pages[0]!.buttons.every((button) => button.slot < 6)).toBe(true)
  })

  it('compacts slots', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const page = base.profiles[0]!.pages[0]!
    const compacted = compactPage(base, profileId, pageId)
    const slots = compacted.profiles[0]!.pages[0]!.buttons.map((button) => button.slot)
    expect(slots).toEqual(page.buttons.map((_, index) => index))
  })

  it('finds the next free slot', () => {
    const base = createDefaultConfig()
    const profile = base.profiles[0]!
    expect(nextFreeSlot(profile.pages[0]!, profile.grid)).toBeNull()
    const taller = resizeGrid(base, profile.id, 5, 4)
    expect(nextFreeSlot(taller.profiles[0]!.pages[0]!, taller.profiles[0]!.grid)).toBe(15)
    const resized = resizeGrid(base, profile.id, 2, 2)
    expect(nextFreeSlot(resized.profiles[0]!.pages[0]!, resized.profiles[0]!.grid)).toBeNull()
  })

  it('duplicates a page with fresh ids', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const result = duplicatePage(base, profileId, pageId)
    const copy = result.config.profiles[0]!.pages.find((page) => page.id === result.pageId)!
    expect(copy.name).toMatch(/copy$/)
    expect(copy.buttons[0]!.id).not.toBe(base.profiles[0]!.pages[0]!.buttons[0]!.id)
  })

  it('adds a page and resolves navigation with wrapping', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const withPage = addPage(base, profileId, 'Extra')
    const profile = withPage.config.profiles[0]!
    expect(profile.pages).toHaveLength(3)
    expect(resolvePageId(profile, 'page-main', { type: 'page', direction: 'prev' })).toBe(withPage.pageId)
    expect(resolvePageId(profile, 'page-main', { type: 'page', direction: 'next' })).toBe('page-media')
    expect(
      resolvePageId(profile, 'page-main', { type: 'page', direction: 'goto', pageId: withPage.pageId }),
    ).toBe(withPage.pageId)
  })
})

describe('per-page grid helpers', () => {
  it('inherits the profile grid when no page override exists', () => {
    const base = createDefaultConfig()
    const profile = base.profiles[0]!
    const page = profile.pages[0]!
    expect(page.grid).toBeUndefined()
    expect(pageGrid(profile, page)).toBe(profile.grid)
    expect(pageCapacity(profile, page)).toBe(capacity(profile.grid))
    expect(nextFreeSlotForPage(profile, page)).toBeNull() // 15 buttons fill the 5x3 grid
    expect(nextFreeSlotForPage(profile, profile.pages[1]!)).toBe(10)
  })

  it('resizes only the requested page and drops buttons outside its capacity', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const resized = resizePageGrid(base, profileId, pageId, grid(4, 2))
    const profile = getProfile(resized, profileId)!
    const page = profile.pages.find((candidate) => candidate.id === pageId)!
    const media = profile.pages.find((candidate) => candidate.id === 'page-media')!

    expect(page.grid).toEqual(grid(4, 2))
    expect(pageGrid(profile, page)).toEqual(grid(4, 2))
    expect(pageCapacity(profile, page)).toBe(8)
    expect(page.buttons.every((button) => button.slot < 8)).toBe(true)

    // Other pages and the profile default are untouched.
    expect(media.grid).toBeUndefined()
    expect(media.buttons).toEqual(base.profiles[0]!.pages[1]!.buttons)
    expect(profile.grid).toEqual(base.profiles[0]!.grid)
  })

  it('clears the override and trims buttons outside the profile capacity', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const wide = resizePageGrid(base, profileId, pageId, grid(8, 4))
    const withButton = addButton(wide, profileId, pageId, createEmptyButton(30))
    const widePage = getProfile(withButton, profileId)!.pages.find((page) => page.id === pageId)!
    expect(widePage.buttons.some((button) => button.slot === 30)).toBe(true)

    const cleared = clearPageGrid(withButton, profileId, pageId)
    const profile = getProfile(cleared, profileId)!
    const page = profile.pages.find((candidate) => candidate.id === pageId)!
    expect(page.grid).toBeUndefined()
    expect('grid' in page).toBe(false)
    expect(page.buttons.every((button) => button.slot < capacity(profile.grid))).toBe(true)
    expect(page.buttons.some((button) => button.slot === 30)).toBe(false)
    expect(profile.grid).toEqual(base.profiles[0]!.grid)
  })

  it('copies the grid override when duplicating a page', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[1]!.id
    const resized = resizePageGrid(base, profileId, pageId, grid(6, 2))
    const result = duplicatePage(resized, profileId, pageId)
    const profile = getProfile(result.config, profileId)!
    const copy = profile.pages.find((page) => page.id === result.pageId)!
    const original = profile.pages.find((page) => page.id === pageId)!

    expect(copy.grid).toEqual(grid(6, 2))
    expect(copy.grid).not.toBe(original.grid)
    expect(copy.buttons[0]!.id).not.toBe(original.buttons[0]!.id)
  })

  it('adds pages without a grid override so they inherit the profile', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const result = addPage(base, profileId, 'Extra')
    const profile = getProfile(result.config, profileId)!
    const page = profile.pages.find((candidate) => candidate.id === result.pageId)!
    expect(page.grid).toBeUndefined()
    expect(pageGrid(profile, page)).toBe(profile.grid)
  })

  it('keeps overridden pages independent when the profile default changes', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const mediaId = base.profiles[0]!.pages[1]!.id
    const overridden = resizePageGrid(base, profileId, mediaId, grid(8, 4))
    const resized = resizeGrid(overridden, profileId, 3, 3)
    const profile = getProfile(resized, profileId)!
    const main = profile.pages.find((page) => page.id === 'page-main')!
    const media = profile.pages.find((page) => page.id === mediaId)!

    expect(main.grid).toBeUndefined()
    expect(main.buttons.every((button) => button.slot < 9)).toBe(true)
    expect(media.grid).toEqual(grid(8, 4))
    expect(media.buttons).toHaveLength(10) // slot 9 still fits the page override
    expect(media.buttons.some((button) => button.slot === 9)).toBe(true)
  })

  it('uses the page capacity for addButton and moveButton', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[0]!.id
    const wide = resizePageGrid(base, profileId, pageId, grid(8, 4))

    expect(() => addButton(base, profileId, pageId, createEmptyButton(20))).toThrow(/outside the grid/)

    const added = addButton(wide, profileId, pageId, createEmptyButton(20))
    const button = getProfile(added, profileId)!.pages[0]!.buttons.find((item) => item.slot === 20)!
    const moved = moveButton(added, profileId, pageId, button.id, 31)
    expect(getProfile(moved, profileId)!.pages[0]!.buttons.find((item) => item.id === button.id)!.slot).toBe(31)
    expect(() => moveButton(added, profileId, pageId, button.id, 40)).toThrow(/outside the grid/)
  })

  it('computes the next free slot for the effective page grid', () => {
    const base = createDefaultConfig()
    const profileId = base.profiles[0]!.id
    const pageId = base.profiles[0]!.pages[1]!.id
    const small = resizePageGrid(base, profileId, pageId, grid(2, 2))
    const profile = getProfile(small, profileId)!
    const page = profile.pages.find((candidate) => candidate.id === pageId)!
    expect(pageCapacity(profile, page)).toBe(4)
    expect(nextFreeSlotForPage(profile, page)).toBeNull()
  })
})
