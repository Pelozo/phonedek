import { afterEach, describe, expect, it } from 'vitest'
import {
  ElgatoClient,
  type ElgatoLightState,
  type LightDeviceClient,
  type LightDeviceState,
  type LightStatePatch,
} from '../src/main/light-client'
import {
  LightStateSource,
  createDefaultLightClient,
} from '../src/main/light-source'
import { HueClient } from '../src/main/hue-client'
import { NanoleafClient } from '../src/main/nanoleaf-client'
import type { LightCredentialReader, LightCredentials } from '../src/main/light-credentials'
import type { LightDeviceSettings } from '../src/main/settings-store'
import type { LightTarget } from '@phonedek/shared'

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

describe('LightStateSource providers', () => {
  const hue: LightDeviceSettings = {
    id: 'hue-1',
    name: 'Hue Desk',
    type: 'hue',
    host: '10.0.0.20',
    port: 443,
    lightId: '4',
  }
  const nanoleaf: LightDeviceSettings = {
    id: 'nl-1',
    name: 'Nanoleaf',
    type: 'nanoleaf',
    host: '10.0.0.21',
    port: 16021,
  }

  function providerCredentials(): LightCredentialReader {
    return {
      get: (id) =>
        id === 'hue-1'
          ? { username: 'hue-key' }
          : id === 'nl-1'
            ? { token: 'nl-token' }
            : null,
      has: (id) => id === 'hue-1' || id === 'nl-1',
    }
  }

  function providerClient(
    state: LightDeviceState,
    writes: Array<{ target: LightTarget | 'power'; value: number }> = [],
    reads?: { count: number },
  ): LightDeviceClient {
    let current = { ...state }
    return {
      getState: async () => {
        if (reads) reads.count += 1
        return { ...current }
      },
      setState: async (patch: LightStatePatch) => {
        current = { ...current, ...patch }
        return { ...current }
      },
      setTarget: async (target, value) => {
        writes.push({ target, value })
        if (target === 'power') current.on = value >= 50
        else if (target === 'brightness') current.brightness = value
        else current.temperature = value
        return { ...current }
      },
    }
  }

  it('dispatches each configured provider through the default factory', () => {
    expect(createDefaultLightClient(hue, { username: 'hue-key' })).toBeInstanceOf(HueClient)
    expect(createDefaultLightClient(nanoleaf, { token: 'nl-token' })).toBeInstanceOf(
      NanoleafClient,
    )
    expect(
      createDefaultLightClient(
        { id: 'e', name: 'Elgato', type: 'elgato', host: '10.0.0.1', port: 9123 },
        {},
      ),
    ).toBeInstanceOf(ElgatoClient)
  })

  it('passes each device its own credentials and caches per-device reads', async () => {
    const seen: Array<[string, LightCredentials]> = []
    const hueReads = { count: 0 }
    const nanoleafReads = { count: 0 }
    const source = new LightStateSource({
      ttlMs: 900,
      credentials: providerCredentials(),
      createClient: (device, credentials) => {
        seen.push([device.id, credentials])
        return device.id === 'hue-1'
          ? providerClient({ on: true, brightness: 37, temperature: 250 }, [], hueReads)
          : providerClient({ on: false, brightness: 80, temperature: 200 }, [], nanoleafReads)
      },
    })
    sources.push(source)
    source.configure([hue, nanoleaf])

    expect(seen).toEqual([
      ['hue-1', { username: 'hue-key' }],
      ['nl-1', { token: 'nl-token' }],
    ])

    await expect(source.readStatus('hue-1', 'brightness')).resolves.toMatchObject({
      active: true,
      value: 0.37,
      available: true,
      detail: '37%',
    })
    await expect(source.readStatus('hue-1', 'brightness')).resolves.toMatchObject({
      detail: '37%',
    })
    expect(hueReads.count).toBe(1)

    await expect(source.readStatus('nl-1', 'power')).resolves.toMatchObject({
      active: false,
      value: 0,
      detail: 'OFF',
    })
    await expect(source.readStatus('nl-1', 'temperature')).resolves.toMatchObject({
      active: false,
      detail: 'OFF',
    })
    expect(nanoleafReads.count).toBe(1)
  })

  it('keeps one unavailable provider from hiding the others', async () => {
    const source = new LightStateSource({
      ttlMs: 0,
      credentials: providerCredentials(),
      createClient: (device) =>
        device.id === 'hue-1'
          ? providerClient({ on: true, brightness: 50, temperature: 250 })
          : {
              ...providerClient({ on: false, brightness: 0, temperature: 250 }),
              getState: async () => {
                throw new Error('Nanoleaf at 10.0.0.21:16021 timed out after 3000 ms')
              },
            },
    })
    sources.push(source)
    source.configure([hue, nanoleaf])

    const statuses = await source.listStatuses()
    expect(statuses[0]).toMatchObject({
      id: 'hue-1',
      type: 'hue',
      lightId: '4',
      available: true,
    })
    expect(statuses[1]).toMatchObject({
      id: 'nl-1',
      type: 'nanoleaf',
      available: false,
    })
    expect(statuses[1]!.error).toMatch(/timed out/)
  })

  it('reports a missing credential as a quiet NO LIGHT condition', async () => {
    const source = new LightStateSource({
      credentials: { get: () => null, has: () => false },
    })
    sources.push(source)
    source.configure([hue])

    await expect(source.readStatus('hue-1', 'power')).rejects.toThrow(
      /application key is missing/,
    )
    await expect(source.listStatuses()).resolves.toMatchObject([
      { id: 'hue-1', available: false, error: expect.stringMatching(/application key is missing/) },
    ])
    await expect(source.test('hue-1')).resolves.toMatchObject({
      id: 'hue-1',
      available: false,
    })
  })

  it('routes raw levels and power through each provider client', async () => {
    const writes = new Map<string, Array<{ target: LightTarget | 'power'; value: number }>>()
    const source = new LightStateSource({
      ttlMs: 0,
      credentials: providerCredentials(),
      createClient: (device) => {
        const target: Array<{ target: LightTarget | 'power'; value: number }> = []
        writes.set(device.id, target)
        return providerClient({ on: true, brightness: 50, temperature: 250 }, target)
      },
    })
    sources.push(source)
    source.configure([hue, nanoleaf])

    await source.setLevel('hue-1', 'brightness', 73)
    await source.setPower('nl-1', false)
    await source.setNormalizedLevel('nl-1', 'temperature', 0.5)

    expect(writes.get('hue-1')).toEqual([{ target: 'brightness', value: 73 }])
    expect(writes.get('nl-1')).toEqual([
      { target: 'power', value: 0 },
      { target: 'temperature', value: expect.any(Number) },
    ])
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
