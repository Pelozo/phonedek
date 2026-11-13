import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlStateMessage, DeckConfig } from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import {
  ControlStateService,
  isAbsoluteVolumeControl,
  isMicGainControl,
  isObsVolumeControl,
  resolveAbsoluteVolumeControls,
  resolveStateControls,
} from '../src/main/control-state'
import type { MicReader, MicReading } from '../src/main/microphone-source'
import type { ObsStateTarget } from '@phonedek/shared'
import type {
  ObsInputReading,
  ObsStateReader,
  ObsStatusOptions,
  ObsStatusReading,
} from '../src/main/obs-source'
import {
  CachedVolumeReader,
  parseMacVolumeOutput,
  parsePactlMuteOutput,
  parsePactlVolumeOutput,
  parseWindowsVolumePayload,
  type VolumeReader,
  type VolumeReading,
} from '../src/main/volume-source'

class FakeReader implements VolumeReader {
  level = 42
  muted: boolean | undefined
  failure: Error | null = null
  reads = 0
  invalidations = 0

  async read(): Promise<VolumeReading> {
    this.reads += 1
    if (this.failure) throw this.failure
    return { level: this.level, ...(this.muted === undefined ? {} : { muted: this.muted }) }
  }

  invalidate(): void {
    this.invalidations += 1
  }

  setKnown(reading: VolumeReading): void {
    this.level = Math.round(reading.level)
    this.muted = reading.muted
  }
}

class FakeMicReader implements MicReader {
  level = 55
  muted = false
  failure: Error | null = null
  reads = 0
  invalidations = 0

  async read(): Promise<MicReading> {
    this.reads += 1
    if (this.failure) throw this.failure
    return { level: this.level, muted: this.muted }
  }

  invalidate(): void {
    this.invalidations += 1
  }

  setKnown(reading: MicReading): void {
    this.level = Math.round(reading.level)
    this.muted = reading.muted ?? false
  }
}

interface Fixture {
  config: DeckConfig
  profileId: string
  pageId: string
  controlId: string
}

function fixture(): Fixture {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const button = page.buttons.find((item) => item.id === 'btn-vol-down')!
  button.control = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'volume', mode: 'absolute' },
  }
  return { config, profileId: profile.id, pageId: page.id, controlId: button.id }
}

const services: ControlStateService[] = []

function service(reader: VolumeReader): ControlStateService {
  const created = new ControlStateService({ reader })
  services.push(created)
  return created
}

afterEach(() => {
  for (const created of services.splice(0)) created.dispose()
  vi.useRealTimers()
})

describe('absolute volume controls', () => {
  it('selects only value-bearing absolute volume sliders and dials', () => {
    const { config, profileId, pageId, controlId } = fixture()
    const page = config.profiles[0]!.pages[0]!
    const relative = page.buttons.find((item) => item.id === 'btn-vol-up')!
    relative.control = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'volume', mode: 'relative' },
    }
    const pad = page.buttons.find((item) => item.id === 'btn-mute')!
    pad.control = { kind: 'trackpad', emit: 'delta', binding: { type: 'pointer' } }

    expect(isAbsoluteVolumeControl(page.buttons.find((item) => item.id === controlId)!)).toBe(true)
    expect(isAbsoluteVolumeControl(relative)).toBe(false)
    expect(isAbsoluteVolumeControl(pad)).toBe(false)

    expect(resolveAbsoluteVolumeControls(config, profileId, pageId)).toEqual([
      { id: controlId, label: 'Volume down' },
    ])
    expect(resolveAbsoluteVolumeControls(config, profileId, pageId, [controlId, 'nope'])).toEqual([
      { id: controlId, label: 'Volume down' },
    ])
    expect(resolveAbsoluteVolumeControls(config, profileId, pageId, ['nope'])).toEqual([])
    expect(resolveAbsoluteVolumeControls(config, 'missing', pageId)).toBeNull()
  })
})

