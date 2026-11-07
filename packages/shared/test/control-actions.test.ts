import { describe, expect, it } from 'vitest'
import { controlToActions } from '../src/actions'
import type { ControlSpec } from '../src/types'

function volume(stepPercent?: number): ControlSpec {
  return {
    kind: 'slider',
    emit: 'delta',
    binding: { type: 'volume', mode: 'relative', ...(stepPercent ? { stepPercent } : {}) },
  }
}

function scroll(axis: 'vertical' | 'horizontal', invert = false): ControlSpec {
  return {
    kind: 'dial',
    emit: 'delta',
    binding: { type: 'scroll', axis, ...(invert ? { invert } : {}) },
  }
}

describe('controlToActions', () => {
  it('maps relative volume deltas to repeated media keys', () => {
    expect(controlToActions(volume(), 2)).toEqual([
      { type: 'media', key: 'volumeup' },
      { type: 'media', key: 'volumeup' },
    ])
    expect(controlToActions(volume(), 0.2)).toEqual([{ type: 'media', key: 'volumeup' }])
    expect(controlToActions(volume(), -3)).toEqual([
      { type: 'media', key: 'volumedown' },
      { type: 'media', key: 'volumedown' },
      { type: 'media', key: 'volumedown' },
    ])
  })

  it('caps one volume batch at 20 steps and ignores stepPercent for now', () => {
    expect(controlToActions(volume(), 20.1)).toHaveLength(20)
    expect(controlToActions(volume(25), 100)).toHaveLength(20)
    expect(controlToActions(volume(1), 2)).toEqual(controlToActions(volume(), 2))
  })

  it('maps scroll deltas to one macro wheel action with axis and invert', () => {
    expect(controlToActions(scroll('vertical'), 2.2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 3 }],
      },
    ])
    expect(controlToActions(scroll('vertical'), -2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'down', amount: 2 }],
      },
    ])
    expect(controlToActions(scroll('vertical', true), 2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'down', amount: 2 }],
      },
    ])
    expect(controlToActions(scroll('horizontal'), 2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'right', amount: 2 }],
      },
    ])
    expect(controlToActions(scroll('horizontal', true), -2)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'right', amount: 2 }],
      },
    ])
  })

  it('caps scroll amount at 100 and ignores zero or invalid deltas', () => {
    expect(controlToActions(scroll('vertical'), 250)).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 100 }],
      },
    ])
    expect(controlToActions(volume(), 0)).toEqual([])
    expect(controlToActions(scroll('vertical'), 0)).toEqual([])
    expect(controlToActions(volume(), Number.NaN)).toEqual([])
    expect(controlToActions(scroll('vertical'), Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('returns an empty batch for unknown bindings and absolute volume', () => {
    const unknown = {
      kind: 'dial',
      emit: 'delta',
      binding: { type: 'nope' },
    } as unknown as ControlSpec
    expect(controlToActions(unknown, 5)).toEqual([])

    const absolute: ControlSpec = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
    }
    expect(controlToActions(absolute, 5)).toEqual([])
  })
})
