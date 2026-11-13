import { describe, expect, it } from 'vitest'
import type { ShortcutBinding } from '@phonedek/shared'
import {
  destructiveShortcutWarning,
  formatKeysCompact,
  shortcutBadge,
  shortcutDirectionLabel,
  shortcutPreset,
  shortcutPresetControl,
  SHORTCUT_PRESETS,
} from '../src/renderer/src/lib/shortcut'

const tabs: ShortcutBinding = {
  type: 'shortcut',
  keys: ['CTRL', 'TAB'],
  reverseKeys: ['CTRL', 'SHIFT', 'TAB'],
}

describe('shortcut compact notation', () => {
  it('uses macOS symbols without separators', () => {
    expect(formatKeysCompact(['CTRL', 'TAB'], 'darwin')).toBe('⌃⇥')
    expect(formatKeysCompact(['WIN', 'TAB'], 'darwin')).toBe('⌘⇥')
    expect(formatKeysCompact(['CTRL', 'SHIFT', 'TAB'], 'darwin')).toBe('⌃⇧⇥')
    expect(formatKeysCompact(['RIGHT'], 'darwin')).toBe('→')
  })

  it('uses short labels with plus signs elsewhere', () => {
    expect(formatKeysCompact(['CTRL', 'TAB'], 'win32')).toBe('Ctrl+Tab')
    expect(formatKeysCompact(['ALT', 'TAB'], 'linux')).toBe('Alt+Tab')
    expect(formatKeysCompact(['CTRL', 'SHIFT', 'TAB'], 'win32')).toBe('Ctrl+Shift+Tab')
    expect(formatKeysCompact(['RIGHT'], 'win32')).toBe('→')
  })

  it('summarizes the reverse chord only when it differs', () => {
    expect(shortcutDirectionLabel(tabs, 'darwin')).toBe('↔ ⌃⇧⇥')
    expect(shortcutDirectionLabel({ type: 'shortcut', keys: ['RIGHT'] }, 'darwin')).toBe(
      'same chord both ways',
    )
  })

  it('puts the held modifier in the badge', () => {
    expect(shortcutBadge(tabs, 'win32')).toBe('↔')
    expect(
      shortcutBadge(
        { type: 'shortcut', keys: ['TAB'], holdKeys: ['ALT'], reverseKeys: ['SHIFT', 'TAB'] },
        'win32',
      ),
    ).toBe('HOLD Alt')
    expect(shortcutBadge({ type: 'shortcut', keys: ['RIGHT'] }, 'win32')).toBe('CHORD')
  })
})

describe('destructive shortcut warning', () => {
  it('recognizes common system chords', () => {
    expect(destructiveShortcutWarning(['CTRL', 'ALT', 'DELETE'], [], 'win32')).toBe(
      'Ctrl+Alt+Delete',
    )
    expect(destructiveShortcutWarning(['ALT', 'F4'], [], 'win32')).toBe('Alt+F4')
    expect(destructiveShortcutWarning(['CTRL', 'SHIFT', 'ESC'], [], 'darwin')).toBe(
      'Ctrl+Shift+Esc',
    )
  })

  it('includes held modifiers in the chord', () => {
    expect(destructiveShortcutWarning(['F4'], ['ALT'], 'win32')).toBe('Alt+F4')
  })

  it('keeps platform-specific system chords on their platform', () => {
    expect(destructiveShortcutWarning(['WIN', 'Q'], [], 'darwin')).toBe('Cmd+Q')
    expect(destructiveShortcutWarning(['WIN', 'Q'], [], 'win32')).toBeNull()
    expect(destructiveShortcutWarning(['WIN', 'L'], [], 'win32')).toBe('Win+L')
    expect(destructiveShortcutWarning(['WIN', 'L'], [], 'darwin')).toBeNull()
  })

  it('does not warn for ordinary chords', () => {
    expect(destructiveShortcutWarning(['CTRL', 'C'], [], 'darwin')).toBeNull()
  })
})

describe('shortcut presets', () => {
  it('ships the navigation and editing set', () => {
    expect(SHORTCUT_PRESETS.map((preset) => preset.id)).toEqual([
      'tabs',
      'app-switcher',
      'zoom',
      'seek',
      'zoom-slider',
      'brush-size',
    ])
  })

  it('maps browser tabs and brush size chords', () => {
    expect(shortcutPreset('tabs').binding('win32')).toEqual({
      type: 'shortcut',
      keys: ['CTRL', 'TAB'],
      reverseKeys: ['CTRL', 'SHIFT', 'TAB'],
    })
    expect(shortcutPreset('brush-size').binding('darwin')).toEqual({
      type: 'shortcut',
      keys: ['['],
      reverseKeys: [']'],
    })
  })

  it('uses Alt on Windows/Linux and Cmd on macOS for the app switcher', () => {
    expect(shortcutPreset('app-switcher').binding('win32').holdKeys).toEqual(['ALT'])
    expect(shortcutPreset('app-switcher').binding('linux').holdKeys).toEqual(['ALT'])
    expect(shortcutPreset('app-switcher').binding('darwin').holdKeys).toEqual(['WIN'])
    expect(shortcutPreset('app-switcher').label('darwin')).toBe('Cmd+Tab')
    expect(shortcutPreset('app-switcher').label('win32')).toBe('Alt+Tab')
  })

  it('builds silent delta controls with the right spans', () => {
    const tabsControl = shortcutPresetControl(shortcutPreset('tabs'), 'win32')
    expect(tabsControl.kind).toBe('dial')
    expect(tabsControl.emit).toBe('delta')
    expect(tabsControl.binding.type).toBe('shortcut')
    expect(shortcutPreset('tabs').span).toEqual({ columns: 2, rows: 1 })

    const zoomSlider = shortcutPreset('zoom-slider')
    const zoomControl = shortcutPresetControl(zoomSlider, 'darwin')
    expect(zoomControl.kind).toBe('slider')
    expect(zoomControl.emit).toBe('delta')
    expect(zoomSlider.span).toEqual({ columns: 3, rows: 1 })
    expect(zoomControl.binding).toMatchObject({
      type: 'shortcut',
      travelSteps: 20,
      keys: ['CTRL', '+'],
      reverseKeys: ['CTRL', '-'],
    })
  })
})