describe('platform readers', () => {
  it('parses macOS volume and mute output', () => {
    expect(parseMacVolumeOutput('42,false\n')).toEqual({ level: 42, muted: false })
    expect(parseMacVolumeOutput(' 0, true ')).toEqual({ level: 0, muted: true })
    expect(parseMacVolumeOutput('100')).toEqual({ level: 100 })
    expect(() => parseMacVolumeOutput('loud')).toThrow(/parse macOS/)
  })

  it('parses pactl multi-channel volume and mute output', () => {
    const sample =
      'Volume: front-left: 27525 /  42% / -2.31 dB,   front-right: 27525 /  42% / -2.31 dB\n' +
      '        balance 0.00\n'
    expect(parsePactlVolumeOutput(sample)).toEqual({ level: 42 })
    expect(parsePactlVolumeOutput('Volume: mono: 65536 / 100% / 0.00 dB')).toEqual({ level: 100 })
    expect(() => parsePactlVolumeOutput('Volume: front-left: no percent')).toThrow(/parse pactl/)
    expect(parsePactlMuteOutput('Mute: yes')).toBe(true)
    expect(parsePactlMuteOutput('Mute: no')).toBe(false)
  })

  it('converts the Windows helper scalar and clamps it', () => {
    expect(parseWindowsVolumePayload({ value: 0.42, muted: false })).toEqual({
      level: 42,
      muted: false,
    })
    expect(parseWindowsVolumePayload({ value: 4 })).toEqual({ level: 100 })
    expect(parseWindowsVolumePayload({ value: -1 })).toEqual({ level: 0 })
    expect(() => parseWindowsVolumePayload({})).toThrow(/no level/)
  })
})

describe('CachedVolumeReader', () => {
  it('caches for the TTL, single-flights, invalidates and accepts a known write', async () => {
    let now = 1000
    let reads = 0
    const reader = new CachedVolumeReader(
      async () => {
        reads += 1
        return { level: 20 }
      },
      { ttlMs: 900, now: () => now },
    )

    await expect(reader.read()).resolves.toEqual({ level: 20 })
    await expect(reader.read()).resolves.toEqual({ level: 20 })
    expect(reads).toBe(1)

    now += 899
    await reader.read()
    expect(reads).toBe(1)

    now += 2
    await reader.read()
    expect(reads).toBe(2)

    reader.invalidate()
    await reader.read()
    expect(reads).toBe(3)

    reader.setKnown({ level: 70 })
    await expect(reader.read()).resolves.toEqual({ level: 70 })
    expect(reads).toBe(3)
  })

  it('shares one in-flight read between concurrent callers', async () => {
    let reads = 0
    let release: ((reading: VolumeReading) => void) | null = null
    const reader = new CachedVolumeReader(
      () => {
        reads += 1
        return new Promise<VolumeReading>((resolve) => {
          release = resolve
        })
      },
      { ttlMs: 0 },
    )

    const first = reader.read()
    const second = reader.read()
    expect(reads).toBe(1)
    release!({ level: 33 })
    await expect(first).resolves.toEqual({ level: 33 })
    await expect(second).resolves.toEqual({ level: 33 })
    expect(reads).toBe(1)
  })
})

describe('ControlStateService', () => {
  it('sends an immediate snapshot on subscribe', async () => {
    const { profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(reader.reads).toBe(1)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'controlState',
      profileId,
      pageId,
      states: [
        { controlId, revision: 1, value: 0.42, available: true, detail: '42%' },
      ],
    })
  })

  it('sends changes only and increments the per-control revision', async () => {
    vi.useFakeTimers()
    const { profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(messages).toHaveLength(1)

    reader.level = 55
    await vi.advanceTimersByTimeAsync(1000)
    expect(messages).toHaveLength(2)
    expect(messages[1]!.states[0]).toMatchObject({
      controlId,
      revision: 2,
      value: 0.55,
      detail: '55%',
    })
  })

  it('clamps the interval to a 500 ms floor and stops polling on unsubscribe', async () => {
    vi.useFakeTimers()
    const { profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 10,
      send: () => undefined,
    })
    expect(reader.reads).toBe(1)

    await vi.advanceTimersByTimeAsync(499)
    expect(reader.reads).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reader.reads).toBe(2)

    state.unsubscribe('client-1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(reader.reads).toBe(2)
  })

  it('marks a control unavailable when the reader fails', async () => {
    const { profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    reader.failure = new Error('No default audio device')
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      controlId,
      revision: 1,
      available: false,
      detail: 'No default audio device',
    })
    expect(messages[0]!.states[0]!.value).toBeUndefined()
  })

  it('sends an empty snapshot for a page without absolute volume controls', async () => {
    const { profileId, pageId } = fixture()
    const reader = new FakeReader()
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages).toEqual([
      { type: 'controlState', profileId, pageId, states: [] },
    ])
    expect(reader.reads).toBe(0)
  })

  it('keeps one subscription per client and replaces it last-wins', async () => {
    const { config, profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    const state = service(reader)
    const secondPage = config.profiles[0]!.pages[1]!

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 1000,
      send: () => undefined,
    })
    await state.subscribe('client-1', {
      profileId,
      pageId: secondPage.id,
      controlIds: [],
      intervalMs: 1000,
      send: () => undefined,
    })

    expect(state.subscriptionCount).toBe(1)
  })

  it('invalidates the cache and pushes a fresh snapshot after a phone write', async () => {
    const { profileId, pageId, controlId } = fixture()
    const reader = new FakeReader()
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages).toHaveLength(1)

    reader.level = 70
    await state.noteVolumeWritten(70)
    expect(reader.invalidations).toBe(1)
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId,
      value: 0.7,
      available: true,
      detail: '70%',
    })
  })
})

