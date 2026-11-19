import { afterEach, describe, expect, it } from 'vitest'
import type {
  AudioDeviceKind,
  AudioDeviceRef,
  ControlStateMessage,
  DeckButton,
  DeckConfig,
} from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import {
  ControlStateService,
  audioDeviceBindingOf,
  audioDeviceMatchesRef,
  isAudioDeviceStateButton,
  resolveStateControls,
  shortAudioDeviceDetail,
  type AudioDeviceStateReader,
} from '../src/main/control-state'
import type { AudioDeviceEntry } from '../src/main/audio-device-source'

const OUTPUT_ID = 'a1b2c3d4e5f6'
const INPUT_ID = '9f8e7d6c5b4a'
const OTHER_ID = '0a1b2c3d4e5f'

class FakeAudioDeviceReader implements AudioDeviceStateReader {
  output: AudioDeviceEntry | null = {
    id: OUTPUT_ID,
    name: 'Headphones (HyperX Cloud II)',
    deviceKind: 'output',
    form: 'headphones',
    current: true,
    available: true,
  }
  input: AudioDeviceEntry | null = {
    id: INPUT_ID,
    name: 'Shure MV7',
    deviceKind: 'input',
    form: 'usb',
    current: true,
    available: true,
  }
  failure: Error | null = null
  reads: AudioDeviceKind[] = []
  invalidations: Array<AudioDeviceKind | undefined> = []

  async current(kind: AudioDeviceKind): Promise<AudioDeviceEntry> {
    this.reads.push(kind)
    if (this.failure) throw this.failure
    const entry = kind === 'output' ? this.output : this.input
    if (!entry) throw new Error('No current audio device')
    return { ...entry }
  }

  invalidate(kind?: AudioDeviceKind): void {
    this.invalidations.push(kind)
  }
}

interface Fixture {
  config: DeckConfig
  profileId: string
  pageId: string
  headsetId: string
  genericInputId: string
  spareId: string
}

function setAudioState(
  button: DeckButton,
  target: AudioDeviceKind,
  device?: AudioDeviceRef,
): void {
  button.actions = []
  delete button.control
  button.state = {
    type: 'audioDevice',
    target,
    ...(device ? { device } : {}),
  } as unknown as DeckButton['state']
}

function fixture(): Fixture {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const headset = page.buttons[0]!
  const generic = page.buttons[1]!
  const spare = page.buttons[2]!
  setAudioState(headset, 'output', { id: OUTPUT_ID, name: 'Headphones (HyperX Cloud II)' })
  setAudioState(generic, 'input')
  setAudioState(spare, 'output', { id: OTHER_ID, name: 'Speakers (Realtek(R) Audio)' })
  return {
    config,
    profileId: profile.id,
    pageId: page.id,
    headsetId: headset.id,
    genericInputId: generic.id,
    spareId: spare.id,
  }
}

const services: ControlStateService[] = []

