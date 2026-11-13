import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import { ControlStateEntrySchema, ControlStateMessageSchema } from '../src/protocol'
import type { ControlSpec, DeckConfig } from '../src/types'

function configWith(control: ControlSpec): DeckConfig {
  const config = createDefaultConfig()
  const page = config.profiles[0]!.pages[0]!
  page.buttons = [
    {
      id: 'btn-scrub',
      slot: 0,
      label: 'Scrub',
      actions: [],
      control,
    },
  ]
  return config
}

function scrub(overrides: Partial<Extract<ControlSpec, { kind: 'slider' }>> = {}): ControlSpec {
  return {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'media', target: 'position' },
    min: 0,
    max: 1,
    step: 0.001,
    initial: 0,
    commit: 'end',
    display: 'time',
    ...overrides,
  }
}

describe('media scrub control schema', () => {
  it('accepts the canonical media slider with commit and display', () => {
    const result = validateConfig(configWith(scrub()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const control = result.config.profiles[0]!.pages[0]!.buttons[0]!.control
    expect(control).toMatchObject({
      kind: 'slider',
      emit: 'value',
      binding: { type: 'media', target: 'position' },
      commit: 'end',
      display: 'time',
    })
  })

  it('accepts omitted additive fields and a media dial', () => {
    const control: ControlSpec = {
      kind: 'dial',
      emit: 'value',
      binding: { type: 'media', target: 'position' },
    }
    expect(validateConfig(configWith(control)).ok).toBe(true)
  })

  it('keeps old configs without commit/display valid', () => {
    const config = createDefaultConfig()
    expect(validateConfig(config)).toMatchObject({ ok: true })
    const page = config.profiles[0]!.pages[0]!
    page.buttons[0]!.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const control = result.config.profiles[0]!.pages[0]!.buttons[0]!.control
      expect(control?.commit).toBeUndefined()
      expect(control?.display).toBeUndefined()
    }
  })

  it('rejects invalid media emit, range and display values', () => {
    const cases: Array<[string, ControlSpec]> = [
      ['emit', scrub({ emit: 'delta' })],
      ['min', scrub({ min: -0.1 })],
      ['max', scrub({ max: 2 })],
      ['display', { ...scrub(), display: 'db' } as unknown as ControlSpec],
      ['commit', { ...scrub(), commit: 'soon' } as unknown as ControlSpec],
      ['target', { ...scrub(), binding: { type: 'media', target: 'duration' } } as unknown as ControlSpec],
    ]
    for (const [label, control] of cases) {
      const result = validateConfig(configWith(control))
      expect(result.ok, label).toBe(false)
    }
  })
})

describe('media control state fields', () => {
  it('accepts the additive position/duration/playing/title/artist fields', () => {
    const entry = {
      controlId: 'btn-scrub',
      revision: 3,
      value: 0.39,
      available: true,
      detail: '1:23 / 3:45',
      positionMs: 84_000,
      durationMs: 213_000,
      playing: true,
      title: 'Song',
      artist: 'Artist',
    }
    expect(ControlStateEntrySchema.safeParse(entry).success).toBe(true)
    expect(
      ControlStateMessageSchema.safeParse({
        type: 'controlState',
        profileId: 'profile-desktop',
        pageId: 'page-main',
        states: [entry],
      }).success,
    ).toBe(true)
  })

  it('rejects negative media times', () => {
    expect(
      ControlStateEntrySchema.safeParse({
        controlId: 'btn-scrub',
        revision: 1,
        available: true,
        positionMs: -1,
      }).success,
    ).toBe(false)
    expect(
      ControlStateEntrySchema.safeParse({
        controlId: 'btn-scrub',
        revision: 1,
        available: true,
        durationMs: -1,
      }).success,
    ).toBe(false)
  })
})
