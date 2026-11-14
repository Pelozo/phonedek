import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LightStateSource } from '../src/main/light-source'
import type { LightCredentialReader } from '../src/main/light-credentials'
import type { LightDeviceSettings } from '../src/main/settings-store'

const key = readFileSync(fileURLToPath(new URL('./fixtures/hue-test-key.pem', import.meta.url)))
const cert = readFileSync(fileURLToPath(new URL('./fixtures/hue-test-cert.pem', import.meta.url)))

interface Recorded {
  method: string
  path: string
  body: string
}

type Handler = (request: Recorded, response: ServerResponse) => void

interface FakeServer {
  requests: Recorded[]
  port: number
  close: () => Promise<void>
}

async function fakeServer(
  secure: boolean,
  handler: Handler,
): Promise<FakeServer> {
  const requests: Recorded[] = []
  const listener = (request: IncomingMessage, response: ServerResponse): void => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', secure ? 'https://127.0.0.1' : 'http://127.0.0.1')
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        path: url.pathname,
        body,
      }
      requests.push(recorded)
      handler(recorded, response)
    })
  }
  const server: HttpServer | HttpsServer = secure
    ? createHttpsServer({ key, cert }, listener)
    : createHttpServer(listener)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    requests,
    port: address.port,
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

function credentials(): LightCredentialReader {
  return {
    get: (id) =>
      id === 'hue-1'
        ? { username: 'app-key' }
        : id === 'nl-1'
          ? { token: 'nl-token' }
          : null,
    has: (id) => id === 'hue-1' || id === 'nl-1',
  }
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('unified light source over fake providers', () => {
  it('reads, caches and writes Hue and Nanoleaf devices through one source', async () => {
    const hueState = { on: true, bri: 127, ct: 250 }
    const hue = await fakeServer(true, (request, response) => {
      if (request.method === 'GET') {
        json(response, 200, { name: 'Desk', state: hueState })
        return
      }
      const body = JSON.parse(request.body) as Record<string, unknown>
      if (typeof body.on === 'boolean') hueState.on = body.on
      if (typeof body.bri === 'number') hueState.bri = body.bri
      if (typeof body.ct === 'number') hueState.ct = body.ct
      json(response, 200, [{ success: {} }])
    })
    cleanups.push(hue.close)

    const nanoleafState = {
      on: { value: true },
      brightness: { value: 40 },
      ct: { value: 4000 },
    }
    const nanoleaf = await fakeServer(false, (request, response) => {
      if (request.method === 'GET') {
        json(response, 200, { name: 'Panels', state: nanoleafState })
        return
      }
      const body = JSON.parse(request.body) as {
        on?: { value: boolean }
        brightness?: { value: number }
        ct?: { value: number }
      }
      if (body.on) nanoleafState.on = { value: body.on.value }
      if (body.brightness) nanoleafState.brightness = { value: body.brightness.value }
      if (body.ct) nanoleafState.ct = { value: body.ct.value }
      response.writeHead(204)
      response.end()
    })
    cleanups.push(nanoleaf.close)

    const devices: LightDeviceSettings[] = [
      {
        id: 'hue-1',
        name: 'Hue Desk',
        type: 'hue',
        host: '127.0.0.1',
        port: hue.port,
        lightId: '4',
      },
      {
        id: 'nl-1',
        name: 'Nanoleaf',
        type: 'nanoleaf',
        host: '127.0.0.1',
        port: nanoleaf.port,
      },
    ]
    const source = new LightStateSource({ credentials: credentials(), ttlMs: 900 })
    cleanups.push(() => source.dispose())
    source.configure(devices)

    await expect(source.readStatus('hue-1', 'brightness')).resolves.toMatchObject({
      active: true,
      detail: '50%',
    })
    await expect(source.readStatus('hue-1', 'temperature')).resolves.toMatchObject({
      detail: '250',
    })
    await expect(source.readStatus('nl-1', 'brightness')).resolves.toMatchObject({
      active: true,
      detail: '40%',
    })
    await expect(source.readStatus('nl-1', 'temperature')).resolves.toMatchObject({
      detail: '250',
    })
    expect(hue.requests.filter((request) => request.method === 'GET')).toHaveLength(1)
    expect(nanoleaf.requests.filter((request) => request.method === 'GET')).toHaveLength(1)

    await source.setLevel('hue-1', 'brightness', 73)
    await source.setPower('nl-1', false)
    const huePut = JSON.parse(
      hue.requests.filter((request) => request.method === 'PUT').at(-1)!.body,
    ) as { bri: number }
    expect(huePut.bri).toBe(185)
    expect(
      JSON.parse(nanoleaf.requests.filter((request) => request.method === 'PUT').at(-1)!.body),
    ).toEqual({ on: { value: false } })

    await expect(source.readStatus('hue-1', 'brightness')).resolves.toMatchObject({
      detail: '73%',
    })
    await expect(source.readStatus('nl-1', 'power')).resolves.toMatchObject({
      active: false,
      detail: 'OFF',
    })
    expect(hue.requests.filter((request) => request.method === 'GET')).toHaveLength(1)
    expect(nanoleaf.requests.filter((request) => request.method === 'GET')).toHaveLength(1)
  })

  it('reports one offline provider without hiding the healthy one', async () => {
    const hue = await fakeServer(true, (_request, response) => {
      json(response, 200, { name: 'Desk', state: { on: true, bri: 254, ct: 300 } })
    })
    cleanups.push(hue.close)
    const nanoleaf = await fakeServer(false, (_request, response) => {
      json(response, 503, { error: 'offline' })
    })
    cleanups.push(nanoleaf.close)

    const source = new LightStateSource({ credentials: credentials(), ttlMs: 0 })
    cleanups.push(() => source.dispose())
    source.configure([
      {
        id: 'hue-1',
        name: 'Hue Desk',
        type: 'hue',
        host: '127.0.0.1',
        port: hue.port,
        lightId: '4',
      },
      {
        id: 'nl-1',
        name: 'Nanoleaf',
        type: 'nanoleaf',
        host: '127.0.0.1',
        port: nanoleaf.port,
      },
    ])

    const statuses = await source.listStatuses()
    expect(statuses[0]).toMatchObject({
      id: 'hue-1',
      type: 'hue',
      available: true,
    })
    expect(statuses[0]!.state?.brightness).toBe(100)
    expect(statuses[1]).toMatchObject({
      id: 'nl-1',
      type: 'nanoleaf',
      available: false,
    })
    expect(statuses[1]!.error).toMatch(/HTTP 503/)
  })
})
