import { describe, expect, it } from 'vitest'
import { actionsToPlan, controlToActions, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import { CONFIG_SCHEMA_VERSION, OBS_CAPABILITY } from '../src/types'
import type { Action, ControlSpec, ExecutableAction } from '../src/types'

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

  it('accepts every phase-2 action and validates OBS names', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    const valid: ExecutableAction[] = [
      { type: 'obs', action: 'setScene', scene: 'Gameplay' },
      { type: 'obs', action: 'setScene' },
      { type: 'obs', action: 'toggleStream' },
      { type: 'obs', action: 'startStream' },
      { type: 'obs', action: 'stopStream' },
      { type: 'obs', action: 'toggleRecord' },
      { type: 'obs', action: 'startRecord' },
      { type: 'obs', action: 'stopRecord' },
      { type: 'obs', action: 'startReplay' },
      { type: 'obs', action: 'stopReplay' },
      { type: 'obs', action: 'toggleReplay' },
      { type: 'obs', action: 'saveReplay' },
      { type: 'obs', action: 'toggleVirtualCam' },
      { type: 'obs', action: 'setSourceVisibility', scene: 'Gameplay', source: 'Camera', visible: true },
      { type: 'obs', action: 'setSourceVisibility', source: 'Camera', visible: false },
      { type: 'obs', action: 'toggleSourceVisibility', source: 'Alert box' },
      { type: 'obs', action: 'addMarker' },
      { type: 'obs', action: 'addMarker', name: 'Boss fight' },
    ]
    for (const action of valid) {
      button.actions = [action] as unknown as Action[]
      expect(validateConfig(config).ok, JSON.stringify(action)).toBe(true)
    }

    const invalid: Array<{ action: unknown; pattern: RegExp }> = [
      {
        action: { type: 'obs', action: 'setSourceVisibility', source: 'Camera' },
        pattern: /visible|Required|invalid_type|Invalid input/i,
      },
      {
        action: { type: 'obs', action: 'setSourceVisibility', visible: true },
        pattern: /source|Required|invalid_type|Invalid input/i,
      },
      {
        action: { type: 'obs', action: 'setScene', scene: '' },
        pattern: /at least 1|too_small/i,
      },
      {
        action: { type: 'obs', action: 'addMarker', name: 'x'.repeat(129) },
        pattern: /at most 128|too_big/i,
      },
      {
        action: { type: 'obs', action: 'setScene', scene: 'x'.repeat(129) },
        pattern: /at most 128|too_big/i,
      },
      {
        action: { type: 'obs', action: 'nope' },
        pattern: /Invalid|No matching|literal/i,
      },
    ]
    for (const { action, pattern } of invalid) {
      button.actions = [action] as unknown as Action[]
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join(' ')).toMatch(pattern)
    }
  })

  it('validates button state bindings and keeps them additive', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    const targets = [
      'streaming',
      'recording',
      'replay',
      'virtualCam',
      'scene',
      'inputMute',
      'inputVolume',
    ] as const
    for (const target of targets) {
      button.state = { type: 'obs', target } as never
      expect(validateConfig(config).ok, target).toBe(true)
    }
    button.state = { type: 'obs', target: 'scene', scene: 'Gameplay' }
    expect(validateConfig(config).ok).toBe(true)
    button.state = { type: 'obs', target: 'inputMute', input: 'Mic/Aux' }
    expect(validateConfig(config).ok).toBe(true)

    button.state = { type: 'obs', target: 'stream' } as never
    expect(validateConfig(config).ok).toBe(false)
    button.state = { type: 'obs', target: 'scene', scene: '' }
    expect(validateConfig(config).ok).toBe(false)
    button.state = { type: 'obs', target: 'inputMute', input: 'x'.repeat(129) }
    expect(validateConfig(config).ok).toBe(false)
  })

  it('plans phase-2 actions with only the relevant optional fields', () => {
    expect(
      actionsToPlan([
        { type: 'obs', action: 'setScene', scene: 'Gameplay' },
        { type: 'obs', action: 'setScene' },
        { type: 'obs', action: 'startStream' },
        { type: 'obs', action: 'saveReplay' },
        { type: 'obs', action: 'setSourceVisibility', scene: 'Gameplay', source: 'Camera', visible: false },
        { type: 'obs', action: 'toggleSourceVisibility', source: 'Alert box' },
        { type: 'obs', action: 'addMarker', name: 'Boss fight' },
      ]),
    ).toEqual([
      { kind: 'obs', action: 'setScene', scene: 'Gameplay' },
      { kind: 'obs', action: 'setScene' },
      { kind: 'obs', action: 'startStream' },
      { kind: 'obs', action: 'saveReplay' },
      {
        kind: 'obs',
        action: 'setSourceVisibility',
        scene: 'Gameplay',
        source: 'Camera',
        visible: false,
      },
      { kind: 'obs', action: 'toggleSourceVisibility', source: 'Alert box' },
      { kind: 'obs', action: 'addMarker', name: 'Boss fight' },
    ])
  })

  it('describes phase-2 actions', () => {
    expect(describeAction({ type: 'obs', action: 'setScene', scene: 'Gameplay' })).toBe(
      'Switch OBS to "Gameplay"',
    )
    expect(describeAction({ type: 'obs', action: 'startStream' })).toBe('Start OBS stream')
    expect(describeAction({ type: 'obs', action: 'stopRecord' })).toBe('Stop OBS recording')
    expect(describeAction({ type: 'obs', action: 'saveReplay' })).toBe('Save OBS replay buffer')
    expect(describeAction({ type: 'obs', action: 'toggleVirtualCam' })).toBe(
      'Toggle OBS virtual camera',
    )
    expect(
      describeAction({ type: 'obs', action: 'setSourceVisibility', source: 'Camera', visible: true }),
    ).toBe('Show OBS source "Camera"')
    expect(describeAction({ type: 'obs', action: 'addMarker', name: 'Boss fight' })).toBe(
      'Add OBS marker "Boss fight"',
    )
  })
})
