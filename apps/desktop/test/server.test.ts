import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { WebSocket } from 'ws'
import { createDefaultConfig } from '@phonedek/shared'
import type {
  ClientMessage,
  ControlSpec,
  ControlStateMessage,
  DeckConfig,
  InputMessage,
  PointerMessage,
  PointerResult,
  PressMessage,
  PressResult,
  ServerMessage,
  WatchMessage,
} from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import { writeBackupFile, type BackupPreview } from '../src/main/backup'
import type { ControlStateSubscription } from '../src/main/control-state'
import {
  DeckServer,
  type ControlStateHub,
  type InputContext,
  type PointerContext,
  type PressContext,
} from '../src/main/server'

interface InputCall {
  message: InputMessage
  context: InputContext
}

interface PointerCall {
  message: PointerMessage
  context: PointerContext | null
}

interface Harness {
  server: DeckServer
  port: number
  token: string
  config: DeckConfig
  assets: AssetStore
  presses: PressMessage[]
  contexts: PressContext[]
  inputs: InputCall[]
  pointers: PointerCall[]
}

const cleanups: Array<() => Promise<void>> = []

interface HarnessOptions {
  importBackup?: (filePath: string, preview: BackupPreview) => Promise<{ ok: boolean; error?: string }>
  pointerSupported?: boolean
  controlState?: ControlStateHub
  controlStateSupported?: boolean
  obsSupported?: () => boolean
  twitchSupported?: () => boolean
}

async function harness(
  pressResult: PressResult = { ok: true },
  options: HarnessOptions = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-server-'))
  const config = createDefaultConfig()
  config.serverName = 'Test deck'
  const assets = new AssetStore(join(dir, 'assets'))
  const presses: PressMessage[] = []
  const contexts: PressContext[] = []
  const inputs: InputCall[] = []
  const pointers: PointerCall[] = []
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
      return pressResult
    },
    onInput: async (_client, message, context) => {
      inputs.push({ message, context })
      return { ok: true }
    },
    onPointer: async (_client, message, context) => {
      pointers.push({ message, context })
      return { seq: message.seq, ok: true }
    },
    pointerSupported: options.pointerSupported,
    controlState: options.controlState,
    controlStateSupported: options.controlStateSupported,
    obsSupported: options.obsSupported,
    twitchSupported: options.twitchSupported,
    importBackup: options.importBackup,
  })
  const port = await server.start()
  cleanups.push(() => server.stop())
  return { server, port, token, config, assets, presses, contexts, inputs, pointers }
}

function attachControl(h: Harness, buttonId: string, control: ControlSpec): void {
  const button = h.config.profiles[0]!.pages[0]!.buttons.find((candidate) => candidate.id === buttonId)
  if (!button) throw new Error(`Missing button ${buttonId}`)
  button.control = control
}

function makeBackup(config: DeckConfig, assets: Record<string, Buffer> = {}): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-backup-src-'))
  const assetsDir = join(dir, 'assets')
  mkdirSync(assetsDir)
  for (const [name, data] of Object.entries(assets)) writeFileSync(join(assetsDir, name), data)
  const target = join(dir, 'backup.zip')
  writeBackupFile(target, config, assetsDir)
  cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))
  return readFileSync(target)
}

function postRaw(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers },
      (response) => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          data += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: data }))
      },
    )
    request.on('error', reject)
    request.end(body)
  })
}

function importTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('phonedek-import-'))
}

