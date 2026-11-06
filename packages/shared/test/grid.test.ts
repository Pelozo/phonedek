import { describe, expect, it } from 'vitest'
import { createDefaultConfig, createEmptyButton } from '../src/defaults'
import {
  addButton,
  addPage,
  capacity,
  compactPage,
  duplicatePage,
  getProfile,
  moveButton,
  nextFreeSlot,
  removeButton,
  resizeGrid,
  resolvePageId,
  updateButton,
} from '../src/grid'

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
