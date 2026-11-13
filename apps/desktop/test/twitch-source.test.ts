import { afterEach, describe, expect, it } from 'vitest'
import type { TwitchPlanStep } from '@phonedek/shared'
import { formatTwitchUptime, TwitchStateSource } from '../src/main/twitch-source'
import type { TwitchAccount } from '../src/main/twitch-auth'
import type { TwitchCategory, TwitchChannel, TwitchStream } from '../src/main/twitch-client'

class FakeClient {
  stream: TwitchStream | null = {
    id: 'stream-1',
    userId: '42',
    userLogin: 'streamer',
    userName: 'Streamer',
    gameId: '123',
    gameName: 'Fortnite',
    type: 'live',
    title: 'Ranked climb',
    viewerCount: 321,
    startedAt: '2026-11-13T10:00:00Z',
  }
  channel: TwitchChannel | null = {
    broadcasterId: '42',
    broadcasterLogin: 'streamer',
    broadcasterName: 'Streamer',
    gameId: '123',
    gameName: 'Fortnite',
    title: 'Ranked climb',
  }
  categories: TwitchCategory[] = [{ id: '999', name: 'Science & Technology' }]
  streamReads = 0
  channelReads = 0
  chats: Array<{ broadcasterId: string; senderId: string; text: string }> = []
  markers: Array<{ userId: string; description?: string }> = []
  updates: Array<{ broadcasterId: string; patch: { title?: string; gameId?: string } }> = []
  failure: Error | null = null

  async getStream(): Promise<TwitchStream | null> {
    this.streamReads += 1
    if (this.failure) throw this.failure
    return this.stream
  }

  async getChannel(): Promise<TwitchChannel | null> {
    this.channelReads += 1
    if (this.failure) throw this.failure
    return this.channel
  }

  async updateChannel(broadcasterId: string, patch: { title?: string; gameId?: string }): Promise<void> {
    this.updates.push({ broadcasterId, patch })
  }

  async sendChat(broadcasterId: string, senderId: string, text: string): Promise<void> {
    this.chats.push({ broadcasterId, senderId, text })
  }

  async createMarker(userId: string, description?: string): Promise<unknown> {
    this.markers.push({ userId, description })
    return {}
  }

  async getGameByName(name: string): Promise<TwitchCategory | null> {
    return this.categories.find((category) => category.name.toLowerCase() === name.toLowerCase()) ?? null
  }
}

class FakeAuth {
  connected = true
  account: TwitchAccount = { userId: '42', login: 'streamer', displayName: 'Streamer' }
  reads = 0

  async getAccount(): Promise<TwitchAccount> {
    this.reads += 1
    if (!this.connected) throw new Error('Twitch is not connected.')
    return this.account
  }
}

const sources: TwitchStateSource[] = []

function source(client: FakeClient, auth: FakeAuth, now = () => 1_000_000): TwitchStateSource {
  const created = new TwitchStateSource(client, auth, {
    streamTtlMs: 20_000,
    channelTtlMs: 30_000,
    now,
  })
  sources.push(created)
  return created
}

afterEach(() => {
  sources.splice(0)
})

