import { describe, expect, it } from 'vitest'
import {
  ActionSchema,
  ButtonSchema,
  ControlSpecSchema,
  StateBindingSchema,
  actionsToPlan,
  denormalizeLightValue,
  describeAction,
  kelvinToMired,
  lightControlDefaults,
  miredToKelvin,
  normalizeLightValue,
  validateConfig,
} from '../src'
import { createDefaultConfig } from '../src/defaults'

const brightnessControl = {
  kind: 'slider' as const,
  emit: 'value' as const,
  min: 0,
  max: 100,
  step: 1,
  initial: 50,
  unit: '%',
  binding: { type: 'light' as const, target: 'brightness' as const },
}

const temperatureControl = {
  kind: 'dial' as const,
  emit: 'value' as const,
  min: 143,
  max: 344,
  step: 1,
  initial: 250,
  unit: 'mired',
  binding: { type: 'light' as const, target: 'temperature' as const, light: 'key-1' },
}

describe('local light binding schema', () => {
  it('accepts a brightness slider for the first configured light', () => {
    const parsed = ControlSpecSchema.safeParse(brightnessControl)
    expect(parsed.success).toBe(true)
  })

  it('accepts a temperature dial targeting a named light', () => {
    const parsed = ControlSpecSchema.safeParse(temperatureControl)
    expect(parsed.success).toBe(true)
  })

  it('accepts a power value control but prefers actions for on/off', () => {
    const parsed = ControlSpecSchema.safeParse({
      kind: 'slider',
      emit: 'value',
      min: 0,
      max: 100,
      step: 100,
      initial: 100,
      binding: { type: 'light', target: 'power' },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects delta light controls and non-Elgato temperature ranges', () => {
    expect(
      ControlSpecSchema.safeParse({ ...brightnessControl, emit: 'delta' }).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse({
        ...temperatureControl,
        min: 100,
      }).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse({
        ...temperatureControl,
        max: 400,
      }).success,
    ).toBe(false)
  })

  it('rejects unknown light targets and a malformed device id', () => {
    expect(
      ControlSpecSchema.safeParse({
        ...brightnessControl,
        binding: { type: 'light', target: 'color' },
      }).success,
    ).toBe(false)
    expect(
      ControlSpecSchema.safeParse({
        ...brightnessControl,
        binding: { type: 'light', target: 'brightness', light: 'bad id!' },
      }).success,
    ).toBe(false)
  })
})

describe('local light actions and plans', () => {
  it('accepts setPower and togglePower actions', () => {
    expect(
      ActionSchema.safeParse({ type: 'light', action: 'setPower', on: true }).success,
    ).toBe(true)
    expect(
      ActionSchema.safeParse({
        type: 'light',
        action: 'togglePower',
        light: 'key-1',
      }).success,
    ).toBe(true)
    expect(ActionSchema.safeParse({ type: 'light', action: 'setPower' }).success).toBe(false)
  })

  it('maps actions to plan steps with optional light ids', () => {
    expect(
      actionsToPlan([
        { type: 'light', action: 'setPower', on: false },
        { type: 'light', action: 'togglePower', light: 'key-1' },
      ]),
    ).toEqual([
      { kind: 'light', action: 'setPower', on: false },
      { kind: 'light', action: 'togglePower', light: 'key-1' },
    ])
  })

  it('describes light actions for the editor', () => {
    expect(describeAction({ type: 'light', action: 'setPower', on: true })).toBe(
      'Turn the first light on',
    )
    expect(
      describeAction({ type: 'light', action: 'togglePower', light: 'key-1' }),
    ).toBe('Toggle light "key-1"')
  })
})

describe('local light state binding', () => {
  it('accepts power, brightness and temperature status tiles', () => {
    for (const target of ['power', 'brightness', 'temperature'] as const) {
      expect(StateBindingSchema.safeParse({ type: 'light', target }).success).toBe(true)
      expect(
        StateBindingSchema.safeParse({ type: 'light', target, light: 'key-1' }).success,
      ).toBe(true)
    }
  })

  it('rejects an unknown target', () => {
    expect(StateBindingSchema.safeParse({ type: 'light', target: 'hue' }).success).toBe(false)
  })

  it('keeps a normal button with a light tile valid', () => {
    const parsed = ButtonSchema.safeParse({
      id: 'btn-light',
      slot: 0,
      label: 'KEY',
      actions: [{ type: 'light', action: 'togglePower' }],
      state: { type: 'light', target: 'power' },
    })
    expect(parsed.success).toBe(true)
  })

  it('keeps old configs valid', () => {
    expect(validateConfig(createDefaultConfig()).ok).toBe(true)
  })
})

describe('light value helpers', () => {
  it('documents the mired defaults and Kelvin mapping', () => {
    expect(lightControlDefaults('brightness')).toEqual({
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
    })
    expect(lightControlDefaults('temperature')).toEqual({
      min: 143,
      max: 344,
      step: 1,
      initial: 250,
      unit: 'mired',
    })
    expect(miredToKelvin(143)).toBe(6993)
    expect(miredToKelvin(344)).toBe(2907)
    expect(kelvinToMired(7000)).toBe(143)
    expect(kelvinToMired(2900)).toBe(344)
  })

  it('normalizes and denormalizes brightness, temperature and power', () => {
    expect(normalizeLightValue('brightness', 42)).toBeCloseTo(0.42)
    expect(denormalizeLightValue('brightness', 0.42)).toBe(42)
    expect(denormalizeLightValue('temperature', 0.5)).toBe(244)
    expect(normalizeLightValue('temperature', 143)).toBe(0)
    expect(normalizeLightValue('temperature', 344)).toBe(1)
    expect(denormalizeLightValue('power', 0.49)).toBe(0)
    expect(denormalizeLightValue('power', 0.5)).toBe(100)
  })
})
