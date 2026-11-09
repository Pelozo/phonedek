import { describe, expect, it } from 'vitest'
import { actionsToPlan, controlToActions, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import { CONFIG_SCHEMA_VERSION, OBS_CAPABILITY } from '../src/types'
import type { ControlSpec, ExecutableAction } from '../src/types'

function obsControl(
  kind: 'slider' | 'dial' = 'slider',
  overrides: Partial<ControlSpec> = {},
): ControlSpec {
  return {
    kind,
    emit: 'value',
    binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
    min: 0,
    max: 200,
    step: 1,
    initial: 100,
    unit: '%',
    ...overrides,
  } as ControlSpec
}

function buttonWithControl(control: ControlSpec) {
  const config = createDefaultConfig()
  const button = config.profiles[0]!.pages[0]!.buttons[0]!
  button.control = control
  return { config, button }
}

describe('OBS contract', () => {
  it('exports the obs-v1 capability and keeps the config schema at v1', () => {
    expect(OBS_CAPABILITY).toBe('obs-v1')
    expect(CONFIG_SCHEMA_VERSION).toBe(1)
    expect(validateConfig(createDefaultConfig()).ok).toBe(true)
  })

  it('accepts the documented OBS slider/dial shapes with and without an input', () => {
    expect(validateConfig(buttonWithControl(obsControl('slider')).config).ok).toBe(true)
    expect(validateConfig(buttonWithControl(obsControl('dial')).config).ok).toBe(true)

    const noInput: ControlSpec = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'obs', target: 'inputVolume' },
      max: 200,
    }
    expect(validateConfig(buttonWithControl(noInput).config).ok).toBe(true)
  })

  it('rejects unknown targets, a delta emit, nonzero min and out-of-range max', () => {
    const cases: Array<{ control: ControlSpec; pattern: RegExp }> = [
      {
        control: obsControl('slider', {
          binding: { type: 'obs', target: 'inputMute' } as unknown as ControlSpec['binding'],
        }),
        pattern: /Invalid|No matching|literal/i,
      },
      {
        control: obsControl('slider', { emit: 'delta' }),
        pattern: /OBS input volume requires emit "value"/,
      },
      {
        control: obsControl('slider', { min: 10 }),
        pattern: /OBS input volume requires min 0/,
      },
      {
        control: obsControl('slider', { max: 0 }),
        pattern: /OBS input volume max must be between 1 and 2000/,
      },
      {
        control: obsControl('slider', { max: 2001 }),
        pattern: /OBS input volume max must be between 1 and 2000/,
      },
      {
        control: obsControl('slider', {
          binding: { type: 'obs', target: 'inputVolume', input: '' },
        }),
        pattern: /at least 1|too_small|String must contain/i,
      },
      {
        control: obsControl('slider', {
          binding: { type: 'obs', target: 'inputVolume', input: 'x'.repeat(129) },
        }),
        pattern: /at most 128|too_big|String must contain/i,
      },
    ]
    for (const { control, pattern } of cases) {
      const result = validateConfig(buttonWithControl(control).config)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join(' ')).toMatch(pattern)
    }
  })

  it('accepts the OBS toggleMute action and rejects unknown actions', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.actions = [{ type: 'obs', action: 'toggleMute', input: 'Mic/Aux' }] as unknown as ExecutableAction[]
    expect(validateConfig(config).ok).toBe(true)

    button.actions = [{ type: 'obs', action: 'toggleMute' }] as unknown as ExecutableAction[]
    expect(validateConfig(config).ok).toBe(true)

    button.actions = [{ type: 'obs', action: 'setMute' }] as unknown as ExecutableAction[]
    expect(validateConfig(config).ok).toBe(false)
  })

  it('flattens an OBS action into one plan step', () => {
    expect(actionsToPlan([{ type: 'obs', action: 'toggleMute', input: 'Mic/Aux' }])).toEqual([
      { kind: 'obs', action: 'toggleMute', input: 'Mic/Aux' },
    ])
    expect(
      actionsToPlan([
        { type: 'obs', action: 'toggleMute' },
        { type: 'delay', ms: 10 },
      ]),
    ).toEqual([{ kind: 'obs', action: 'toggleMute' }, { kind: 'delay', ms: 10 }])
  })

  it('describes the mute action and never synthesises actions from the binding', () => {
    expect(describeAction({ type: 'obs', action: 'toggleMute', input: 'Mic/Aux' })).toBe(
      'Mute OBS "Mic/Aux"',
    )
    expect(describeAction({ type: 'obs', action: 'toggleMute' })).toBe('Mute OBS input')
    expect(controlToActions(obsControl(), 5)).toEqual([])
    expect(controlToActions(obsControl('dial'), -2)).toEqual([])
  })
})
