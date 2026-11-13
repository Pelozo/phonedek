import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import {
  ObsClient,
  OBS_EVENT_SUBSCRIPTIONS,
  defaultObsBackoff,
  obsAuthString,
  obsWebSocketUrl,
  type ObsClientOptions,
  type ObsStatus,
} from '../src/main/obs-client'

type FakeResult =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; code: number; comment?: string }
  | null

interface FakeRequest {
  requestId: string
  requestType: string
  requestData: Record<string, unknown>
}

interface FakeObs {
  port: number
  salt: string
  challenge: string
  connections: number
  identifies: Array<Record<string, unknown>>
  requests: FakeRequest[]
  sendEvent(type: string, data: Record<string, unknown>): void
  sendResponse(requestId: string, result: Exclude<FakeResult, null>): void
  terminateAll(): void
  close(): Promise<void>
}

const fakes: FakeObs[] = []
const clients: ObsClient[] = []

async function fakeObs(options: {
  password?: string
  rpcVersion?: unknown
  closeOnIdentify?: number
  closeOnIdentifyOnce?: boolean
  onRequest?: (
    type: string,
    data: Record<string, unknown>,
  ) => FakeResult | Promise<FakeResult>
} = {}): Promise<FakeObs> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const salt = 'test-salt'
  const challenge = 'test-challenge'
  let connections = 0
  let identifyClosed = false
  const identifies: Array<Record<string, unknown>> = []
  const requests: FakeRequest[] = []

  const respond = (socket: WebSocket, requestId: string, result: Exclude<FakeResult, null>): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    const body =
      result.ok
        ? {
            op: 7,
            d: {
              requestType: '',
              requestId,
              requestStatus: { result: true, code: 100 },
              responseData: result.data ?? {},
            },
          }
        : {
            op: 7,
            d: {
              requestType: '',
              requestId,
              requestStatus: {
                result: false,
                code: result.code,
                ...(result.comment ? { comment: result.comment } : {}),
              },
            },
          }
    socket.send(JSON.stringify(body))
  }

  const defaultResult = (type: string): Exclude<FakeResult, null> => {
    if (type === 'GetVersion') {
      return { ok: true, data: { obsVersion: '30.2.2', obsWebSocketVersion: '5.5.2', rpcVersion: 1 } }
    }
    return { ok: true }
  }

  wss.on('connection', (socket) => {
    connections += 1
    socket.send(
      JSON.stringify({
        op: 0,
        d: {
          obsStudioVersion: '30.2.2',
          obsWebSocketVersion: '5.5.2',
          rpcVersion: options.rpcVersion ?? 1,
          ...(options.password !== undefined ? { authentication: { challenge, salt } } : {}),
        },
      }),
    )
    socket.on('message', (raw) => {
      let frame: { op?: unknown; d?: Record<string, unknown> }
      try {
        frame = JSON.parse(raw.toString()) as { op?: unknown; d?: Record<string, unknown> }
      } catch {
        return
      }
      if (frame.op === 1 && frame.d) {
        identifies.push(frame.d)
        if (options.closeOnIdentify && (!options.closeOnIdentifyOnce || !identifyClosed)) {
          identifyClosed = true
          socket.close(options.closeOnIdentify, 'fake close')
          return
        }
        if (options.password !== undefined) {
          const expected = obsAuthString(options.password, salt, challenge)
          if (frame.d['authentication'] !== expected) {
            socket.close(4009, 'Authentication failed')
            return
          }
        }
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
        return
      }
      if (frame.op !== 6 || !frame.d) return
      const request: FakeRequest = {
        requestId: String(frame.d['requestId'] ?? ''),
        requestType: String(frame.d['requestType'] ?? ''),
        requestData: isRecord(frame.d['requestData']) ? frame.d['requestData'] : {},
      }
      requests.push(request)
      const resultPromise = options.onRequest
        ? options.onRequest(request.requestType, request.requestData)
        : defaultResult(request.requestType)
      void Promise.resolve(resultPromise)
        .then((result) => {
          if (result === null) return
          respond(socket, request.requestId, result)
        })
        .catch(() => undefined)
    })
  })

  const fake: FakeObs = {
    port,
    salt,
    challenge,
    get connections() {
      return connections
    },
    identifies,
    requests,
    sendEvent(type, data) {
      const payload = JSON.stringify({ op: 5, d: { eventType: type, eventIntent: 8, eventData: data } })
      for (const socket of wss.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload)
      }
    },
    sendResponse(requestId, result) {
      for (const socket of wss.clients) respond(socket, requestId, result)
    },
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

