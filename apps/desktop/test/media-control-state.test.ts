import { afterEach, describe, expect, it } from 'vitest'
import type { ControlStateMessage, DeckConfig } from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import {
  ControlStateService,
  isMediaControl,
  resolveStateControls,
} from '../src/main/control-state'
import type { MediaReader, MediaReading } from '../src/main/media-source'
class FakeMediaReader implements MediaReader {
  reading: MediaReading | null = {
    positionMs: 83_000,
    durationMs: 213_000,
    playing: true,
    title: 'Song',
    artist: 'Artist',
  }
  failure: Error | null = null
  reads = 0
  invalidations = 0

  async read(): Promise<MediaReading | null> {
    this.reads += 1
    if (this.failure) throw this.failure
    return this.reading
  }

  invalidate(): void {
    this.invalidations += 1
  }

  setKnown(reading: MediaReading): void {
    this.reading = reading
  }
}

function fixture(): {
  config: DeckConfig
  profileId: string
  pageId: string
  controlId: string
} {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const button = page.buttons.find((item) => item.id === 'btn-vol-down')!
  button.control = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'media', target: 'position' },
    min: 0,
    max: 1,
    step: 0.001,
    commit: 'end',
    display: 'time',
  }
  return { config, profileId: profile.id, pageId: page.id, controlId: button.id }
}

const services: ControlStateService[] = []

function service(reader: MediaReader): ControlStateService {
  const created = new ControlStateService({ mediaReader: reader })
  services.push(created)
  return created
}

afterEach(() => {
  for (const created of services.splice(0)) created.dispose()
})

describe('media control resolution', () => {
  it('selects value-bearing media sliders and excludes delta controls', () => {
    const { config, profileId, pageId, controlId } = fixture()
    const button = config.profiles[0]!.pages[0]!.buttons.find((item) => item.id === controlId)!
    expect(isMediaControl(button)).toBe(true)
    expect(resolveStateControls(config, profileId, pageId)).toEqual([
      { id: controlId, label: 'Volume down', source: 'media' },
    ])
    expect(resolveStateControls(config, profileId, pageId, [controlId, 'nope'])).toHaveLength(1)

    button.control = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'media', target: 'position' },
    }
    expect(isMediaControl(button)).toBe(false)
    expect(resolveStateControls(config, profileId, pageId)).toEqual([])
  })
})

describe('ControlStateService media states', () => {
  it('sends position, duration, playing, title and artist immediately', async () => {
    const reader = new FakeMediaReader()
    const created = service(reader)
    const { profileId, pageId, controlId } = fixture()
    const messages: ControlStateMessage[] = []

    await created.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      controls: [{ id: controlId, label: 'Scrub', source: 'media' }],
      intervalMs: 500,
      send: (message) => messages.push(message),
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]!.states[0]).toMatchObject({
      controlId,
      available: true,
      positionMs: 83_000,
      durationMs: 213_000,
      playing: true,
      title: 'Song',
      artist: 'Artist',
      detail: '1:23 / 3:33',
    })
    expect(messages[0]!.states[0]!.value).toBeCloseTo(83_000 / 213_000, 6)
    expect(reader.reads).toBe(1)
  })

  it('reads once for two media tiles and fans out both entries', async () => {
    const reader = new FakeMediaReader()
    const created = service(reader)
    const { config, profileId, pageId, controlId } = fixture()
    const page = config.profiles[0]!.pages[0]!
    const second = page.buttons.find((item) => item.id === 'btn-vol-up')!
    second.control = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'media', target: 'position' },
      commit: 'end',
      display: 'time',
    }
    const messages: ControlStateMessage[] = []

    await created.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId, second.id],
      controls: [
        { id: controlId, label: 'Scrub', source: 'media' },
        { id: second.id, label: 'Scrub 2', source: 'media' },
      ],
      intervalMs: 500,
      send: (message) => messages.push(message),
    })

    expect(reader.reads).toBe(1)
    expect(messages[0]!.states.map((state) => state.controlId).sort()).toEqual(
      [controlId, second.id].sort(),
    )
  })

  it('reports NO PLAYER and backend errors without throwing', async () => {
    const none = new FakeMediaReader()
    none.reading = null
    const first = service(none)
    const { profileId, pageId, controlId } = fixture()
    const messages: ControlStateMessage[] = []
    await first.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      controls: [{ id: controlId, label: 'Scrub', source: 'media' }],
      intervalMs: 500,
      send: (message) => messages.push(message),
    })
    expect(messages[0]!.states[0]).toMatchObject({
      available: false,
      detail: 'NO PLAYER',
    })

    const broken = new FakeMediaReader()
    broken.failure = new Error('osascript exited with 1: Not authorized to send Apple events')
    const second = service(broken)
    messages.length = 0
    await second.subscribe('client-2', {
      profileId,
      pageId,
      controlIds: [controlId],
      controls: [{ id: controlId, label: 'Scrub', source: 'media' }],
      intervalMs: 500,
      send: (message) => messages.push(message),
    })
    expect(messages[0]!.states[0]).toMatchObject({
      available: false,
      detail: 'NO PLAYER',
    })
  })

  it('sends a changed position after a seek and increments the revision', async () => {
    const reader = new FakeMediaReader()
    const created = service(reader)
    const { profileId, pageId, controlId } = fixture()
    const messages: ControlStateMessage[] = []

    await created.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [controlId],
      controls: [{ id: controlId, label: 'Scrub', source: 'media' }],
      intervalMs: 500,
      send: (message) => messages.push(message),
    })
    const first = messages.at(-1)!.states[0]!

    reader.setKnown({
      positionMs: 150_000,
      durationMs: 213_000,
      playing: true,
      title: 'Song',
      artist: 'Artist',
    })
    await created.noteMediaChanged()

    const second = messages.at(-1)!.states[0]!
    expect(second.positionMs).toBe(150_000)
    expect(second.revision).toBeGreaterThan(first.revision)
  })
})
