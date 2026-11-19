import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type {
  AudioDeviceKind,
  AudioDevicesStateMessage,
  ClientMessage,
  DeckConfig,
  ServerMessage,
} from '@phonedek/shared'
import { AUDIO_DEVICE_CAPABILITY, createDefaultConfig } from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import {
  AudioDeviceService,
  DeckServer,
  audioDevicesStateSignature,
  serverCapabilities,
  toAudioDevicesStateMessage,
  type AudioDeviceCommandRequest,
  type AudioDeviceHub,
  type AudioDeviceSubscription,
} from '../src/main/server'
import type {
  AudioDeviceController,
  AudioDeviceEntry,
  AudioDeviceSnapshot,
} from '../src/main/audio-device-source'

const OUTPUT_ID = 'a1b2c3d4e5f6'
const INPUT_ID = '9f8e7d6c5b4a'

function entry(overrides: Partial<AudioDeviceEntry> = {}): AudioDeviceEntry {
  return {
    id: OUTPUT_ID,
    name: 'Headphones (HyperX Cloud II)',
    deviceKind: 'output',
    form: 'headphones',
    current: true,
    available: true,
    ...overrides,
  }
}

function snapshot(overrides: Partial<AudioDeviceSnapshot> = {}): AudioDeviceSnapshot {
  const output = overrides.output ?? [entry()]
  const input =
    overrides.input ?? [
      entry({
        id: INPUT_ID,
        name: 'Shure MV7',
        deviceKind: 'input',
        form: 'usb',
      }),
    ]
  return {
    available: true,
    output,
    input,
    currentOutputId: overrides.currentOutputId ?? output.find((item) => item.current)?.id,
    currentInputId: overrides.currentInputId ?? input.find((item) => item.current)?.id,
    updatedAt: overrides.updatedAt ?? 1000,
    ...overrides,
  }
}

class FakeAudioDeviceController implements AudioDeviceController {
  data: AudioDeviceSnapshot = snapshot()
  listCalls = 0
  currentCalls: AudioDeviceKind[] = []
  setCalls: Array<{ kind: AudioDeviceKind; id: string }> = []
  listFailure: Error | null = null
  setFailure: Error | null = null

  async list(): Promise<AudioDeviceSnapshot> {
    this.listCalls += 1
    if (this.listFailure) throw this.listFailure
    return { ...this.data, output: [...this.data.output], input: [...this.data.input] }
  }

  async current(kind: AudioDeviceKind): Promise<AudioDeviceEntry> {
    this.currentCalls.push(kind)
    const found = (kind === 'output' ? this.data.output : this.data.input).find(
      (item) => item.current,
    )
    if (!found) throw new Error('No current audio device')
    return { ...found }
  }

  async setDefault(kind: AudioDeviceKind, ref: { id?: string; name?: string }): Promise<AudioDeviceEntry> {
    if (this.setFailure) throw this.setFailure
    const id = ref.id ?? ''
    this.setCalls.push({ kind, id })
    const list = kind === 'output' ? this.data.output : this.data.input
    const target = list.find((item) => item.id === id)
    if (!target) throw new Error(`Device not found: ${id}`)
    this.data = {
      ...this.data,
      output: this.data.output.map((item) => ({ ...item, current: kind === 'output' && item.id === id })),
      input: this.data.input.map((item) => ({ ...item, current: kind === 'input' && item.id === id })),
      ...(kind === 'output' ? { currentOutputId: id } : { currentInputId: id }),
      updatedAt: 2000,
    }
    return { ...target, current: true }
  }

  async cycle(): Promise<AudioDeviceEntry> {
    return entry()
  }

  dispose(): void {}
}

class FakeAudioDeviceHub implements AudioDeviceHub {
  subscriptions: Array<{ clientId: string; subscription: AudioDeviceSubscription }> = []
  cleared: string[] = []
  commands: AudioDeviceCommandRequest[] = []
  result: { ok: boolean; error?: string; currentId?: string } = { ok: true, currentId: OUTPUT_ID }
  commandFailure: Error | null = null

  async subscribe(clientId: string, subscription: AudioDeviceSubscription): Promise<void> {
    this.subscriptions.push({ clientId, subscription })
  }

  unsubscribe(clientId: string): void {
    this.cleared.push(clientId)
  }

  async command(
    command: AudioDeviceCommandRequest,
  ): Promise<{ ok: boolean; error?: string; currentId?: string }> {
    if (this.commandFailure) throw this.commandFailure
    this.commands.push(command)
    return this.result
  }
}

