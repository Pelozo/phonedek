import { describe, expect, it } from 'vitest'
import {
  CONFIG_SCHEMA_VERSION,
  buttonFootprint,
  canPlaceButton,
  createEmptyButton,
  createEmptyPage,
  createEmptyProfile,
  pageGrid,
} from '@phonedek/shared'
import type {
  DeckButton,
  DeckConfig,
  DeckPage,
  DeckProfile,
  GridSettings,
} from '@phonedek/shared'
import {
  cloneButtonForPaste,
  cutButtonFromPage,
  moveButtonToPage,
  pasteButtonIntoPage,
  placeButtonInPage,
} from '../src/renderer/src/lib/clipboard'

const GRID_5x3: GridSettings = { columns: 5, rows: 3, gap: 0, padding: 0 }
const GRID_3x2: GridSettings = { columns: 3, rows: 2, gap: 0, padding: 0 }

interface Fixture {
  config: DeckConfig
  profileA: DeckProfile
  main: DeckPage
  media: DeckPage
  profileB: DeckProfile
  stream: DeckPage
}

function fixture(): Fixture {
  const profileA = createEmptyProfile('Desktop')
  profileA.grid = { ...GRID_5x3 }
  const main = profileA.pages[0]!
  main.name = 'Main'
  const media = createEmptyPage('Media')
  profileA.pages.push(media)

  const profileB = createEmptyProfile('Streaming')
  profileB.grid = { ...GRID_5x3 }
  const stream = profileB.pages[0]!
  stream.name = 'Live'

  const config: DeckConfig = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: '2026-01-01T00:00:00.000Z',
    serverName: 'Studio',
    defaultProfileId: profileA.id,
    profiles: [profileA, profileB],
  }
  return { config, profileA, main, media, profileB, stream }
}

function richButton(slot = 0, overrides: Partial<DeckButton> = {}): DeckButton {
  return {
    id: 'btn-source',
    slot,
    label: 'Mic mute',
    sublabel: 'Ctrl + M',
    icon: '🎙️',
    background: { type: 'gradient', from: '#112233', to: '#445566', angle: 45, overlay: 0.2 },
    textColor: '#fefefe',
    iconMedia: { type: 'image', asset: 'mic.gif', fit: 'contain' },
    actions: [
      { type: 'hotkey', keys: ['CTRL', 'M'], holdMs: 40 },
      { type: 'delay', ms: 120 },
    ],
    control: {
      kind: 'slider',
      axis: 'horizontal',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
      haptics: false,
    },
    span: { columns: 2, rows: 1 },
    ...overrides,
  }
}

function buttonAt(slot: number, id: string): DeckButton {
  return { ...createEmptyButton(slot, id), id, slot, actions: [] }
}

function pageButtons(config: DeckConfig, profileId: string, pageId: string): DeckButton[] {
  return config.profiles.find((item) => item.id === profileId)!.pages.find((item) => item.id === pageId)!
    .buttons
}

