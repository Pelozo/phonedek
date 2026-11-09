import { describe, expect, it } from 'vitest'
import { actionsToPlan, controlToActions, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import type { ControlSpec, ExecutableAction } from '../src/types'

function micControl(kind: 'slider' | 'dial' = 'slider', emit: 'value' | 'delta' = 'value'): ControlSpec {
  return {
    kind,
    emit,
    binding: { type: 'mic', mode: 'gain' },
    min: 0,
    max: 100,
    step: 1,
    initial: 50,
    unit: '%',
  }
}

describe('mic binding and action', () => {
  it('accepts the documented mic slider shape on sliders and dials', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.pages[0]!.buttons[0]!.control = micControl('slider')
    expect(validateConfig(config).ok).toBe(true)

    config.profiles[0]!.pages[0]!.buttons[0]!.control = micControl('dial')
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects unknown mic modes and a delta emit', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    button.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'mic', mode: 'mute' },
    } as unknown as ControlSpec
    let result = validateConfig(config)
    expect(result.ok).toBe(false)

    button.control = micControl('slider', 'delta')
    result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Mic gain requires emit "value"/)
  })

  it('accepts the mic toggle action on a normal button', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.actions = [{ type: 'mic', action: 'toggleMute' }]
    expect(validateConfig(config).ok).toBe(true)

    button.actions = [{ type: 'mic', action: 'setGain', value: 50 } as unknown as ExecutableAction]
    expect(validateConfig(config).ok).toBe(false)
  })

  it('flattens a mic action into one plan step', () => {
    expect(actionsToPlan([{ type: 'mic', action: 'toggleMute' }])).toEqual([
      { kind: 'mic', action: 'toggleMute' },
    ])
    expect(
      actionsToPlan([
        { type: 'mic', action: 'toggleMute' },
        { type: 'delay', ms: 10 },
      ]),
    ).toEqual([
      { kind: 'mic', action: 'toggleMute' },
      { kind: 'delay', ms: 10 },
    ])
  })

  it('never synthesises actions from the mic binding', () => {
    expect(controlToActions(micControl(), 5)).toEqual([])
    expect(controlToActions(micControl('dial'), -2)).toEqual([])
  })

  it('describes the action and keeps legacy configs valid', () => {
    expect(describeAction({ type: 'mic', action: 'toggleMute' })).toBe('Toggle microphone mute')
    expect(validateConfig(createDefaultConfig()).ok).toBe(true)
  })
})
