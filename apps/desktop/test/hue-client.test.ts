import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HueClient,
  HueError,
  discoverHueBridges,
  pairHueBridge,
  parseHueLightState,
  parseHueLights,
} from '../src/main/hue-client'
import type { LightDeviceSettings } from '../src/main/settings-store'

const key = readFileSync(fileURLToPath(new URL('./fixtures/hue-test-key.pem', import.meta.url)))
const cert = readFileSync(fileURLToPath(new URL('./fixtures/hue-test-cert.pem', import.meta.url)))

interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
}

type Handler = (request: Recorded, response: ServerResponse) => void

interface FakeBridge {
  device: LightDeviceSettings
  requests: Recorded[]
  close: () => Promise<void>
}

async function fakeBridge(handler: Handler): Promise<FakeBridge> {
  const requests: Recorded[] = []
  const server: HttpsServer = createHttpsServer({ key, cert }, (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'https://127.0.0.1')
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
      id: 'hue-1',
      name: 'Hue Bridge',
      type: 'hue',
      host: '127.0.0.1',
      port: address.port,
      lightId: '3',
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

function light(state: Record<string, unknown>, name = 'Desk'): unknown {
  return { name, state }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe('Hue payload parsing', () => {
  it('maps bri/ct into app units and clamps the app range', () => {
    expect(parseHueLightState(light({ on: true, bri: 254, ct: 153 }))).toEqual({
      on: true,
      brightness: 100,
      temperature: 153,
    })
    expect(parseHueLightState(light({ on: false, bri: 127, ct: 500 }))).toEqual({
      on: false,
      brightness: 50,
      temperature: 344,
    })
    expect(parseHueLightState(light({ on: true }))).toEqual({
      on: true,
      brightness: 0,
      temperature: 250,
    })
  })

  it('rejects malformed payloads', () => {
    expect(() => parseHueLightState(null)).toThrow(HueError)
    expect(() => parseHueLightState({})).toThrow(HueError)
    expect(() => parseHueLights([])).toThrow(HueError)
  })

  it('lists lights sorted numerically and skips malformed entries', () => {
    const lights = parseHueLights({
      '10': light({ on: true, bri: 254, ct: 200 }, 'Ten'),
      '2': light({ on: false, bri: 1, ct: 300 }, 'Two'),
      broken: { nope: true },
    })
    expect(lights.map((item) => item.id)).toEqual(['2', '10'])
    expect(lights[0]!.name).toBe('Two')
  })
})

describe('Hue bridge pairing', () => {
  it('waits for the link button and returns the generated application key', async () => {
    let posts = 0
    const bridge = await fakeBridge((request, response) => {
      posts += 1
      if (posts === 1) {
        json(response, 200, [
          { error: { type: 101, address: '', description: 'link button not pressed' } },
        ])
        return
      }
      json(response, 200, [{ success: { username: 'generated-key-1' } }])
    })
    cleanups.push(bridge.close)

    const result = await pairHueBridge(
      { host: '127.0.0.1', port: bridge.device.port },
      { attempts: 2, retryDelayMs: 5, timeoutMs: 1000 },
    )

    expect(result).toMatchObject({
      username: 'generated-key-1',
      host: '127.0.0.1',
      port: bridge.device.port,
      deviceType: 'phonedek#127.0.0.1',
    })
    expect(bridge.requests).toHaveLength(2)
    expect(bridge.requests[0]!.method).toBe('POST')
    expect(bridge.requests[0]!.path).toBe('/api')
    expect(JSON.parse(bridge.requests[0]!.body)).toEqual({
      devicetype: 'phonedek#127.0.0.1',
    })
  })

  it('explains the link-button flow when pairing times out', async () => {
    const bridge = await fakeBridge((_request, response) => {
      json(response, 200, [
        { error: { type: 101, address: '', description: 'link button not pressed' } },
      ])
    })
    cleanups.push(bridge.close)

    await expect(
      pairHueBridge(
        { host: '127.0.0.1', port: bridge.device.port },
        { attempts: 1, timeoutMs: 1000 },
      ),
    ).rejects.toMatchObject({
      code: 'link-button',
      message: expect.stringMatching(/Press the link button/),
    })
  })

  it('surfaces other bridge errors without a key', async () => {
    const bridge = await fakeBridge((_request, response) => {
      json(response, 200, [
        { error: { type: 7, address: '/', description: 'invalid value' } },
      ])
    })
    cleanups.push(bridge.close)

    await expect(
      pairHueBridge(
        { host: '127.0.0.1', port: bridge.device.port },
        { attempts: 1, timeoutMs: 1000 },
      ),
    ).rejects.toThrow(/refused pairing: invalid value/)
  })

  it('rejects a non-host bridge value before making a request', async () => {
    await expect(pairHueBridge({ host: 'https://bridge.local' })).rejects.toThrow(/bare hostname/)
  })
})

describe('Hue discovery', () => {
  it('returns valid, de-duplicated bridges and ignores invalid entries', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify([
          { id: 'bridge-1', internalipaddress: '192.168.1.20', port: 443 },
          { id: 'bridge-1-duplicate', internalipaddress: '192.168.1.20' },
          { id: 'bad', internalipaddress: 'http://192.168.1.21' },
          { id: 'bridge-2', internalipaddress: '192.168.1.22', port: 8443 },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    await expect(discoverHueBridges({ fetchImpl })).resolves.toEqual([
      { id: 'bridge-1', host: '192.168.1.20', port: 443 },
      { id: 'bridge-2', host: '192.168.1.22', port: 8443 },
    ])
  })

  it('reports unavailable discovery clearly', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 503 })) as typeof fetch
    await expect(discoverHueBridges({ fetchImpl })).rejects.toThrow(/HTTP 503/)
  })
})