async function waitForImportCleanup(before: Set<string>): Promise<void> {
  await waitFor(() => importTempDirs().every((name) => before.has(name)))
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
    expect(infoBody.capabilities).toContain('import-v1')
    expect(infoBody.capabilities).toContain('input-v1')
    expect(infoBody.capabilities).toContain('brightness-v1')
    expect(infoBody.capabilities).toContain('pointer-v1')

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
    expect(hello.capabilities).toContain('input-v1')
    expect(hello.capabilities).toContain('brightness-v1')
    expect(hello.capabilities).toContain('import-v1')
    expect(hello.capabilities).toContain('pointer-v1')
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

  it('forwards a press result message to the phone', async () => {
    const h = await harness({ ok: true, message: 'Screenshot saved to Desktop: shot.png' })
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    const button = h.config.profiles[0]!.pages[0]!.buttons[0]!
    ws.send(
      JSON.stringify({
        type: 'press',
        requestId: 'message-1',
        profileId: h.config.profiles[0]!.id,
        pageId: h.config.profiles[0]!.pages[0]!.id,
        buttonId: button.id,
      }),
    )
    const result = await waitFor(() => messages.find((message) => message.type === 'pressResult'))
    expect(result).toMatchObject({
      type: 'pressResult',
      ok: true,
      message: 'Screenshot saved to Desktop: shot.png',
    })
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

describe('DeckServer continuous input', () => {
  const volumeControl: ControlSpec = {
    kind: 'slider',
    emit: 'delta',
    binding: { type: 'volume', mode: 'relative' },
  }

  function inputMessage(
    h: Harness,
    requestId: string,
    phase: 'start' | 'move' | 'end',
    controlId: string,
    delta?: number,
    value?: number,
  ) {
    return {
      type: 'input',
      requestId,
      profileId: h.config.profiles[0]!.id,
      pageId: h.config.profiles[0]!.pages[0]!.id,
      controlId,
      phase,
      ...(delta === undefined ? {} : { delta }),
      ...(value === undefined ? {} : { value }),
    }
  }

  it('routes start/move/end through onInput and acknowledges only end', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', volumeControl)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(JSON.stringify(inputMessage(h, 'in-start', 'start', 'btn-vol-down')))
    ws.send(JSON.stringify(inputMessage(h, 'in-move', 'move', 'btn-vol-down', 2)))
    ws.send(JSON.stringify(inputMessage(h, 'in-end', 'end', 'btn-vol-down')))

    const result = await waitFor(() =>
      messages.find((message) => message.type === 'inputResult' && message.requestId === 'in-end'),
    )
    expect(result).toMatchObject({
      type: 'inputResult',
      requestId: 'in-end',
      controlId: 'btn-vol-down',
      ok: true,
    })
    expect(h.inputs.map((call) => call.message.phase)).toEqual(['start', 'move', 'end'])
    expect(h.inputs[0]!.context.button.id).toBe('btn-vol-down')
    expect(h.inputs[0]!.context.control).toEqual(volumeControl)
    // start/move successes stay silent.
    expect(messages.filter((message) => message.type === 'inputResult')).toHaveLength(1)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('rejects non-control buttons and unknown controls', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(JSON.stringify(inputMessage(h, 'not-control', 'end', 'btn-mute')))
    const notControl = await waitFor(() =>
      messages.find((message) => message.type === 'inputResult' && message.requestId === 'not-control'),
    )
    expect(notControl).toMatchObject({ type: 'inputResult', ok: false })
    if (notControl.type === 'inputResult') expect(notControl.error).toMatch(/not a continuous control/)

    ws.send(JSON.stringify(inputMessage(h, 'missing-control', 'end', 'does-not-exist')))
    const missing = await waitFor(() =>
      messages.find((message) => message.type === 'inputResult' && message.requestId === 'missing-control'),
    )
    expect(missing).toMatchObject({ type: 'inputResult', ok: false })
    if (missing.type === 'inputResult') expect(missing.error).toMatch(/not found/i)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('passes absolute control values through onInput', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'absolute' },
    })
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(JSON.stringify(inputMessage(h, 'abs-move', 'move', 'btn-vol-down', undefined, 0.42)))
    ws.send(JSON.stringify(inputMessage(h, 'abs-end', 'end', 'btn-vol-down')))
    await waitFor(() =>
      messages.find((message) => message.type === 'inputResult' && message.requestId === 'abs-end'),
    )

    const move = h.inputs.find((call) => call.message.requestId === 'abs-move')
    expect(move?.message.value).toBe(0.42)
    expect(move?.context.control.binding).toEqual({ type: 'volume', mode: 'absolute' })

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('limits moves to 60/s but always accepts end', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', volumeControl)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    for (let index = 0; index < 61; index += 1) {
      ws.send(JSON.stringify(inputMessage(h, `burst-${index}`, 'move', 'btn-vol-down', 0.1)))
    }

    const limited = await waitFor(() =>
      messages.find(
        (message) =>
          message.type === 'inputResult' &&
          typeof message.error === 'string' &&
          /Too many control events/.test(message.error),
      ),
    )
    expect(limited).toMatchObject({ type: 'inputResult', ok: false })

    ws.send(JSON.stringify(inputMessage(h, 'after-burst-end', 'end', 'btn-vol-down')))
    const endResult = await waitFor(() =>
      messages.find(
        (message) => message.type === 'inputResult' && message.requestId === 'after-burst-end',
      ),
    )
    expect(endResult).toMatchObject({ type: 'inputResult', ok: true })

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })
})

describe('DeckServer pointer input', () => {
  const trackpad: ControlSpec = {
    kind: 'trackpad',
    emit: 'delta',
    binding: { type: 'pointer' },
  }

  function pointerStart(h: Harness, seq = 1, controlId = 'btn-vol-down'): PointerMessage {
    return {
      type: 'pointer',
      seq,
      phase: 'start',
      profileId: h.config.profiles[0]!.id,
      pageId: h.config.profiles[0]!.pages[0]!.id,
      controlId,
    }
  }

  function pointerMove(seq: number): PointerMessage {
    return { type: 'pointer', seq, phase: 'move', dx: 0.1, dy: -0.1 }
  }

  it('advertises pointer-v1 only when pointer injection is supported', async () => {
    const supported = await harness({ ok: true }, { pointerSupported: true })
    const a = await openSocket(`ws://127.0.0.1:${supported.port}/ws?token=${supported.token}`)
    const hello = await waitFor(() => a.messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).toContain('pointer-v1')
    a.ws.close()

    const unsupported = await harness({ ok: true }, { pointerSupported: false })
    const b = await openSocket(`ws://127.0.0.1:${unsupported.port}/ws?token=${unsupported.token}`)
    const noHello = await waitFor(() => b.messages.find((message) => message.type === 'hello'))
    expect(noHello.capabilities).not.toContain('pointer-v1')
    b.ws.close()
  })

  it('routes start/move/end through onPointer and acknowledges only end', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', trackpad)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(JSON.stringify(pointerStart(h)))
    ws.send(JSON.stringify(pointerMove(2)))
    ws.send(JSON.stringify({ type: 'pointer', seq: 3, phase: 'end' }))

    const result = await waitFor(() =>
      messages.find((message) => message.type === 'pointerResult' && message.seq === 3),
    )
    expect(result).toEqual({ type: 'pointerResult', seq: 3, ok: true })
    expect(h.pointers.map((call) => call.message.phase)).toEqual(['start', 'move', 'end'])
    expect(h.pointers[0]!.context?.control).toEqual(trackpad)
    expect(h.pointers[0]!.context?.label).toBe('Volume down')
    expect(h.pointers[1]!.context).toBeNull()
    // Moves never produce success acks.
    expect(messages.filter((message) => message.type === 'pointerResult')).toHaveLength(1)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('notifies an old phone app when the deck needs the trackpad', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', trackpad)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    const hello: ClientMessage = {
      type: 'hello',
      protocol: 1,
      device: { name: 'Old phone', model: 'test', appVersion: '0.2.3' },
      capabilities: ['input-v1'],
    }
    ws.send(JSON.stringify(hello))
    const notice = await waitFor(() => {
      const found = messages.find(
        (message) => message.type === 'error' && message.code === 'APP_OUTDATED',
      )
      return found && found.type === 'error' ? found : undefined
    })
    expect(notice.message).toContain('Trackpad')

    // Re-sending hello does not spam the same notice.
    ws.send(JSON.stringify(hello))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      messages.filter((message) => message.type === 'error' && message.code === 'APP_OUTDATED'),
    ).toHaveLength(1)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('does not notify a phone that supports the deck controls', async () => {
    const h = await harness()
    attachControl(h, 'btn-vol-down', trackpad)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        device: { name: 'Current phone', model: 'test', appVersion: '0.2.4' },
        capabilities: ['input-v1', 'pointer-v1'],
      } satisfies ClientMessage),
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      messages.filter((message) => message.type === 'error' && message.code === 'APP_OUTDATED'),
    ).toHaveLength(0)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('notifies when a trackpad is added while an old phone is connected', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        device: { name: 'Old phone', model: 'test', appVersion: '0.2.3' },
        capabilities: ['input-v1'],
      } satisfies ClientMessage),
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      messages.filter((message) => message.type === 'error' && message.code === 'APP_OUTDATED'),
    ).toHaveLength(0)

    attachControl(h, 'btn-vol-down', trackpad)
    h.server.broadcastConfig()
    await waitFor(() =>
      messages.find((message) => message.type === 'error' && message.code === 'APP_OUTDATED'),
    )

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('rejects a start that is not a trackpad control', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    ws.send(JSON.stringify(pointerStart(h, 1, 'btn-mute')))
    const notTrackpad = await waitFor(() =>
      messages.find((message) => message.type === 'pointerResult' && message.seq === 1),
    )
    expect(notTrackpad).toMatchObject({ type: 'pointerResult', ok: false })
    if (notTrackpad.type === 'pointerResult') expect(notTrackpad.error).toMatch(/not a trackpad/)
    expect(h.pointers).toHaveLength(0)

    ws.send(JSON.stringify(pointerStart(h, 2, 'does-not-exist')))
    const missing = await waitFor(() =>
      messages.find((message) => message.type === 'pointerResult' && message.seq === 2),
    )
    expect(missing).toMatchObject({ type: 'pointerResult', ok: false })
    if (missing.type === 'pointerResult') expect(missing.error).toMatch(/not found/i)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

})

