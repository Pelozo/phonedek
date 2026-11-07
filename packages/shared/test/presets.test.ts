import { describe, expect, it } from 'vitest'
import {
  ACTION_PACKS,
  findActionPack,
  findActionPreset,
  isPresetAvailable,
  presetToButton,
  resolvePresetActions,
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
        const allActions = [
          ...preset.actions,
          ...Object.values(preset.platformActions ?? {}).flatMap((actions) => actions ?? []),
        ]
        for (const action of allActions) {
          const parsed = ActionSchema.safeParse(action)
          expect(parsed.success, `${pack.id}/${preset.id}: ${JSON.stringify(action)}`).toBe(true)
          if (action.type === 'hotkey') {
            expect(() => normalizeCombo(action.keys)).not.toThrow()
          }
        }
        for (const description of Object.values(preset.platformDescriptions ?? {})) {
          expect(description.length).toBeGreaterThan(0)
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

    const macButton = presetToButton(preset, 4, 'darwin')
    expect(macButton.actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'T'] }])
  })

  it('filters Windows-only and macOS-only presets per host', () => {
    for (const id of ['system-task-view', 'system-clipboard-history', 'system-settings']) {
      const preset = findActionPreset(id)!
      expect(isPresetAvailable(preset, 'win32'), id).toBe(true)
      expect(isPresetAvailable(preset, 'darwin'), id).toBe(false)
      expect(isPresetAvailable(preset, 'linux'), id).toBe(false)
      // Unknown strings normalize to linux.
      expect(isPresetAvailable(preset, 'freebsd'), id).toBe(false)
    }

    const mission = findActionPreset('system-mission-control')!
    expect(isPresetAvailable(mission, 'darwin')).toBe(true)
    expect(isPresetAvailable(mission, 'win32')).toBe(false)

    expect(isPresetAvailable(findActionPreset('system-file-manager')!, 'win32')).toBe(true)
    expect(isPresetAvailable(findActionPreset('system-file-manager')!, 'darwin')).toBe(true)
    expect(isPresetAvailable(findActionPreset('system-file-manager')!, 'linux')).toBe(false)

    for (const id of ['chrome-new-tab', 'vscode-command-palette', 'media-play-pause']) {
      for (const platform of ['win32', 'darwin', 'linux']) {
        expect(isPresetAvailable(findActionPreset(id)!, platform), `${id}/${platform}`).toBe(true)
      }
    }
  })

  it('resolves Cmd variants on macOS and Ctrl variants on Windows/Linux', () => {
    const preset = findActionPreset('chrome-new-tab')!
    expect(resolvePresetActions(preset, 'darwin')).toEqual([{ type: 'hotkey', keys: ['WIN', 'T'] }])
    expect(resolvePresetActions(preset, 'win32')).toEqual([{ type: 'hotkey', keys: ['CTRL', 'T'] }])
    expect(resolvePresetActions(preset, 'linux')).toEqual([{ type: 'hotkey', keys: ['CTRL', 'T'] }])
    expect(resolvePresetActions(preset, 'unknown-os')).toEqual([{ type: 'hotkey', keys: ['CTRL', 'T'] }])
    expect(resolvePresetActions(preset, 'darwin')).not.toBe(preset.platformActions?.darwin)

    const palette = findActionPreset('vscode-command-palette')!
    expect(resolvePresetActions(palette, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['WIN', 'SHIFT', 'P'] },
    ])

    const format = findActionPreset('vscode-format')!
    expect(resolvePresetActions(format, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['SHIFT', 'ALT', 'F'] },
    ])
  })

  it('resolves system and OBS overrides', () => {
    expect(resolvePresetActions(findActionPreset('system-lock')!, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'WIN', 'Q'] },
    ])
    expect(resolvePresetActions(findActionPreset('system-lock')!, 'win32')[0]).toMatchObject({
      type: 'command',
    })

    expect(resolvePresetActions(findActionPreset('system-show-desktop')!, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['F11'] },
    ])
    expect(resolvePresetActions(findActionPreset('system-show-desktop')!, 'win32')).toEqual([
      { type: 'hotkey', keys: ['WIN', 'D'] },
    ])

    expect(resolvePresetActions(findActionPreset('system-file-manager')!, 'darwin')).toEqual([
      { type: 'launch', path: '/System/Applications/Finder.app' },
    ])
    expect(resolvePresetActions(findActionPreset('system-file-manager')!, 'win32')).toEqual([
      { type: 'launch', path: 'explorer.exe' },
    ])

    expect(resolvePresetActions(findActionPreset('obs-launch')!, 'darwin')).toEqual([
      { type: 'launch', path: '/Applications/OBS.app' },
    ])
    expect(resolvePresetActions(findActionPreset('obs-launch')!, 'win32')).toEqual([
      { type: 'launch', path: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' },
    ])
  })

  it('provides mac-friendly summaries and drops the old porting notes', () => {
    const screenshot = findActionPreset('system-screenshot')!
    expect(screenshot.description).toMatch(/full-screen/i)
    expect(screenshot.platformDescriptions?.darwin).toMatch(/^Cmd \+ Shift \+ S/)
    expect(screenshot.platformDescriptions?.darwin).toMatch(/full-screen/i)
    expect(resolvePresetActions(screenshot, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] },
    ])

    for (const pack of ACTION_PACKS) {
      expect(pack.description.toLowerCase()).not.toContain('change ctrl')
      for (const preset of pack.presets) {
        expect(preset.description.toLowerCase()).not.toContain('change ctrl')
      }
    }
  })
})
