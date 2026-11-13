import { describe, expect, it } from 'vitest'
import { actionsToPlan, hasHostActions } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import type { Action, ConfigAction, DeckButton, DeckConfig, KeyboardAction } from '../src/types'

const openKeyboard: KeyboardAction = { type: 'keyboard', action: 'open' }

function configWith(actions: ConfigAction[]): { config: DeckConfig; button: DeckButton } {
  const config = createDefaultConfig()
  const page = config.profiles[0]!.pages[0]!
  const button: DeckButton = {
    id: 'btn-keyboard',
    slot: 0,
    label: 'Keyboard',
    // The persisted model stores the plannable families through the legacy
    // Action[] slot; the schema is the runtime authority for the new variant.
    actions: actions as unknown as Action[],
  }
  page.buttons = [button]
  return { config, button }
}

describe('keyboard launcher action', () => {
  it('validates the phone-local open action', () => {
    const { config } = configWith([openKeyboard])
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects unknown keyboard actions', () => {
    for (const action of ['toggle', 'close', '']) {
      const { config } = configWith([
        { type: 'keyboard', action } as unknown as ConfigAction,
      ])
      expect(validateConfig(config).ok, action).toBe(false)
    }
  })

  it('keeps old configs valid and does not require any new field', () => {
    const config = createDefaultConfig()
    expect(validateConfig(config).ok).toBe(true)
    expect(config.schemaVersion).toBe(1)

    const { config: mixed, button } = configWith([
      { type: 'hotkey', keys: ['CTRL', 'K'] },
      openKeyboard,
      { type: 'text', text: 'after' },
    ])
    expect(validateConfig(mixed).ok).toBe(true)
    expect(button.actions).toHaveLength(3)
  })

  it('omits the launcher from the desktop plan while keeping order', () => {
    const plan = actionsToPlan([
      { type: 'text', text: 'before' },
      openKeyboard,
      { type: 'hotkey', keys: ['ENTER'] },
    ])
    expect(plan.map((step) => step.kind)).toEqual(['text', 'keys'])
    expect(plan[0]).toMatchObject({ kind: 'text', text: 'before' })
    expect(plan[1]).toMatchObject({ kind: 'keys', keys: ['ENTER'] })
  })

  it('treats a keyboard-only button as having no host action', () => {
    expect(actionsToPlan([openKeyboard])).toEqual([])
    expect(hasHostActions([openKeyboard])).toBe(false)
    expect(hasHostActions([openKeyboard, { type: 'page', direction: 'next' }])).toBe(false)
  })
})