describe('DeckServer control state', () => {
  const absoluteVolume: ControlSpec = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'volume', mode: 'absolute' },
  }

  const mediaScrub: ControlSpec = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'media', target: 'position' },
    min: 0,
    max: 1,
    step: 0.001,
    commit: 'end',
    display: 'time',
  }

  function fakeHub(): {
    hub: ControlStateHub
    subscriptions: Array<{ clientId: string; subscription: ControlStateSubscription }>
    cleared: string[]
  } {
    const subscriptions: Array<{ clientId: string; subscription: ControlStateSubscription }> = []
    const cleared: string[] = []
    return {
      subscriptions,
      cleared,
      hub: {
        subscribe: (clientId, subscription) => {
          subscriptions.push({ clientId, subscription })
        },
        unsubscribe: (clientId) => {
          cleared.push(clientId)
        },
      },
    }
  }

  async function sendHello(ws: WebSocket, capabilities: string[]): Promise<void> {
    ws.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        device: { name: 'Test phone', model: 'test', appVersion: '0.3.0' },
        capabilities,
      } satisfies ClientMessage),
    )
    // The server parses hello asynchronously; let capability gating see it.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  function watch(h: Harness, controlIds?: string[], intervalMs?: number): WatchMessage {
    return {
      type: 'watch',
      profileId: h.config.profiles[0]!.id,
      pageId: h.config.profiles[0]!.pages[0]!.id,
      ...(controlIds === undefined ? {} : { controlIds }),
      ...(intervalMs === undefined ? {} : { intervalMs }),
    }
  }

  it('advertises control-state-v1 only when a reader exists', async () => {
    const supported = await harness({ ok: true }, { controlStateSupported: true })
    const info = await fetch(`http://127.0.0.1:${supported.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain('control-state-v1')

    const socket = await openSocket(`ws://127.0.0.1:${supported.port}/ws?token=${supported.token}`)
    const hello = await waitFor(() => socket.messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).toContain('control-state-v1')
    socket.ws.close()

    const unsupported = await harness()
    const noInfo = await fetch(`http://127.0.0.1:${unsupported.port}/api/info`)
    const noBody = (await noInfo.json()) as { capabilities?: string[] }
    expect(noBody.capabilities).not.toContain('control-state-v1')

    const noSocket = await openSocket(`ws://127.0.0.1:${unsupported.port}/ws?token=${unsupported.token}`)
    const noHello = await waitFor(() => noSocket.messages.find((message) => message.type === 'hello'))
    expect(noHello.capabilities).not.toContain('control-state-v1')
    noSocket.ws.close()
  })

  it('accepts a watch and sends the batched controlState payload', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true },
    )
    attachControl(h, 'btn-vol-down', absoluteVolume)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await sendHello(ws, ['input-v1', 'control-state-v1'])

    ws.send(JSON.stringify(watch(h, ['btn-vol-down'], 750)))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.subscription.controlIds).toEqual(['btn-vol-down'])
    expect(call.subscription.intervalMs).toBe(750)

    // A watch has no direct ack; only the service's state message arrives.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(messages.some((message) => message.type === 'controlState')).toBe(false)
    expect(messages.some((message) => message.type === 'error')).toBe(false)

    const payload: ControlStateMessage = {
      type: 'controlState',
      profileId: call.subscription.profileId,
      pageId: call.subscription.pageId,
      states: [
        { controlId: 'btn-vol-down', revision: 1, value: 0.42, available: true, detail: '42%' },
      ],
    }
    call.subscription.send(payload)
    const state = await waitFor(() =>
      messages.find((message) => message.type === 'controlState'),
    )
    expect(state).toEqual(payload)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('resolves a media scrub control for watch', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true },
    )
    attachControl(h, 'btn-vol-down', mediaScrub)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await sendHello(ws, ['control-state-v1'])

    ws.send(JSON.stringify(watch(h, ['btn-vol-down'], 500)))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.subscription.intervalMs).toBe(500)
    expect(call.subscription.controls).toEqual([
      { id: 'btn-vol-down', label: 'Volume down', source: 'media' },
    ])

    call.subscription.send({
      type: 'controlState',
      profileId: call.subscription.profileId,
      pageId: call.subscription.pageId,
      states: [
        {
          controlId: 'btn-vol-down',
          revision: 1,
          available: true,
          positionMs: 83_000,
          durationMs: 213_000,
          playing: true,
          title: 'Song',
          artist: 'Artist',
          detail: '1:23 / 3:33',
        },
      ],
    })
    const state = await waitFor(() => messages.find((message) => message.type === 'controlState'))
    expect(state).toMatchObject({
      type: 'controlState',
      states: [{ controlId: 'btn-vol-down', positionMs: 83_000, durationMs: 213_000 }],
    })

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('drops a watch with an empty control list and clears on close', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true },
    )
    attachControl(h, 'btn-vol-down', absoluteVolume)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await sendHello(ws, ['control-state-v1'])

    ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call).toBeTruthy()

    ws.send(JSON.stringify(watch(h, [])))
    await waitFor(() => fake.cleared.includes(call.clientId))

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('rejects unknown pages and ignores old clients', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true },
    )
    attachControl(h, 'btn-vol-down', absoluteVolume)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await sendHello(ws, ['control-state-v1'])

    ws.send(
      JSON.stringify({
        type: 'watch',
        profileId: h.config.profiles[0]!.id,
        pageId: 'does-not-exist',
        controlIds: ['btn-vol-down'],
      } satisfies WatchMessage),
    )
    const error = await waitFor(() =>
      messages.find((message) => message.type === 'error' && message.code === 'BAD_MESSAGE'),
    )
    expect(error.type).toBe('error')
    expect(fake.subscriptions).toHaveLength(0)

    // A client that did not advertise the capability gets nothing.
    const old = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => old.messages.find((message) => message.type === 'hello'))
    await sendHello(old.ws, ['input-v1'])
    await old.ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fake.subscriptions).toHaveLength(0)
    expect(
      old.messages.some((message) => message.type === 'controlState' || message.type === 'error'),
    ).toBe(false)

    old.ws.close()
    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('limits watches to two per second', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true },
    )
    attachControl(h, 'btn-vol-down', absoluteVolume)
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await sendHello(ws, ['control-state-v1'])

    ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))
    ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))
    ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))

    const limited = await waitFor(() =>
      messages.find((message) => message.type === 'error' && message.code === 'RATE_LIMITED'),
    )
    expect(limited.type).toBe('error')
    expect(fake.subscriptions).toHaveLength(2)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('advertises obs-v1 only while OBS is identified', async () => {
    let connected = false
    const h = await harness({ ok: true }, { obsSupported: () => connected })

    const info = await fetch(`http://127.0.0.1:${h.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).not.toContain('obs-v1')

    const first = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const firstHello = await waitFor(() => first.messages.find((message) => message.type === 'hello'))
    expect(firstHello.capabilities).not.toContain('obs-v1')
    first.ws.close()

    connected = true
    const second = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const secondHello = await waitFor(() => second.messages.find((message) => message.type === 'hello'))
    expect(secondHello.capabilities).toContain('obs-v1')
    second.ws.close()

    await waitFor(() => h.server.getClients().length === 0)
  })

  it('advertises twitch-v1 only while Twitch is authorized', async () => {
    let authorized = false
    const h = await harness({ ok: true }, { twitchSupported: () => authorized })

    const info = await fetch(`http://127.0.0.1:${h.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).not.toContain('twitch-v1')

    const first = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const firstHello = await waitFor(() => first.messages.find((message) => message.type === 'hello'))
    expect(firstHello.capabilities).not.toContain('twitch-v1')
    first.ws.close()

    authorized = true
    const second = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const secondHello = await waitFor(() => second.messages.find((message) => message.type === 'hello'))
    expect(secondHello.capabilities).toContain('twitch-v1')
    second.ws.close()

    await waitFor(() => h.server.getClients().length === 0)
  })

  it('resolves Twitch state buttons for watch while unauthorized', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      {
        controlState: fake.hub,
        controlStateSupported: true,
        twitchSupported: () => false,
      },
    )
    const button = h.config.profiles[0]!.pages[0]!.buttons[0]!
    button.state = { type: 'twitch', target: 'live' }

    const info = await fetch(`http://127.0.0.1:${h.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain('control-state-v1')
    expect(body.capabilities).not.toContain('twitch-v1')

    const { ws } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await sendHello(ws, ['control-state-v1'])
    ws.send(JSON.stringify(watch(h, [button.id])))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.subscription.controls).toEqual([
      { id: button.id, label: button.label, source: 'twitch', twitchTarget: 'live' },
    ])
    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('keeps control-state-v1 and resolves OBS controls while OBS is down', async () => {
    const fake = fakeHub()
    const h = await harness(
      { ok: true },
      { controlState: fake.hub, controlStateSupported: true, obsSupported: () => false },
    )
    attachControl(h, 'btn-vol-down', {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
      min: 0,
      max: 200,
      step: 1,
      initial: 100,
      unit: '%',
    })

    const info = await fetch(`http://127.0.0.1:${h.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain('control-state-v1')
    expect(body.capabilities).not.toContain('obs-v1')

    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const hello = await waitFor(() => messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).toContain('control-state-v1')
    expect(hello.capabilities).not.toContain('obs-v1')
    await sendHello(ws, ['control-state-v1'])

    ws.send(JSON.stringify(watch(h, ['btn-vol-down'])))
    const call = await waitFor(() => fake.subscriptions[0])
    expect(call.subscription.controls).toEqual([
      {
        id: 'btn-vol-down',
        label: 'Volume down',
        source: 'obs',
        input: 'Mic/Aux',
        max: 200,
      },
    ])

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })
})

