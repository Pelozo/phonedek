import { describe, expect, it } from 'vitest'
import {
  formatCombo,
  isModifier,
  isScreenshotShortcut,
  isValidKeyName,
  keyFromEvent,
  normalizeCombo,
  normalizeKey,
} from '../src/keys'

describe('key names', () => {
  it('normalizes aliases', () => {
    expect(normalizeKey('control')).toBe('CTRL')
    expect(normalizeKey('Escape')).toBe('ESC')
    expect(normalizeKey('return')).toBe('ENTER')
    expect(normalizeKey('Cmd')).toBe('WIN')
    expect(normalizeKey('f12')).toBe('F12')
    expect(normalizeKey('a')).toBe('A')
  })

  it('rejects unknown names', () => {
    expect(isValidKeyName('banana')).toBe(false)
    expect(isValidKeyName('CTRL')).toBe(true)
  })

  it('orders modifiers first and removes duplicates', () => {
    expect(normalizeCombo(['c', 'shift', 'ctrl', 'SHIFT'])).toEqual(['CTRL', 'SHIFT', 'C'])
    expect(normalizeCombo(['alt', 'tab'])).toEqual(['ALT', 'TAB'])
  })

  it('recognizes modifiers', () => {
    expect(isModifier('CTRL')).toBe(true)
    expect(isModifier('C')).toBe(false)
  })

  it('detects the Win+Shift+S screenshot intent', () => {
    expect(isScreenshotShortcut(['WIN', 'SHIFT', 'S'])).toBe(true)
    expect(isScreenshotShortcut(['S', 'shift', 'win'])).toBe(true)
    expect(isScreenshotShortcut(['CMD', 'SHIFT', 'S'])).toBe(true)
    expect(isScreenshotShortcut(['WIN', 'SHIFT', 'S', 'A'])).toBe(false)
    expect(isScreenshotShortcut(['CTRL', 'SHIFT', 'S'])).toBe(false)
    expect(isScreenshotShortcut(['WIN', 'S'])).toBe(false)
    expect(isScreenshotShortcut(['banana'])).toBe(false)
  })

  it('formats keycaps', () => {
    expect(formatCombo(['CTRL', 'SHIFT', 'ESC'])).toBe('Ctrl + Shift + Esc')
  })

  it('maps DOM events, preferring physical codes for shifted symbols', () => {
    expect(keyFromEvent({ key: 'Control', code: 'ControlLeft' })).toBe('CTRL')
    expect(keyFromEvent({ key: 'a', code: 'KeyA' })).toBe('A')
    expect(keyFromEvent({ key: '!', code: 'Digit1' })).toBe('1')
    expect(keyFromEvent({ key: ' ', code: 'Space' })).toBe('SPACE')
    expect(keyFromEvent({ key: 'Escape', code: 'Escape' })).toBe('ESC')
    expect(keyFromEvent({ key: 'Unidentified', code: 'KeyQ' })).toBe('Q')
  })
})
