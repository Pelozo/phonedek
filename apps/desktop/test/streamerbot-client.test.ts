import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import {
  StreamerBotClient,
  StreamerBotRequestError,
  defaultStreamerBotBackoff,
  normalizeDoAction,
  streamerBotAuthString,
  streamerBotWebSocketUrl,
  type StreamerBotClientOptions,
  type StreamerBotStatus,
} from '../src/main/streamerbot-client'

interface FakeRequest {
  request: string
  id: string
  payload: Record<string, unknown>
}

type FakeResult =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error?: string }
  | null

interface FakeStreamerBot {
  port: number
  salt: string
  challenge: string
  connections: number
  authentications: string[]
  requests: FakeRequest[]
  terminateAll(): void
  close(): Promise<void>
}

const fakes: FakeStreamerBot[] = []
const clients: StreamerBotClient[] = []

async function fakeStreamerBot(
  options: {
    password?: string
    actions?: Array<Record<string, unknown>>
    silent?: boolean
    onRequest?: (request: FakeRequest) => FakeResult | Promise<FakeResult>
  } = {},
): Promise<FakeStreamerBot> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const salt = 'test-salt'
  const challenge = 'test-challenge'
  let connections = 0
  const authentications: string[] = []
  const requests: FakeRequest[] = []

  const send = (socket: WebSocket, body: Record<string, unknown>): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body))
  }

  wss.on('connection', (socket) => {
    connections += 1
    if (options.silent) return

    send(socket, {
      timestamp: new Date(0).toISOString(),
      session: `session-${connections}`,
      request: 'Hello',
      info: {
        instanceId: 'instance-1',
        name: 'Streamer.bot Test',
        version: '0.2.5',
        os: 'linux',
        osVersion: 'test',
        mode: 'ui',
        darkMode: true,
        source: 'websocketServer',
      },
      ...(options.password !== undefined
        ? { authentication: { salt, challenge } }
        : {}),
    })

    socket.on('message', (raw) => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(raw.toString()) as Record<string, unknown>
      } catch {
        return
      }
      const request = typeof frame['request'] === 'string' ? frame['request'] : ''
      const id = typeof frame['id'] === 'string' ? frame['id'] : ''
      if (!request || !id) return

      if (request === 'Authenticate') {
        const value = typeof frame['authentication'] === 'string' ? frame['authentication'] : ''
        authentications.push(value)
        const expected = streamerBotAuthString(options.password!, salt, challenge)
        send(socket, {
          status: value === expected ? 'ok' : 'error',
          id,
          ...(value === expected ? {} : { error: 'Authentication failed' }),
        })
        return
      }

      const record: FakeRequest = {
        request,
        id,
        payload: frame,
      }
      requests.push(record)

      const result = options.onRequest
        ? options.onRequest(record)
        : request === 'GetActions'
          ? { ok: true, data: { actions: options.actions ?? [], count: (options.actions ?? []).length } }
          : { ok: true }
      void Promise.resolve(result)
        .then((response) => {
          if (!response) return
          send(socket, {
            status: response.ok ? 'ok' : 'error',
            id,
            ...(response.ok
              ? (response.data ?? {})
              : { error: ('error' in response ? response.error : undefined) ?? 'Request failed' }),
          })
        })
        .catch(() => undefined)
    })
  })

  const fake: FakeStreamerBot = {
    port,
    salt,
    challenge,
    get connections() {
      return connections
    },
    authentications,
    requests,
    terminateAll() {
      for (const socket of wss.clients) socket.terminate()
    },
    async close() {
      for (const socket of wss.clients) socket.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
  fakes.push(fake)
  return fake
}

function makeClient(
  fake: FakeStreamerBot,
  options: StreamerBotClientOptions = {},
): StreamerBotClient {
  const client = new StreamerBotClient({
    host: '127.0.0.1',
    port: fake.port,
    password: '',
    enabled: true,
    connectTimeoutMs: 500,
    requestTimeoutMs: 200,
    heartbeatMs: 0,
    backoffMs: () => 10,
    authRetryMs: 40,
    ...options,
  })
  clients.push(client)
  return client
}

async function waitFor<T>(fn: () => T | undefined | false | null, timeout = 8000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  for (const fake of fakes.splice(0)) await fake.close()
})