function makeClient(fake: FakeObs, options: ObsClientOptions = {}): ObsClient {
  const client = new ObsClient({
    host: '127.0.0.1',
    port: fake.port,
    password: '',
    enabled: true,
    connectTimeoutMs: 500,
    requestTimeoutMs: 100,
    heartbeatMs: 0,
    backoffMs: () => 10,
    authRetryMs: 40,
    ...options,
  })
  clients.push(client)
  return client
}

async function waitFor<T>(fn: () => T | undefined | false | null, timeout = 2000): Promise<T> {
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

describe('ObsClient handshake', () => {
  it('identifies without auth, subscribes to inputs, and loads the version', async () => {
    const fake = await fakeObs()
    const client = makeClient(fake)
    const statuses: ObsStatus[] = []
    client.onStatus((status) => statuses.push(status))
    client.configure({ enabled: true })

    await waitFor(() => client.connected)
    // Includes input volume/mute plus OBS phase 2 stream/record/scene events.
    expect(fake.identifies[0]).toMatchObject({
      rpcVersion: 1,
      eventSubscriptions: OBS_EVENT_SUBSCRIPTIONS,
    })
    expect(fake.identifies[0]!['authentication']).toBeUndefined()

    await waitFor(() => client.status.obsVersion === '30.2.2')
    expect(client.status.websocketVersion).toBe('5.5.2')
    expect(statuses.some((status) => status.state === 'connected')).toBe(true)

    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    client.onEvent((type, data) => events.push({ type, data }))
    fake.sendEvent('InputVolumeChanged', { inputName: 'Mic/Aux', inputVolumeMul: 1.5 })
    await waitFor(() => events.length === 1)
    expect(events[0]).toEqual({
      type: 'InputVolumeChanged',
      data: { inputName: 'Mic/Aux', inputVolumeMul: 1.5 },
    })
  })

  it('computes the SHA-256 challenge response', async () => {
    const fake = await fakeObs({ password: 's3cret' })
    const client = makeClient(fake, { password: 's3cret' })
    client.configure({ enabled: true })

    await waitFor(() => client.connected)
    expect(fake.identifies[0]!['authentication']).toBe(
      obsAuthString('s3cret', fake.salt, fake.challenge),
    )
  })

  it('reports auth-failed and does not retry in a tight loop', async () => {
    const fake = await fakeObs({ password: 's3cret' })
    const client = makeClient(fake, { password: 'wrong' })
    client.configure({ enabled: true })

    await waitFor(() => client.status.state === 'auth-failed')
    expect(client.status.lastError).toMatch(/authentication failed/i)
    expect(fake.connections).toBe(1)
    await sleep(15)
    expect(fake.connections).toBe(1)
  })

  it('treats 4010 as unsupported OBS and 4011 as a stopped session', async () => {
    const unsupported = await fakeObs({ closeOnIdentify: 4010 })
    const first = makeClient(unsupported)
    first.configure({ enabled: true })
    await waitFor(() => first.status.state === 'error')
    expect(first.status.lastError).toMatch(/OBS 28\+/)
    await sleep(20)
    expect(unsupported.connections).toBe(1)

    const kicked = await fakeObs({ closeOnIdentify: 4011, closeOnIdentifyOnce: true })
    const second = makeClient(kicked)
    second.configure({ enabled: true })
    await waitFor(() => second.status.state === 'disabled')
    await sleep(20)
    expect(kicked.connections).toBe(1)

    second.configure({ enabled: true })
    await waitFor(() => second.connected)
    expect(kicked.connections).toBe(2)
  })
})

describe('ObsClient requests', () => {
  it('correlates out-of-order responses, ignores unknown ids and uses unique ids', async () => {
    let releaseSlow: ((result: FakeResult) => void) | null = null
    const fake = await fakeObs({
      onRequest: (type) => {
        if (type === 'Slow') {
          return new Promise<FakeResult>((resolve) => {
            releaseSlow = resolve
          })
        }
        return { ok: true, data: { type } }
      },
    })
    const client = makeClient(fake)
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    fake.sendResponse('unknown-id', { ok: true, data: { ignored: true } })
    const slow = client.request<Record<string, unknown>>('Slow')
    const fast = client.request<Record<string, unknown>>('Fast')
    await expect(fast).resolves.toEqual({ type: 'Fast' })
    await waitFor(() => typeof releaseSlow === 'function')
    releaseSlow!({ ok: true, data: { type: 'Slow' } })
    await expect(slow).resolves.toEqual({ type: 'Slow' })

    const ids = fake.requests.map((request) => request.requestId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('obs-'))).toBe(true)
  })

  it('surfaces requestStatus error codes and times out a missing response', async () => {
    const fake = await fakeObs({
      onRequest: (type) => {
        if (type === 'GetInputMute') return { ok: false, code: 600, comment: 'Parameter: inputName' }
        if (type === 'Never') return null
        return { ok: true }
      },
    })
    const client = makeClient(fake, { requestTimeoutMs: 250 })
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    await expect(client.request('GetInputMute')).rejects.toMatchObject({ code: 600 })
    await expect(client.request('Never')).rejects.toThrow(/timed out/)
  })

  it('rejects pending requests and reconnects after the socket closes', async () => {
    const fake = await fakeObs({
      onRequest: (type) => (type === 'Never' ? null : { ok: true }),
    })
    const client = makeClient(fake, { backoffMs: () => 40 })
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    const pending = client.request('Never')
    await waitFor(() => fake.requests.some((request) => request.requestType === 'Never'))
    fake.terminateAll()
    await expect(pending).rejects.toThrow(/closed/)
    await waitFor(() => client.status.state === 'reconnecting')
    await waitFor(() => client.connected && fake.connections >= 2)
  })

  it('rejects requests while disabled or disconnected', async () => {
    const fake = await fakeObs()
    const client = makeClient(fake, { enabled: false })
    client.configure({ enabled: false })
    await sleep(30)
    expect(fake.connections).toBe(0)
    expect(client.status.state).toBe('disabled')
    await expect(client.request('GetVersion')).rejects.toThrow('OBS is not connected.')

    client.configure({ enabled: true })
    await waitFor(() => client.connected)
    expect(fake.connections).toBe(1)
    expect(fake.identifies).toHaveLength(1)
  })

  it('resets the backoff attempt after each successful identification', async () => {
    const delays: number[] = []
    const fake = await fakeObs()
    const client = makeClient(fake, {
      backoffMs: (attempt) => {
        delays.push(attempt)
        return 20
      },
    })
    client.configure({ enabled: true })
    await waitFor(() => client.connected)

    fake.terminateAll()
    await waitFor(() => client.connected && fake.connections >= 2)
    expect(delays).toEqual([1])

    fake.terminateAll()
    await waitFor(() => client.connected && fake.connections >= 3)
    expect(delays).toEqual([1, 1])
  })
})

describe('ObsClient URL and backoff', () => {
  it('brackets IPv6 hosts and builds ws URLs', () => {
    expect(obsWebSocketUrl('127.0.0.1', 4455)).toBe('ws://127.0.0.1:4455')
    expect(obsWebSocketUrl('localhost', 4455)).toBe('ws://localhost:4455')
    expect(obsWebSocketUrl('::1', 4455)).toBe('ws://[::1]:4455')
    expect(obsWebSocketUrl('[::1]', 4455)).toBe('ws://[::1]:4455')
  })

  it('caps the default backoff at 30 s with jitter', () => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const delay = defaultObsBackoff(attempt)
      const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(5, attempt - 1)))
      expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.8) - 1)
      expect(delay).toBeLessThanOrEqual(Math.round(base * 1.2) + 1)
    }
  })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
