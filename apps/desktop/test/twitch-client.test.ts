import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { TwitchApiError, TwitchClient } from '../src/main/twitch-client'
import type { TwitchTokenProvider } from '../src/main/twitch-auth'

interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
  query: URLSearchParams
}

type Handler = (request: Recorded, response: ServerResponse) => void

interface FakeServer {
  baseUrl: string
  requests: Recorded[]
  close: () => Promise<void>
}

async function fakeServer(handler: Handler): Promise<FakeServer> {
  const requests: Recorded[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        path: url.pathname,
        headers: request.headers,
        body,
        query: url.searchParams,
      }
      requests.push(recorded)
      handler(recorded, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/helix`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

class FakeProvider implements TwitchTokenProvider {
  readonly clientId = 'clientid'
  accessToken = 'access-1'
  refreshCalls = 0

  async getAccessToken(): Promise<string> {
    return this.accessToken
  }

  async refreshAccessToken(): Promise<string> {
    this.refreshCalls += 1
    this.accessToken = `access-${this.refreshCalls + 1}`
    return this.accessToken
  }
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('TwitchClient', () => {
  it('sends Client-Id/Bearer and parses users, streams and channels', async () => {
    const server = await fakeServer((request, response) => {
      if (request.path.endsWith('/users')) {
        json(response, 200, {
          data: [{ id: '42', login: 'streamer', display_name: 'Streamer', profile_image_url: 'https://img' }],
        })
        return
      }
      if (request.path.endsWith('/streams')) {
        json(response, 200, {
          data: [
            {
              id: 'stream-1',
              user_id: '42',
              user_login: 'streamer',
              user_name: 'Streamer',
              game_id: '123',
              game_name: 'Fortnite',
              type: 'live',
              title: 'Ranked',
              viewer_count: 321,
              started_at: '2026-11-13T10:00:00Z',
              language: 'en',
            },
          ],
        })
        return
      }
      if (request.path.endsWith('/channels')) {
        json(response, 200, {
          data: [
            {
              broadcaster_id: '42',
              broadcaster_login: 'streamer',
              broadcaster_name: 'Streamer',
              game_id: '123',
              game_name: 'Fortnite',
              title: 'Ranked',
              broadcaster_language: 'en',
            },
          ],
        })
        return
      }
      json(response, 404, {})
    })
    cleanups.push(server.close)
    const provider = new FakeProvider()
    const client = new TwitchClient({ tokenProvider: provider, baseUrl: server.baseUrl })

    expect(await client.getUser()).toMatchObject({ id: '42', login: 'streamer', displayName: 'Streamer' })
    expect(await client.getStream('42')).toMatchObject({
      id: 'stream-1',
      viewerCount: 321,
      gameName: 'Fortnite',
      title: 'Ranked',
    })
    expect(await client.getChannel('42')).toMatchObject({
      broadcasterId: '42',
      gameName: 'Fortnite',
      title: 'Ranked',
    })

    const streams = server.requests.find((request) => request.path.endsWith('/streams'))!
    expect(streams.query.get('user_id')).toBe('42')
    for (const request of server.requests) {
      expect(request.headers['client-id']).toBe('clientid')
      expect(request.headers.authorization).toBe('Bearer access-1')
    }
  })

  it('PATCHes title/game, sends chat and creates markers', async () => {
    const server = await fakeServer((request, response) => {
      if (request.method === 'PATCH') {
        response.writeHead(204)
        response.end()
        return
      }
      if (request.path.endsWith('/chat/messages')) {
        json(response, 200, { data: [{ message_id: 'm1', is_sent: true, drop_reason: null }] })
        return
      }
      if (request.path.endsWith('/streams/markers')) {
        json(response, 200, {
          data: [
            {
              id: 'marker-1',
              created_at: '2026-11-13T10:10:00Z',
              description: 'clutch',
              position_seconds: 600,
            },
          ],
        })
        return
      }
      json(response, 404, {})
    })
    cleanups.push(server.close)
    const client = new TwitchClient({ tokenProvider: new FakeProvider(), baseUrl: server.baseUrl })

    await client.updateChannel('42', { title: 'New title', gameId: '999' })
    await client.sendChat('42', '42', 'hello chat')
    const marker = await client.createMarker('42', 'clutch')
    expect(marker).toMatchObject({ id: 'marker-1', positionSeconds: 600, description: 'clutch' })

    const patch = server.requests.find((request) => request.method === 'PATCH')!
    expect(patch.query.get('broadcaster_id')).toBe('42')
    expect(JSON.parse(patch.body)).toEqual({ title: 'New title', game_id: '999' })

    const chat = server.requests.find((request) => request.path.endsWith('/chat/messages'))!
    expect(JSON.parse(chat.body)).toEqual({ broadcaster_id: '42', sender_id: '42', message: 'hello chat' })

    const markerRequest = server.requests.find((request) => request.path.endsWith('/streams/markers'))!
    expect(JSON.parse(markerRequest.body)).toEqual({ user_id: '42', description: 'clutch' })
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    const server = await fakeServer((request, response) => {
      if (request.headers.authorization === 'Bearer access-1') {
        json(response, 401, { status: 401, message: 'invalid access token' })
        return
      }
      json(response, 200, { data: [{ id: '42', login: 'streamer', display_name: 'Streamer' }] })
    })
    cleanups.push(server.close)
    const provider = new FakeProvider()
    const client = new TwitchClient({ tokenProvider: provider, baseUrl: server.baseUrl })

    await expect(client.getUser()).resolves.toMatchObject({ id: '42' })
    expect(provider.refreshCalls).toBe(1)
    expect(server.requests.map((request) => request.headers.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ])
  })

  it('surfaces rate limits, Twitch errors and dropped chat messages', async () => {
    let mode: 'rate' | 'bad' | 'drop' | 'missing' = 'rate'
    const server = await fakeServer((_request, response) => {
      if (mode === 'rate') {
        json(
          response,
          429,
          { status: 429, message: 'Too Many Requests' },
          { 'Ratelimit-Limit': '800', 'Ratelimit-Remaining': '0', 'Ratelimit-Reset': '1700000060', 'Retry-After': '3' },
        )
        return
      }
      if (mode === 'drop') {
        json(response, 200, {
          data: [
            {
              message_id: 'm1',
              is_sent: false,
              drop_reason: { code: 'slow_mode', message: 'slow mode is on' },
            },
          ],
        })
        return
      }
      if (mode === 'missing') {
        json(response, 404, { status: 404, message: 'not found' })
        return
      }
      json(response, 400, { status: 400, message: 'title may not be empty' })
    })
    cleanups.push(server.close)
    const client = new TwitchClient({ tokenProvider: new FakeProvider(), baseUrl: server.baseUrl })

    await expect(client.getStream('42')).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
    await expect(client.getStream('42')).rejects.toThrow(/rate limit/i)
    expect(client.rateLimit).toMatchObject({ limit: 800, remaining: 0 })

    mode = 'bad'
    await expect(client.updateChannel('42', { title: '' })).rejects.toThrow(/title may not be empty/)

    mode = 'drop'
    await expect(client.sendChat('42', '42', 'hi')).rejects.toThrow(/slow mode is on/)

    mode = 'missing'
    await expect(client.createMarker('42')).rejects.toMatchObject({ status: 404 })
  })

  it('resolves a category by exact name first, then the first result', async () => {
    const server = await fakeServer((_request, response) => {
      json(response, 200, {
        data: [
          { id: '1', name: 'Fortnite Creative' },
          { id: '2', name: 'Fortnite' },
        ],
      })
    })
    cleanups.push(server.close)
    const client = new TwitchClient({ tokenProvider: new FakeProvider(), baseUrl: server.baseUrl })
    expect(await client.getGameByName('fortnite')).toMatchObject({ id: '2', name: 'Fortnite' })
    expect(await client.getGameByName('unknown')).toMatchObject({ id: '1' })
    expect(await client.getGameByName('  ')).toBeNull()
  })

  it('spaces chat sends conservatively for macros', async () => {
    let now = 1000
    let sends = 0
    const server = await fakeServer((_request, response) => {
      sends += 1
      json(response, 200, { data: [{ message_id: `m${sends}`, is_sent: true, drop_reason: null }] })
    })
    cleanups.push(server.close)
    const client = new TwitchClient({
      tokenProvider: new FakeProvider(),
      baseUrl: server.baseUrl,
      now: () => now,
      chatIntervalMs: 1500,
    })
    await client.sendChat('42', '42', 'one')
    await expect(client.sendChat('42', '42', 'two')).rejects.toMatchObject({
      status: 429,
      code: 'chat_rate_limited',
    })
    now += 1501
    await client.sendChat('42', '42', 'three')
    expect(sends).toBe(2)
  })

  it('exposes explicit TwitchApiError instances', () => {
    expect(new TwitchApiError('nope', 400, 'bad')).toMatchObject({
      name: 'TwitchApiError',
      message: 'nope',
      status: 400,
      code: 'bad',
    })
  })
})
