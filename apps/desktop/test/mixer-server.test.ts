import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type {
  ClientMessage,
  DeckConfig,
  MixerCommandMessage,
  MixerStateMessage,
  ServerMessage,
} from '@phonedek/shared'
import { createDefaultConfig } from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import { DeckServer, type MixerHub } from '../src/main/server'

interface SubscriptionCall {
  clientId: string
  subscription: { send: (message: MixerStateMessage) => void }
}

class FakeMixerHub implements MixerHub {
  subscriptions: SubscriptionCall[] = []
  cleared: string[] = []
  commands: MixerCommandMessage[] = []
  result: { ok: boolean; error?: string } = { ok: true }
  commandFailure: Error | null = null

  async subscribe(clientId: string, subscription: { send: (message: MixerStateMessage) => void }) {
    this.subscriptions.push({ clientId, subscription })
  }

  unsubscribe(clientId: string): void {
    this.cleared.push(clientId)
  }

  async command(message: MixerCommandMessage): Promise<{ ok: boolean; error?: string }> {
    if (this.commandFailure) throw this.commandFailure
    this.commands.push(message)
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

async function harness(options: {
  mixer?: MixerHub
  mixerSupported?: boolean | (() => boolean)
} = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-mixer-'))
  const config = createDefaultConfig()
  const server = new DeckServer({
    port: 0,
    token: 'mixer-token',
    version: '0.9.0',
    assets: new AssetStore(join(dir, 'assets')),
    getConfig: () => config,
    getServerName: () => config.serverName,
    onPress: async () => ({ ok: true }),
    ...(options.mixer ? { mixer: options.mixer } : {}),
    ...(options.mixerSupported === undefined
      ? {}
      : {
          mixerSupported:
            typeof options.mixerSupported === 'function'
              ? options.mixerSupported
              : () => options.mixerSupported === true,
        }),
  })
  const port = await server.start()
  cleanups.push(async () => {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })
  return { server, port, token: 'mixer-token', config, dir }
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

async function connect(h: Harness, capabilities: string[]): Promise<{
  ws: WebSocket
  messages: ServerMessage[]
  clientId: string
}> {
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
  // Hello parsing is async; the server does not echo the client id.
  const client = await waitFor(() =>
    h.server.getClients().find(
      (candidate) =>
        !before.has(candidate.id) && candidate.capabilities?.length === capabilities.length,
    ),
  )
  return { ws, messages, clientId: client.id }
}

function mixerMessage(phase: 'start' | 'stop'): ClientMessage {
  return { type: 'mixer', phase }
}

function stateMessage(updatedAt = 1): MixerStateMessage {
  return {
    type: 'mixerState',
    available: true,
    sessions: [
      {
        id: 'sink-input-42',
        process: 'chrome',
        name: 'Google Chrome',
        volume: 42,
        muted: false,
        available: true,
      },
    ],
    updatedAt,
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('mixer capability gating', () => {
  it('advertises mixer-v1 only when the host supports per-app audio', async () => {
    const supported = await harness({ mixer: new FakeMixerHub(), mixerSupported: true })
    const info = await fetch(`http://127.0.0.1:${supported.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain('mixer-v1')

    const socket = await openSocket(
      `ws://127.0.0.1:${supported.port}/ws?token=${supported.token}`,
    )
    const hello = await waitFor(() => socket.messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).toContain('mixer-v1')
    socket.ws.close()

    const unsupported = await harness({ mixerSupported: false })
    const noInfo = await fetch(`http://127.0.0.1:${unsupported.port}/api/info`)
    const noBody = (await noInfo.json()) as { capabilities?: string[] }
    expect(noBody.capabilities).not.toContain('mixer-v1')

    const noSocket = await openSocket(
      `ws://127.0.0.1:${unsupported.port}/ws?token=${unsupported.token}`,
    )
    const noHello = await waitFor(() =>
      noSocket.messages.find((message) => message.type === 'hello'),
    )
    expect(noHello.capabilities).not.toContain('mixer-v1')
    noSocket.ws.close()
  })

  it('honours a dynamic capability switch', async () => {
    let supported = false
    const h = await harness({ mixer: new FakeMixerHub(), mixerSupported: () => supported })
    let info = (await (await fetch(`http://127.0.0.1:${h.port}/api/info`)).json()) as {
      capabilities?: string[]
    }
    expect(info.capabilities).not.toContain('mixer-v1')
    supported = true
    info = (await (await fetch(`http://127.0.0.1:${h.port}/api/info`)).json()) as {
      capabilities?: string[]
    }
    expect(info.capabilities).toContain('mixer-v1')
  })
})

describe('mixer subscriptions', () => {
  it('subscribes after a start and forwards snapshots until stop', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, messages, clientId } = await connect(h, ['input-v1', 'mixer-v1'])

    ws.send(JSON.stringify(mixerMessage('start')))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.clientId).toBe(clientId)

    call.subscription.send(stateMessage(10))
    expect(await waitFor(() => messages.find((message) => message.type === 'mixerState'))).toMatchObject(
      { type: 'mixerState', available: true },
    )

    ws.send(JSON.stringify(mixerMessage('stop')))
    await waitFor(() => fake.cleared.includes(clientId))
    expect(fake.subscriptions).toHaveLength(1)
    ws.close()
  })

  it('ignores start for old clients and cleans up on close', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const old = await connect(h, ['input-v1'])
    old.ws.send(JSON.stringify(mixerMessage('start')))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fake.subscriptions).toHaveLength(0)
    expect(old.messages.some((message) => message.type === 'mixerState')).toBe(false)
    expect(old.messages.some((message) => message.type === 'error')).toBe(false)

    const current = await connect(h, ['mixer-v1'])
    current.ws.send(JSON.stringify(mixerMessage('start')))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.clientId).toBe(current.clientId)

    current.ws.close()
    await waitFor(() => fake.cleared.includes(current.clientId))
    old.ws.close()
  })

