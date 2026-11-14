import { describe, expect, it } from 'vitest'
import { actionsToPlan, controlToActions, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import {
  MIXER_CAPABILITY,
  type AppVolumeAction,
  type AppVolumeStateBinding,
  type ControlSpec,
} from '../src/types'

function appControl(
  kind: 'slider' | 'dial' = 'slider',
  emit: 'value' | 'delta' = 'value',
  process = 'discord',
): ControlSpec {
  return {
    kind,
    emit,
    binding: { type: 'appVolume', target: 'volume', match: { process } },
    min: 0,
    max: 100,
    step: 1,
    initial: 50,
    unit: '%',
  }
}

describe('app volume binding, actions and state binding', () => {
  it('accepts the documented slider/dial shape with a process match', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    button.control = appControl('slider')
    expect(validateConfig(config).ok).toBe(true)

    button.control = appControl('dial', 'value', 'Google Chrome')
    expect(validateConfig(config).ok).toBe(true)

    button.control = appControl('slider', 'value', 'C:\\Program Files\\Discord\\Discord.exe')
    expect(validateConfig(config).ok).toBe(true)
  })

  it('rejects a delta emit, out-of-range bounds and unknown match keys', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    button.control = appControl('slider', 'delta')
    let result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/App volume requires emit "value"/)

    button.control = { ...appControl(), min: -1 } as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    button.control = { ...appControl(), max: 101 } as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    button.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'appVolume', target: 'volume', match: { process: 'discord', extra: true } },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)
  })

  it('accepts setMute/toggleMute actions on a normal button', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    button.actions = [
      { type: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: true },
      { type: 'appVolume', action: 'toggleMute', match: { process: 'spotify' } },
    ] as unknown as typeof button.actions
    expect(validateConfig(config).ok).toBe(true)

    button.actions = [
      { type: 'appVolume', action: 'setMute', match: { process: 'discord' } },
    ] as unknown as typeof button.actions
    expect(validateConfig(config).ok).toBe(false)

    button.actions = [
      { type: 'appVolume', action: 'setVolume', match: { process: 'discord' }, muted: true },
    ] as unknown as typeof button.actions
    expect(validateConfig(config).ok).toBe(false)
  })

  it('accepts per-app volume and mute state bindings for status tiles', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    const volume: AppVolumeStateBinding = {
      type: 'appVolume',
      target: 'volume',
      match: { process: 'chrome' },
    }
    button.state = volume
    expect(validateConfig(config).ok).toBe(true)

    button.state = { type: 'appVolume', target: 'mute', match: { process: 'chrome' } }
    expect(validateConfig(config).ok).toBe(true)

    button.state = {
      type: 'appVolume',
      target: 'pan',
      match: { process: 'chrome' },
    } as unknown as AppVolumeStateBinding
    expect(validateConfig(config).ok).toBe(false)
  })

  it('flattens per-app mute actions into plan steps', () => {
    const actions: AppVolumeAction[] = [
      { type: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: true },
      { type: 'delay', ms: 10 },
      { type: 'appVolume', action: 'toggleMute', match: { process: 'spotify' } },
    ]
    expect(actionsToPlan(actions)).toEqual([
      { kind: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: true },
      { kind: 'delay', ms: 10 },
      { kind: 'appVolume', action: 'toggleMute', match: { process: 'spotify' } },
    ])
  })

  it('never synthesises actions from the app volume binding', () => {
    expect(controlToActions(appControl(), 5)).toEqual([])
    expect(controlToActions(appControl('dial'), -2)).toEqual([])
  })

  it('describes mute actions and exposes the mixer capability', () => {
    expect(
      describeAction({ type: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: true }),
    ).toBe('Mute "discord"')
    expect(
      describeAction({ type: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: false }),
    ).toBe('Unmute "discord"')
    expect(
      describeAction({ type: 'appVolume', action: 'toggleMute', match: { process: 'spotify' } }),
    ).toBe('Toggle mute for "spotify"')
    expect(
      describeAction({ type: 'appVolume', action: 'toggleMute', match: {} }),
    ).toBe('Toggle mute for app audio')
    expect(MIXER_CAPABILITY).toBe('mixer-v1')
  })

  it('keeps legacy configs valid', () => {
    expect(validateConfig(createDefaultConfig()).ok).toBe(true)
  })
})
