import { describe, expect, it } from 'vitest'
import * as shared from '../src'
import { actionsToPlan, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { estimateRigMs } from '../src/rigs'
import {
  ActionSchema,
  AudioDeviceActionSchema,
  AudioDeviceStateBindingSchema,
  StateBindingSchema,
  audioDeviceRefSchema,
  normalizeAudioDeviceName,
  parseConfig,
  validateConfig,
} from '../src/schema'
import {
  AudioDeviceEntrySchema,
  AudioDeviceResultMessageSchema,
  AudioDeviceSetMessageSchema,
  AudioDevicesMessageSchema,
  AudioDevicesStateMessageSchema,
  isAudioDeviceSetMessage,
  isAudioDevicesMessage,
  parseClientMessage,
} from '../src/protocol'
import { AUDIO_DEVICE_CAPABILITY } from '../src/types'
import type {
  AudioDeviceAction,
  AudioDevicePlanStep,
  AudioDeviceRef,
  AudioDeviceStateBinding,
  DeckButton,
  DeckConfig,
  RigPreset,
} from '../src/types'

const headphones: AudioDeviceRef = {
  id: 'a1b2c3d4e5f6',
  name: 'Headphones (HyperX Cloud II)',
}
const speakers: AudioDeviceRef = {
  id: '0a1b2c3d4e5f',
  name: 'Speakers (Realtek(R) Audio)',
}
const usbMic: AudioDeviceRef = {
  id: '9f8e7d6c5b4a',
  name: 'Shure MV7',
}

const setOutput: AudioDeviceAction = {
  type: 'audioDevice',
  action: 'set',
  kind: 'output',
  device: headphones,
}

const setInput: AudioDeviceAction = {
  type: 'audioDevice',
  action: 'set',
  kind: 'input',
  device: usbMic,
}

const outputState: AudioDeviceStateBinding = {
  type: 'audioDevice',
  target: 'output',
  device: headphones,
}

function button(overrides: Record<string, unknown>): DeckButton {
  return {
    id: 'btn-audio',
    slot: 0,
    label: 'Headset',
    actions: [],
    ...overrides,
  } as unknown as DeckButton
}

function configWithAudio(): DeckConfig {
  const config = createDefaultConfig()
  const page = config.profiles[0]!.pages[0]!
  page.buttons = [
    button({
      id: 'btn-headset',
      label: 'Headset',
      icon: '🎧',
      actions: [setOutput, setInput],
      state: outputState,
    }),
  ]
  return config
}

function issuePaths(result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'))
}

describe('audio device contract', () => {
  it('advertises the desktop capability', () => {
    expect(AUDIO_DEVICE_CAPABILITY).toBe('audio-device-v1')
  })

  it('re-exports the new contract from the package index', () => {
    expect(shared.AUDIO_DEVICE_CAPABILITY).toBe('audio-device-v1')
    expect(shared.audioDeviceRefSchema).toBeDefined()
    expect(shared.AudioDeviceActionSchema).toBeDefined()
    expect(shared.AudioDeviceStateBindingSchema).toBeDefined()
    expect(shared.normalizeAudioDeviceName('  A  B ')).toBe('a b')
  })

  it('normalizes names for duplicate detection without dropping parentheses', () => {
    expect(normalizeAudioDeviceName('  Speakers   (Realtek(R)  Audio) ')).toBe(
      'speakers (realtek(r) audio)',
    )
    expect(normalizeAudioDeviceName('Speakers (Realtek(R) Audio)')).not.toBe(
      normalizeAudioDeviceName('Speakers (Realtek Audio)'),
    )
  })

  describe('device refs', () => {
    it('accepts an id, a name, or both', () => {
      expect(audioDeviceRefSchema.safeParse({ id: 'abc123' }).success).toBe(true)
      expect(audioDeviceRefSchema.safeParse({ name: 'Speakers' }).success).toBe(true)
      expect(
        audioDeviceRefSchema.safeParse({ id: 'abc123', name: 'Speakers (Realtek)' }).success,
      ).toBe(true)
    })

    it('requires at least one of id or name and rejects blank values', () => {
      expect(audioDeviceRefSchema.safeParse({}).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ id: '' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ name: '' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ name: '   ' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ name: '\n\t' }).success).toBe(false)
    })

    it('rejects unsafe ids and overlong values', () => {
      expect(audioDeviceRefSchema.safeParse({ id: 'a/b' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ id: '-leading' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ id: 'has space' }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ id: 'a'.repeat(128) }).success).toBe(true)
      expect(audioDeviceRefSchema.safeParse({ id: 'a'.repeat(129) }).success).toBe(false)
      expect(audioDeviceRefSchema.safeParse({ name: 'n'.repeat(120) }).success).toBe(true)
      expect(audioDeviceRefSchema.safeParse({ name: 'n'.repeat(121) }).success).toBe(false)
    })

    it('rejects unknown fields', () => {
      expect(
        audioDeviceRefSchema.safeParse({ id: 'abc', endpointPath: '\\\\?\\device' }).success,
      ).toBe(false)
    })
  })

  describe('AudioDeviceActionSchema', () => {
    it('accepts set and cycle with optional allRoles', () => {
      expect(AudioDeviceActionSchema.safeParse(setOutput).success).toBe(true)
      expect(
        AudioDeviceActionSchema.safeParse({ ...setOutput, allRoles: true }).success,
      ).toBe(true)
      expect(
        AudioDeviceActionSchema.safeParse({
          type: 'audioDevice',
          action: 'cycle',
          kind: 'output',
          devices: [headphones, speakers],
        }).success,
      ).toBe(true)
      expect(
        AudioDeviceActionSchema.safeParse({
          type: 'audioDevice',
          action: 'cycle',
          kind: 'input',
          devices: [usbMic, { name: 'Microphone (USB Audio)' }],
          allRoles: false,
        }).success,
      ).toBe(true)
    })

    it('rejects set without a device or with a device list', () => {
      const missing = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'set',
        kind: 'output',
      })
      expect(missing.success).toBe(false)
      expect(issuePaths(missing)).toContain('device')

      const withList = AudioDeviceActionSchema.safeParse({
        ...setOutput,
        devices: [headphones, speakers],
      })
      expect(withList.success).toBe(false)
      expect(issuePaths(withList)).toContain('devices')
    })

    it('requires a 2..8 device cycle and rejects a singular device', () => {
      const one = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        devices: [headphones],
      })
      expect(one.success).toBe(false)
      expect(issuePaths(one)).toContain('devices')

      const nine = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        devices: Array.from({ length: 9 }, (_, index) => ({ id: `device${index}` })),
      })
      expect(nine.success).toBe(false)

      const withDevice = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        device: headphones,
        devices: [headphones, speakers],
      })
      expect(withDevice.success).toBe(false)
      expect(issuePaths(withDevice)).toContain('device')

      expect(
        AudioDeviceActionSchema.safeParse({
          type: 'audioDevice',
          action: 'cycle',
          kind: 'output',
          devices: Array.from({ length: 8 }, (_, index) => ({ id: `device${index}` })),
        }).success,
      ).toBe(true)
    })

    it('rejects duplicate cycle targets by id and by normalized name', () => {
      const sameId = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        devices: [{ id: 'dupe' }, { id: 'DUPE' }],
      })
      expect(sameId.success).toBe(false)
      expect(issuePaths(sameId)).toContain('devices.1')

      const sameName = AudioDeviceActionSchema.safeParse({
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        devices: [
          { name: 'Speakers (Realtek(R) Audio)' },
          { name: '  speakers   (realtek(r) audio) ' },
        ],
      })
      expect(sameName.success).toBe(false)
      expect(issuePaths(sameName)).toContain('devices.1')
    })

    it('rejects unknown kinds, actions, fields and non-boolean allRoles', () => {
      expect(
        AudioDeviceActionSchema.safeParse({ ...setOutput, kind: 'monitor' }).success,
      ).toBe(false)
      expect(
        AudioDeviceActionSchema.safeParse({ ...setOutput, action: 'toggle' }).success,
      ).toBe(false)
      expect(
        AudioDeviceActionSchema.safeParse({ ...setOutput, endpointPath: '\\\\?\\device' }).success,
      ).toBe(false)
      expect(
        AudioDeviceActionSchema.safeParse({ ...setOutput, allRoles: 'yes' }).success,
      ).toBe(false)
    })

    it('rejects a set whose device ref is empty or blank', () => {
      expect(
        AudioDeviceActionSchema.safeParse({
          type: 'audioDevice',
          action: 'set',
          kind: 'output',
          device: {},
        }).success,
      ).toBe(false)
      expect(
        AudioDeviceActionSchema.safeParse({
          type: 'audioDevice',
          action: 'set',
          kind: 'output',
          device: { name: '   ' },
        }).success,
      ).toBe(false)
    })
  })

  describe('status bindings', () => {
    it('accepts output/input with and without a target ref', () => {
      expect(StateBindingSchema.safeParse({ type: 'audioDevice', target: 'output' }).success).toBe(
        true,
      )
      expect(StateBindingSchema.safeParse({ type: 'audioDevice', target: 'input' }).success).toBe(
        true,
      )
      expect(StateBindingSchema.safeParse(outputState).success).toBe(true)
      expect(
        AudioDeviceStateBindingSchema.safeParse({
          type: 'audioDevice',
          target: 'input',
          device: usbMic,
        }).success,
      ).toBe(true)
    })

    it('rejects unknown targets and fields', () => {
      expect(
        AudioDeviceStateBindingSchema.safeParse({ type: 'audioDevice', target: 'monitor' }).success,
      ).toBe(false)
      expect(
        AudioDeviceStateBindingSchema.safeParse({
          type: 'audioDevice',
          target: 'output',
          id: 'abc',
        }).success,
      ).toBe(false)
    })

    it('rejects an empty embedded device ref', () => {
      expect(
        AudioDeviceStateBindingSchema.safeParse({
          type: 'audioDevice',
          target: 'output',
          device: {},
        }).success,
      ).toBe(false)
    })
  })

  describe('runtime union membership', () => {
    it('ActionSchema accepts set and cycle while remaining a JSON value', () => {
      expect(ActionSchema.safeParse(setOutput).success).toBe(true)
      expect(
        ActionSchema.safeParse({
          type: 'audioDevice',
          action: 'cycle',
          kind: 'output',
          devices: [headphones, speakers],
        }).success,
      ).toBe(true)
      expect(JSON.parse(JSON.stringify(setOutput))).toEqual(setOutput)
    })

    it('a rig step can carry an audio device set or cycle action', () => {
      const rig: RigPreset = {
        id: 'rig-streaming',
        name: 'Streaming',
        steps: [
          { action: setInput as unknown as RigPreset['steps'][number]['action'] },
          {
            action: {
              type: 'audioDevice',
              action: 'cycle',
              kind: 'output',
              devices: [headphones, speakers],
            } as unknown as RigPreset['steps'][number]['action'],
          },
        ],
      }
      const config = createDefaultConfig()
      config.rigs = [rig]
      const result = validateConfig(config)
      expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
    })

    it('rig steps still refuse page navigation and nested rigs', () => {
      const config = createDefaultConfig()
      config.rigs = [
        {
          id: 'rig-bad',
          name: 'Bad',
          steps: [
            {
              action: { type: 'page', direction: 'next' } as unknown as RigPreset['steps'][number]['action'],
            },
          ],
        },
      ]
      expect(validateConfig(config).ok).toBe(false)

      config.rigs = [
        {
          id: 'rig-bad',
          name: 'Bad',
          steps: [
            {
              action: {
                type: 'rig',
                action: 'run',
                presetId: 'rig-bad',
              } as unknown as RigPreset['steps'][number]['action'],
            },
          ],
        },
      ]
      expect(validateConfig(config).ok).toBe(false)
    })
  })

  describe('config round-trip', () => {
    it('validates a v1 config with audio actions and state', () => {
      const config = configWithAudio()
      const result = validateConfig(config)
      expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
    })

    it('round-trips through parseConfig and JSON unchanged', () => {
      const config = configWithAudio()
      const parsed = parseConfig(JSON.parse(JSON.stringify(config)))
      expect(parsed).toEqual(config)

      const entry = parsed.profiles[0]!.pages[0]!.buttons[0]!
      const runtime = entry as unknown as {
        actions: unknown[]
        state: unknown
      }
      expect(runtime.actions).toEqual([setOutput, setInput])
      expect(runtime.state).toEqual(outputState)
      expect(parsed.schemaVersion).toBe(1)
    })

    it('rejects a config whose audio action is malformed', () => {
      const config = configWithAudio()
      const page = config.profiles[0]!.pages[0]!
      page.buttons[0] = button({
        actions: [{ type: 'audioDevice', action: 'set', kind: 'output' }],
      })
      expect(validateConfig(config).ok).toBe(false)
    })

    it('does not validate device ids against a host at config time', () => {
      const config = configWithAudio()
      const page = config.profiles[0]!.pages[0]!
      page.buttons[0] = button({
        actions: [
          {
            type: 'audioDevice',
            action: 'set',
            kind: 'output',
            device: { id: 'not-on-this-pc', name: 'Headphones from another PC' },
          },
        ],
      })
      expect(validateConfig(config).ok).toBe(true)
    })
  })
})