describe('StreamerBotClient handshake', () => {
  it('connects on Hello without auth and records the instance info', async () => {
    const fake = await fakeStreamerBot()
    const client = makeClient(fake)
    const statuses: StreamerBotStatus[] = []
    client.onStatus((status) => statuses.push(status))
    client.configure({ enabled: true })

    await waitFor(() => client.connected)
    expect(fake.authentications).toEqual([])
    expect(client.status).toMatchObject({
      state: 'connected',
      host: '127.0.0.1',
      port: fake.port,
      instanceName: 'Streamer.bot Test',
      version: '0.2.5',
    })
    expect(statuses.some((status) => status.state === 'connected')).toBe(true)
  })

  it('answers the Hello challenge with the documented hash', async () => {
    const fake = await fakeStreamerBot({ password: 's3cret' })
    const client = makeClient(fake, { password: 's3cret' })
    client.configure({ enabled: true })

    await waitFor(() => client.connected)
    expect(fake.authentications).toEqual([
      streamerBotAuthString('s3cret', fake.salt, fake.challenge),
    ])
  })

  it('reports auth-failed for a wrong password without logging the secret', async () => {
    const fake = await fakeStreamerBot({ password: 's3cret' })
    const client = makeClient(fake, { password: 'wrong-password', authRetryMs: 500 })
    client.configure({ enabled: true })

    await waitFor(() => client.status.state === 'auth-failed')
    expect(client.status.lastError).toMatch(/rejected the WebSocket password/i)
    expect(JSON.stringify(client.status)).not.toContain('wrong-password')
    expect(client.connected).toBe(false)

    // The auth retry floor prevents a tight loop.
    await sleep(30)
    expect(fake.connections).toBe(1)
  })

  it('asks for a password when the server requires one', async () => {
    const fake = await fakeStreamerBot({ password: 's3cret' })
    const client = makeClient(fake, { password: '' })
    client.configure({ enabled: true })

    await waitFor(() => client.status.state === 'auth-failed')
    expect(client.status.lastError).toMatch(/requires a WebSocket password/i)
    expect(fake.authentications).toEqual([])
  })

  it('reconnects with backoff after the socket drops', async () => {
    const fake = await fakeStreamerBot()
    const attempts: number[] = []
    const client = makeClient(fake, {
      backoffMs: (attempt) => {
        attempts.push(attempt)
        return 10
      },
    })
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    fake.terminateAll()
    const reconnecting = await waitFor(() =>
      client.status.state === 'reconnecting' ? client.status : null,
    )
    expect(reconnecting.nextRetryMs).toBe(10)
    await waitFor(() => client.connected && fake.connections >= 2)
    expect(attempts).toEqual([1])
  })

  it('stays idle while disabled and rejects requests', async () => {
    const fake = await fakeStreamerBot()
    const client = makeClient(fake, { enabled: false })
    client.configure({ enabled: false })
    await sleep(30)

    expect(fake.connections).toBe(0)
    expect(client.status.state).toBe('disabled')
    await expect(client.getActions()).rejects.toThrow('Streamer.bot is not connected.')
    await expect(client.doAction('Test')).rejects.toThrow('Streamer.bot is not connected.')

    client.configure({ enabled: true })
    await waitFor(() => client.connected)
    expect(fake.connections).toBe(1)
  })

  it('surfaces a handshake timeout instead of a fake connection', async () => {
    const fake = await fakeStreamerBot({ silent: true })
    const client = makeClient(fake, { connectTimeoutMs: 60, backoffMs: () => 500 })
    client.configure({ enabled: true })

    const status = await waitFor(() =>
      client.status.state === 'reconnecting' && client.status.lastError
        ? client.status
        : null,
    )
    expect(status.lastError).toMatch(/handshake/i)
    expect(client.connected).toBe(false)
  })
})

