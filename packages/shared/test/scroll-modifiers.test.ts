import { describe, expect, it } from 'vitest'
import { controlToActions } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import type { ControlSpec, DeckConfig, ScrollBinding } from '../src/types'

function configWithScroll(binding: ScrollBinding): DeckConfig {
  const config = createDefaultConfig()
  const page = config.profiles[0]!.pages[0]!
  page.buttons = [
    {
      id: 'btn-scroll',
      slot: 0,
      label: 'Scroll',
      actions: [],
      control: { kind: 'dial', emit: 'delta', binding },
    },
  ]
  return config
}

function scrollControl(binding: ScrollBinding): ControlSpec {
  return { kind: 'dial', emit: 'delta', binding }
}

describe('scroll binding modifiers', () => {
  it('accepts modifiers and normalizes aliases to canonical keys', () => {
    const result = validateConfig(
      configWithScroll({
        type: 'scroll',
        axis: 'vertical',
        modifiers: ['Control', 'cmd', 'Shift'],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const binding = result.config.profiles[0]!.pages[0]!.buttons[0]!.control
    expect(binding).toMatchObject({
      binding: { type: 'scroll', axis: 'vertical', modifiers: ['CTRL', 'SHIFT', 'WIN'] },
    })
  })

  it('accepts all four modifiers and still validates configs without them', () => {
    expect(
      validateConfig(
        configWithScroll({
          type: 'scroll',
          axis: 'horizontal',
          modifiers: ['CTRL', 'SHIFT', 'ALT', 'WIN'],
        }),
      ).ok,
    ).toBe(true)
    expect(
      validateConfig(configWithScroll({ type: 'scroll', axis: 'vertical' })).ok,
    ).toBe(true)
  })

  it('rejects unknown, non-modifier, duplicate and excessive modifier lists', () => {
    for (const modifiers of [
      ['HYPER'],
      ['TAB'],
      ['CTRL', 'Control'],
      ['CTRL', 'SHIFT', 'ALT', 'WIN', 'CTRL'],
    ]) {
      const result = validateConfig(
        configWithScroll({
          type: 'scroll',
          axis: 'vertical',
          modifiers: modifiers as never,
        }),
      )
      expect(result.ok, modifiers.join(',')).toBe(false)
    }
  })
})

describe('controlToActions modifier scroll', () => {
  it('keeps the old single-step macro when no modifier is set', () => {
    expect(controlToActions(scrollControl({ type: 'scroll', axis: 'vertical' }), 2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 2 }],
      },
    ])
  })

  it('presses modifiers, scrolls, then releases in reverse order', () => {
    expect(
      controlToActions(
        scrollControl({
          type: 'scroll',
          axis: 'vertical',
          modifiers: ['CTRL', 'SHIFT'],
        }),
        3,
      ),
    ).toEqual([
      {
        type: 'macro',
        steps: [
          { type: 'hotkey', keys: ['CTRL'], action: 'down' },
          { type: 'hotkey', keys: ['SHIFT'], action: 'down' },
          { type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 3 },
          { type: 'hotkey', keys: ['SHIFT'], action: 'up' },
          { type: 'hotkey', keys: ['CTRL'], action: 'up' },
        ],
      },
    ])
  })

  it('keeps direction, invert, axis and amount with modifiers', () => {
    const horizontal = controlToActions(
      scrollControl({
        type: 'scroll',
        axis: 'horizontal',
        invert: true,
        modifiers: ['SHIFT'],
      }),
      2.2,
    )
    expect(horizontal).toMatchObject([
      {
        steps: [
          { type: 'hotkey', keys: ['SHIFT'], action: 'down' },
          { type: 'mouse', action: 'scroll', direction: 'left', amount: 3 },
          { type: 'hotkey', keys: ['SHIFT'], action: 'up' },
        ],
      },
    ])

    const capped = controlToActions(
      scrollControl({ type: 'scroll', axis: 'vertical', modifiers: ['CTRL'] }),
      250,
    )
    expect(capped).toMatchObject([
      { steps: [{}, { direction: 'up', amount: 100 }, {}] },
    ])
  })

  it('deduplicates hand-edited duplicate modifiers before pressing', () => {
    expect(
      controlToActions(
        scrollControl({
          type: 'scroll',
          axis: 'vertical',
          modifiers: ['CTRL', 'CTRL', 'Control'],
        } as ScrollBinding),
        1,
      ),
    ).toEqual([
      {
        type: 'macro',
        steps: [
          { type: 'hotkey', keys: ['CTRL'], action: 'down' },
          { type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 1 },
          { type: 'hotkey', keys: ['CTRL'], action: 'up' },
        ],
      },
    ])
  })
})
