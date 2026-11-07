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
      expect.arrayContaining(['chrome', 'obs', 'vscode', 'jetbrains', 'opencode', 'system', 'media']),
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

  it('resolves JetBrains Windows and macOS keymaps', () => {
    const run = findActionPreset('jetbrains-run')!
    expect(resolvePresetActions(run, 'win32')).toEqual([{ type: 'hotkey', keys: ['SHIFT', 'F10'] }])
    expect(resolvePresetActions(run, 'darwin')).toEqual([{ type: 'hotkey', keys: ['CTRL', 'R'] }])

    const build = findActionPreset('jetbrains-build')!
    expect(resolvePresetActions(build, 'win32')).toEqual([{ type: 'hotkey', keys: ['CTRL', 'F9'] }])
    expect(resolvePresetActions(build, 'darwin')).toEqual([{ type: 'hotkey', keys: ['WIN', 'F9'] }])

    const findAction = findActionPreset('jetbrains-find-action')!
    expect(resolvePresetActions(findAction, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['WIN', 'SHIFT', 'A'] },
    ])

    expect(findActionPack('jetbrains')?.presets.length).toBeGreaterThanOrEqual(15)
  })

  it('builds OpenCode leader-sequence macros and keeps them available everywhere', () => {
    const session = findActionPreset('opencode-new-session')!
    const actions = resolvePresetActions(session, 'linux')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'macro' })
    if (actions[0]?.type !== 'macro') throw new Error('expected a macro')
    expect(actions[0].steps).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'X'] },
      { type: 'delay', ms: 80 },
      { type: 'hotkey', keys: ['N'] },
    ])

    expect(resolvePresetActions(findActionPreset('opencode-command-palette')!, 'darwin')).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'P'] },
    ])
    for (const id of ['opencode-new-session', 'opencode-models', 'opencode-agents']) {
      for (const platform of ['win32', 'darwin', 'linux']) {
        expect(isPresetAvailable(findActionPreset(id)!, platform), `${id}/${platform}`).toBe(true)
      }
    }
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

  it('uses the exact JetBrains macOS overrides for every preset', () => {
    const cases: Array<[string, string[], string[]]> = [
      ['jetbrains-build', ['CTRL', 'F9'], ['WIN', 'F9']],
      ['jetbrains-run', ['SHIFT', 'F10'], ['CTRL', 'R']],
      ['jetbrains-debug', ['SHIFT', 'F9'], ['CTRL', 'D']],
      ['jetbrains-stop', ['CTRL', 'F2'], ['WIN', 'F2']],
      ['jetbrains-find-action', ['CTRL', 'SHIFT', 'A'], ['WIN', 'SHIFT', 'A']],
      ['jetbrains-open-class', ['CTRL', 'N'], ['WIN', 'O']],
      ['jetbrains-open-file', ['CTRL', 'SHIFT', 'N'], ['WIN', 'SHIFT', 'O']],
      ['jetbrains-find-in-path', ['CTRL', 'SHIFT', 'F'], ['WIN', 'SHIFT', 'F']],
      ['jetbrains-replace-in-path', ['CTRL', 'SHIFT', 'R'], ['WIN', 'SHIFT', 'R']],
      ['jetbrains-reformat', ['CTRL', 'ALT', 'L'], ['WIN', 'ALT', 'L']],
      ['jetbrains-optimize-imports', ['CTRL', 'ALT', 'O'], ['CTRL', 'ALT', 'O']],
      ['jetbrains-terminal', ['ALT', 'F12'], ['ALT', 'F12']],
      ['jetbrains-project-view', ['ALT', '1'], ['WIN', '1']],
      ['jetbrains-git', ['ALT', '9'], ['WIN', '9']],
      ['jetbrains-logcat', ['ALT', '6'], ['WIN', '6']],
    ]

    for (const [id, windowsKeys, macKeys] of cases) {
      const preset = findActionPreset(id)
      expect(preset, id).toBeTruthy()
      expect(resolvePresetActions(preset!, 'win32'), id).toEqual([{ type: 'hotkey', keys: windowsKeys }])
      expect(resolvePresetActions(preset!, 'linux'), id).toEqual([{ type: 'hotkey', keys: windowsKeys }])
      expect(resolvePresetActions(preset!, 'darwin'), id).toEqual([{ type: 'hotkey', keys: macKeys }])
      for (const platform of ['win32', 'darwin', 'linux']) {
        expect(isPresetAvailable(preset!, platform), `${id}/${platform}`).toBe(true)
      }
    }

    const description = (id: string) => findActionPreset(id)!.platformDescriptions?.darwin
    expect(description('jetbrains-build')).toBe('Cmd + F9')
    expect(description('jetbrains-run')).toBe('Ctrl + R')
    expect(description('jetbrains-reformat')).toBe('Cmd + Option + L')
    expect(description('jetbrains-optimize-imports')).toBe('Ctrl + Option + O')
    expect(description('jetbrains-terminal')).toBe('Option + F12')
    expect(description('jetbrains-logcat')).toBe('Android Studio only — Cmd + 6')
  })

  it('builds every OpenCode leader macro with the requested key', () => {
    const leaders: Array<[string, string]> = [
      ['opencode-new-session', 'N'],
      ['opencode-sessions', 'L'],
      ['opencode-models', 'M'],
      ['opencode-agents', 'A'],
      ['opencode-undo', 'U'],
      ['opencode-redo', 'R'],
      ['opencode-compact-session', 'C'],
      ['opencode-toggle-sidebar', 'B'],
      ['opencode-editor', 'E'],
      ['opencode-themes', 'T'],
      ['opencode-export', 'X'],
      ['opencode-status', 'S'],
      ['opencode-exit', 'Q'],
    ]
    for (const [id, key] of leaders) {
      const actions = resolvePresetActions(findActionPreset(id)!, 'darwin')
      expect(actions).toEqual([
        {
          type: 'macro',
          steps: [
            { type: 'hotkey', keys: ['CTRL', 'X'] },
            { type: 'delay', ms: 80 },
            { type: 'hotkey', keys: [key] },
          ],
        },
      ])
    }
    expect(resolvePresetActions(findActionPreset('opencode-command-palette')!, 'win32')).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'P'] },
    ])
  })

  it('keeps the requested pack order', () => {
    expect(ACTION_PACKS.map((pack) => pack.id)).toEqual([
      'chrome',
      'obs',
      'vscode',
      'jetbrains',
      'opencode',
      'system',
      'media',
    ])
  })
})