describe('microphone control state', () => {
  function micFixture(): {
    config: DeckConfig
    profileId: string
    pageId: string
    micId: string
    volumeId: string
  } {
    const config = createDefaultConfig()
    const profile = config.profiles[0]!
    const page = profile.pages[0]!
    const volume = page.buttons.find((item) => item.id === 'btn-vol-down')!
    volume.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
    }
    const mic = page.buttons.find((item) => item.id === 'btn-mute')!
    mic.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'mic', mode: 'gain' },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
    }
    return {
      config,
      profileId: profile.id,
      pageId: page.id,
      micId: mic.id,
      volumeId: volume.id,
    }
  }

  it('selects mic gain controls alongside absolute volume', () => {
    const { config, profileId, pageId, micId, volumeId } = micFixture()
    const page = config.profiles[0]!.pages[0]!
    const pad = page.buttons.find((item) => item.id === 'btn-copy')!
    pad.control = { kind: 'trackpad', emit: 'delta', binding: { type: 'pointer' } }

    expect(isMicGainControl(page.buttons.find((item) => item.id === micId)!)).toBe(true)
    expect(isMicGainControl(page.buttons.find((item) => item.id === volumeId)!)).toBe(false)
    expect(resolveStateControls(config, profileId, pageId)).toEqual([
      { id: volumeId, label: 'Volume down', source: 'volume' },
      { id: micId, label: 'Mute', source: 'mic' },
    ])
    expect(resolveStateControls(config, profileId, pageId, [micId, 'nope'])).toEqual([
      { id: micId, label: 'Mute', source: 'mic' },
    ])
    expect(resolveAbsoluteVolumeControls(config, profileId, pageId)).toEqual([
      { id: volumeId, label: 'Volume down' },
    ])
  })

  it('emits volume and mic entries from one batched snapshot', async () => {
    const { profileId, pageId, micId, volumeId } = micFixture()
    const volume = new FakeReader()
    const mic = new FakeMicReader()
    const messages: ControlStateMessage[] = []
    const state = serviceWithMic(volume, mic)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId, micId],
      controls: [
        { id: volumeId, label: '', source: 'volume' },
        { id: micId, label: '', source: 'mic' },
      ],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(volume.reads).toBe(1)
    expect(mic.reads).toBe(1)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.states).toEqual([
      { controlId: volumeId, revision: 1, value: 0.42, available: true, detail: '42%' },
      { controlId: micId, revision: 1, value: 0.55, muted: false, available: true, detail: '55%' },
    ])
  })

  it('shows MUTED and keeps the raw gain in value', async () => {
    const { profileId, pageId, micId } = micFixture()
    const volume = new FakeReader()
    const mic = new FakeMicReader()
    mic.level = 40
    mic.muted = true
    const messages: ControlStateMessage[] = []
    const state = serviceWithMic(volume, mic)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'mic' }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(volume.reads).toBe(0)
    expect(messages[0]!.states[0]).toMatchObject({
      controlId: micId,
      value: 0.4,
      muted: true,
      available: true,
      detail: 'MUTED',
    })
  })

  it('marks mic state unavailable when no capture reader exists', async () => {
    const { profileId, pageId, micId } = micFixture()
    const messages: ControlStateMessage[] = []
    const state = service(new FakeReader())

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'mic' }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      controlId: micId,
      available: false,
      detail: 'Microphone state is not available on this desktop.',
    })
  })

  it('invalidates the mic cache and pushes a fresh snapshot after writes', async () => {
    const { profileId, pageId, micId } = micFixture()
    const volume = new FakeReader()
    const mic = new FakeMicReader()
    const messages: ControlStateMessage[] = []
    const state = serviceWithMic(volume, mic)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'mic' }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    await state.noteMicWritten(70, false)
    expect(mic.invalidations).toBe(1)
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      value: 0.7,
      muted: false,
      available: true,
      detail: '70%',
    })

    mic.level = 0
    mic.muted = true
    await state.noteMicChanged()
    expect(mic.invalidations).toBe(2)
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      value: 0,
      muted: true,
      available: true,
      detail: 'MUTED',
    })
  })
})