describe('StreamerBotClient requests', () => {
  it('lists actions and normalizes the GetActions payload', async () => {
    const fake = await fakeStreamerBot({
      actions: [
        {
          enabled: true,
          group: 'None',
          id: 'a0ff6f91',
          name: 'Test Alert',
          subaction_count: 4,
          trigger_count: 1,
        },
        {
          enabled: false,
          group: 'Stream',
          id: '84a0dfe7',
          name: 'Stream Starting',
          subaction_count: 18,
          trigger_count: 2,
        },
        { id: 'bad-entry' },
      ],
    })
    const client = makeClient(fake)
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    await expect(client.getActions()).resolves.toEqual([
      {
        id: 'a0ff6f91',
        name: 'Test Alert',
        enabled: true,
        subactionCount: 4,
        triggerCount: 1,
      },
      {
        id: '84a0dfe7',
        name: 'Stream Starting',
        group: 'Stream',
        enabled: false,
        subactionCount: 18,
        triggerCount: 2,
      },
    ])
    expect(client.status.actionCount).toBe(2)
    expect(fake.requests[0]?.request).toBe('GetActions')
  })

  it('sends DoAction by name with arguments and serializes calls', async () => {
    let releaseFirst: ((result: FakeResult) => void) | null = null
    const fake = await fakeStreamerBot({
      onRequest: (request) => {
        if (request.request === 'DoAction' && !releaseFirst) {
          return new Promise<FakeResult>((resolve) => {
            releaseFirst = resolve
          })
        }
        return { ok: true }
      },
    })
    const client = makeClient(fake)
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    const first = client.doAction('Test Alert', { message: 'hello', count: '2' })
    const second = client.doAction('Second')
    await waitFor(() => fake.requests.length === 1)
    expect(fake.requests[0]?.payload).toMatchObject({
      request: 'DoAction',
      action: { name: 'Test Alert' },
      args: { message: 'hello', count: '2' },
    })
    expect(typeof fake.requests[0]?.id).toBe('string')

    // The second action waits for the first response.
    await sleep(20)
    expect(fake.requests).toHaveLength(1)
    releaseFirst!({ ok: true })
    await expect(first).resolves.toBeUndefined()

    await waitFor(() => fake.requests.length === 2)
    expect(fake.requests[1]?.payload).toEqual({
      request: 'DoAction',
      id: fake.requests[1]?.id,
      action: { name: 'Second' },
    })
    await expect(second).resolves.toBeUndefined()
  })

  it('surfaces error responses and request timeouts', async () => {
    const release: { fn: ((result: FakeResult) => void) | null } = { fn: null }
    const fake = await fakeStreamerBot({
      onRequest: (request) => {
        if (request.request === 'GetActions') {
          return { ok: false, error: 'Unknown request: GetActions' }
        }
        return new Promise<FakeResult>((resolve) => {
          release.fn = resolve
        })
      },
    })
    const client = makeClient(fake)
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    const failed = client.getActions()
    await expect(failed).rejects.toBeInstanceOf(StreamerBotRequestError)
    await expect(failed).rejects.toThrow('Unknown request: GetActions')

    await expect(client.doAction('Never')).rejects.toThrow(/timed out/)
    release.fn?.({ ok: true })
  })

  it('rejects pending requests when the connection closes', async () => {
    const fake = await fakeStreamerBot({ onRequest: () => null })
    const client = makeClient(fake)
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    const pending = client.doAction('Pending')
    await waitFor(() => fake.requests.some((request) => request.request === 'DoAction'))
    fake.terminateAll()
    await expect(pending).rejects.toThrow(/closed/)

    await waitFor(() => client.connected && fake.connections >= 2)
  })
})

describe('Streamer.bot helpers', () => {
  it('builds the WebSocket URL and brackets IPv6 hosts', () => {
    expect(streamerBotWebSocketUrl('127.0.0.1', 8080)).toBe('ws://127.0.0.1:8080/')
    expect(streamerBotWebSocketUrl('localhost', 8080)).toBe('ws://localhost:8080/')
    expect(streamerBotWebSocketUrl('::1', 8080)).toBe('ws://[::1]:8080/')
    expect(streamerBotWebSocketUrl('[::1]', 8080)).toBe('ws://[::1]:8080/')
  })

  it('caps the default backoff at 30 s with jitter', () => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const delay = defaultStreamerBotBackoff(attempt)
      const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(5, attempt - 1)))
      expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.8) - 1)
      expect(delay).toBeLessThanOrEqual(Math.round(base * 1.2) + 1)
    }
  })

  it('normalizes and validates action names and arguments', () => {
    expect(normalizeDoAction('  Test Alert  ')).toEqual({ name: 'Test Alert' })
    expect(normalizeDoAction('Test', { a: 'b' })).toEqual({ name: 'Test', args: { a: 'b' } })
    expect(() => normalizeDoAction('   ')).toThrow(/cannot be empty/)
    expect(() => normalizeDoAction('x'.repeat(129))).toThrow(/128 characters/)
    expect(() => normalizeDoAction('Test', { a: 1 })).toThrow(/must be text/)
    expect(() =>
      normalizeDoAction(
        'Test',
        Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`a${index}`, 'v'])),
      ),
    ).toThrow(/at most 16 arguments/)
    expect(() => normalizeDoAction('Test', { ['k'.repeat(65)]: 'v' })).toThrow(/1\.\.64/)
    expect(() => normalizeDoAction('Test', { a: 'v'.repeat(513) })).toThrow(/512 characters/)
  })
})