describe('DeckServer phone brightness', () => {
  async function hello(
    ws: WebSocket,
    name: string,
    capabilities?: string[],
  ): Promise<void> {
    ws.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        device: { name },
        ...(capabilities ? { capabilities } : {}),
      }),
    )
  }

  it('stores hello capabilities and sends brightness updates to that phone', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    await hello(ws, 'Pixel 8', ['brightness-v1'])
    const client = await waitFor(() =>
      h.server.getClients().find((candidate) => candidate.device?.name === 'Pixel 8'),
    )
    expect(client.capabilities).toContain('brightness-v1')

    expect(h.server.setClientBrightness(client.id, 0.42)).toEqual({ ok: true })
    const level = await waitFor(() => messages.find((message) => message.type === 'brightness'))
    expect(level).toEqual({ type: 'brightness', level: 0.42 })
    expect(h.server.getClients().find((candidate) => candidate.id === client.id)?.brightnessLevel).toBe(0.42)

    expect(h.server.setClientBrightness(client.id, null)).toEqual({ ok: true })
    const system = await waitFor(() =>
      messages.find((message) => message.type === 'brightness' && message.level === null),
    )
    expect(system).toEqual({ type: 'brightness', level: null })
    expect(h.server.getClients().find((candidate) => candidate.id === client.id)?.brightnessLevel).toBeNull()

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('rejects unsupported phones, invalid levels and unknown clients', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await hello(ws, 'Old phone')
    const client = await waitFor(() =>
      h.server.getClients().find((candidate) => candidate.device?.name === 'Old phone'),
    )

    expect(h.server.setClientBrightness(client.id, 0.5)).toEqual({
      ok: false,
      error: 'Update the phone app to control brightness',
    })
    expect(h.server.setClientBrightness(client.id, 1.1)).toEqual({
      ok: false,
      error: 'Brightness must be between 0 and 100%',
    })
    expect(h.server.setClientBrightness(client.id, Number.NaN)).toEqual({
      ok: false,
      error: 'Brightness must be between 0 and 100%',
    })
    expect(h.server.setClientBrightness('missing', 0.5)).toEqual({
      ok: false,
      error: 'Phone is not connected',
    })
    expect(messages.some((message) => message.type === 'brightness')).toBe(false)

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('sends to one client without broadcasting', async () => {
    const h = await harness()
    const a = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    const b = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => a.messages.find((message) => message.type === 'hello'))
    await waitFor(() => b.messages.find((message) => message.type === 'hello'))
    await hello(a.ws, 'Phone A', ['brightness-v1'])
    await hello(b.ws, 'Phone B', ['brightness-v1'])
    await waitFor(
      () =>
        h.server.getClients().filter((candidate) =>
          candidate.device?.name === 'Phone A' || candidate.device?.name === 'Phone B',
        ).length === 2,
    )

    const clientA = h.server.getClients().find((candidate) => candidate.device?.name === 'Phone A')!
    expect(h.server.sendToClient(clientA.id, { type: 'brightness', level: 0.25 })).toBe(true)
    const delivered = await waitFor(() => a.messages.find((message) => message.type === 'brightness'))
    expect(delivered).toEqual({ type: 'brightness', level: 0.25 })
    expect(b.messages.some((message) => message.type === 'brightness')).toBe(false)
    expect(h.server.sendToClient('missing-client', { type: 'brightness', level: null })).toBe(false)

    a.ws.close()
    b.ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })

  it('rate-limits brightness updates to about 20 per second', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(`ws://127.0.0.1:${h.port}/ws?token=${h.token}`)
    await waitFor(() => messages.find((message) => message.type === 'hello'))
    await hello(ws, 'Pixel 8', ['brightness-v1'])
    const client = await waitFor(() =>
      h.server.getClients().find((candidate) => candidate.device?.name === 'Pixel 8'),
    )

    for (let index = 0; index < 20; index += 1) {
      expect(h.server.setClientBrightness(client.id, 0.5), `update ${index}`).toEqual({ ok: true })
    }
    expect(h.server.setClientBrightness(client.id, 0.5)).toEqual({
      ok: false,
      error: 'Too many brightness updates, slow down',
    })

    ws.close()
    await waitFor(() => h.server.getClients().length === 0)
  })
})

