import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
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
    const infoBody = (await info.json()) as {
      app: string
      serverName: string
      protocol: number
      capabilities?: string[]
    }
    expect(infoBody).toMatchObject({ app: 'PhoneDeck', serverName: 'Test deck', protocol: 1 })
    expect(infoBody.capabilities).toContain('backup-export-v1')

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

  it('supports byte ranges, HEAD and 416 for video assets', async () => {
    const h = await harness()
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    expect(h.assets.importBuffer('clip.mp4', bytes)).toBe(true)
    const base = `http://127.0.0.1:${h.port}`
    const assetUrl = url(base, '/assets/clip.mp4', h.token)

    // Unauthenticated requests are still rejected.
    expect((await fetch(`${base}/assets/clip.mp4`)).status).toBe(401)

    const full = await fetch(assetUrl)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('content-length')).toBe('8')
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes)

    const partial = await fetch(assetUrl, { headers: { Range: 'bytes=2-4' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('accept-ranges')).toBe('bytes')
    expect(partial.headers.get('content-range')).toBe('bytes 2-4/8')
    expect(partial.headers.get('content-length')).toBe('3')
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(2, 5))

    const openEnded = await fetch(assetUrl, { headers: { Range: 'bytes=5-' } })
    expect(openEnded.status).toBe(206)
    expect(openEnded.headers.get('content-range')).toBe('bytes 5-7/8')
    expect(Buffer.from(await openEnded.arrayBuffer())).toEqual(bytes.subarray(5))

    const suffix = await fetch(assetUrl, { headers: { Range: 'bytes=-3' } })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe('bytes 5-7/8')
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(bytes.subarray(5))

    const clamped = await fetch(assetUrl, { headers: { Range: 'bytes=2-999' } })
    expect(clamped.status).toBe(206)
    expect(clamped.headers.get('content-range')).toBe('bytes 2-7/8')
    expect(Buffer.from(await clamped.arrayBuffer())).toEqual(bytes.subarray(2))

    const head = await fetch(assetUrl, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('accept-ranges')).toBe('bytes')
    expect(head.headers.get('content-length')).toBe('8')
    expect((await head.arrayBuffer()).byteLength).toBe(0)

    const headRange = await fetch(assetUrl, { method: 'HEAD', headers: { Range: 'bytes=1-2' } })
    expect(headRange.status).toBe(206)
    expect(headRange.headers.get('content-range')).toBe('bytes 1-2/8')
    expect(headRange.headers.get('content-length')).toBe('2')
    expect((await headRange.arrayBuffer()).byteLength).toBe(0)

    for (const range of ['bytes=99-100', 'bytes=4-2', 'bytes=abc', 'bytes=0-1,3-4']) {
      const invalid = await fetch(assetUrl, { headers: { Range: range } })
      expect(invalid.status, range).toBe(416)
      expect(invalid.headers.get('content-range')).toBe('bytes */8')
    }
  })

  it('exports a ZIP backup with auth, headers and temp cleanup', async () => {
    const h = await harness()
    const base = `http://127.0.0.1:${h.port}`
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('phonedek-export-')))

    expect((await fetch(`${base}/api/backup`)).status).toBe(401)

    const response = await fetch(url(base, '/api/backup', h.token))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="phonedek-backup-\d{8}-\d{6}\.zip"$/,
    )

    const buffer = Buffer.from(await response.arrayBuffer())
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(Number(response.headers.get('content-length'))).toBe(buffer.length)

    // Empty asset store still produces the existing config + README ZIP.
    const zip = new AdmZip(buffer)
    expect(zip.getEntry('phonedek-config.json')).toBeTruthy()
    expect(zip.getEntry('README.txt')).toBeTruthy()
    expect(zip.readAsText('phonedek-config.json')).toContain('Test deck')

    await waitFor(() =>
      readdirSync(tmpdir())
        .filter((name) => name.startsWith('phonedek-export-'))
        .every((name) => before.has(name)),
    )
  })

  it('supports HEAD and inclusive Range for backups', async () => {
    const h = await harness()
    const base = `http://127.0.0.1:${h.port}`
    const backupUrl = url(base, '/api/backup', h.token)

    const head = await fetch(backupUrl, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('application/zip')
    expect(head.headers.get('content-disposition')).toMatch(/^attachment; filename="phonedek-backup-/)
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0)
    expect((await head.arrayBuffer()).byteLength).toBe(0)

    const range = await fetch(backupUrl, { headers: { Range: 'bytes=0-1' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toMatch(/^bytes 0-1\/\d+$/)
    expect(range.headers.get('content-length')).toBe('2')
    const bytes = Buffer.from(await range.arrayBuffer())
    expect(bytes).toHaveLength(2)
    expect(bytes.toString('latin1')).toBe('PK')

    const invalid = await fetch(backupUrl, { headers: { Range: 'bytes=999999999-' } })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/)
  })

  it('snapshots current assets and handles concurrent exports', async () => {
    const h = await harness()
    const source = join(tmpdir(), `phonedek-backup-asset-${Date.now()}.png`)
    writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const asset = h.assets.importFile(source)
    const base = `http://127.0.0.1:${h.port}`
    const target = url(base, '/api/backup', h.token)

    const [first, second] = await Promise.all([fetch(target), fetch(target)])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    for (const response of [first, second]) {
      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()))
      expect(zip.getEntry('phonedek-config.json')).toBeTruthy()
      expect(zip.getEntry(`assets/${asset}`)).toBeTruthy()
    }
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
