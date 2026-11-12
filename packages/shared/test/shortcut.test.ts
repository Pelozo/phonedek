import { describe, expect, it } from 'vitest'
import { controlToActions, MAX_SHORTCUT_CHORDS_PER_FLUSH, shortcutDeltaPerStep } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { ControlSpecSchema, validateConfig } from '../src/schema'
import type { ControlSpec } from '../src/types'

function shortcut(
  overrides: Partial<Extract<ControlSpec, { kind: 'slider' | 'dial' }>> = {},
): ControlSpec {
  return {
    kind: 'dial',
    emit: 'delta',
    binding: { type: 'shortcut', keys: ['CTRL', 'TAB'] },
    ...overrides,
  } as ControlSpec
}

function hotkey(keys: string[]) {
  return { type: 'hotkey', keys }
}

describe('shortcut binding schema', () => {
  it('accepts shortcut sliders and dials with all optional fields', () => {
    const dial = shortcut({
      kind: 'dial',
      binding: {
        type: 'shortcut',
        keys: ['TAB'],
        reverseKeys: ['SHIFT', 'TAB'],
        holdKeys: ['ALT'],
        repeat: 2,
        travelSteps: 40,
      },
    })
    expect(ControlSpecSchema.safeParse(dial).success).toBe(true)

    const slider = shortcut({
      kind: 'slider',
      axis: 'horizontal',
      binding: { type: 'shortcut', keys: ['['], reverseKeys: [']'] },
    })
    expect(ControlSpecSchema.safeParse(slider).success).toBe(true)
  })

  it('keeps legacy controls and default configs valid', () => {
    expect(validateConfig(createDefaultConfig()).ok).toBe(true)
    expect(
      ControlSpecSchema.safeParse({
        kind: 'slider',
        emit: 'delta',
        binding: { type: 'volume', mode: 'relative' },
      }).success,
    ).toBe(true)
  })

  it('rejects empty keys, invalid key names and value emits', () => {
    expect(
      ControlSpecSchema.safeParse(
        shortcut({ binding: { type: 'shortcut', keys: [] } }),
      ).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse(
        shortcut({ binding: { type: 'shortcut', keys: ['NOPE'] } }),
      ).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse(
        shortcut({ binding: { type: 'shortcut', keys: ['TAB'], reverseKeys: [] } }),
      ).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse(
        shortcut({ emit: 'value' }),
      ).success,
    ).toBe(false)
  })

  it('rejects repeat outside 1..5 and travelSteps outside 4..100', () => {
    for (const repeat of [0, 6, 1.5]) {
      expect(
        ControlSpecSchema.safeParse(
          shortcut({ binding: { type: 'shortcut', keys: ['TAB'], repeat } }),
        ).success,
      ).toBe(false)
    }
    for (const travelSteps of [3, 101, 4.5]) {
      expect(
        ControlSpecSchema.safeParse(
          shortcut({ binding: { type: 'shortcut', keys: ['TAB'], travelSteps } }),
        ).success,
      ).toBe(false)
    }
    expect(
      ControlSpecSchema.safeParse(
        shortcut({ binding: { type: 'shortcut', keys: ['TAB'], repeat: 5, travelSteps: 4 } }),
      ).success,
    ).toBe(true)
  })
})

describe('controlToActions shortcut mapping', () => {
  it('maps positive movement to the forward chord and negative to reverseKeys', () => {
    const control = shortcut({
      binding: {
        type: 'shortcut',
        keys: ['CTRL', 'TAB'],
        reverseKeys: ['CTRL', 'SHIFT', 'TAB'],
      },
    })
    expect(controlToActions(control, 1)).toEqual([hotkey(['CTRL', 'TAB'])])
    expect(controlToActions(control, -2)).toEqual([
      hotkey(['CTRL', 'SHIFT', 'TAB']),
      hotkey(['CTRL', 'SHIFT', 'TAB']),
    ])
  })

  it('falls back to keys for reverse movement and normalizes aliases', () => {
    const control = shortcut({ binding: { type: 'shortcut', keys: ['command', 'tab'] } })
    expect(controlToActions(control, -1)).toEqual([hotkey(['WIN', 'TAB'])])
  })

  it('never emits holdKeys as press actions', () => {
    const control = shortcut({
      binding: { type: 'shortcut', keys: ['TAB'], holdKeys: ['ALT'] },
    })
    expect(controlToActions(control, 1)).toEqual([hotkey(['TAB'])])
    expect(controlToActions(control, -1)).toEqual([hotkey(['TAB'])])
  })

  it('repeats the chord and caps one flush at 10 chords', () => {
    const repeated = shortcut({ binding: { type: 'shortcut', keys: ['TAB'], repeat: 3 } })
    expect(controlToActions(repeated, 2)).toHaveLength(6)
    expect(controlToActions(repeated, 4)).toHaveLength(MAX_SHORTCUT_CHORDS_PER_FLUSH)

    const max = shortcut({
      kind: 'slider',
      binding: { type: 'shortcut', keys: ['TAB'], repeat: 5, travelSteps: 100 },
    })
    expect(controlToActions(max, 100)).toHaveLength(MAX_SHORTCUT_CHORDS_PER_FLUSH)
  })

  it('maps slider travelSteps slices and dial units', () => {
    const slider = shortcut({
      kind: 'slider',
      binding: { type: 'shortcut', keys: ['['], travelSteps: 10 },
    })
    expect(controlToActions(slider, 50)).toHaveLength(5)
    expect(controlToActions(slider, 100)).toHaveLength(10)
    expect(shortcutDeltaPerStep(slider)).toBe(10)

    const slider20 = shortcut({
      kind: 'slider',
      binding: { type: 'shortcut', keys: ['['], travelSteps: 20 },
    })
    expect(controlToActions(slider20, 100)).toHaveLength(10)
    expect(shortcutDeltaPerStep(slider20)).toBe(5)

    const dial = shortcut({ binding: { type: 'shortcut', keys: ['RIGHT'] } })
    expect(controlToActions(dial, 3)).toHaveLength(3)
    expect(controlToActions(dial, -4)).toHaveLength(4)
    expect(shortcutDeltaPerStep(dial)).toBe(1)
  })

  it('ignores zero and invalid deltas', () => {
    const control = shortcut()
    expect(controlToActions(control, 0)).toEqual([])
    expect(controlToActions(control, Number.NaN)).toEqual([])
    expect(controlToActions(control, Number.POSITIVE_INFINITY)).toEqual([])
  })
})
