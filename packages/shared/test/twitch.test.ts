import { describe, expect, it } from 'vitest'
import { actionsToPlan, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import { CONFIG_SCHEMA_VERSION, TWITCH_CAPABILITY } from '../src/types'
import type { ExecutableAction, TwitchAction, TwitchStateBinding } from '../src/types'

function buttonConfig(actions: ExecutableAction[]) {
  const config = createDefaultConfig()
  const button = config.profiles[0]!.pages[0]!.buttons[0]!
  button.actions = actions as typeof button.actions
  return config
}

describe('Twitch contract', () => {
  it('exports twitch-v1 and keeps the config schema at v1', () => {
    expect(TWITCH_CAPABILITY).toBe('twitch-v1')
    expect(CONFIG_SCHEMA_VERSION).toBe(1)
  })

  it('accepts all four actions and the five state targets', () => {
    const actions: TwitchAction[] = [
      { type: 'twitch', action: 'sendChat', message: 'hello chat' },
      { type: 'twitch', action: 'createMarker', description: 'big play' },
      { type: 'twitch', action: 'createMarker' },
      { type: 'twitch', action: 'setTitle', title: 'Ranked climb' },
      { type: 'twitch', action: 'setGame', game: 'Science & Technology' },
    ]
    expect(validateConfig(buttonConfig(actions)).ok).toBe(true)

    const config = createDefaultConfig()
    const targets: TwitchStateBinding['target'][] = ['live', 'viewers', 'uptime', 'title', 'game']
    config.profiles[0]!.pages[0]!.buttons.forEach((button, index) => {
      button.state = { type: 'twitch', target: targets[index % targets.length]! }
    })
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects empty and overlong text and unknown targets', () => {
    const cases: Array<{ actions: unknown[]; pattern: RegExp }> = [
      { actions: [{ type: 'twitch', action: 'sendChat', message: '   ' }], pattern: /cannot be empty/ },
      {
        actions: [{ type: 'twitch', action: 'sendChat', message: 'x'.repeat(501) }],
        pattern: /500 characters/,
      },
      {
        actions: [{ type: 'twitch', action: 'setTitle', title: 'x'.repeat(141) }],
        pattern: /140 characters/,
      },
      {
        actions: [{ type: 'twitch', action: 'createMarker', description: 'x'.repeat(141) }],
        pattern: /140 characters/,
      },
      {
        actions: [{ type: 'twitch', action: 'setGame', game: 'x'.repeat(101) }],
        pattern: /100 characters/,
      },
      {
        actions: [{ type: 'twitch', action: 'setGame', game: '' }],
        pattern: /cannot be empty/,
      },
      {
        actions: [{ type: 'twitch', action: 'follow' }],
        pattern: /Invalid|No matching|literal/i,
      },
    ]
    for (const testCase of cases) {
      const config = createDefaultConfig()
      const button = config.profiles[0]!.pages[0]!.buttons[0]!
      button.actions = testCase.actions as typeof button.actions
      const result = validateConfig(config)
      expect(result.ok, testCase.actions.map(String).join()).toBe(false)
      if (!result.ok) expect(result.errors.join(' ')).toMatch(testCase.pattern)
    }

    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.state = { type: 'twitch', target: 'followers' } as unknown as TwitchStateBinding
    expect(validateConfig(config).ok).toBe(false)
  })

  it('maps actions to ordered plan steps', () => {
    const actions: ExecutableAction[] = [
      { type: 'twitch', action: 'sendChat', message: 'gg' },
      { type: 'twitch', action: 'createMarker', description: 'clutch' },
      { type: 'twitch', action: 'createMarker' },
      { type: 'twitch', action: 'setTitle', title: 'New title' },
      { type: 'twitch', action: 'setGame', game: 'Fortnite' },
    ]
    expect(actionsToPlan(actions)).toEqual([
      { kind: 'twitch', action: 'sendChat', message: 'gg' },
      { kind: 'twitch', action: 'createMarker', description: 'clutch' },
      { kind: 'twitch', action: 'createMarker' },
      { kind: 'twitch', action: 'setTitle', title: 'New title' },
      { kind: 'twitch', action: 'setGame', game: 'Fortnite' },
    ])
  })

  it('describes actions for the editor and logs', () => {
    expect(describeAction({ type: 'twitch', action: 'sendChat', message: 'hello chat' })).toBe(
      'Send Twitch chat "hello chat"',
    )
    expect(describeAction({ type: 'twitch', action: 'createMarker' })).toBe(
      'Add Twitch stream marker',
    )
    expect(
      describeAction({ type: 'twitch', action: 'createMarker', description: 'clutch' }),
    ).toBe('Add Twitch marker "clutch"')
    expect(describeAction({ type: 'twitch', action: 'setTitle', title: 'Ranked climb' })).toBe(
      'Set Twitch title "Ranked climb"',
    )
    expect(describeAction({ type: 'twitch', action: 'setGame', game: 'Fortnite' })).toBe(
      'Set Twitch category "Fortnite"',
    )
  })
})
