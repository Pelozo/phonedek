import { describe, expect, it } from 'vitest'
import {
  ACTION_PACKS,
  findActionPack,
  findActionPreset,
  presetToButton,
} from '../src/presets'
import { ActionSchema } from '../src/schema'
import { normalizeCombo } from '../src/keys'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

describe('action packs', () => {
  it('exports a non-empty pack list', () => {
    expect(ACTION_PACKS.length).toBeGreaterThan(0)
    for (const pack of ACTION_PACKS) {
      expect(pack.name.length).toBeGreaterThan(0)
      expect(pack.description.length).toBeGreaterThan(0)
      expect(pack.presets.length).toBeGreaterThan(0)
    }
  })

  it('uses unique, schema-safe pack and preset ids', () => {
    const packIds = new Set<string>()
    const presetIds = new Set<string>()
    for (const pack of ACTION_PACKS) {
      expect(pack.id).toMatch(ID_PATTERN)
      expect(packIds.has(pack.id)).toBe(false)
      packIds.add(pack.id)
      for (const preset of pack.presets) {
        expect(preset.id).toMatch(ID_PATTERN)
        expect(presetIds.has(preset.id)).toBe(false)
        presetIds.add(preset.id)
        expect(preset.actions.length).toBeGreaterThan(0)
      }
    }
  })

  it('validates every preset action against ActionSchema', () => {
    for (const pack of ACTION_PACKS) {
      for (const preset of pack.presets) {
        for (const action of preset.actions) {
          const parsed = ActionSchema.safeParse(action)
          expect(parsed.success, `${pack.id}/${preset.id}: ${JSON.stringify(action)}`).toBe(true)
          if (action.type === 'hotkey') {
            expect(() => normalizeCombo(action.keys)).not.toThrow()
          }
        }
      }
    }
  })

  it('stays JSON-serializable', () => {
    expect(JSON.parse(JSON.stringify(ACTION_PACKS))).toEqual(ACTION_PACKS)
  })

  it('exports the requested packs and presets', () => {
    expect(ACTION_PACKS.map((pack) => pack.id)).toEqual(
      expect.arrayContaining(['chrome', 'obs', 'vscode', 'system', 'media']),
    )
    expect(findActionPack('chrome')?.presets.length).toBeGreaterThan(10)
    expect(findActionPack('obs')?.presets.length).toBeGreaterThan(0)
    expect(findActionPreset('system-screenshot')?.actions).toEqual([
      { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] },
    ])
    expect(findActionPack('missing')).toBeUndefined()
    expect(findActionPreset('missing')).toBeUndefined()
  })

  it('builds a one-action button from a preset', () => {
    const preset = findActionPreset('chrome-new-tab')!
    const button = presetToButton(preset, 3)
    expect(button.slot).toBe(3)
    expect(button.label).toBe(preset.name)
    expect(button.icon).toBe(preset.icon)
    expect(button.actions).toEqual(preset.actions)
    expect(button.actions).not.toBe(preset.actions)
    expect(button.id).toMatch(/^btn-/)
  })
})
