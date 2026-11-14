import { afterEach, describe, expect, it } from 'vitest'
import type { AppVolumeMatch, ControlStateMessage, DeckConfig } from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import {
  ControlStateService,
  isAppVolumeControl,
  isAppVolumeStateButton,
  resolveStateControls,
} from '../src/main/control-state'
import type {
  AppVolumeReader,
  AppVolumeReading,
} from '../src/main/app-volume-source'

class FakeAppReader implements AppVolumeReader {
  reading: AppVolumeReading = { level: 42, muted: false }
  failure: Error | null = null
  reads = 0
  invalidations = 0
  known: Array<{ match: AppVolumeMatch; reading: AppVolumeReading }> = []

  async read(): Promise<AppVolumeReading> {
    this.reads += 1
    if (this.failure) throw this.failure
    return { ...this.reading }
  }

  invalidate(): void {
    this.invalidations += 1
  }

  setKnown(match: AppVolumeMatch, reading: AppVolumeReading): void {
    this.known.push({ match, reading: { ...reading } })
    this.reading = { ...reading }
  }
}

interface Fixture {
  config: DeckConfig
  profileId: string
  pageId: string
  volumeId: string
  muteId: string
}

function fixture(): Fixture {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const volume = page.buttons[0]!
  const mute = page.buttons[1]!
  volume.control = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'appVolume', target: 'volume', match: { process: 'discord' } },
    min: 0,
    max: 100,
    step: 1,
    initial: 50,
    unit: '%',
  }
  mute.state = {
    type: 'appVolume',
    target: 'mute',
    match: { process: 'spotify' },
  }
  return {
    config,
    profileId: profile.id,
    pageId: page.id,
    volumeId: volume.id,
    muteId: mute.id,
  }
}

const services: ControlStateService[] = []

function service(appReader: AppVolumeReader | null): ControlStateService {
  const created = new ControlStateService({
    ...(appReader ? { appReader } : {}),
  })
  services.push(created)
  return created
}

afterEach(() => {
  for (const created of services.splice(0)) created.dispose()
})

describe('app volume control state', () => {
  it('selects value controls and status bindings with their match target', () => {
    const { config, profileId, pageId, volumeId, muteId } = fixture()
    const controls = resolveStateControls(config, profileId, pageId)
    expect(controls).toHaveLength(2)
    expect(controls![0]).toMatchObject({
      id: volumeId,
      source: 'appVolume',
      appTarget: 'volume',
      appMatch: { process: 'discord' },
    })
    expect(controls![1]).toMatchObject({
      id: muteId,
      source: 'appVolume',
      appTarget: 'mute',
      appMatch: { process: 'spotify' },
    })

    const page = config.profiles[0]!.pages[0]!
    const volume = page.buttons.find((button) => button.id === volumeId)!
    const mute = page.buttons.find((button) => button.id === muteId)!
    expect(isAppVolumeControl(volume)).toBe(true)
    expect(isAppVolumeStateButton(mute)).toBe(true)
    expect(isAppVolumeStateButton(volume)).toBe(false)
  })

  it('emits value, muted, available and detail for both targets', async () => {
    const { config, profileId, pageId, volumeId, muteId } = fixture()
    const reader = new FakeAppReader()
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: controls.map((control) => control.id),
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(reader.reads).toBe(2)
    const byId = new Map(messages[0]!.states.map((entry) => [entry.controlId, entry]))
    expect(byId.get(volumeId)).toMatchObject({
      revision: 1,
      value: 0.42,
      muted: false,
      active: true,
      available: true,
      detail: '42%',
    })
    expect(byId.get(muteId)).toMatchObject({
      revision: 1,
      value: 0.42,
      muted: false,
      active: true,
      available: true,
      detail: 'LIVE',
    })
  })

  it('shows MUTED and keeps the raw value', async () => {
    const { config, profileId, pageId, volumeId } = fixture()
    const reader = new FakeAppReader()
    reader.reading = { level: 42, muted: true }
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      controlId: volumeId,
      value: 0.42,
      muted: true,
      active: false,
      available: true,
      detail: 'MUTED',
    })
  })

  it('reports NO SESSION and recovers when the session returns', async () => {
    const { config, profileId, pageId, volumeId } = fixture()
    const reader = new FakeAppReader()
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    reader.failure = new Error('No audio session matches "discord".')
    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages[0]!.states[0]).toMatchObject({
      available: false,
      detail: 'NO SESSION',
    })

    reader.failure = null
    await state.noteAppVolumeChanged({ process: 'discord' })
    expect(messages.at(-1)!.states[0]).toMatchObject({
      available: true,
      detail: '42%',
    })
    expect(messages.at(-1)!.states[0]!.revision).toBeGreaterThan(
      messages[0]!.states[0]!.revision,
    )
  })

  it('reports ambiguity without hiding the value', async () => {
    const { config, profileId, pageId, volumeId } = fixture()
    const reader = new FakeAppReader()
    reader.reading = { level: 55, muted: false, ambiguous: true, sessionCount: 2 }
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      value: 0.55,
      available: true,
      detail: '55%',
      error: 'Multiple audio sessions match; using the first.',
    })
  })

  it('marks app state unavailable when no reader exists', async () => {
    const { config, profileId, pageId, volumeId } = fixture()
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(null)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      available: false,
      detail: 'UNSUPPORTED',
    })
  })

  it('invalidates the cache and pushes a fresh snapshot after a write', async () => {
    const { config, profileId, pageId, volumeId } = fixture()
    const reader = new FakeAppReader()
    const controls = resolveStateControls(config, profileId, pageId)!
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [volumeId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    expect(messages).toHaveLength(1)

    await state.noteAppVolumeWritten({ process: 'discord' }, 63, false)
    expect(reader.invalidations).toBe(0)
    expect(reader.known.at(-1)).toEqual({
      match: { process: 'discord' },
      reading: { level: 63, muted: false },
    })
    expect(messages).toHaveLength(2)
    expect(messages[1]!.states[0]).toMatchObject({
      controlId: volumeId,
      revision: 2,
      value: 0.63,
      detail: '63%',
    })

    await state.noteAppVolumeChanged({ process: 'discord' })
    expect(reader.invalidations).toBe(1)
  })
})
