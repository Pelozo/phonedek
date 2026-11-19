import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { stripAutomationForLegacy } from '../src/legacy'
import { parseConfig, validateConfig } from '../src/schema'
import type {
  DeckButton,
  DeckConfig,
  EventRule,
  RigPreset,
  RigRunAction,
} from '../src/types'

const rigOne: RigPreset = {
  id: 'rig-one',
  name: 'Go live',
  steps: [{ id: 'step-1', action: { type: 'hotkey', keys: ['A'] } }],
}

const rigTwo: RigPreset = {
  id: 'rig-two',
  name: 'Go offline',
  steps: [{ id: 'step-2', action: { type: 'hotkey', keys: ['B'] } }],
}

const rigAction: RigRunAction = { type: 'rig', action: 'run', presetId: 'rig-one' }
const otherRigAction: RigRunAction = { type: 'rig', action: 'run', presetId: 'rig-two' }

function button(overrides: Partial<DeckButton> & Record<string, unknown>): DeckButton {
  return { id: 'btn', slot: 0, label: 'Button', actions: [], ...overrides } as DeckButton
}

function configWithAutomation(): DeckConfig {
  const config = createDefaultConfig()
  config.rigs = [rigOne, rigTwo]
  const rules: EventRule[] = [
    {
      id: 'rule-live',
      name: 'Go live',
      trigger: { kind: 'obs.streaming', active: true },
      actions: [{ kind: 'runRig', presetId: rigOne.id }],
    },
    {
      id: 'rule-phone',
      name: 'Back on the phone',
      trigger: { kind: 'phone.connected' },
      actions: [{ kind: 'showProfile', profileId: config.defaultProfileId }],
    },
  ]
  config.rules = rules

  const page = config.profiles[0]!.pages[0]!
  page.buttons = [
    button({
      id: 'btn-rig-only',
      slot: 0,
      label: 'Go live',
      actions: [rigAction],
      state: { type: 'rig', presetId: rigOne.id },
    }),
    button({
      id: 'btn-mixed',
      slot: 1,
      label: 'Mic',
      actions: [
        { type: 'hotkey', keys: ['CTRL', 'M'] },
        otherRigAction,
        { type: 'text', text: 'done' },
      ],
      state: { type: 'rig', presetId: rigTwo.id },
    }),
    button({
      id: 'btn-keep',
      slot: 2,
      label: 'Mute',
      actions: [{ type: 'media', key: 'mute' }],
    }),
    button({
      id: 'btn-control',
      slot: 3,
      label: 'Volume',
      actions: [],
      control: {
        kind: 'slider',
        emit: 'value',
        binding: { type: 'volume', mode: 'absolute' },
        min: 0,
        max: 100,
        step: 1,
        initial: 50,
      },
    }),
    button({
      id: 'btn-state',
      slot: 4,
      label: 'OBS',
      actions: [],
      state: { type: 'obs', target: 'streaming' },
    }),
  ]
  return config
}

describe('stripAutomationForLegacy', () => {
  it('removes rigs, rules, rig actions, rig states and dead rig buttons', () => {
    const config = configWithAutomation()
    const { config: legacy, removed } = stripAutomationForLegacy(config)

    expect(removed).toEqual({
      rigs: 2,
      rules: 2,
      rigActions: 2,
      rigStates: 2,
      buttons: 1,
    })
    expect(legacy.rigs).toBeUndefined()
    expect(legacy.rules).toBeUndefined()

    const buttons = legacy.profiles[0]!.pages[0]!.buttons
    expect(buttons.map((entry) => entry.id)).toEqual([
      'btn-mixed',
      'btn-keep',
      'btn-control',
      'btn-state',
    ])
    expect(buttons.map((entry) => entry.slot)).toEqual([1, 2, 3, 4])

    const mixed = buttons[0]!
    expect(mixed.actions).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'M'] },
      { type: 'text', text: 'done' },
    ])
    expect(mixed.state).toBeUndefined()

    expect(buttons[1]!.actions).toEqual([{ type: 'media', key: 'mute' }])
    expect(buttons[2]!.control?.kind).toBe('slider')
    expect(buttons[3]!.state).toEqual({ type: 'obs', target: 'streaming' })
  })

  it('returns a schema-valid v1 config', () => {
    const { config: legacy } = stripAutomationForLegacy(configWithAutomation())
    const result = validateConfig(legacy)
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(result.config.schemaVersion).toBe(1)
    expect(parseConfig(legacy)).toEqual(legacy)
  })

  it('does not mutate the input config', () => {
    const config = configWithAutomation()
    const before = structuredClone(config)
    stripAutomationForLegacy(config)
    expect(config).toEqual(before)
    expect(config.rigs).toHaveLength(2)
    expect(config.rules).toHaveLength(2)
    expect(config.profiles[0]!.pages[0]!.buttons[0]!.actions).toEqual([rigAction])
  })

  it('is a byte-identical no-op for a pre-rig config', () => {
    const config = createDefaultConfig()
    const before = JSON.stringify(config)
    const { config: legacy, removed } = stripAutomationForLegacy(config)

    expect(legacy).toEqual(config)
    expect(JSON.stringify(legacy)).toBe(before)
    expect(removed).toEqual({
      rigs: 0,
      rules: 0,
      rigActions: 0,
      rigStates: 0,
      buttons: 0,
    })
    expect(removed.audioActions).toBeUndefined()
    expect(removed.audioStates).toBeUndefined()
    expect(legacy).not.toBe(config)
  })

  it('keeps a control tile even when a rig status was its only state', () => {
    const config = createDefaultConfig()
    config.rigs = [rigOne]
    config.profiles[0]!.pages[0]!.buttons = [
      button({
        id: 'btn-rig-control',
        slot: 0,
        label: 'Volume',
        actions: [rigAction],
        state: { type: 'rig', presetId: rigOne.id },
        control: {
          kind: 'slider',
          emit: 'value',
          binding: { type: 'volume', mode: 'absolute' },
        },
      }),
    ]

    const { config: legacy, removed } = stripAutomationForLegacy(config)
    expect(removed.buttons).toBe(0)
    expect(removed.rigActions).toBe(1)
    expect(removed.rigStates).toBe(1)
    expect(legacy.profiles[0]!.pages[0]!.buttons[0]!.control).toBeDefined()
    expect(legacy.profiles[0]!.pages[0]!.buttons[0]!.actions).toEqual([])
    expect(legacy.profiles[0]!.pages[0]!.buttons[0]!.state).toBeUndefined()
    expect(validateConfig(legacy).ok).toBe(true)
  })
})