  it('rate limits start/stop and leaves old traffic untouched', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, messages } = await connect(h, ['mixer-v1'])

    ws.send(JSON.stringify(mixerMessage('start')))
    ws.send(JSON.stringify(mixerMessage('start')))
    ws.send(JSON.stringify(mixerMessage('start')))
    const limited = await waitFor(() =>
      messages.find(
        (message) => message.type === 'error' && message.code === 'RATE_LIMITED',
      ),
    )
    expect(limited).toMatchObject({ code: 'RATE_LIMITED' })
    expect(fake.subscriptions).toHaveLength(2)

    // Normal traffic still works after the limit.
    ws.send(JSON.stringify({ type: 'ping', t: 7 }))
    const pong = await waitFor(() => messages.find((message) => message.type === 'pong'))
    expect(pong).toEqual({ type: 'pong', t: 7 })

    // A stop always releases the subscription.
    ws.send(JSON.stringify(mixerMessage('stop')))
    await waitFor(() => fake.cleared.length === 1)
    ws.close()
  })

  it('ignores mixer traffic when the host has no mixer', async () => {
    const h = await harness()
    const { ws, messages } = await connect(h, ['mixer-v1'])
    ws.send(JSON.stringify(mixerMessage('start')))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(messages.some((message) => message.type === 'mixerState')).toBe(false)
    expect(messages.some((message) => message.type === 'error')).toBe(false)

    // Normal traffic on the same connection is unaffected.
    ws.send(JSON.stringify({ type: 'ping', t: 9 }))
    expect(await waitFor(() => messages.find((message) => message.type === 'pong'))).toEqual({
      type: 'pong',
      t: 9,
    })
    ws.close()
  })

  it('unsubscribes every watcher when the server stops', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, clientId } = await connect(h, ['mixer-v1'])
    ws.send(JSON.stringify(mixerMessage('start')))
    await waitFor(() => fake.subscriptions[0])

    await h.server.stop()
    expect(fake.cleared).toContain(clientId)
    ws.close()
  })
})