interface Harness {
  server: DeckServer
  port: number
  token: string
  config: DeckConfig
  dir: string
}

const cleanups: Array<() => Promise<void>> = []

async function harness(
  options: {
    audioDevices?: AudioDeviceHub
    audioDevicesSupported?: boolean | (() => boolean)
  } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-audio-devices-'))
  const config = createDefaultConfig()
  const server = new DeckServer({
    port: 0,
    token: 'audio-token',
    version: '0.19.1',
    assets: new AssetStore(join(dir, 'assets')),
    getConfig: () => config,
    getServerName: () => config.serverName,
    onPress: async () => ({ ok: true }),
    ...(options.audioDevices ? { audioDevices: options.audioDevices } : {}),
    ...(options.audioDevicesSupported === undefined
      ? {}
      : {
          audioDevicesSupported:
            typeof options.audioDevicesSupported === 'function'
              ? options.audioDevicesSupported
              : () => options.audioDevicesSupported === true,
        }),
  })
  const port = await server.start()
  cleanups.push(async () => {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })
  return { server, port, token: 'audio-token', config, dir }
}

function waitFor<T>(fn: () => T | undefined | null | false, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      const value = fn()
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('Timed out waiting for condition'))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

function openSocket(target: string): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target)
    const messages: ServerMessage[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage))
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

async function connect(
  h: Harness,
  capabilities: string[],
): Promise<{ ws: WebSocket; messages: ServerMessage[]; clientId: string }> {
  const before = new Set(h.server.getClients().map((client) => client.id))
  const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
  await waitFor(() => messages.find((message) => message.type === 'hello'))
  ws.send(
    JSON.stringify({
      type: 'hello',
      protocol: 1,
      device: { name: 'Test phone', model: 'test' },
      capabilities,
    } satisfies ClientMessage),
  )
  const client = await waitFor(() =>
    h.server.getClients().find(
      (candidate) =>
        !before.has(candidate.id) && candidate.capabilities?.length === capabilities.length,
    ),
  )
  return { ws, messages, clientId: client.id }
}

function subscribe(phase: 'start' | 'stop'): ClientMessage {
  return { type: 'audioDevices', phase }
}

function setMessage(overrides: Partial<{ requestId: string; deviceKind: AudioDeviceKind; deviceId: string }> = {}): ClientMessage {
  return {
    type: 'audioDeviceSet',
    requestId: 'req-1',
    deviceKind: 'output',
    deviceId: OUTPUT_ID,
    ...overrides,
  }
}