describe('stripAutomationForLegacy audio devices', () => {
  const audioSet = {
    type: 'audioDevice',
    action: 'set',
    kind: 'output',
    device: { id: 'a1b2c3', name: 'Speakers (Realtek(R) Audio)' },
  }
  const audioInput = {
    type: 'audioDevice',
    action: 'set',
    kind: 'input',
    device: { id: '9f8e7d', name: 'HyperX Cloud II Microphone' },
  }
  const audioState = {
    type: 'audioDevice',
    target: 'output',
    device: { id: 'a1b2c3', name: 'Speakers (Realtek(R) Audio)' },
  }

  function configWithAudioDevices(): DeckConfig {
    const config = createDefaultConfig()
    const page = config.profiles[0]!.pages[0]!
    page.buttons = [
      button({
        id: 'btn-audio-only',
        slot: 0,
        label: 'Headset',
        actions: [audioSet, audioInput],
        state: audioState,
      }),
      button({
        id: 'btn-audio-mixed',
        slot: 1,
        label: 'Speakers',
        actions: [{ type: 'hotkey', keys: ['A'] }, audioSet],
        state: audioState,
      }),
      button({
        id: 'btn-audio-control',
        slot: 2,
        label: 'Volume',
        actions: [audioSet],
        state: audioState,
        control: {
          kind: 'slider',
          emit: 'value',
          binding: { type: 'volume', mode: 'absolute' },
        },
      }),
      button({
        id: 'btn-keep',
        slot: 3,
        label: 'Mute',
        actions: [{ type: 'media', key: 'mute' }],
      }),
    ]
    return config
  }

  it('removes audio actions/states, counts them and drops dead audio tiles', () => {
    const { config: legacy, removed } = stripAutomationForLegacy(configWithAudioDevices())

    expect(removed.rigActions).toBe(0)
    expect(removed.rigStates).toBe(0)
    expect(removed.audioActions).toBe(4)
    expect(removed.audioStates).toBe(3)
    expect(removed.buttons).toBe(1)

    const buttons = legacy.profiles[0]!.pages[0]!.buttons
    expect(buttons.map((entry) => entry.id)).toEqual([
      'btn-audio-mixed',
      'btn-audio-control',
      'btn-keep',
    ])
    expect(buttons.map((entry) => entry.slot)).toEqual([1, 2, 3])
    expect(buttons[0]!.actions).toEqual([{ type: 'hotkey', keys: ['A'] }])
    expect(buttons[0]!.state).toBeUndefined()
    expect(buttons[1]!.actions).toEqual([])
    expect(buttons[1]!.state).toBeUndefined()
    expect(buttons[1]!.control?.kind).toBe('slider')
    expect(buttons[2]!.actions).toEqual([{ type: 'media', key: 'mute' }])
  })

  it('produces a schema-valid v1 config after stripping audio wiring', () => {
    const { config: legacy } = stripAutomationForLegacy(configWithAudioDevices())
    const result = validateConfig(legacy)
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(result.config.schemaVersion).toBe(1)
    expect(parseConfig(legacy)).toEqual(legacy)
  })

  it('does not mutate the input config', () => {
    const config = configWithAudioDevices()
    const before = structuredClone(config)
    stripAutomationForLegacy(config)
    expect(config).toEqual(before)
    expect(config.profiles[0]!.pages[0]!.buttons[0]!.actions).toHaveLength(2)
  })
})
