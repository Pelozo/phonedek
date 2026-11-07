import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import {
  addButton,
  buttonFootprint,
  buttonSpan,
  canPlaceButton,
  compactPage,
  duplicatePage,
  duplicateProfile,
  getProfile,
  moveButton,
  nextFreeSlot,
  occupiedCells,
  resizeGrid,
  resizePageGrid,
} from '../src/grid'
import { validateConfig } from '../src/schema'
import type { CellSpan, ControlSpec, DeckButton, DeckConfig, GridSettings } from '../src/types'

const TEST_GRID: GridSettings = { columns: 5, rows: 4, gap: 8, padding: 10 }

function button(id: string, slot: number, span?: CellSpan, control?: ControlSpec): DeckButton {
  return {
    id,
    slot,
    label: id,
    actions: [],
    ...(span ? { span } : {}),
    ...(control ? { control } : {}),
  }
}

function emptyPageConfig(): { config: DeckConfig; profileId: string; pageId: string } {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  profile.grid = { ...TEST_GRID }
  const page = profile.pages[0]!
  page.buttons = []
  return { config, profileId: profile.id, pageId: page.id }
}

function soloButtonConfig(): { config: DeckConfig; profileId: string; pageId: string; button: DeckButton } {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const target: DeckButton = {
    id: 'btn-control',
    slot: 0,
    label: 'Control',
    actions: [],
  }
  page.buttons = [target]
  return { config, profileId: profile.id, pageId: page.id, button: target }
}

function slots(config: DeckConfig, profileId: string, pageId: string): number[] {
  const page = getProfile(config, profileId)!.pages.find((candidate) => candidate.id === pageId)!
  return page.buttons.map((candidate) => candidate.slot)
}

describe('button footprints', () => {
  it('defaults to 1x1 and computes row-major cells', () => {
    expect(buttonSpan(button('a', 7))).toEqual({ columns: 1, rows: 1 })
    expect(buttonSpan(button('b', 7, { columns: 3, rows: 2 }))).toEqual({ columns: 3, rows: 2 })

    expect(buttonFootprint(button('a', 7), TEST_GRID)).toMatchObject({
      slot: 7,
      row: 1,
      column: 2,
      columns: 1,
      rows: 1,
      cells: [7],
    })
    expect(buttonFootprint(button('b', 2, { columns: 3, rows: 1 }), TEST_GRID)!.cells).toEqual([2, 3, 4])
    expect(buttonFootprint(button('c', 6, { columns: 3, rows: 2 }), TEST_GRID)).toMatchObject({
      row: 1,
      column: 1,
      columns: 3,
      rows: 2,
      cells: [6, 7, 8, 11, 12, 13],
    })
  })

  it('returns null when any covered cell leaves the grid', () => {
    expect(buttonFootprint(button('a', 4, { columns: 3, rows: 1 }), TEST_GRID)).toBeNull()
    expect(buttonFootprint(button('b', 2, { columns: 3, rows: 1 }), TEST_GRID)).not.toBeNull()
    expect(buttonFootprint(button('c', 16, { columns: 1, rows: 2 }), TEST_GRID)).toBeNull()
    expect(buttonFootprint(button('d', 20, { columns: 1, rows: 1 }), TEST_GRID)).toBeNull()
  })

  it('reports every occupied cell and skips covered cells for free slots', () => {
    const buttons = [button('a', 0, { columns: 3, rows: 1 }), button('b', 6)]
    expect([...occupiedCells(buttons, TEST_GRID)].sort((a, b) => a - b)).toEqual([0, 1, 2, 6])
    expect(nextFreeSlot({ id: 'page', name: 'Page', buttons }, TEST_GRID)).toBe(3)
  })

  it('checks placement against complete footprints and can ignore the moving tile', () => {
    const buttons = [button('a', 0, { columns: 3, rows: 1 }), button('b', 6)]
    expect(canPlaceButton(buttons, 0, { columns: 3, rows: 1 }, TEST_GRID)).toBe(false)
    expect(canPlaceButton(buttons, 2, { columns: 1, rows: 1 }, TEST_GRID)).toBe(false)
    expect(canPlaceButton(buttons, 3, { columns: 2, rows: 1 }, TEST_GRID)).toBe(true)
    expect(canPlaceButton(buttons, 5, { columns: 3, rows: 1 }, TEST_GRID)).toBe(false) // covers slot 6
    expect(canPlaceButton(buttons, 10, { columns: 3, rows: 2 }, TEST_GRID)).toBe(true)
    expect(canPlaceButton(buttons, 0, { columns: 3, rows: 1 }, TEST_GRID, 'a')).toBe(true)
  })
})

