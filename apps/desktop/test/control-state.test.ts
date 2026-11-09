import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlStateMessage, DeckConfig } from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import {
  ControlStateService,
  isAbsoluteVolumeControl,
  resolveAbsoluteVolumeControls,
} from '../src/main/control-state'
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