describe('TwitchStatusSource', () => {
  it('maps live, viewers, uptime, title and game detail strings', async () => {
    const client = new FakeClient()
    const auth = new FakeAuth()
    const now = () => Date.parse('2026-11-13T11:23:45Z')
    const state = source(client, auth, now)

    await expect(state.readStatus('live')).resolves.toEqual({
      active: true,
      available: true,
      detail: 'LIVE',
    })
    await expect(state.readStatus('viewers')).resolves.toEqual({
      active: true,
      available: true,
      detail: '321',
    })
    await expect(state.readStatus('uptime')).resolves.toEqual({
      active: true,
      available: true,
      detail: '1:23:45',
    })
    await expect(state.readStatus('title')).resolves.toEqual({
      available: true,
      detail: 'Ranked climb',
    })
    await expect(state.readStatus('game')).resolves.toEqual({
      available: true,
      detail: 'Fortnite',
    })
  })

  it('reports offline live/viewers/uptime as unavailable while title/game stay readable', async () => {
    const client = new FakeClient()
    client.stream = null
    const state = source(client, new FakeAuth())

    await expect(state.readStatus('live')).resolves.toEqual({ available: false, detail: 'OFF' })
    await expect(state.readStatus('viewers')).resolves.toEqual({ available: false, detail: 'OFF' })
    await expect(state.readStatus('uptime')).resolves.toEqual({ available: false, detail: 'OFF' })
    await expect(state.readStatus('title')).resolves.toEqual({
      available: true,
      detail: 'Ranked climb',
    })
  })

  it('caches stream and channel reads, single-flights and invalidates by group', async () => {
    let now = 1000
    const client = new FakeClient()
    const state = source(client, new FakeAuth(), () => now)

    const [a, b] = await Promise.all([state.readStatus('live'), state.readStatus('viewers')])
    expect(a.detail).toBe('LIVE')
    expect(b.detail).toBe('321')
    expect(client.streamReads).toBe(1)

    await state.readStatus('uptime')
    expect(client.streamReads).toBe(1)

    now += 20_001
    await state.readStatus('live')
    expect(client.streamReads).toBe(2)

    await state.readStatus('title')
    await state.readStatus('game')
    expect(client.channelReads).toBe(1)

    state.invalidateStatus('title')
    await state.readStatus('title')
    expect(client.channelReads).toBe(2)
    await state.readStatus('live')
    expect(client.streamReads).toBe(2)

    state.invalidateStatus()
    await state.readStatus('live')
    await state.readStatus('title')
    expect(client.streamReads).toBe(3)
    expect(client.channelReads).toBe(3)
  })

  it('rejects reads while disabled or unconnected', async () => {
    const auth = new FakeAuth()
    auth.connected = false
    const state = source(new FakeClient(), auth)
    await expect(state.readStatus('live')).rejects.toThrow(/not connected/)
  })

  it('routes chat, marker, title and category actions and invalidates status', async () => {
    const client = new FakeClient()
    const state = source(client, new FakeAuth())
    await state.readStatus('live')
    expect(client.streamReads).toBe(1)

    const steps: TwitchPlanStep[] = [
      { kind: 'twitch', action: 'sendChat', message: 'hello' },
      { kind: 'twitch', action: 'createMarker', description: 'clutch' },
      { kind: 'twitch', action: 'setTitle', title: 'New title' },
      { kind: 'twitch', action: 'setGame', game: 'science & technology' },
    ]
    for (const step of steps) await state.execute(step)

    expect(client.chats).toEqual([{ broadcasterId: '42', senderId: '42', text: 'hello' }])
    expect(client.markers).toEqual([{ userId: '42', description: 'clutch' }])
    expect(client.updates).toEqual([
      { broadcasterId: '42', patch: { title: 'New title' } },
      { broadcasterId: '42', patch: { gameId: '999' } },
    ])

    await state.readStatus('live')
    expect(client.streamReads).toBe(2)
  })

  it('reports an unknown category clearly and still validates the account', async () => {
    const client = new FakeClient()
    client.categories = []
    const auth = new FakeAuth()
    const state = source(client, auth)
    await expect(state.execute({ kind: 'twitch', action: 'setGame', game: 'Nope' })).rejects.toThrow(
      /category "Nope" was not found/,
    )
    expect(client.updates).toEqual([])
  })

  it('formats uptime with and without hours', () => {
    expect(formatTwitchUptime('2026-11-13T10:00:00Z', Date.parse('2026-11-13T11:23:45Z'))).toBe(
      '1:23:45',
    )
    expect(formatTwitchUptime('2026-11-13T10:00:00Z', Date.parse('2026-11-13T10:03:07Z'))).toBe(
      '3:07',
    )
    expect(formatTwitchUptime('not a date', 0)).toBe('0:00')
    expect(formatTwitchUptime('2026-11-13T10:00:00Z', Date.parse('2026-11-13T09:00:00Z'))).toBe('0:00')
  })
})
