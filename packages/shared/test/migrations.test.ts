import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { migrateStarterDeck } from '../src/migrations'
import type { DeckButton } from '../src/types'

function mainButtons(platform = 'win32'): DeckButton[] {
  return createDefaultConfig(platform).profiles[0]!.pages[0]!.buttons
}

function byId(buttons: DeckButton[], id: string): DeckButton {
  const button = buttons.find((candidate) => candidate.id === id)
  expect(button, id).toBeTruthy()
  return button!
}

describe('starter deck migration', () => {
  it('converts untouched Windows starter shortcuts on macOS', () => {
    const migrated = migrateStarterDeck(createDefaultConfig('win32'), 'darwin')
    const buttons = migrated.profiles[0]!.pages[0]!.buttons

    expect(byId(buttons, 'btn-copy').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'C'] }])
    expect(byId(buttons, 'btn-paste').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'V'] }])
    expect(byId(buttons, 'btn-undo').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'Z'] }])
    expect(byId(buttons, 'btn-taskview').label).toBe('Mission Control')
    expect(byId(buttons, 'btn-taskview').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'UP'] }])
    expect(byId(buttons, 'btn-desktop').actions).toEqual([{ type: 'hotkey', keys: ['F11'] }])
    expect(byId(buttons, 'btn-lock').actions).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'WIN', 'Q'] },
    ])
    expect(byId(buttons, 'btn-screenshot').sublabel).toBe('Full screen')
  })

  it('is a no-op on Windows and Linux', () => {
    const config = createDefaultConfig('win32')
    expect(migrateStarterDeck(config, 'win32')).toBe(config)
    expect(migrateStarterDeck(config, 'linux')).toBe(config)
  })

  it('does not touch buttons the user has edited', () => {
    const config = createDefaultConfig('win32')
    const copy = config.profiles[0]!.pages[0]!.buttons.find((button) => button.id === 'btn-copy')!
    copy.actions = [{ type: 'text', text: 'custom copy' }]
    copy.label = 'My copy'

    const migrated = migrateStarterDeck(config, 'darwin')
    const button = migrated.profiles[0]!.pages[0]!.buttons.find((candidate) => candidate.id === 'btn-copy')!
    expect(button.label).toBe('My copy')
    expect(button.actions).toEqual([{ type: 'text', text: 'custom copy' }])
  })

  it('is idempotent', () => {
    const once = migrateStarterDeck(createDefaultConfig('win32'), 'darwin')
    const twice = migrateStarterDeck(once, 'darwin')
    expect(twice).toBe(once)
  })
})