describe('audio device plan construction', () => {
  const cycleOutput = {
    type: 'audioDevice',
    action: 'cycle',
    kind: 'output',
    devices: [headphones, speakers],
    allRoles: false,
  } satisfies AudioDeviceAction

  it('maps set and cycle one-to-one, cloning refs', () => {
    const plan = actionsToPlan([setOutput, cycleOutput])
    expect(plan).toEqual<AudioDevicePlanStep[]>([
      {
        kind: 'audioDevice',
        action: 'set',
        deviceKind: 'output',
        device: headphones,
      },
      {
        kind: 'audioDevice',
        action: 'cycle',
        deviceKind: 'output',
        devices: [headphones, speakers],
        allRoles: false,
      },
    ])

    const setStep = plan[0] as Extract<AudioDevicePlanStep, { action: 'set' }>
    const cycleStep = plan[1] as Extract<AudioDevicePlanStep, { action: 'cycle' }>
    expect(setStep.device).not.toBe(headphones)
    expect(cycleStep.devices[0]).not.toBe(cycleOutput.devices[0])
    expect(cycleStep.devices[1]).not.toBe(cycleOutput.devices[1])
  })

  it('keeps allRoles and cycle order intact', () => {
    const inputSet: AudioDeviceAction = { ...setInput, allRoles: true }
    const inputCycle: AudioDeviceAction = {
      type: 'audioDevice',
      action: 'cycle',
      kind: 'input',
      devices: [usbMic, speakers],
      allRoles: true,
    }
    const plan = actionsToPlan([inputSet, inputCycle])
    expect(plan).toEqual([
      {
        kind: 'audioDevice',
        action: 'set',
        deviceKind: 'input',
        device: usbMic,
        allRoles: true,
      },
      {
        kind: 'audioDevice',
        action: 'cycle',
        deviceKind: 'input',
        devices: [usbMic, speakers],
        allRoles: true,
      },
    ])
    expect(actionsToPlan([setOutput])).toHaveLength(1)
  })

  it('describes set and cycle without leaking a full name', () => {
    expect(describeAction(setOutput)).toBe('Set output to "Headphones (HyperX Cloud II)"')
    expect(describeAction(setInput)).toBe('Set input to "Shure MV7"')
    expect(describeAction(cycleOutput)).toBe('Cycle output devices (2)')
    expect(
      describeAction({ type: 'audioDevice', action: 'set', kind: 'input', device: { id: 'abc123' } }),
    ).toBe('Set input to "abc123"')

    const longName = 'Headphones (HyperX Cloud II Wireless Gaming Headset with Boom Mic)'
    const described = describeAction({
      type: 'audioDevice',
      action: 'set',
      kind: 'output',
      device: { name: longName },
    })
    expect(described.length).toBeLessThanOrEqual('Set output to ""'.length + 40)
    expect(described.endsWith('…"')).toBe(true)
    expect(described).not.toContain(longName)
  })

  it('estimates an audio-device rig step as a short action', () => {
    const rig: RigPreset = {
      id: 'rig-audio',
      name: 'Audio',
      steps: [
        { action: setOutput as unknown as RigPreset['steps'][number]['action'] },
        { action: cycleOutput as unknown as RigPreset['steps'][number]['action'] },
      ],
    }
    const estimate = estimateRigMs(rig)
    expect(estimate).toBeGreaterThan(0)
    expect(estimate).toBeLessThan(300)

    const withDelay: RigPreset = {
      ...rig,
      steps: [{ ...rig.steps[0]!, delayMs: 1_000 }],
    }
    expect(estimateRigMs(withDelay)).toBeGreaterThan(estimate)
  })
})