function createService(reader?: AudioDeviceStateReader): ControlStateService {
  const service = new ControlStateService({
    ...(reader ? { audioReader: reader } : {}),
  })
  services.push(service)
  return service
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

describe('audio device state resolution', () => {
  it('resolves target and optional ref structurally', () => {
    const { config } = fixture()
    const page = config.profiles[0]!.pages[0]!
    expect(audioDeviceBindingOf(page.buttons[0]!)).toEqual({
      target: 'output',
      device: { id: OUTPUT_ID, name: 'Headphones (HyperX Cloud II)' },
    })
    expect(audioDeviceBindingOf(page.buttons[1]!)).toEqual({ target: 'input' })
    expect(isAudioDeviceStateButton(page.buttons[0]!)).toBe(true)
    expect(isAudioDeviceStateButton(page.buttons[3]!)).toBe(false)
  })

  it('maps tiles to the audioDevice source and honors requested ids', () => {
    const { config, profileId, pageId, headsetId, genericInputId } = fixture()
    const controls = resolveStateControls(config, profileId, pageId, [headsetId, genericInputId])
    expect(controls).toEqual([
      {
        id: headsetId,
        label: expect.any(String),
        source: 'audioDevice',
        audioDeviceKind: 'output',
        audioDeviceTarget: { id: OUTPUT_ID, name: 'Headphones (HyperX Cloud II)' },
      },
      {
        id: genericInputId,
        label: expect.any(String),
        source: 'audioDevice',
        audioDeviceKind: 'input',
      },
    ])
  })
})

describe('audio device control state', () => {
  async function subscribe(
    service: ControlStateService,
    fixtureValue: Fixture,
    messages: ControlStateMessage[],
    ids = [fixtureValue.headsetId, fixtureValue.genericInputId, fixtureValue.spareId],
  ): Promise<void> {
    const controls = resolveStateControls(
      fixtureValue.config,
      fixtureValue.profileId,
      fixtureValue.pageId,
      ids,
    )!
    await service.subscribe('client-1', {
      profileId: fixtureValue.profileId,
      pageId: fixtureValue.pageId,
      controlIds: ids,
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
  }

  it('reports the current name, target-bound active and a neutral generic tile', async () => {
    const fixtureValue = fixture()
    const reader = new FakeAudioDeviceReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    await subscribe(service, fixtureValue, messages)

    const states = messages.at(-1)!.states
    const headset = states.find((state) => state.controlId === fixtureValue.headsetId)!
    expect(headset).toMatchObject({
      available: true,
      active: true,
      detail: 'Headphones (HyperX Cloud II)',
      revision: 1,
    })
    const generic = states.find((state) => state.controlId === fixtureValue.genericInputId)!
    expect(generic).toMatchObject({
      available: true,
      active: false,
      detail: 'Shure MV7',
      revision: 1,
    })
    const spare = states.find((state) => state.controlId === fixtureValue.spareId)!
    expect(spare).toMatchObject({ available: true, active: false, detail: 'Headphones (HyperX Cloud II)' })
  })

  it('matches a stale id by normalized friendly name', () => {
    const entry = {
      id: OUTPUT_ID,
      name: 'Headphones (HyperX Cloud II)',
      deviceKind: 'output' as const,
      current: true,
      available: true,
    }
    expect(audioDeviceMatchesRef({ id: OTHER_ID, name: ' hyperx  CLOUD II ' }, entry)).toBe(false)
    expect(
      audioDeviceMatchesRef(
        { id: OTHER_ID, name: '  headphones (hyperx cloud ii) ' },
        entry,
      ),
    ).toBe(true)
    expect(audioDeviceMatchesRef({ id: OUTPUT_ID }, entry)).toBe(true)
    expect(audioDeviceMatchesRef({ name: 'Speakers' }, entry)).toBe(false)
  })

  it('shares one current read per direction across tiles', async () => {
    const fixtureValue = fixture()
    // Add a second output tile bound to the same kind.
    const page = fixtureValue.config.profiles[0]!.pages[0]!
    const duplicate = page.buttons[3]!
    setAudioState(duplicate, 'output', { id: OUTPUT_ID })
    const reader = new FakeAudioDeviceReader()
    const service = createService(reader)
    await subscribe(service, fixtureValue, [], [
      fixtureValue.headsetId,
      fixtureValue.spareId,
      duplicate.id,
      fixtureValue.genericInputId,
    ])

    expect(reader.reads.sort()).toEqual(['input', 'output'])
  })

  it('pushes the new current device after noteAudioDeviceChanged', async () => {
    const fixtureValue = fixture()
    const reader = new FakeAudioDeviceReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    await subscribe(service, fixtureValue, messages)

    reader.output = {
      id: OTHER_ID,
      name: 'Speakers (Realtek(R) Audio)',
      deviceKind: 'output',
      form: 'speakers',
      current: true,
      available: true,
    }
    await service.noteAudioDeviceChanged('output')

    expect(reader.invalidations).toEqual(['output'])
    const latest = messages.at(-1)!.states
    const headset = latest.find((state) => state.controlId === fixtureValue.headsetId)!
    expect(headset).toMatchObject({
      available: true,
      active: false,
      detail: 'Speakers (Realtek(R) Audio)',
      revision: 2,
    })
    const spare = latest.find((state) => state.controlId === fixtureValue.spareId)!
    expect(spare).toMatchObject({ active: true, revision: 2 })
  })

  it('reports NO DEVICE and NO AUDIO quietly', async () => {
    const fixtureValue = fixture()
    const reader = new FakeAudioDeviceReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    await subscribe(service, fixtureValue, messages, [fixtureValue.headsetId])

    reader.failure = new Error('Device not found: Speakers (Realtek)')
    await service.noteAudioDeviceChanged('output')
    expect(messages.at(-1)!.states[0]).toMatchObject({ available: false, detail: 'NO DEVICE' })

    reader.failure = new Error('Audio device helper is not running')
    await service.noteAudioDeviceChanged('output')
    expect(messages.at(-1)!.states[0]).toMatchObject({ available: false, detail: 'NO AUDIO' })
  })

  it('reports NO AUDIO when the host has no controller', async () => {
    const fixtureValue = fixture()
    const service = createService()
    const messages: ControlStateMessage[] = []
    await subscribe(service, fixtureValue, messages, [fixtureValue.headsetId])
    expect(messages.at(-1)!.states[0]).toMatchObject({
      available: false,
      detail: 'NO AUDIO',
    })
  })

  it('clamps the detail to 60 characters', () => {
    expect(shortAudioDeviceDetail('x'.repeat(120))).toHaveLength(60)
    expect(shortAudioDeviceDetail('  Headphones\n Cloud  ')).toBe('Headphones Cloud')
  })

  it('does not bump revisions when the current device is unchanged', async () => {
    const fixtureValue = fixture()
    const reader = new FakeAudioDeviceReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    await subscribe(service, fixtureValue, messages, [fixtureValue.headsetId])

    await service.noteAudioDeviceChanged('output')
    const relevant = messages.filter((message) =>
      message.states.some((state) => state.controlId === fixtureValue.headsetId),
    )
    expect(relevant).toHaveLength(1)
  })
})