describe('DeckServer phone backup import', () => {
  it('previews and applies a valid backup after approval', async () => {
    const source = createDefaultConfig()
    source.serverName = 'Phone backup'
    source.profiles[0]!.pages[0]!.buttons[0]!.actions = [
      { type: 'launch', path: 'notepad.exe' },
      { type: 'command', command: 'echo hi', hidden: true },
      { type: 'macro', steps: [{ type: 'command', command: 'echo nested', hidden: true }] },
    ]
    const zip = makeBackup(source, { 'wallpaper.png': Buffer.from([1, 2, 3, 4]) })

    let seen: BackupPreview | null = null
    let fileExistedDuringApproval = false
    const h = await harness(
      { ok: true },
      {
        importBackup: async (filePath, preview) => {
          fileExistedDuringApproval = existsSync(filePath)
          seen = preview
          return { ok: true }
        },
      },
    )
    const before = new Set(importTempDirs())
    const response = await fetch(url(`http://127.0.0.1:${h.port}`, '/api/import', h.token), {
      method: 'POST',
      body: new Uint8Array(zip),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; preview: BackupPreview }
    expect(body.ok).toBe(true)
    expect(fileExistedDuringApproval).toBe(true)
    expect(seen).not.toBeNull()
    expect(seen).toMatchObject({
      serverName: 'Phone backup',
      profiles: 1,
      pages: 2,
      buttons: 25,
      assets: 1,
      bytes: 4,
      dangerousActions: 4,
      warnings: [],
    })
    expect(body.preview).toEqual(seen)
    await waitForImportCleanup(before)
  })

  it('includes skipped-asset warnings in the preview', async () => {
    const source = createDefaultConfig()
    source.serverName = 'Warned backup'
    const zip = new AdmZip()
    zip.addFile('phonedek-config.json', Buffer.from(JSON.stringify(source)))
    zip.addFile('assets/notes.txt', Buffer.from('not an asset'))
    let seen: BackupPreview | null = null
    const h = await harness(
      { ok: true },
      {
        importBackup: async (_filePath, preview) => {
          seen = preview
          return { ok: true }
        },
      },
    )
    const response = await fetch(url(`http://127.0.0.1:${h.port}`, '/api/import', h.token), {
      method: 'POST',
      body: new Uint8Array(zip.toBuffer()),
    })
    expect(response.status).toBe(200)
    expect(seen).not.toBeNull()
    expect(seen!.assets).toBe(0)
    expect(seen!.warnings).toContain('Skipped unsupported asset: notes.txt')
  })

  it('requires the pairing PIN', async () => {
    const h = await harness()
    const zip = makeBackup(createDefaultConfig())
    const response = await fetch(`http://127.0.0.1:${h.port}/api/import`, {
      method: 'POST',
      body: new Uint8Array(zip),
    })
    expect(response.status).toBe(401)
  })

  it('rejects an invalid ZIP without calling approval', async () => {
    let called = false
    const h = await harness(
      { ok: true },
      {
        importBackup: async () => {
          called = true
          return { ok: true }
        },
      },
    )
    const before = new Set(importTempDirs())
    const response = await fetch(url(`http://127.0.0.1:${h.port}`, '/api/import', h.token), {
      method: 'POST',
      body: new Uint8Array(Buffer.from('this is not a zip')),
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)
    await waitForImportCleanup(before)
  })

  it('returns 500 when the desktop rejects the import', async () => {
    const h = await harness(
      { ok: true },
      {
        importBackup: async () => ({ ok: false, error: 'Import cancelled on the PC.' }),
      },
    )
    const before = new Set(importTempDirs())
    const response = await fetch(url(`http://127.0.0.1:${h.port}`, '/api/import', h.token), {
      method: 'POST',
      body: new Uint8Array(makeBackup(createDefaultConfig())),
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: 'Import cancelled on the PC.' })
    await waitForImportCleanup(before)
  })

  it('rejects a concurrent import with 409', async () => {
    let release!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const h = await harness(
      { ok: true },
      {
        importBackup: async () => {
          await new Promise<void>((resolve) => {
            release = resolve
            markStarted()
          })
          return { ok: true }
        },
      },
    )
    const target = url(`http://127.0.0.1:${h.port}`, '/api/import', h.token)
    const zip = makeBackup(createDefaultConfig())
    const first = fetch(target, { method: 'POST', body: new Uint8Array(zip) })
    await started

    const second = await fetch(target, { method: 'POST', body: new Uint8Array(zip) })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ ok: false })

    release()
    expect((await first).status).toBe(200)
  })

  it('rejects an oversize declared upload with 413', async () => {
    const h = await harness()
    const before = new Set(importTempDirs())
    const result = await postRaw(
      h.port,
      '/api/import',
      {
        Authorization: `Bearer ${h.token}`,
        'Content-Type': 'application/zip',
        'Content-Length': String(300 * 1024 * 1024 + 1),
      },
      Buffer.alloc(0),
    )
    expect(result.status).toBe(413)
    expect(result.body).toContain('300 MB')
    await waitForImportCleanup(before)
  })
})