describe('mixer commands', () => {
  function command(overrides: Partial<MixerCommandMessage> = {}): MixerCommandMessage {
    return {
      type: 'mixerCommand',
      requestId: 'req-1',
      sessionId: 'sink-input-42',
      volume: 55,
      ...overrides,
    }
  }

  it('forwards a volume write and acks success', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, messages } = await connect(h, ['mixer-v1'])

    ws.send(JSON.stringify(command()))
    const result = await waitFor(() =>
      messages.find((message) => message.type === 'mixerResult'),
    )
    expect(fake.commands).toEqual([command()])
    expect(result).toEqual({ type: 'mixerResult', requestId: 'req-1', ok: true })

    ws.send(JSON.stringify(command({ requestId: 'req-2', volume: undefined, muted: true })))
    await waitFor(() => fake.commands.length === 2)
    const muteResult = await waitFor(() =>
      messages.filter((message) => message.type === 'mixerResult')[1],
    )
    expect(muteResult).toEqual({ type: 'mixerResult', requestId: 'req-2', ok: true })
    ws.close()
  })

  it('returns clear errors from the source and from an unsupported host', async () => {
    const fake = new FakeMixerHub()
    fake.result = { ok: false, error: 'That audio session is no longer available.' }
    const h = await harness({ mixer: fake, mixerSupported: true })
    const failed = await connect(h, ['mixer-v1'])
    failed.ws.send(JSON.stringify(command()))
    const error = await waitFor(() =>
      failed.messages.find((message) => message.type === 'mixerResult'),
    )
    expect(error).toEqual({
      type: 'mixerResult',
      requestId: 'req-1',
      ok: false,
      error: 'That audio session is no longer available.',
    })
    failed.ws.close()

    const missing = new FakeMixerHub()
    const noHost = await harness({ mixer: missing, mixerSupported: false })
    const target = await connect(noHost, ['mixer-v1'])
    target.ws.send(JSON.stringify(command()))
    const unavailable = await waitFor(() =>
      target.messages.find((message) => message.type === 'mixerResult'),
    )
    expect(unavailable).toMatchObject({ ok: false })
    expect((unavailable as { error: string }).error).toContain('not available')
    expect(missing.commands).toHaveLength(0)
    target.ws.close()
  })

  it('acks an out-of-range command with a correlated mixerResult', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, messages } = await connect(h, ['mixer-v1'])

    ws.send(JSON.stringify(command({ requestId: 'bad-volume', volume: 150 })))
    const result = await waitFor(() =>
      messages.find((message) => message.type === 'mixerResult'),
    )
    expect(result).toMatchObject({ type: 'mixerResult', requestId: 'bad-volume', ok: false })
    expect((result as { error?: string }).error).toMatch(/100/)
    expect(messages.some((message) => message.type === 'error')).toBe(false)
    expect(fake.commands).toHaveLength(0)
    ws.close()
  })

  it('rejects commands from clients without mixer-v1', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const old = await connect(h, ['input-v1'])
    old.ws.send(JSON.stringify(command()))
    const result = await waitFor(() =>
      old.messages.find((message) => message.type === 'mixerResult'),
    )
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: string }).error).toContain('Update the PhoneDeck app')
    expect(fake.commands).toHaveLength(0)
    old.ws.close()
  })

  it('rate limits command bursts with a clear result', async () => {
    const fake = new FakeMixerHub()
    const h = await harness({ mixer: fake, mixerSupported: true })
    const { ws, messages } = await connect(h, ['mixer-v1'])

    for (let index = 0; index < 26; index += 1) {
      ws.send(JSON.stringify(command({ requestId: `req-${index}` })))
    }
    await waitFor(
      () => messages.filter((message) => message.type === 'mixerResult').length === 26,
    )
    const results = messages.filter((message) => message.type === 'mixerResult')
    expect(results.filter((message) => message.ok)).toHaveLength(25)
    expect(results.filter((message) => !message.ok)).toEqual([
      expect.objectContaining({
        requestId: 'req-25',
        ok: false,
        error: 'Too many mixer commands, slow down',
      }),
    ])
    expect(fake.commands).toHaveLength(25)
    ws.close()
  })
})