describe('span-aware page mutations', () => {
  it('adds spanning buttons and rejects footprint collisions', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    const added = addButton(config, profileId, pageId, button('a', 0, { columns: 3, rows: 1 }))
    expect(slots(added, profileId, pageId)).toEqual([0])

    expect(() => addButton(added, profileId, pageId, button('b', 1))).toThrow(/overlaps/)
    expect(() => addButton(added, profileId, pageId, button('c', 3, { columns: 3, rows: 1 }))).toThrow(
      /outside the grid/,
    )

    const roomy = addButton(added, profileId, pageId, button('d', 10, { columns: 3, rows: 2 }))
    expect(slots(roomy, profileId, pageId)).toEqual([0, 10])
    expect(buttonFootprint(getProfile(roomy, profileId)!.pages[0]!.buttons[1]!, TEST_GRID)!.cells).toEqual([
      10, 11, 12, 15, 16, 17,
    ])
  })

  it('moves spanning buttons into free space and rejects unsafe targets', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    const withSpan = addButton(config, profileId, pageId, button('a', 0, { columns: 3, rows: 1 }))
    const withOther = addButton(withSpan, profileId, pageId, button('b', 6))

    const moved = moveButton(withOther, profileId, pageId, 'a', 10)
    expect(slots(moved, profileId, pageId)).toEqual([6, 10])
    expect(() => moveButton(withOther, profileId, pageId, 'a', 3)).toThrow(/outside the grid/)

    // The target overlaps two tiles, so no safe swap exists.
    let crowded = addButton(config, profileId, pageId, button('wide', 10, { columns: 3, rows: 1 }))
    crowded = addButton(crowded, profileId, pageId, button('one', 6))
    crowded = addButton(crowded, profileId, pageId, button('two', 7))
    expect(() => moveButton(crowded, profileId, pageId, 'wide', 5)).toThrow(/overlaps 2 buttons/)

    // A single occupant can only be swapped when its span fits the old anchor.
    let swap = addButton(config, profileId, pageId, button('narrow', 3, { columns: 2, rows: 1 }))
    swap = addButton(swap, profileId, pageId, button('wide2', 5, { columns: 3, rows: 1 }))
    expect(() => moveButton(swap, profileId, pageId, 'narrow', 5)).toThrow(/does not fit/)
  })

  it('keeps the legacy 1x1 swap behavior', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    const one = addButton(config, profileId, pageId, button('one', 0))
    const two = addButton(one, profileId, pageId, button('two', 5))
    const swapped = moveButton(two, profileId, pageId, 'one', 5)
    expect(slots(swapped, profileId, pageId)).toEqual([0, 5])
    const page = getProfile(swapped, profileId)!.pages[0]!
    expect(page.buttons.find((candidate) => candidate.slot === 5)!.id).toBe('one')
    expect(page.buttons.find((candidate) => candidate.slot === 0)!.id).toBe('two')
  })

  it('drops spanning buttons that no longer fit when the profile grid shrinks', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    let grown = addButton(config, profileId, pageId, button('wide', 2, { columns: 3, rows: 1 }))
    grown = addButton(grown, profileId, pageId, button('single', 10))

    const resized = resizeGrid(grown, profileId, 4, 4)
    expect(slots(resized, profileId, pageId)).toEqual([10])
    const page = getProfile(resized, profileId)!.pages[0]!
    expect(occupiedCells(page.buttons, { ...TEST_GRID, columns: 4, rows: 4 }).size).toBe(1)
  })

  it('drops spanning buttons that no longer fit when a page grid shrinks', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    let grown = addButton(config, profileId, pageId, button('wide', 0, { columns: 2, rows: 2 }))
    grown = addButton(grown, profileId, pageId, button('single', 2))

    const resized = resizePageGrid(grown, profileId, pageId, { columns: 3, rows: 1, gap: 4, padding: 4 })
    const profile = getProfile(resized, profileId)!
    const page = profile.pages.find((candidate) => candidate.id === pageId)!
    expect(page.grid).toEqual({ columns: 3, rows: 1, gap: 4, padding: 4 })
    expect(page.buttons.map((candidate) => candidate.id)).toEqual(['single'])
  })

  it('duplicates pages and profiles with spans, controls and fresh ids', () => {
    const control: ControlSpec = {
      kind: 'slider',
      axis: 'horizontal',
      emit: 'delta',
      binding: { type: 'volume', mode: 'relative', stepPercent: 4 },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
      haptics: true,
    }
    const { config, profileId, pageId } = emptyPageConfig()
    const withControl = addButton(config, profileId, pageId, button('span', 0, { columns: 3, rows: 1 }, control))

    const pageCopy = duplicatePage(withControl, profileId, pageId)
    const copiedPage = getProfile(pageCopy.config, profileId)!.pages.find((page) => page.id === pageCopy.pageId)!
    expect(copiedPage.buttons[0]!.id).not.toBe('span')
    expect(copiedPage.buttons[0]!.span).toEqual({ columns: 3, rows: 1 })
    expect(copiedPage.buttons[0]!.control).toEqual(control)
    expect(copiedPage.buttons[0]!.control).not.toBe(control)

    const profileCopy = duplicateProfile(withControl, profileId)
    const copiedProfile = getProfile(profileCopy.config, profileCopy.profileId)!
    const first = copiedProfile.pages[0]!.buttons[0]!
    expect(first.id).not.toBe('span')
    expect(first.span).toEqual({ columns: 3, rows: 1 })
    expect(first.control).toEqual(control)
  })

  it('compacts only when no tile spans cells', () => {
    const { config, profileId, pageId } = emptyPageConfig()
    const sparse = addButton(config, profileId, pageId, button('b', 10))
    const compacted = compactPage(sparse, profileId, pageId)
    expect(slots(compacted, profileId, pageId)).toEqual([0])

    const spanning = addButton(config, profileId, pageId, button('wide', 0, { columns: 2, rows: 1 }))
    expect(compactPage(spanning, profileId, pageId)).toBe(spanning)
  })
})

