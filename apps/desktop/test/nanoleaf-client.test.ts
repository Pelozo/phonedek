import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  NanoleafClient,
  NanoleafError,
  parseNanoleafState,
} from '../src/main/nanoleaf-client'
import type { LightDeviceSettings } from '../src/main/settings-store'

interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
}

type Handler = (request: Recorded, response: ServerResponse) => void

interface FakeDevice {
  device: LightDeviceSettings
  requests: Recorded[]
  close: () => Promise<void>
}

async function fakeDevice(handler: Handler): Promise<FakeDevice> {
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
      }
      requests.push(recorded)
      handler(recorded, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    device: {
      id: 'nl-1',
      name: 'Nanoleaf',
      type: 'nanoleaf',
      host: '127.0.0.1',
      port: address.port,
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function panel(state: Record<string, unknown>): unknown {
  return { name: 'Panels', state }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('Nanoleaf payload parsing', () => {
  it('reads nested and bare on/brightness/ct values', () => {
    expect(
      parseNanoleafState(
        panel({
          on: { value: true },
          brightness: { value: 42 },
          ct: { value: 4000 },
        }),
      ),
    ).toEqual({ on: true, brightness: 42, temperature: 250 })

    expect(
      parseNanoleafState(panel({ on: false, brightness: 100, ct: 6500 })),
    ).toEqual({ on: false, brightness: 100, temperature: 154 })

    expect(parseNanoleafState(panel({ on: { value: true } }))).toEqual({
      on: true,
      brightness: 0,
      temperature: 250,
    })
  })

  it('rejects malformed payloads', () => {
    expect(() => parseNanoleafState(null)).toThrow(NanoleafError)
    expect(() => parseNanoleafState({})).toThrow(NanoleafError)
  })
})

describe('NanoleafClient HTTP', () => {
  it('requires a token', () => {
    expect(
      () =>
        new NanoleafClient(
          { id: 'n', name: 'N', type: 'nanoleaf', host: '127.0.0.1', port: 16021 },
          { token: 'bad/token' },
        ),
    ).toThrow(/token is missing/)
  })

  it('reads state from the OpenAPI endpoint', async () => {
    const fake = await fakeDevice((_request, response) => {
      json(response, 200, panel({ on: { value: true }, brightness: { value: 42 }, ct: { value: 4000 } }))
    })
    cleanups.push(fake.close)
    const client = new NanoleafClient(fake.device, { token: 'token-1', timeoutMs: 3000 })

    await expect(client.getState()).resolves.toEqual({
      on: true,
      brightness: 42,
      temperature: 250,
    })
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.method).toBe('GET')
    expect(fake.requests[0]!.path).toBe('/api/v1/token-1/')
  })

  it('writes on/brightness/ct in the Nanoleaf wire shape', async () => {
    const fake = await fakeDevice((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, panel({ on: { value: false }, brightness: { value: 5 }, ct: { value: 3000 } }))
        return
      }
      response.writeHead(204)
      response.end()
    })
    cleanups.push(fake.close)
    const client = new NanoleafClient(fake.device, { token: 'token-1', timeoutMs: 3000 })

    await expect(
      client.setState({ on: true, brightness: 42, temperature: 250 }),
    ).resolves.toEqual({ on: true, brightness: 42, temperature: 250 })

    const put = fake.requests.find((request) => request.method === 'PUT')!
    expect(put.path).toBe('/api/v1/token-1/state')
    expect(JSON.parse(put.body)).toEqual({
      on: { value: true },
      brightness: { value: 42 },
      ct: { value: 4000 },
    })

    await client.setTarget('power', 0)
    const powerPut = fake.requests.filter((request) => request.method === 'PUT').at(-1)!
    expect(JSON.parse(powerPut.body)).toEqual({ on: { value: false } })
  })

  it('clamps the Kelvin range on writes', async () => {
    const fake = await fakeDevice((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, panel({ on: { value: true }, brightness: { value: 50 }, ct: { value: 4000 } }))
        return
      }
      response.writeHead(204)
      response.end()
    })
    cleanups.push(fake.close)
    const client = new NanoleafClient(fake.device, { token: 'token-1', timeoutMs: 3000 })

    await client.setState({ temperature: 143 })
    expect(JSON.parse(fake.requests.filter((request) => request.method === 'PUT').at(-1)!.body)).toEqual({
      ct: { value: 6500 },
    })

    await client.setState({ temperature: 344 })
    expect(JSON.parse(fake.requests.filter((request) => request.method === 'PUT').at(-1)!.body)).toEqual({
      ct: { value: 2907 },
    })
  })

  it('surfaces HTTP errors without leaking the token', async () => {
    const fake = await fakeDevice((_request, response) => {
      json(response, 401, { error: 'unauthorized' })
    })
    cleanups.push(fake.close)
    const client = new NanoleafClient(fake.device, { token: 'secret-token', timeoutMs: 3000 })

    await expect(client.getState()).rejects.toMatchObject({
      name: 'NanoleafError',
      status: 401,
      host: '127.0.0.1',
    })
    await expect(client.getState()).rejects.not.toThrow(/secret-token/)
  })

  it('reports unreachable and timed-out devices', async () => {
    const fake = await fakeDevice((_request, _response) => {
      // Never answer.
    })
    const device = fake.device
    const client = new NanoleafClient(device, { token: 'token-1', timeoutMs: 120 })
    await expect(client.getState()).rejects.toThrow(/timed out after 120 ms/)

    await fake.close()
    const offline = new NanoleafClient(device, { token: 'token-1', timeoutMs: 500 })
    await expect(offline.getState()).rejects.toThrow(/Could not reach Nanoleaf/)
  })

  it('coalesces concurrent writes with latest-wins semantics', async () => {
    const fake = await fakeDevice((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, panel({ on: { value: true }, brightness: { value: 5 }, ct: { value: 4000 } }))
        return
      }
      setTimeout(() => {
        response.writeHead(204)
        response.end()
      }, 70)
    })
    cleanups.push(fake.close)
    const client = new NanoleafClient(fake.device, { token: 'token-1', timeoutMs: 2000 })

    const first = client.setState({ brightness: 10 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = client.setState({ brightness: 90 })
    const [a, b] = await Promise.all([first, second])

    expect(a.brightness).toBe(90)
    expect(b.brightness).toBe(90)
    const puts = fake.requests.filter((request) => request.method === 'PUT')
    expect(puts.length).toBeLessThanOrEqual(2)
    expect(JSON.parse(puts.at(-1)!.body).brightness.value).toBe(90)
  })
})
