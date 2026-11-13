import { afterEach, describe, expect, it } from 'vitest'
import {
  ElgatoClient,
  type ElgatoLightState,
} from '../src/main/light-client'
import { LightStateSource } from '../src/main/light-source'
import type { LightDeviceSettings } from '../src/main/settings-store'

interface Call {
  method: string
  url: string
  body: unknown
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stateBody(state: ElgatoLightState): unknown {
  return {
    numberOfLights: 1,
    lights: [
      {
        on: state.on ? 1 : 0,
        brightness: state.brightness,
        temperature: state.temperature,
      },
    ],
  }
}

interface FakeLights {
  fetchImpl: typeof fetch
  calls: Call[]
  states: Map<string, ElgatoLightState>
}

function fakeLights(initial: Array<[string, ElgatoLightState]>): FakeLights {
  const states = new Map(initial)
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = url.host
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: url.toString(), body })
    const current = states.get(key) ?? { on: false, brightness: 0, temperature: 250 }
    if (method === 'GET') return jsonResponse(200, stateBody(current))
    const light = body.lights[0]
    const next: ElgatoLightState = {
      on: Boolean(light.on),
      brightness: light.brightness,
      temperature: light.temperature,
    }
    states.set(key, next)
    return jsonResponse(200, stateBody(next))
  }) as typeof fetch
  return { fetchImpl, calls, states }
}

const devices: LightDeviceSettings[] = [
  { id: 'key-1', name: 'Key Light', type: 'elgato', host: '127.0.0.1', port: 9123 },
  { id: 'fill-1', name: 'Fill Light', type: 'elgato', host: '127.0.0.1', port: 9124 },
]

const sources: LightStateSource[] = []

function source(fake: FakeLights, ttlMs = 900, now?: () => number): LightStateSource {
  const created = new LightStateSource({
    ttlMs,
    ...(now ? { now } : {}),
    createClient: (device) =>
      new ElgatoClient(device, { timeoutMs: 500, fetchImpl: fake.fetchImpl }),
  })
  created.configure(devices)
  sources.push(created)
  return created
}

afterEach(() => {
  for (const created of sources.splice(0)) created.dispose()
})

describe('LightStateSource reads', () => {
  it('maps power, brightness and temperature to normalized state readings', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 42, temperature: 250 }],
      ['127.0.0.1:9124', { on: false, brightness: 10, temperature: 344 }],
    ])
    const lights = source(fake)

    await expect(lights.readStatus(undefined, 'power')).resolves.toMatchObject({
      active: true,
      value: 1,
      available: true,
      detail: 'ON',
    })
    await expect(lights.readStatus('key-1', 'brightness')).resolves.toMatchObject({
      active: true,
      value: 0.42,
      detail: '42%',
    })
    await expect(lights.readStatus('key-1', 'temperature')).resolves.toMatchObject({
      active: true,
      value: (250 - 143) / (344 - 143),
      detail: '250',
    })
    await expect(lights.readStatus('fill-1', 'power')).resolves.toMatchObject({
      active: false,
      detail: 'OFF',
    })
  })

  it('uses the first configured light when no id is given', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 80, temperature: 200 }],
      ['127.0.0.1:9124', { on: false, brightness: 5, temperature: 300 }],
    ])
    const lights = source(fake)

    const reading = await lights.readStatus(undefined, 'brightness')
    expect(reading.value).toBeCloseTo(0.8)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.url).toBe('http://127.0.0.1:9123/elgato/lights')
  })

  it('fails clearly for unknown devices and an empty configuration', async () => {
    const lights = source(fakeLights([]))
    await expect(lights.readStatus('missing', 'power')).rejects.toThrow(/not configured/)
    const empty = new LightStateSource()
    sources.push(empty)
    await expect(empty.readStatus(undefined, 'power')).rejects.toThrow(/No lights are configured/)
  })

  it('caches reads for the TTL and single-flights concurrent reads', async () => {
    let now = 0
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 42, temperature: 250 }],
    ])
    const lights = source(fake, 900, () => now)

    const [a, b] = await Promise.all([
      lights.readStatus('key-1', 'brightness'),
      lights.readStatus('key-1', 'brightness'),
    ])
    expect(a.value).toBe(0.42)
    expect(b.value).toBe(0.42)
    expect(fake.calls).toHaveLength(1)

    now = 500
    await lights.readStatus('key-1', 'power')
    expect(fake.calls).toHaveLength(1)

    now = 1000
    await lights.readStatus('key-1', 'power')
    expect(fake.calls).toHaveLength(2)

    lights.invalidateStatus('key-1')
    await lights.readStatus('key-1', 'power')
    expect(fake.calls).toHaveLength(3)
  })

  it('reports per-device availability without throwing from listStatuses', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 42, temperature: 250 }],
    ])
    const failing = new LightStateSource({
      ttlMs: 0,
      createClient: (device) =>
        new ElgatoClient(device, {
          timeoutMs: 50,
          fetchImpl:
            device.id === 'fill-1'
              ? (async () => {
                  throw new Error('connect ECONNREFUSED')
                }) as typeof fetch
              : fake.fetchImpl,
        }),
    })
    sources.push(failing)
    failing.configure(devices)

    const statuses = await failing.listStatuses()
    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toMatchObject({ id: 'key-1', available: true })
    expect(statuses[0]!.state?.brightness).toBe(42)
    expect(statuses[1]).toMatchObject({ id: 'fill-1', available: false })
    expect(statuses[1]!.error).toMatch(/ECONNREFUSED/)
  })
})

describe('LightStateSource writes', () => {
  it('sets raw brightness/temperature levels and refreshes the cache', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 10, temperature: 200 }],
    ])
    const lights = source(fake, 900)

    await lights.setLevel('key-1', 'brightness', 73)
    const lastPut = fake.calls.filter((call) => call.method === 'PUT').at(-1)
    expect((lastPut!.body as { lights: Array<{ brightness: number }> }).lights[0]!.brightness).toBe(73)

    // The cache now holds the written value: no extra GET.
    const before = fake.calls.length
    await expect(lights.readStatus('key-1', 'brightness')).resolves.toMatchObject({
      detail: '73%',
    })
    expect(fake.calls).toHaveLength(before)
  })

  it('toggles power from the device state and executes plan steps', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 50, temperature: 250 }],
    ])
    const lights = source(fake, 0)

    await expect(lights.togglePower('key-1')).resolves.toBe(false)
    expect(fake.states.get('127.0.0.1:9123')?.on).toBe(false)

    await lights.execute({ kind: 'light', action: 'setPower', on: true })
    expect(fake.states.get('127.0.0.1:9123')?.on).toBe(true)

    await lights.execute({ kind: 'light', action: 'togglePower', light: 'key-1' })
    expect(fake.states.get('127.0.0.1:9123')?.on).toBe(false)
  })

  it('notifies listeners after a write', async () => {
    const fake = fakeLights([
      ['127.0.0.1:9123', { on: true, brightness: 50, temperature: 250 }],
    ])
    const lights = source(fake)
    const notified: Array<string | undefined> = []
    lights.onChange((id) => notified.push(id))

    await lights.execute({ kind: 'light', action: 'setPower', light: 'key-1', on: false })
    expect(notified).toEqual(['key-1'])
  })
})