describe('HueClient HTTP', () => {
  it('requires an application key', () => {
    expect(
      () =>
        new HueClient(
          { id: 'h', name: 'Hue', type: 'hue', host: '127.0.0.1', port: 443, lightId: '1' },
          { username: '' },
        ),
    ).toThrow(/application key is missing/)
  })

  it('reads on/bri/ct through the bridge HTTPS API', async () => {
    const bridge = await fakeBridge((_request, response) => {
      json(response, 200, light({ on: true, bri: 127, ct: 250 }))
    })
    cleanups.push(bridge.close)
    const client = new HueClient(bridge.device, { username: 'app-key', timeoutMs: 1000 })

    await expect(client.getState()).resolves.toEqual({
      on: true,
      brightness: 50,
      temperature: 250,
    })
    expect(bridge.requests).toHaveLength(1)
    expect(bridge.requests[0]!.method).toBe('GET')
    expect(bridge.requests[0]!.path).toBe('/api/app-key/lights/3')
  })

  it('writes bri/ct/on with the Hue range and merges the result locally', async () => {
    const bridge = await fakeBridge((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, light({ on: true, bri: 10, ct: 200 }))
        return
      }
      json(response, 200, [{ success: { '/lights/3/state': 'ok' } }])
    })
    cleanups.push(bridge.close)
    const client = new HueClient(bridge.device, { username: 'app-key', timeoutMs: 1000 })

    const state = await client.setState({ brightness: 50, temperature: 143 })
    expect(state).toEqual({ on: true, brightness: 50, temperature: 143 })

    const put = bridge.requests.find((request) => request.method === 'PUT')!
    expect(put.path).toBe('/api/app-key/lights/3/state')
    expect(JSON.parse(put.body)).toEqual({ bri: 127, ct: 153 })

    await client.setTarget('power', 0)
    const powerPut = bridge.requests.filter((request) => request.method === 'PUT').at(-1)!
    expect(JSON.parse(powerPut.body)).toEqual({ on: false })
  })

  it('resolves the first light when no target is pinned', async () => {
    const bridge = await fakeBridge((request, response) => {
      if (request.path === '/api/app-key/lights') {
        json(response, 200, {
          '7': light({ on: true, bri: 50, ct: 250 }, 'Seven'),
          '2': light({ on: false, bri: 1, ct: 300 }, 'Two'),
        })
        return
      }
      json(response, 200, light({ on: true, bri: 127, ct: 250 }, 'Two'))
    })
    cleanups.push(bridge.close)
    const device = { ...bridge.device, lightId: undefined }
    const client = new HueClient(device, { username: 'app-key', timeoutMs: 1000 })

    await expect(client.getState()).resolves.toMatchObject({ brightness: 50 })
    expect(bridge.requests.map((request) => request.path)).toEqual([
      '/api/app-key/lights',
      '/api/app-key/lights/2',
    ])
  })

  it('surfaces HTTP auth errors without leaking the application key', async () => {
    const bridge = await fakeBridge((_request, response) => {
      json(response, 401, { error: 'unauthorized' })
    })
    cleanups.push(bridge.close)
    const client = new HueClient(bridge.device, { username: 'secret-app-key', timeoutMs: 1000 })

    await expect(client.getState()).rejects.toMatchObject({
      name: 'HueError',
      status: 401,
      code: 'auth',
      host: '127.0.0.1',
    })
    await expect(client.getState()).rejects.not.toThrow(/secret-app-key/)
  })

  it('treats an error array from a 200 response as a failure', async () => {
    const bridge = await fakeBridge((_request, response) => {
      json(response, 200, [
        { error: { type: 1, address: '/lights/3', description: 'unauthorized user' } },
      ])
    })
    cleanups.push(bridge.close)
    const client = new HueClient(bridge.device, { username: 'app-key', timeoutMs: 1000 })

    await expect(client.getState()).rejects.toThrow(/unauthorized user/)
  })

  it('reports unreachable and timed-out bridges', async () => {
    const bridge = await fakeBridge((_request, _response) => {
      // Never answer.
    })
    const device = bridge.device
    const client = new HueClient(device, { username: 'app-key', timeoutMs: 120 })
    await expect(client.getState()).rejects.toThrow(/timed out after 120 ms/)

    await bridge.close()
    const offline = new HueClient(device, { username: 'app-key', timeoutMs: 500 })
    await expect(offline.getState()).rejects.toThrow(/Could not reach Hue bridge/)
  })

  it('coalesces concurrent writes with latest-wins semantics', async () => {
    const bridge = await fakeBridge((request, response) => {
      if (request.method === 'GET') {
        json(response, 200, light({ on: true, bri: 5, ct: 200 }))
        return
      }
      setTimeout(() => json(response, 200, [{ success: {} }]), 70)
    })
    cleanups.push(bridge.close)
    const client = new HueClient(bridge.device, { username: 'app-key', timeoutMs: 2000 })

    const first = client.setState({ brightness: 10 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = client.setState({ brightness: 90 })
    const [a, b] = await Promise.all([first, second])

    expect(a.brightness).toBe(90)
    expect(b.brightness).toBe(90)
    const puts = bridge.requests.filter((request) => request.method === 'PUT')
    expect(puts.length).toBeLessThanOrEqual(2)
    expect(JSON.parse(puts.at(-1)!.body).bri).toBe(229)
  })
})
