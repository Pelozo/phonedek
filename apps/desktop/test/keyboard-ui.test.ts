import { describe, expect, it } from 'vitest'
import type { Action, ConfigAction } from '@phonedek/shared'
import {
  DEFAULT_KEYBOARD_SPAN,
  KEYBOARD_ACTION_BODY,
  KEYBOARD_ACTION_SUMMARY,
  KEYBOARD_ACTION_TITLE,
  KEYBOARD_BADGE,
  KEYBOARD_LAUNCHER_ICON,
  KEYBOARD_LAUNCHER_LABEL,
  KEYBOARD_LAUNCHER_SUBLABEL,
  createKeyboardLauncher,
  hasKeyboardAction,
  hasKeyboardLauncher,
  isKeyboardAction,
  keyboardAction,
  keyboardSpanCandidates,
} from '../src/renderer/src/lib/keyboard'

describe('keyboard launcher', () => {
  it('creates a normal 2x1 button carrying only the phone-local action', () => {
    const button = createKeyboardLauncher(4)

    expect(button.slot).toBe(4)
    expect(button.label).toBe(KEYBOARD_LAUNCHER_LABEL)
    expect(button.sublabel).toBe(KEYBOARD_LAUNCHER_SUBLABEL)
    expect(button.icon).toBe(KEYBOARD_LAUNCHER_ICON)
    expect(button.span).toEqual(DEFAULT_KEYBOARD_SPAN)
    expect(button.control).toBeUndefined()
    expect(button.actions).toHaveLength(1)
    expect(button.actions[0]).toEqual({ type: 'keyboard', action: 'open' })
  })

  it('accepts an explicit span for a 3x2 or 1x1 fallback', () => {
    expect(createKeyboardLauncher(0, { columns: 3, rows: 2 }).span).toEqual({
      columns: 3,
      rows: 2,
    })
    expect(createKeyboardLauncher(0, { columns: 1, rows: 1 }).span).toEqual({
      columns: 1,
      rows: 1,
    })
  })

  it('prefers 2x1, offers 3x2, then falls back to 1x1', () => {
    expect(keyboardSpanCandidates()).toEqual([
      { columns: 2, rows: 1 },
      { columns: 3, rows: 2 },
      { columns: 1, rows: 1 },
    ])
  })

  it('describes the phone-only action without host execution', () => {
    expect(KEYBOARD_ACTION_TITLE).toBe('Open phone keyboard')
    expect(KEYBOARD_ACTION_SUMMARY).toBe('Full-screen phone keyboard')
    expect(KEYBOARD_ACTION_BODY).toContain('Typing goes to the active window on this PC')
    expect(KEYBOARD_ACTION_BODY).toContain('Nothing runs on this PC when this action is pressed directly')
    expect(KEYBOARD_BADGE).toBe('KEYBOARD')
    expect(keyboardAction()).toEqual({ type: 'keyboard', action: 'open' })
  })

  it('detects keyboard actions in mixed action lists', () => {
    const hotkey: Action = { type: 'hotkey', keys: ['CTRL', 'C'] }
    const keyboard: ConfigAction = { type: 'keyboard', action: 'open' }

    expect(isKeyboardAction(keyboard)).toBe(true)
    expect(isKeyboardAction(hotkey)).toBe(false)
    expect(hasKeyboardAction([hotkey, keyboard])).toBe(true)
    expect(hasKeyboardAction([hotkey])).toBe(false)
  })

  it('only treats a control-free button with a single keyboard action as a launcher', () => {
    const button = createKeyboardLauncher(0)
    expect(hasKeyboardLauncher(button)).toBe(true)
    expect(
      hasKeyboardLauncher({
        actions: [...button.actions, { type: 'hotkey', keys: ['CTRL', 'C'] }],
      }),
    ).toBe(false)
    expect(
      hasKeyboardLauncher({
        actions: button.actions,
        control: {
          kind: 'trackpad',
          emit: 'delta',
          binding: { type: 'pointer' },
        },
      }),
    ).toBe(false)
  })
})