describe('schema for spans and controls', () => {
  it('keeps legacy configs valid without span/control fields', () => {
    const config = createDefaultConfig()
    for (const page of config.profiles[0]!.pages) {
      for (const item of page.buttons) {
        expect(item.span).toBeUndefined()
        expect(item.control).toBeUndefined()
      }
    }
    expect(validateConfig(config).ok).toBe(true)
  })

  it('accepts valid spans and slider/dial controls', () => {
    const { config, button: target } = soloButtonConfig()
    target.span = { columns: 3, rows: 1 }
    target.control = {
      kind: 'slider',
      axis: 'horizontal',
      emit: 'delta',
      binding: { type: 'volume', mode: 'relative' },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
      haptics: true,
    }
    expect(validateConfig(config).ok).toBe(true)

    target.control = {
      kind: 'dial',
      emit: 'delta',
      binding: { type: 'scroll', axis: 'vertical', invert: true },
    }
    expect(validateConfig(config).ok).toBe(true)

    target.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
    }
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects invalid spans', () => {
    const { config, button: target } = soloButtonConfig()
    for (const span of [
      { columns: 0, rows: 1 },
      { columns: 11, rows: 1 },
      { columns: 2, rows: 0 },
      { columns: 1, rows: 11 },
      { columns: 1.5, rows: 1 },
    ]) {
      target.span = span as CellSpan
      expect(validateConfig(config).ok).toBe(false)
    }
  })

  it('rejects invalid control kinds, emits, bindings and ranges', () => {
    const { config, button: target } = soloButtonConfig()
    const valid: ControlSpec = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'volume', mode: 'relative' },
    }

    target.control = { ...valid, kind: 'wheel' } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, emit: 'absolute' } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, binding: { type: 'volume', mode: 'absolute' } } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, emit: 'value' } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
    }
    expect(validateConfig(config).ok).toBe(true)

    target.control = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'volume', mode: 'absolute' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, binding: { type: 'scroll' } } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      ...valid,
      binding: { type: 'volume', mode: 'relative', stepPercent: 0 },
    }
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      ...valid,
      binding: { type: 'volume', mode: 'relative', stepPercent: 26 },
    }
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, step: 0 }
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, min: 10, max: 10 }
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, min: 0, max: 10, initial: 11 }
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, min: 0, max: 10, initial: -1 }
    expect(validateConfig(config).ok).toBe(false)

    target.control = { ...valid, min: 0, max: 10, initial: 5 }
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects footprints outside the page grid', () => {
    const { config, button: target } = soloButtonConfig()
    target.slot = 4
    target.span = { columns: 3, rows: 1 }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/extends outside the 5x3 grid/)
  })

  it('rejects overlapping footprints even when anchors differ', () => {
    const config = createDefaultConfig()
    const page = config.profiles[0]!.pages[0]!
    page.buttons = [
      { id: 'btn-wide', slot: 0, label: 'Wide', actions: [], span: { columns: 3, rows: 1 } },
      { id: 'btn-inside', slot: 1, label: 'Inside', actions: [] },
    ]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/overlap/)
  })

  it('accepts a spanning tile when it does not overlap the remaining tiles', () => {
    const config = createDefaultConfig()
    const page = config.profiles[0]!.pages[0]!
    page.buttons = [
      { id: 'btn-wide', slot: 0, label: 'Wide', actions: [], span: { columns: 3, rows: 1 } },
      { id: 'btn-next-row', slot: 5, label: 'Next row', actions: [] },
    ]
    expect(validateConfig(config).ok).toBe(true)
    expect(config.schemaVersion).toBe(1)
  })
})