describe('clipboard helpers', () => {
  it('deep-clones every component field and assigns a new id', () => {
    const source = richButton()
    const clone = cloneButtonForPaste(source)

    expect(clone.id).not.toBe(source.id)
    expect(clone.id.startsWith('btn-')).toBe(true)
    expect(clone.label).toBe(source.label)
    expect(clone.sublabel).toBe(source.sublabel)
    expect(clone.icon).toBe(source.icon)
    expect(clone.background).toEqual(source.background)
    expect(clone.textColor).toBe(source.textColor)
    expect(clone.iconMedia).toEqual(source.iconMedia)
    expect(clone.span).toEqual(source.span)
    expect(clone.control).toEqual(source.control)
    expect(clone.actions).toEqual(source.actions)
    expect(clone.actions).not.toBe(source.actions)
    expect(clone.control).not.toBe(source.control)

    // Mutating the clone must not touch the clipboard source.
    ;(clone.actions[0] as { keys: string[] }).keys.push('SHIFT')
    clone.background = { type: 'color', color: '#000000' }
    expect((source.actions[0] as { keys: string[] }).keys).toEqual(['CTRL', 'M'])
    expect(source.background).toEqual({ type: 'gradient', from: '#112233', to: '#445566', angle: 45, overlay: 0.2 })
  })

  it('pastes into the same slot when it is free and keeps the span', () => {
    const f = fixture()
    const source = richButton(2)
    const result = pasteButtonIntoPage(f.config, f.profileB.id, f.stream.id, source)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fallback).toBe('none')
    expect(result.button.slot).toBe(2)
    expect(result.button.span).toEqual({ columns: 2, rows: 1 })
    expect(result.button.id).not.toBe(source.id)
    expect(pageButtons(result.config, f.profileB.id, f.stream.id)).toHaveLength(1)
    expect(result.config.profiles[0]!.pages[0]!.buttons).toHaveLength(0)
  })

  it('falls back to 1×1 when the preferred span has no space', () => {
    const f = fixture()
    f.profileB.pages[0]!.grid = { ...GRID_3x2 }
    const target = pageButtons(f.config, f.profileB.id, f.stream.id)
    // Free cells are 0 and 5 only: no 2×1 footprint can fit.
    target.push(buttonAt(1, 'b1'), buttonAt(2, 'b2'), buttonAt(3, 'b3'), buttonAt(4, 'b4'))

    const source = richButton(1)
    const result = pasteButtonIntoPage(f.config, f.profileB.id, f.stream.id, source)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fallback).toBe('span-reduced')
    expect(result.button.slot).toBe(0)
    expect(result.button.span).toEqual({ columns: 1, rows: 1 })
    expect(result.button.actions).toEqual(source.actions)
    expect(result.button.control).toEqual(source.control)
  })

  it('never overwrites or overlaps an existing button', () => {
    const f = fixture()
    const existing = buttonAt(0, 'existing')
    f.profileB.pages[0]!.buttons.push(existing)

    const result = pasteButtonIntoPage(f.config, f.profileB.id, f.stream.id, richButton(0))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.button.slot).toBe(1)
    const buttons = pageButtons(result.config, f.profileB.id, f.stream.id)
    expect(buttons.find((item) => item.id === 'existing')).toEqual(existing)
    expect(buttons).toHaveLength(2)
    const grid = pageGrid(f.profileB, f.stream)
    expect(canPlaceButton(buttons, result.button.slot, { columns: 2, rows: 1 }, grid, result.button.id)).toBe(true)
    expect(buttons.every((item) => item.id !== result.button.id || buttonFootprint(item, grid))).toBe(true)
  })

  it('reports an error and leaves the config untouched when no cell is free', () => {
    const f = fixture()
    const fullProfile = createEmptyProfile('Full')
    fullProfile.grid = { columns: 1, rows: 1, gap: 0, padding: 0 }
    fullProfile.pages[0]!.buttons.push(buttonAt(0, 'only'))
    f.config.profiles.push(fullProfile)
    const snapshot = structuredClone(f.config)

    const result = pasteButtonIntoPage(f.config, fullProfile.id, fullProfile.pages[0]!.id, richButton(0))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/No free cell/i)
    expect(f.config).toEqual(snapshot)
  })

  it('assigns a fresh id on every paste', () => {
    const f = fixture()
    const first = pasteButtonIntoPage(f.config, f.profileA.id, f.media.id, richButton(0))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = pasteButtonIntoPage(first.config, f.profileA.id, f.media.id, richButton(0))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.button.id).not.toBe(first.button.id)
    expect(pageButtons(second.config, f.profileA.id, f.media.id)).toHaveLength(2)
  })

  it('cuts a button out of the source page and returns a deep copy', () => {
    const f = fixture()
    f.main.buttons.push(richButton(0))
    const result = cutButtonFromPage(f.config, f.profileA.id, f.main.id, 'btn-source')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.button.label).toBe('Mic mute')
    expect(result.button).not.toBe(f.main.buttons[0])
    expect(pageButtons(result.config, f.profileA.id, f.main.id)).toHaveLength(0)
  })

  it('moves a component across pages, keeping id and settings', () => {
    const f = fixture()
    const source = richButton(0)
    f.main.buttons.push(source)

    const result = moveButtonToPage(
      f.config,
      f.profileA.id,
      f.main.id,
      f.profileA.id,
      f.media.id,
      source.id,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fallback).toBe('none')
    expect(result.button.id).toBe(source.id)
    expect(result.button.actions).toEqual(source.actions)
    expect(result.button.control).toEqual(source.control)
    expect(result.button.background).toEqual(source.background)
    expect(result.button.span).toEqual(source.span)
    expect(pageButtons(result.config, f.profileA.id, f.main.id)).toHaveLength(0)
    const target = pageButtons(result.config, f.profileA.id, f.media.id)
    expect(target).toHaveLength(1)
    expect(target[0]!.id).toBe(source.id)
    expect(target[0]!.slot).toBe(0)
  })

  it('moves a component across profiles', () => {
    const f = fixture()
    const source = richButton(1)
    f.main.buttons.push(source)

    const result = moveButtonToPage(
      f.config,
      f.profileA.id,
      f.main.id,
      f.profileB.id,
      f.stream.id,
      source.id,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.button.id).toBe(source.id)
    expect(pageButtons(result.config, f.profileA.id, f.main.id)).toHaveLength(0)
    const target = pageButtons(result.config, f.profileB.id, f.stream.id)
    expect(target).toHaveLength(1)
    expect(target[0]!.slot).toBe(1)
    expect(target[0]!.label).toBe('Mic mute')
  })

  it('generates a new id when the target already uses the moved id', () => {
    const f = fixture()
    const source = richButton(0)
    f.main.buttons.push(source)
    f.stream.buttons.push({ ...buttonAt(0, 'btn-source'), label: 'Target button' })

    const result = moveButtonToPage(
      f.config,
      f.profileA.id,
      f.main.id,
      f.profileB.id,
      f.stream.id,
      source.id,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.button.id).not.toBe('btn-source')
    expect(result.button.id.startsWith('btn-')).toBe(true)
    const target = pageButtons(result.config, f.profileB.id, f.stream.id)
    expect(target).toHaveLength(2)
    expect(new Set(target.map((item) => item.id)).size).toBe(2)
    expect(target.find((item) => item.label === 'Target button')!.id).toBe('btn-source')
  })

  it('moves into the first free span-aware slot and never overlaps', () => {
    const f = fixture()
    const source = richButton(0)
    f.main.buttons.push(source)
    f.stream.buttons.push(buttonAt(0, 'a'), buttonAt(1, 'b'))

    const result = moveButtonToPage(
      f.config,
      f.profileA.id,
      f.main.id,
      f.profileB.id,
      f.stream.id,
      source.id,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.button.slot).toBe(2)
    const buttons = pageButtons(result.config, f.profileB.id, f.stream.id)
    const grid = pageGrid(f.profileB, f.stream)
    expect(canPlaceButton(buttons, result.button.slot, { columns: 2, rows: 1 }, grid, result.button.id)).toBe(true)
    expect(buttons).toHaveLength(3)
  })

  it('refuses to move when the target has no free cell and keeps the original', () => {
    const f = fixture()
    const source = richButton(0, { span: undefined })
    f.main.buttons.push(source)
    const fullProfile = createEmptyProfile('Full')
    fullProfile.grid = { columns: 1, rows: 1, gap: 0, padding: 0 }
    fullProfile.pages[0]!.buttons.push(buttonAt(0, 'only'))
    f.config.profiles.push(fullProfile)
    const snapshot = structuredClone(f.config)

    const result = moveButtonToPage(
      f.config,
      f.profileA.id,
      f.main.id,
      fullProfile.id,
      fullProfile.pages[0]!.id,
      source.id,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not moved/i)
    expect(f.config).toEqual(snapshot)
    expect(pageButtons(f.config, f.profileA.id, f.main.id)).toHaveLength(1)
  })

  it('rejects moving a component onto its own page', () => {
    const f = fixture()
    f.main.buttons.push(richButton(0))
    const result = moveButtonToPage(f.config, f.profileA.id, f.main.id, f.profileA.id, f.main.id, 'btn-source')
    expect(result.ok).toBe(false)
  })

  it('placeButtonInPage prefers the requested slot, then the first free cell', () => {
    const f = fixture()
    const source = richButton(3, { span: undefined })
    expect(placeButtonInPage(f.stream, f.profileB.grid, source)).toEqual({
      slot: 3,
      span: { columns: 1, rows: 1 },
      fallback: 'none',
    })

    f.stream.buttons.push(buttonAt(3, 'occupied'))
    expect(placeButtonInPage(f.stream, f.profileB.grid, source)?.slot).toBe(0)
  })
})