function serviceWithMic(reader: VolumeReader, micReader: MicReader): ControlStateService {
  const created = new ControlStateService({ reader, micReader })
  services.push(created)
  return created
}

class FakeObsReader implements ObsStateReader {
  defaultReading: ObsInputReading = { level: 100, muted: false }
  readings = new Map<string, ObsInputReading>()
  failure: Error | null = null
  reads: Array<string | undefined> = []
  invalidations: Array<string | undefined> = []
  known: Array<{ input: string | undefined; reading: ObsInputReading }> = []

  async read(input?: string): Promise<ObsInputReading> {
    this.reads.push(input)
    if (this.failure) throw this.failure
    const reading = this.readings.get(input ?? '') ?? this.defaultReading
    return { ...reading }
  }

  invalidate(input?: string): void {
    this.invalidations.push(input)
  }

  setKnown(input: string | undefined, reading: ObsInputReading): void {
    this.known.push({ input, reading })
  }

  async listInputs(): Promise<Array<{ name: string; kind: string; audio: boolean }>> {
    return []
  }

  async readStatus(
    _target: ObsStateTarget,
    _options?: ObsStatusOptions,
  ): Promise<ObsStatusReading> {
    return { active: false, detail: 'OFF' }
  }

  invalidateStatus(_target?: ObsStateTarget): void {
    // no cache in the fake
  }

  async setVolume(): Promise<string> {
    return ''
  }

  async toggleMute(): Promise<{ input: string; muted: boolean }> {
    return { input: 'Mic/Aux', muted: true }
  }
}

