import { describe, expect, it } from 'vitest'
import { controlToActions } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import type { ControlSpec, DeckButton, DeckConfig } from '../src/types'

function soloButtonConfig(): { config: DeckConfig; button: DeckButton } {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const target: DeckButton = {
    id: 'btn-trackpad',
    slot: 0,
    label: 'Trackpad',
    actions: [],
  }
  page.buttons = [target]
  return { config, button: target }
}

const minimalTrackpad: ControlSpec = {
  kind: 'trackpad',
  emit: 'delta',
  binding: { type: 'pointer' },
}

describe('trackpad control schema', () => {
  it('accepts the minimal trackpad control and every option', () => {
    const { config, button: target } = soloButtonConfig()

    target.control = minimalTrackpad
    expect(validateConfig(config).ok).toBe(true)

    target.control = {
      kind: 'trackpad',
      emit: 'delta',
      binding: {
        type: 'pointer',
        sensitivity: 1.75,
        naturalScroll: false,
        tapToClick: false,
        dragLock: false,
      },
      haptics: false,
    }
    expect(validateConfig(config).ok).toBe(true)

    target.control = { ...minimalTrackpad, haptics: true }
    expect(validateConfig(config).ok).toBe(true)
  })

  it('enforces the sensitivity range and rejects non-finite values', () => {
    const { config, button: target } = soloButtonConfig()

    for (const sensitivity of [0.25, 1, 3]) {
      target.control = {
        kind: 'trackpad',
        emit: 'delta',
        binding: { type: 'pointer', sensitivity },
      }
      expect(validateConfig(config).ok, `sensitivity ${sensitivity}`).toBe(true)
    }

    for (const sensitivity of [0.24, 3.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      target.control = {
        kind: 'trackpad',
        emit: 'delta',
        binding: { type: 'pointer', sensitivity },
      }
      expect(validateConfig(config).ok, `sensitivity ${sensitivity}`).toBe(false)
    }
  })

  it('rejects a pointer binding on sliders and dials', () => {
    const { config, button: target } = soloButtonConfig()

    target.control = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'pointer' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      kind: 'dial',
      emit: 'delta',
      binding: { type: 'pointer' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)
  })

  it('rejects volume/scroll bindings and value emission on a trackpad', () => {
    const { config, button: target } = soloButtonConfig()

    target.control = {
      kind: 'trackpad',
      emit: 'delta',
      binding: { type: 'volume', mode: 'relative' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      kind: 'trackpad',
      emit: 'delta',
      binding: { type: 'scroll', axis: 'vertical' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)

    target.control = {
      kind: 'trackpad',
      emit: 'value',
      binding: { type: 'pointer' },
    } as unknown as ControlSpec
    expect(validateConfig(config).ok).toBe(false)
  })

  it('keeps legacy slider/dial controls and legacy configs valid', () => {
    const config = createDefaultConfig()
    for (const page of config.profiles[0]!.pages) {
      for (const item of page.buttons) {
        expect(item.control).toBeUndefined()
      }
    }
    expect(validateConfig(config).ok).toBe(true)
    expect(config.schemaVersion).toBe(1)

    const { config: solo, button: target } = soloButtonConfig()
    const legacy: ControlSpec[] = [
      { kind: 'slider', emit: 'delta', binding: { type: 'volume', mode: 'relative' } },
      { kind: 'slider', emit: 'value', binding: { type: 'volume', mode: 'absolute' } },
      { kind: 'dial', emit: 'delta', binding: { type: 'scroll', axis: 'vertical', invert: true } },
    ]
    for (const control of legacy) {
      target.control = control
      expect(validateConfig(solo).ok, control.kind).toBe(true)
    }
  })

  it('never synthesises actions for a trackpad control', () => {
    expect(controlToActions(minimalTrackpad, 5)).toEqual([])
    expect(controlToActions(minimalTrackpad, -2)).toEqual([])
    expect(controlToActions(minimalTrackpad, 0)).toEqual([])
  })
})