describe('audio device protocol', () => {
  const validState = {
    type: 'audioDevicesState' as const,
    available: true,
    output: [
      {
        id: 'a1b2c3d4e5f6',
        name: 'Headphones (HyperX Cloud II)',
        deviceKind: 'output' as const,
        form: 'headphones' as const,
        current: true,
        available: true,
        detail: 'DEFAULT',
      },
    ],
    input: [
      {
        id: '9f8e7d6c5b4a',
        name: 'Shure MV7',
        deviceKind: 'input' as const,
        current: false,
        available: true,
      },
    ],
    currentOutputId: 'a1b2c3d4e5f6',
    currentInputId: '9f8e7d6c5b4a',
    updatedAt: 1_700_000_000_000,
  }

  it('accepts subscribe/refresh and set messages through parseClientMessage', () => {
    const start = parseClientMessage({ type: 'audioDevices', phase: 'start' })
    const stop = parseClientMessage({ type: 'audioDevices', phase: 'stop' })
    const set = parseClientMessage({
      type: 'audioDeviceSet',
      requestId: 'req-1',
      deviceKind: 'output',
      deviceId: 'a1b2c3d4e5f6',
    })
    expect(start.ok).toBe(true)
    expect(stop.ok).toBe(true)
    expect(set.ok).toBe(true)
    if (start.ok && stop.ok && set.ok) {
      expect(isAudioDevicesMessage(start.message)).toBe(true)
      expect(isAudioDevicesMessage(set.message)).toBe(false)
      expect(isAudioDeviceSetMessage(set.message)).toBe(true)
      expect(set.message).toMatchObject({ deviceKind: 'output', deviceId: 'a1b2c3d4e5f6' })
    }
  })

  it('rejects unknown phases, kinds, missing ids and unsafe/overlong ids', () => {
    expect(AudioDevicesMessageSchema.safeParse({ type: 'audioDevices', phase: 'pause' }).success).toBe(
      false,
    )
    expect(
      AudioDeviceSetMessageSchema.safeParse({
        type: 'audioDeviceSet',
        requestId: 'r1',
        deviceKind: 'monitor',
        deviceId: 'abc',
      }).success,
    ).toBe(false)
    expect(
      AudioDeviceSetMessageSchema.safeParse({
        type: 'audioDeviceSet',
        requestId: 'r1',
        deviceKind: 'output',
      }).success,
    ).toBe(false)
    expect(
      AudioDeviceSetMessageSchema.safeParse({
        type: 'audioDeviceSet',
        requestId: 'r1',
        deviceKind: 'output',
        deviceId: '',
      }).success,
    ).toBe(false)
    expect(
      AudioDeviceSetMessageSchema.safeParse({
        type: 'audioDeviceSet',
        requestId: 'r1',
        deviceKind: 'output',
        deviceId: 'a'.repeat(65),
      }).success,
    ).toBe(false)
    expect(
      AudioDeviceSetMessageSchema.safeParse({
        type: 'audioDeviceSet',
        requestId: 'r1',
        deviceKind: 'output',
        deviceId: 'C:\\Windows\\endpoint',
      }).success,
    ).toBe(false)
    expect(
      parseClientMessage({
        type: 'audioDeviceSet',
        requestId: '',
        deviceKind: 'output',
        deviceId: 'abc',
      }).ok,
    ).toBe(false)
  })

  it('accepts a valid snapshot with output/input entries and current ids', () => {
    const parsed = AudioDevicesStateMessageSchema.safeParse(validState)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.output[0]).toMatchObject({
        id: 'a1b2c3d4e5f6',
        current: true,
        available: true,
        form: 'headphones',
        detail: 'DEFAULT',
      })
      expect(parsed.data.input[0]?.deviceKind).toBe('input')
    }
    expect(
      AudioDevicesStateMessageSchema.safeParse({
        type: 'audioDevicesState',
        available: false,
        reason: 'pactl not found',
        output: [],
        input: [],
        updatedAt: 0,
      }).success,
    ).toBe(true)
  })

  it('rejects malformed entries and caps each kind at 64 devices', () => {
    const entry = validState.output[0]!
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, id: '' }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, id: 'a'.repeat(65) }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, name: '' }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, name: '   ' }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, name: 'n'.repeat(121) }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, name: 'bad\nname' }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, form: 'toaster' }).success).toBe(false)
    expect(AudioDeviceEntrySchema.safeParse({ ...entry, current: 'yes' }).success).toBe(false)

    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      ...entry,
      id: `device${index}`,
    }))
    expect(
      AudioDevicesStateMessageSchema.safeParse({
        ...validState,
        output: tooMany,
      }).success,
    ).toBe(false)
    expect(
      AudioDevicesStateMessageSchema.safeParse({
        ...validState,
        input: tooMany,
      }).success,
    ).toBe(false)
    expect(
      AudioDevicesStateMessageSchema.safeParse({
        ...validState,
        output: Array.from({ length: 64 }, (_, index) => ({ ...entry, id: `device${index}` })),
      }).success,
    ).toBe(true)
  })

  it('accepts a result acknowledgement and rejects overlong errors', () => {
    expect(
      AudioDeviceResultMessageSchema.safeParse({
        type: 'audioDeviceResult',
        requestId: 'r1',
        ok: true,
        currentId: 'a1b2c3d4e5f6',
      }).success,
    ).toBe(true)
    expect(
      AudioDeviceResultMessageSchema.safeParse({
        type: 'audioDeviceResult',
        requestId: 'r1',
        ok: false,
        error: 'Device not found: HyperX',
      }).success,
    ).toBe(true)
    expect(
      AudioDeviceResultMessageSchema.safeParse({
        type: 'audioDeviceResult',
        requestId: 'r1',
        ok: false,
        error: 'e'.repeat(301),
      }).success,
    ).toBe(false)
  })

  it('keeps parsing configs that do not use audio devices', () => {
    const config = createDefaultConfig()
    const parsed = parseConfig(JSON.parse(JSON.stringify(config)))
    expect(parsed).toEqual(config)
    expect(
      parsed.profiles[0]!.pages[0]!.buttons.every(
        (item) => !item.actions.some((action) => action.type === 'audioDevice'),
      ),
    ).toBe(true)
  })
})