describe('OBS control state', () => {
  function obsFixture(): {
    config: DeckConfig
    profileId: string
    pageId: string
    micId: string
    gameId: string
  } {
    const config = createDefaultConfig()
    const profile = config.profiles[0]!
    const page = profile.pages[0]!
    const mic = page.buttons.find((item) => item.id === 'btn-mute')!
    mic.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
      min: 0,
      max: 200,
      step: 1,
      initial: 100,
      unit: '%',
    }
    const game = page.buttons.find((item) => item.id === 'btn-copy')!
    game.control = {
      kind: 'dial',
      emit: 'value',
      binding: { type: 'obs', target: 'inputVolume', input: 'Game' },
      min: 0,
      max: 200,
      step: 1,
      initial: 100,
      unit: '%',
    }
    return { config, profileId: profile.id, pageId: page.id, micId: mic.id, gameId: game.id }
  }

  function serviceWithObs(obsReader: ObsStateReader): ControlStateService {
    const created = new ControlStateService({ obsReader })
    services.push(created)
    return created
  }

  it('selects OBS controls with their input and display max', () => {
    const { config, profileId, pageId, micId, gameId } = obsFixture()
    expect(isObsVolumeControl(config.profiles[0]!.pages[0]!.buttons.find((item) => item.id === micId)!)).toBe(true)
    expect(resolveStateControls(config, profileId, pageId)).toEqual([
      { id: micId, label: 'Mute', source: 'obs', input: 'Mic/Aux', max: 200 },
      {
        id: gameId,
        label: 'Copy',
        source: 'obs',
        input: 'Game',
        max: 200,
      },
    ])
    expect(resolveAbsoluteVolumeControls(config, profileId, pageId)).toEqual([])
  })

  it('reads each distinct OBS input once and shares it between controls', async () => {
    const { config, profileId, pageId, micId, gameId } = obsFixture()
    const page = config.profiles[0]!.pages[0]!
    const other = page.buttons.find((item) => item.id === 'btn-vol-down')!
    other.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
      max: 200,
    }
    const obs = new FakeObsReader()
    obs.readings.set('Mic/Aux', { level: 150, muted: true })
    obs.readings.set('Game', { level: 50, muted: false })
    const messages: ControlStateMessage[] = []
    const state = serviceWithObs(obs)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId, other.id, gameId],
      controls: [
        { id: micId, label: '', source: 'obs', input: 'Mic/Aux', max: 200 },
        { id: other.id, label: '', source: 'obs', input: 'Mic/Aux', max: 200 },
        { id: gameId, label: '', source: 'obs', input: 'Game', max: 200 },
      ],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(obs.reads).toEqual(['Mic/Aux', 'Game'])
    expect(messages).toHaveLength(1)
    expect(messages[0]!.states).toEqual([
      { controlId: micId, revision: 1, value: 0.75, muted: true, available: true, detail: 'MUTED' },
      { controlId: other.id, revision: 1, value: 0.75, muted: true, available: true, detail: 'MUTED' },
      { controlId: gameId, revision: 1, value: 0.25, muted: false, available: true, detail: '50%' },
    ])
  })

  it('reports NO OBS and NO INPUT with a new revision when the reason changes', async () => {
    const { profileId, pageId, micId } = obsFixture()
    const obs = new FakeObsReader()
    obs.failure = new Error('OBS is not connected.')
    const messages: ControlStateMessage[] = []
    const state = serviceWithObs(obs)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'obs', input: 'Mic/Aux', max: 200 }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      revision: 1,
      available: false,
      detail: 'NO OBS',
    })

    obs.failure = new Error('OBS input "Mic/Aux" was not found')
    await state.noteObsChanged('Mic/Aux')
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      revision: 2,
      available: false,
      detail: 'NO INPUT',
    })

    obs.failure = null
    obs.defaultReading = { level: 100, muted: false }
    await state.noteObsChanged('Mic/Aux')
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      revision: 3,
      value: 0.5,
      available: true,
      detail: '100%',
    })
  })

  it('invalidates the OBS cache and fans out after a phone write', async () => {
    const { profileId, pageId, micId } = obsFixture()
    const obs = new FakeObsReader()
    obs.defaultReading = { level: 20, muted: false }
    const messages: ControlStateMessage[] = []
    const state = serviceWithObs(obs)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'obs', input: 'Mic/Aux', max: 200 }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    obs.defaultReading = { level: 150, muted: false }
    await state.noteObsWritten('Mic/Aux', 150)
    expect(obs.invalidations).toEqual(['Mic/Aux'])
    expect(obs.known).toEqual([{ input: 'Mic/Aux', reading: { level: 150, muted: false } }])
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      value: 0.75,
      available: true,
      detail: '150%',
    })

    obs.defaultReading = { level: 150, muted: true }
    await state.noteObsChanged('Mic/Aux')
    expect(obs.invalidations).toEqual(['Mic/Aux'])
    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: micId,
      value: 0.75,
      muted: true,
      detail: 'MUTED',
    })
  })

  it('marks OBS unavailable when no OBS reader exists', async () => {
    const { profileId, pageId, micId } = obsFixture()
    const messages: ControlStateMessage[] = []
    const state = serviceWithObs(new FakeObsReader())
    // Replace the reader with nothing by constructing a service with only volume.
    // The service still marks the OBS control unavailable.
    state.dispose()
    const plain = service(new FakeReader())
    await plain.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [micId],
      controls: [{ id: micId, label: '', source: 'obs', input: 'Mic/Aux', max: 200 }],
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages[0]!.states[0]).toMatchObject({
      controlId: micId,
      available: false,
      detail: 'NO OBS',
    })
  })
})
