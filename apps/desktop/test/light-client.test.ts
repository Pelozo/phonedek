import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  ElgatoClient,
  ElgatoError,
  elgatoPutBody,
  elgatoRequestUrl,
  parseElgatoLights,
} from '../src/main/light-client'
import type { LightDeviceSettings } from '../src/main/settings-store'

interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
  at: number
}

type Handler = (request: Recorded, response: ServerResponse) => void

interface FakeServer {
  device: LightDeviceSettings
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
        at: Date.now(),
      }
      requests.push(recorded)
      handler(recorded, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    device: { id: 'key-1', name: 'Key Light', type: 'elgato', host: '127.0.0.1', port: address.port },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('Elgato payload parsing', () => {
  it('parses numeric and boolean on values', () => {
    expect(
      parseElgatoLights({
        numberOfLights: 1,
        lights: [{ on: 1, brightness: 42, temperature: 250 }],
      }),
    ).toEqual({ on: true, brightness: 42, temperature: 250 })
    expect(
      parseElgatoLights({
        numberOfLights: 1,
        lights: [{ on: false, brightness: 0, temperature: 143 }],
      }),
    ).toEqual({ on: false, brightness: 0, temperature: 143 })
  })

  it('clamps out-of-range values and rejects empty payloads', () => {
    expect(
      parseElgatoLights({ lights: [{ on: true, brightness: 250, temperature: 999 }] }),
    ).toEqual({ on: true, brightness: 100, temperature: 344 })
    expect(() => parseElgatoLights({ lights: [] })).toThrow(ElgatoError)
    expect(() => parseElgatoLights(null)).toThrow(ElgatoError)
  })

  it('builds the exact PUT body the device expects', () => {
    expect(elgatoPutBody({ on: true, brightness: 42, temperature: 250 })).toEqual({
      numberOfLights: 1,
      lights: [{ on: true, brightness: 42, temperature: 250 }],
    })
  })

  it('builds the device URL with the default port', () => {
    expect(elgatoRequestUrl({ host: 'key.local' })).toBe('http://key.local:9123/elgato/lights')
    expect(elgatoRequestUrl({ host: '10.0.0.5', port: 9124 })).toBe(
      'http://10.0.0.5:9124/elgato/lights',
    )
  })
})

describe('ElgatoClient HTTP', () => {
  it('reads /elgato/lights without an Origin header', async () => {
    const server = await fakeServer((request, response) => {
      json(response, 200, {
        numberOfLights: 1,
        lights: [{ on: 1, brightness: 42, temperature: 250 }],
      })
    })
    cleanups.push(server.close)
    const client = new ElgatoClient(server.device, { timeoutMs: 1000 })

    await expect(client.getState()).resolves.toEqual({
      on: true,
      brightness: 42,
      temperature: 250,
    })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]!.method).toBe('GET')
    expect(server.requests[0]!.path).toBe('/elgato/lights')
    expect(server.requests[0]!.headers.origin).toBeUndefined()
  })

  it('PUTs a full one-light body and adopts the response', async () => {
    const server = await fakeServer((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, {
          numberOfLights: 1,
          lights: [{ on: 1, brightness: 10, temperature: 200 }],
        })
        return
      }
      const body = JSON.parse(request.body) as {
        numberOfLights: number
        lights: Array<{ on: boolean; brightness: number; temperature: number }>
      }
      json(response, 200, body)
    })
    cleanups.push(server.close)
    const client = new ElgatoClient(server.device, { timeoutMs: 1000 })

    const state = await client.setState({ brightness: 88, temperature: 300 })
    expect(state).toEqual({ on: true, brightness: 88, temperature: 300 })

    const puts = server.requests.filter((request) => request.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0]!.body)).toEqual({
      numberOfLights: 1,
      lights: [{ on: true, brightness: 88, temperature: 300 }],
    })
    expect(puts[0]!.headers['content-type']).toBe('application/json')
  })

  it('surfaces non-2xx responses with status and host', async () => {
    const server = await fakeServer((_request, response) => {
      json(response, 500, { error: 'boom' })
    })
    cleanups.push(server.close)
    const client = new ElgatoClient(server.device, { timeoutMs: 1000 })

    await expect(client.getState()).rejects.toMatchObject({
      name: 'ElgatoError',
      status: 500,
      host: '127.0.0.1',
    })
    await expect(client.getState()).rejects.toThrow(/HTTP 500/)
  })

  it('times out a device that never answers', async () => {
    const server = await fakeServer(() => {
      // Intentionally never respond.
    })
    cleanups.push(server.close)
    const client = new ElgatoClient(server.device, { timeoutMs: 120 })

    await expect(client.getState()).rejects.toThrow(/timed out after 120 ms/)
  })

  it('reports an unreachable device clearly', async () => {
    const server = await fakeServer((_request, response) => json(response, 200, {}))
    const device = server.device
    await server.close()
    const client = new ElgatoClient(device, { timeoutMs: 500 })

    await expect(client.getState()).rejects.toThrow(/Could not reach Elgato light/)
  })

  it('coalesces concurrent writes with latest-wins semantics', async () => {
    const server = await fakeServer((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, {
          numberOfLights: 1,
          lights: [{ on: 1, brightness: 5, temperature: 200 }],
        })
        return
      }
      // Keep the first PUT in flight long enough for the second patch to merge.
      setTimeout(() => json(response, 200, JSON.parse(request.body)), 60)
    })
    cleanups.push(server.close)
    const client = new ElgatoClient(server.device, { timeoutMs: 2000 })

    const first = client.setState({ brightness: 10 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = client.setState({ brightness: 90 })
    const [a, b] = await Promise.all([first, second])

    expect(a.brightness).toBe(90)
    expect(b.brightness).toBe(90)
    const puts = server.requests.filter((request) => request.method === 'PUT')
    expect(puts.length).toBeLessThanOrEqual(2)
    expect(JSON.parse(puts.at(-1)!.body).lights[0].brightness).toBe(90)
  })
})
