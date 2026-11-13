import { afterEach, describe, expect, it } from 'vitest'
import type { ControlStateMessage, DeckConfig, TwitchStateTarget } from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import { ControlStateService, resolveStateControls } from '../src/main/control-state'
import type { TwitchStateReader, TwitchStatusReading } from '../src/main/twitch-source'

class FakeTwitchReader implements TwitchStateReader {
  readings = new Map<TwitchStateTarget, TwitchStatusReading>([
    ['live', { active: true, available: true, detail: 'LIVE' }],
    ['viewers', { active: true, available: true, detail: '321' }],
    ['uptime', { active: true, available: true, detail: '1:23:45' }],
    ['title', { available: true, detail: 'Ranked climb' }],
    ['game', { available: true, detail: 'Fortnite' }],
  ])
  failure: Error | null = null
  reads: TwitchStateTarget[] = []
  invalidations: Array<TwitchStateTarget | undefined> = []

  async readStatus(target: TwitchStateTarget): Promise<TwitchStatusReading> {
    this.reads.push(target)
    if (this.failure) throw this.failure
    return this.readings.get(target) ?? { available: false, detail: 'UNKNOWN' }
  }

  invalidateStatus(target?: TwitchStateTarget): void {
    this.invalidations.push(target)
  }

  async execute(): Promise<void> {
    // not used by control state
  }
}

interface Fixture {
  config: DeckConfig
  profileId: string
  pageId: string
  liveId: string
  viewersId: string
  titleId: string
}

function fixture(): Fixture {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const [live, viewers, title] = page.buttons
  live!.state = { type: 'twitch', target: 'live' }
  viewers!.state = { type: 'twitch', target: 'viewers' }
  title!.state = { type: 'twitch', target: 'title' }
  return {
    config,
    profileId: profile.id,
    pageId: page.id,
    liveId: live!.id,
    viewersId: viewers!.id,
    titleId: title!.id,
  }
}

const services: ControlStateService[] = []

function service(reader: FakeTwitchReader): ControlStateService {
  const created = new ControlStateService({ twitchReader: reader })
  services.push(created)
  return created
}

afterEach(() => {
  for (const created of services.splice(0)) created.dispose()
})

describe('Twitch control state', () => {
  it('resolves Twitch state buttons alongside continuous controls', () => {
    const { config, profileId, pageId, liveId, viewersId, titleId } = fixture()
    expect(resolveStateControls(config, profileId, pageId)).toEqual([
      { id: liveId, label: expect.any(String), source: 'twitch', twitchTarget: 'live' },
      { id: viewersId, label: expect.any(String), source: 'twitch', twitchTarget: 'viewers' },
      { id: titleId, label: expect.any(String), source: 'twitch', twitchTarget: 'title' },
    ])
    expect(resolveStateControls(config, profileId, pageId, [liveId])).toEqual([
      { id: liveId, label: expect.any(String), source: 'twitch', twitchTarget: 'live' },
    ])
  })

  it('publishes live/viewers/title readings with revisions and active flags', async () => {
    const { config, profileId, pageId, liveId, viewersId, titleId } = fixture()
    const reader = new FakeTwitchReader()
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [liveId, viewersId, titleId],
      controls: resolveStateControls(config, profileId, pageId)!,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(reader.reads).toEqual(['live', 'viewers', 'title'])
    expect(messages[0]!.states).toEqual([
      { controlId: liveId, revision: 1, available: true, active: true, detail: 'LIVE' },
      { controlId: viewersId, revision: 1, available: true, active: true, detail: '321' },
      { controlId: titleId, revision: 1, available: true, detail: 'Ranked climb' },
    ])

    reader.readings.set('live', { available: false, detail: 'OFF' })
    await state.noteTwitchChanged('live')
    const last = messages[messages.length - 1]!
    expect(last.states).toEqual([
      { controlId: liveId, revision: 2, available: false, detail: 'OFF' },
    ])
    expect(reader.invalidations).toContain('live')
  })

  it('maps auth/connection failures to NO TWITCH without throwing', async () => {
    const { config, profileId, pageId, liveId } = fixture()
    const reader = new FakeTwitchReader()
    reader.failure = new Error('Twitch is not connected.')
    const messages: ControlStateMessage[] = []
    const state = service(reader)

    await state.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [liveId],
      controls: resolveStateControls(config, profileId, pageId, [liveId])!,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages[0]!.states[0]).toMatchObject({
      controlId: liveId,
      revision: 1,
      available: false,
      detail: 'NO TWITCH',
      error: 'Twitch is not connected.',
    })
  })
})