function stateMessage(overrides: Partial<AudioDevicesStateMessage> = {}): AudioDevicesStateMessage {
  return {
    type: 'audioDevicesState',
    available: true,
    output: [
      {
        id: OUTPUT_ID,
        name: 'Headphones (HyperX Cloud II)',
        deviceKind: 'output',
        form: 'headphones',
        current: true,
        available: true,
      },
    ],
    input: [],
    currentOutputId: OUTPUT_ID,
    updatedAt: 1,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('audio device capability gating', () => {
  it('advertises audio-device-v1 only when a controller exists', async () => {
    const supported = await harness({
      audioDevices: new FakeAudioDeviceHub(),
      audioDevicesSupported: true,
    })
    const info = await fetch(`http://127.0.0.1:${supported.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain(AUDIO_DEVICE_CAPABILITY)

    const socket = await openSocket(
      `ws://127.0.0.1:${supported.port}/ws?token=${supported.token}`,
    )
    const hello = await waitFor(() => socket.messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).toContain(AUDIO_DEVICE_CAPABILITY)
    socket.ws.close()

    const unsupported = await harness({ audioDevicesSupported: false })
    const noInfo = await fetch(`http://127.0.0.1:${unsupported.port}/api/info`)
    const noBody = (await noInfo.json()) as { capabilities?: string[] }
    expect(noBody.capabilities).not.toContain(AUDIO_DEVICE_CAPABILITY)

    const noSocket = await openSocket(
      `ws://127.0.0.1:${unsupported.port}/ws?token=${unsupported.token}`,
    )
    const noHello = await waitFor(() =>
      noSocket.messages.find((message) => message.type === 'hello'),
    )
    expect(noHello.capabilities).not.toContain(AUDIO_DEVICE_CAPABILITY)
    noSocket.ws.close()
  })

  it('keeps the capability absent without a hub even when a flag says supported', async () => {
    const capabilities = serverCapabilities(
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    )
    expect(capabilities).not.toContain(AUDIO_DEVICE_CAPABILITY)
    expect(capabilities).toContain('control-state-v1')

    const flagged = await harness({ audioDevicesSupported: true })
    const info = await fetch(`http://127.0.0.1:${flagged.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).not.toContain(AUDIO_DEVICE_CAPABILITY)
  })
})

describe('audio device subscriptions', () => {
  it('subscribes after start and forwards snapshots until stop', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages, clientId } = await connect(h, ['audio-device-v1'])

    ws.send(JSON.stringify(subscribe('start')))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.clientId).toBe(clientId)

    call.subscription.send(stateMessage({ updatedAt: 10 }))
    expect(
      await waitFor(() => messages.find((message) => message.type === 'audioDevicesState')),
    ).toMatchObject({ type: 'audioDevicesState', available: true, currentOutputId: OUTPUT_ID })

    ws.send(JSON.stringify(subscribe('stop')))
    await waitFor(() => fake.cleared.includes(clientId))
    expect(fake.subscriptions).toHaveLength(1)
    ws.close()
  })

  it('ignores start for old clients and sends them nothing', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const old = await connect(h, ['input-v1'])
    old.ws.send(JSON.stringify(subscribe('start')))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fake.subscriptions).toHaveLength(0)
    expect(old.messages.some((message) => message.type === 'audioDevicesState')).toBe(false)
    expect(old.messages.some((message) => message.type === 'error')).toBe(false)
    old.ws.close()
  })

  it('rate limits start/stop to 2/s per client', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages } = await connect(h, ['audio-device-v1'])

    ws.send(JSON.stringify(subscribe('start')))
    ws.send(JSON.stringify(subscribe('start')))
    ws.send(JSON.stringify(subscribe('start')))
    const limited = await waitFor(() =>
      messages.find((message) => message.type === 'error' && message.code === 'RATE_LIMITED'),
    )
    expect(limited).toMatchObject({ code: 'RATE_LIMITED' })
    expect(fake.subscriptions).toHaveLength(2)

    // Normal traffic still works after the limit.
    ws.send(JSON.stringify({ type: 'ping', t: 7 }))
    expect(await waitFor(() => messages.find((message) => message.type === 'pong'))).toEqual({
      type: 'pong',
      t: 7,
    })

    // A stop always releases, even after the limiter tripped.
    ws.send(JSON.stringify(subscribe('stop')))
    await waitFor(() => fake.cleared.length === 1)
    ws.close()
  })

  it('unsubscribes every watcher on close and server stop', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const first = await connect(h, ['audio-device-v1'])
    first.ws.send(JSON.stringify(subscribe('start')))
    await waitFor(() => fake.subscriptions[0])
    first.ws.close()
    await waitFor(() => fake.cleared.includes(first.clientId))

    const second = await connect(h, ['audio-device-v1'])
    second.ws.send(JSON.stringify(subscribe('start')))
    await waitFor(() => fake.subscriptions.length === 2)
    await h.server.stop()
    expect(fake.cleared).toContain(second.clientId)
    second.ws.close()
  })

  it('ignores audio traffic when the host has no controller', async () => {
    const h = await harness()
    const { ws, messages } = await connect(h, ['audio-device-v1'])
    ws.send(JSON.stringify(subscribe('start')))
    ws.send(JSON.stringify(setMessage()))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(messages.some((message) => message.type === 'audioDevicesState')).toBe(false)
    expect(messages.some((message) => message.type === 'error')).toBe(false)
    const result = await waitFor(() =>
      messages.find((message) => message.type === 'audioDeviceResult'),
    )
    expect(result).toMatchObject({ type: 'audioDeviceResult', requestId: 'req-1', ok: false })
    expect((result as { error: string }).error).toContain('not available')
    ws.close()
  })
})

describe('audio device sets', () => {
  it('forwards a set and replies with the new current id', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages } = await connect(h, ['audio-device-v1'])

    ws.send(JSON.stringify(setMessage()))
    const result = await waitFor(() => messages.find((message) => message.type === 'audioDeviceResult'))
    expect(fake.commands).toEqual([{ deviceKind: 'output', deviceId: OUTPUT_ID }])
    expect(result).toEqual({
      type: 'audioDeviceResult',
      requestId: 'req-1',
      ok: true,
      currentId: OUTPUT_ID,
    })
    ws.close()
  })

  it('forwards a service error and never falls back to another device', async () => {
    const fake = new FakeAudioDeviceHub()
    fake.result = { ok: false, error: 'That audio device is no longer available.' }
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages } = await connect(h, ['audio-device-v1'])
    ws.send(JSON.stringify(setMessage({ requestId: 'req-missing' })))
    const result = await waitFor(() => messages.find((message) => message.type === 'audioDeviceResult'))
    expect(result).toEqual({
      type: 'audioDeviceResult',
      requestId: 'req-missing',
      ok: false,
      error: 'That audio device is no longer available.',
    })
    expect(fake.commands).toHaveLength(1)
    ws.close()
  })

  it('correlates a thrown service failure into audioDeviceResult', async () => {
    const fake = new FakeAudioDeviceHub()
    fake.commandFailure = new Error('Audio device helper stopped unexpectedly')
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages } = await connect(h, ['audio-device-v1'])
    ws.send(JSON.stringify(setMessage({ requestId: 'req-crash' })))
    const result = await waitFor(() => messages.find((message) => message.type === 'audioDeviceResult'))
    expect(result).toMatchObject({
      requestId: 'req-crash',
      ok: false,
      error: 'Audio device helper stopped unexpectedly',
    })
    ws.close()
  })

  it('rejects old clients and malformed ids with a correlated result', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const old = await connect(h, ['input-v1'])
    old.ws.send(JSON.stringify(setMessage()))
    const rejected = await waitFor(() => old.messages.find((message) => message.type === 'audioDeviceResult'))
    expect(rejected).toMatchObject({ ok: false })
    expect((rejected as { error: string }).error).toContain('Update the PhoneDeck app')
    expect(fake.commands).toHaveLength(0)
    old.ws.close()

    const current = await connect(h, ['audio-device-v1'])
    // The shared schema accepts 1-char ids; the service strengthens this to
    // 8..64 alphanumeric characters and must answer in-band.
    current.ws.send(JSON.stringify(setMessage({ requestId: 'req-short', deviceId: 'abc' })))
    const malformed = await waitFor(() =>
      current.messages.find((message) => message.type === 'audioDeviceResult'),
    )
    expect(malformed).toMatchObject({ requestId: 'req-short', ok: false })
    expect((malformed as { error: string }).error).toContain('Invalid audio device')
    expect(fake.commands).toHaveLength(0)

    current.ws.send(
      JSON.stringify({
        type: 'audioDeviceSet',
        requestId: 'req-shape',
        deviceKind: 'speaker',
        deviceId: OUTPUT_ID,
      }),
    )
    const shape = await waitFor(() =>
      current.messages
        .filter((message) => message.type === 'audioDeviceResult')
        .find((message) => (message as { requestId?: string }).requestId === 'req-shape'),
    )
    expect(shape).toMatchObject({ requestId: 'req-shape', ok: false })
    expect(current.messages.some((message) => message.type === 'error')).toBe(false)
    current.ws.close()
  })

  it('rate limits command bursts to 8/s', async () => {
    const fake = new FakeAudioDeviceHub()
    const h = await harness({ audioDevices: fake, audioDevicesSupported: true })
    const { ws, messages } = await connect(h, ['audio-device-v1'])

    for (let index = 0; index < 9; index += 1) {
      ws.send(JSON.stringify(setMessage({ requestId: `req-${index}` })))
    }
    await waitFor(() => messages.filter((message) => message.type === 'audioDeviceResult').length === 9)
    const results = messages.filter((message) => message.type === 'audioDeviceResult')
    expect(results.filter((message) => message.ok)).toHaveLength(8)
    expect(results.filter((message) => !message.ok)).toEqual([
      expect.objectContaining({
        requestId: 'req-8',
        ok: false,
        error: 'Too many audio device changes, slow down',
      }),
    ])
    expect(fake.commands).toHaveLength(8)
    ws.close()
  })
})

describe('audio device service', () => {
  const services: AudioDeviceService[] = []
  afterEach(() => {
    for (const service of services.splice(0)) service.dispose()
  })

  function createService(controller: AudioDeviceController, pollIntervalMs = 30): AudioDeviceService {
    const service = new AudioDeviceService({ controller, pollIntervalMs })
    services.push(service)
    return service
  }

  it('sends an immediate snapshot with the documented payload shape', async () => {
    const controller = new FakeAudioDeviceController()
    const service = createService(controller)
    const messages: AudioDevicesStateMessage[] = []
    await service.subscribe('client-1', { send: (message) => messages.push(message) })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({
      type: 'audioDevicesState',
      available: true,
      output: [
        {
          id: OUTPUT_ID,
          name: 'Headphones (HyperX Cloud II)',
          deviceKind: 'output',
          form: 'headphones',
          current: true,
          available: true,
        },
      ],
      input: [
        {
          id: INPUT_ID,
          name: 'Shure MV7',
          deviceKind: 'input',
          form: 'usb',
          current: true,
          available: true,
        },
      ],
      currentOutputId: OUTPUT_ID,
      currentInputId: INPUT_ID,
      updatedAt: 1000,
    })
  })

  it('polls at ~1 Hz while subscribed and stops after unsubscribe', async () => {
    const controller = new FakeAudioDeviceController()
    const service = createService(controller)
    const messages: AudioDevicesStateMessage[] = []
    await service.subscribe('client-1', { send: (message) => messages.push(message) })
    expect(controller.listCalls).toBe(1)

    await waitFor(() => controller.listCalls >= 3)
    // Unchanged snapshots are not re-sent.
    expect(messages).toHaveLength(1)

    controller.data = { ...controller.data, updatedAt: 5000, currentOutputId: undefined }
    controller.data.output = [
      entry({ id: 'ffffffffffff', name: 'Speakers (Realtek(R) Audio)', form: 'speakers' }),
    ]
    controller.data.currentOutputId = 'ffffffffffff'
    await waitFor(() => messages.length === 2)
    expect(messages[1]!.currentOutputId).toBe('ffffffffffff')

    service.unsubscribe('client-1')
    const calls = controller.listCalls
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(controller.listCalls).toBe(calls)
  })

  it('sets a device by opaque id, broadcasts the new state and notifies control state', async () => {
    const controller = new FakeAudioDeviceController()
    const changed: AudioDeviceKind[] = []
    const service = new AudioDeviceService({
      controller,
      pollIntervalMs: 30,
      onChanged: (kind) => {
        changed.push(kind)
      },
    })
    services.push(service)
    const messages: AudioDevicesStateMessage[] = []
    await service.subscribe('client-1', { send: (message) => messages.push(message) })
    messages.length = 0

    const result = await service.command({ deviceKind: 'input', deviceId: INPUT_ID })
    expect(result).toEqual({ ok: true, currentId: INPUT_ID })
    expect(controller.setCalls).toEqual([{ kind: 'input', id: INPUT_ID }])
    expect(changed).toEqual(['input'])
    // The write invalidates the controller cache and pushes a fresh snapshot to
    // every subscriber, including the requesting phone.
    const latest = messages.at(-1)!
    expect(latest.currentInputId).toBe(INPUT_ID)
    expect(latest.input.every((item) => item.available)).toBe(true)
  })

  it('rejects unknown ids and unavailable hosts without writing', async () => {
    const controller = new FakeAudioDeviceController()
    const service = createService(controller)
    const unknown = await service.command({ deviceKind: 'output', deviceId: 'deadbeefdead' })
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toContain('no longer available')
    expect(controller.setCalls).toHaveLength(0)

    controller.data = { available: false, reason: 'Audio device helper not found.', output: [], input: [], updatedAt: 0 }
    const unavailable = await service.command({ deviceKind: 'output', deviceId: OUTPUT_ID })
    expect(unavailable).toEqual({ ok: false, error: 'Audio device helper not found.' })
    expect(controller.setCalls).toHaveLength(0)

    const empty = new AudioDeviceService()
    services.push(empty)
    const missing = await empty.command({ deviceKind: 'output', deviceId: OUTPUT_ID })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('not available')
    const states: AudioDevicesStateMessage[] = []
    await empty.subscribe('client-1', { send: (message) => states.push(message) })
    expect(states[0]).toMatchObject({ available: false, output: [], input: [] })
    expect(states[0]!.reason).toBeTruthy()
  })

  it('maps wires safely: drops invalid ids, clamps names and lists', () => {
    const message = toAudioDevicesStateMessage(
      snapshot({
        output: [
          entry({ id: 'not a valid id!' }),
          entry({ id: 'abcdef012345', name: 'x'.repeat(300) }),
        ],
        input: [],
      }),
    )
    expect(message.output).toHaveLength(1)
    expect(message.output[0]!.name).toHaveLength(120)
    expect(audioDevicesStateSignature(snapshot())).not.toContain('1000')
  })
})
