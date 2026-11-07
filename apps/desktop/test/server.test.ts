import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createDefaultConfig } from '@phonedek/shared'
import type { ClientMessage, DeckConfig, PressMessage, ServerMessage } from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import { DeckServer, type PressContext } from '../src/main/server'

interface Harness {
  server: DeckServer
  port: number
  token: string
  config: DeckConfig
  assets: AssetStore
  presses: PressMessage[]
  contexts: PressContext[]
}

const cleanups: Array<() => Promise<void>> = []

async function harness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-server-'))
  const config = createDefaultConfig()
  config.serverName = 'Test deck'
  const assets = new AssetStore(join(dir, 'assets'))
  const presses: PressMessage[] = []
  const contexts: PressContext[] = []
  const token = 'test-token-123'
  const server = new DeckServer({
    port: 0,
    token,
    version: '0.1.0',
    assets,
    getConfig: () => config,
    getServerName: () => config.serverName,
    onPress: async (_client, message, context) => {
      presses.push(message)
      contexts.push(context)
      return { ok: true }
    },
  })
  const port = await server.start()
  cleanups.push(() => server.stop())
  return { server, port, token, config, assets, presses, contexts }
}

function url(base: string, path: string, token?: string): string {
  const target = new URL(path, base)
  if (token) target.searchParams.set('token', token)
  return target.toString()
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
      setTimeout(tick, 20)
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

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('DeckServer HTTP', () => {
  it('serves info without auth and config with the token', async () => {
    const h = await harness()
    const base = `http://127.0.0.1:${h.port}`

    const info = await fetch(`${base}/api/info`)
    expect(info.status).toBe(200)
    const infoBody = (await info.json()) as { app: string; serverName: string; protocol: number }
    expect(infoBody).toMatchObject({ app: 'PhoneDeck', serverName: 'Test deck', protocol: 1 })

    expect((await fetch(`${base}/api/config`)).status).toBe(401)
    expect((await fetch(`${base}/api/config?token=wrong`)).status).toBe(401)

    const config = await fetch(`${base}/api/config`, {
      headers: { Authorization: `Bearer ${h.token}` },
    })
    expect(config.status).toBe(200)
    const body = (await config.json()) as DeckConfig
    expect(body.serverName).toBe('Test deck')
    const etag = config.headers.get('etag')
    expect(etag).toBeTruthy()

    const cached = await fetch(`${base}/api/config`, {
      headers: { Authorization: `Bearer ${h.token}`, 'If-None-Match': etag! },
    })
    expect(cached.status).toBe(304)
  })

  it('throttles wrong PIN attempts', async () => {
    const h = await harness()
    const base = `http://127.0.0.1:${h.port}`
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await fetch(`${base}/api/config?token=0000`)).status).toBe(401)
    }
    const blocked = await fetch(`${base}/api/config?token=0000`)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    // Even the correct PIN stays blocked until the window expires.
    expect((await fetch(`${base}/api/config`, { headers: { Authorization: `Bearer ${h.token}` } })).status).toBe(429)
  })

  it('serves imported assets with auth and blocks traversal', async () => {
    const h = await harness()
    const source = join(tmpdir(), `phonedek-${Date.now()}.png`)
    writeFileSync(source, Buffer.from([1, 2, 3, 4]))
    const asset = h.assets.importFile(source)
    const base = `http://127.0.0.1:${h.port}`

    expect((await fetch(`${base}/assets/${asset}`)).status).toBe(401)
    const response = await fetch(url(base, `/assets/${asset}`, h.token))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([1, 2, 3, 4]))

    expect((await fetch(url(base, '/assets/..%2Fconfig.json', h.token))).status).toBe(404)
  })

  it('executes HTTP press fallback', async () => {
    const h = await harness()
    const button = h.config.profiles[0]!.pages[0]!.buttons[0]!
    const response = await fetch(`http://127.0.0.1:${h.port}/api/press`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'press',
        requestId: 'r1',
        profileId: h.config.profiles[0]!.id,
        pageId: h.config.profiles[0]!.pages[0]!.id,
        buttonId: button.id,
      }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(h.presses).toHaveLength(1)
    expect(h.contexts[0]!.button.id).toBe(button.id)
  })
})

describe('DeckServer WebSocket', () => {
  it('sends hello, tracks devices, executes presses and broadcasts config', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)

    const hello = await waitFor(() => messages.find((message) => message.type === 'hello'))
    expect(hello.config.serverName).toBe('Test deck')
    expect(messages.some((message) => message.type === 'hello')).toBe(true)

    const helloMessage: ClientMessage = {
      type: 'hello',
      protocol: 1,
      device: { name: 'Pixel 8', model: 'Google Pixel 8' },
    }
    ws.send(JSON.stringify(helloMessage))
    await waitFor(() => h.server.getClients()[0]?.device?.name === 'Pixel 8')

    const button = h.config.profiles[0]!.pages[0]!.buttons[0]!
    ws.send(
      JSON.stringify({
        type: 'press',
        requestId: 'req-1',
        profileId: h.config.profiles[0]!.id,
        pageId: h.config.profiles[0]!.pages[0]!.id,
        buttonId: button.id,
      }),
    )
    const result = await waitFor(() => messages.find((message) => message.type === 'pressResult'))
    expect(result).toMatchObject({ type: 'pressResult', requestId: 'req-1', ok: true })
    expect(h.presses).toHaveLength(1)

    h.config.serverName = 'Renamed deck'
    h.server.broadcastConfig()
    const update = await waitFor(() =>
      messages.find((message) => message.type === 'config' && message.config.serverName === 'Renamed deck'),
    )
    expect(update.type).toBe('config')

    ws.send(JSON.stringify({ type: 'ping', t: 42 }))
    const pong = await waitFor(() => messages.find((message) => message.type === 'pong'))
    expect(pong).toEqual({ type: 'pong', t: 42 })

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('reports unknown buttons instead of crashing', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    ws.send(
      JSON.stringify({
        type: 'press',
        requestId: 'req-2',
        profileId: h.config.profiles[0]!.id,
        pageId: h.config.profiles[0]!.pages[0]!.id,
        buttonId: 'missing',
      }),
    )
    const result = await waitFor(() => messages.find((message) => message.type === 'pressResult'))
    expect(result).toMatchObject({ ok: false, requestId: 'req-2' })
    if (result.type === 'pressResult') expect(result.error).toMatch(/not found/i)
    ws.close()
  })

  it('rejects a bad WebSocket token', async () => {
    const h = await harness()
    await expect(openSocket(`ws://127.0.0.1:${h.port}/ws?token=nope`)).rejects.toBeTruthy()
  })
})
