import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import {
  BRIGHTNESS_CAPABILITY,
  POINTER_CAPABILITY,
  PROTOCOL_VERSION,
  parseClientMessage,
} from '@phonedek/shared'
import type {
  BrightnessMessage,
  ClientMessage,
  ConnectedClient,
  ControlSpec,
  DeckButton,
  DeckConfig,
  DeckPage,
  DeckProfile,
  InputMessage,
  InputResult,
  PointerMessage,
  PointerResult,
  PressMessage,
  PressResult,
  ServerMessage,
} from '@phonedek/shared'
import type { AssetStore } from './assets'
import {
  previewBackup,
  readBackupFile,
  writeBackupFile,
  type BackupPreview,
} from './backup'
import type { Logger } from './logger'

/** LAN endpoints and features advertised to clients. */
export const SERVER_CAPABILITIES = [
  'backup-export-v1',
  'import-v1',
  'input-v1',
  BRIGHTNESS_CAPABILITY,
  POINTER_CAPABILITY,
] as const

/**
 * Capabilities for a specific host. Wayland/unsupported platforms must not
 * advertise `pointer-v1`, so the desktop computes this at startup.
 */
export function serverCapabilities(pointerSupported: boolean): string[] {
  return SERVER_CAPABILITIES.filter(
    (capability) => pointerSupported || capability !== POINTER_CAPABILITY,
  )
}

interface ControlNeeds {
  pointer: boolean
  input: boolean
}

function controlNeeds(config: DeckConfig): ControlNeeds {
  let pointer = false
  let input = false
  for (const profile of config.profiles) {
    for (const page of profile.pages) {
      for (const button of page.buttons) {
        if (!button.control) continue
        if (button.control.kind === 'trackpad') pointer = true
        else input = true
      }
    }
  }
  return { pointer, input }
}

/**
 * Friendly mismatch notice for an old phone app. The phone cannot discover
 * capabilities it does not know about (an old app silently drops trackpad and
 * control tiles), so the desktop tells it once per connection/config.
 */
export function outdatedClientMessage(
  config: DeckConfig,
  capabilities: readonly string[],
  serverSupportsPointer: boolean,
): string | null {
  const needs = controlNeeds(config)
  if (needs.pointer && serverSupportsPointer && !capabilities.includes(POINTER_CAPABILITY)) {
    return 'This deck uses the Trackpad. Update the PhoneDeck app on your phone to use it.'
  }
  if (needs.input && !capabilities.includes('input-v1')) {
    return 'This deck uses continuous controls. Update the PhoneDeck app on your phone to use them.'
  }
  return null
}

export interface PressContext {
  profile: DeckProfile
  page: DeckPage
  button: DeckButton
}

export interface InputContext extends PressContext {
  control: ControlSpec
}

/** Trackpad resolved from the `start` message; null for move/end/cancel. */
export interface PointerContext {
  control: ControlSpec
  label: string
}

export interface DeckServerOptions {
  port: number
  token: string
  version: string
  assets: AssetStore
  getConfig: () => DeckConfig
  getServerName: () => string
  onPress: (client: ConnectedClient, message: PressMessage, context: PressContext) => Promise<PressResult>
  onInput?: (client: ConnectedClient, message: InputMessage, context: InputContext) => Promise<InputResult>
  onPointer?: (
    client: ConnectedClient,
    message: PointerMessage,
    context: PointerContext | null,
  ) => Promise<PointerResult>
  /** Set false on Wayland/unsupported hosts so `pointer-v1` is not advertised. */
  pointerSupported?: boolean
  /** Called when a phone disconnects, so held pointer buttons can be released. */
  onClientClosed?: (client: ConnectedClient) => void
  /** Called only after an uploaded backup validates; show native approval here. */
  importBackup?: (filePath: string, preview: BackupPreview) => Promise<{ ok: boolean; error?: string }>
  onClientsChanged?: (clients: ConnectedClient[]) => void
  logger?: Logger
}

interface ClientRecord {
  ws: WebSocket
  info: ConnectedClient
  alive: boolean
  pressTimes: number[]
  inputTimes: number[]
  brightnessTimes: number[]
  pointerTimes: number[]
  /** Last APP_OUTDATED message sent to this client, to avoid spamming. */
  outdatedNotice: string | null
}

interface AuthResult {
  ok: boolean
  blocked: boolean
}

const AUTH_WINDOW_MS = 60_000
const AUTH_MAX_FAILURES = 6
const AUTH_BLOCK_MS = 60_000
const INPUT_RATE_LIMIT = 60
const POINTER_RATE_LIMIT = 120
const BRIGHTNESS_RATE_LIMIT = 20
const MAX_IMPORT_BYTES = 300 * 1024 * 1024
const IMPORT_TEMP_PREFIX = 'phonedek-import-'

function bearerToken(request: IncomingMessage, url: URL): string | undefined {
  const query = url.searchParams.get('token')
  if (query) return query
  const header = request.headers.authorization
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')
  if (expectedBuffer.length !== providedBuffer.length) return false
  try {
    return timingSafeEqual(expectedBuffer, providedBuffer)
  } catch {
    return false
  }
}

function remoteAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? 'unknown'
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

function json(response: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = `${JSON.stringify(body)}\n`
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  response.end(payload)
}

export interface ByteRange {
  start: number
  end: number
}

/** `phonedek-backup-YYYYMMDD-HHMMSS.zip` in UTC. */
export function backupExportFileName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `phonedek-backup-${stamp}.zip`
}

/**
 * Parse a single `bytes=` range. Returns null for malformed, multi-part or
 * unsatisfiable ranges, which callers answer with 416.
 */
export function parseByteRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return null
  if (!Number.isSafeInteger(size) || size <= 0) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(startText)
  if (!Number.isSafeInteger(start) || start >= size) return null
  const requestedEnd = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function streamAsset(path: string, response: ServerResponse, range?: ByteRange): void {
  const stream = range
    ? createReadStream(path, { start: range.start, end: range.end })
    : createReadStream(path)
  stream.on('error', () => {
    if (!response.headersSent) json(response, 500, { error: 'Could not read asset' })
    else response.end()
  })
  stream.pipe(response)
}

type UploadResult = 'ok' | 'too-large' | 'aborted'

/**
 * Stream the request body to disk without buffering the ZIP. The temp file is
 * deleted by the caller in all paths.
 */
function receiveUpload(
  request: IncomingMessage,
  target: string,
  limit: number,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const output = createWriteStream(target)
    let total = 0
    let settled = false

    const finish = (result: UploadResult): void => {
      if (settled) return
      settled = true
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
      output.off('error', onOutputError)
      resolve(result)
    }

    const onData = (chunk: Buffer): void => {
      total += chunk.length
      if (total > limit) {
        output.destroy()
        finish('too-large')
        request.resume()
        return
      }
      if (!output.write(chunk)) {
        request.pause()
        output.once('drain', () => request.resume())
      }
    }

    const onEnd = (): void => {
      output.end(() => finish('ok'))
    }
    const onError = (): void => {
      output.destroy()
      finish('aborted')
    }
    const onAborted = (): void => {
      output.destroy()
      finish('aborted')
    }
    const onOutputError = (): void => {
      finish('aborted')
      request.resume()
    }

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
    output.once('error', onOutputError)
  })
}

async function readJson(request: IncomingMessage, limit = 32 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

export class DeckServer {
  private readonly options: DeckServerOptions
  private token: string
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private readonly clients = new Map<string, ClientRecord>()
  private readonly authFailures = new Map<string, number[]>()
  private readonly authBlockedUntil = new Map<string, number>()
  private importInProgress = false
  private actualPort = 0

  constructor(options: DeckServerOptions) {
    this.options = options
    this.token = options.token
    this.actualPort = options.port
  }

  get port(): number {
    return this.actualPort
  }

  get running(): boolean {
    return this.httpServer !== null
  }

  get tokenValue(): string {
    return this.token
  }

  private get capabilities(): string[] {
    return serverCapabilities(this.options.pointerSupported !== false)
  }

  async start(): Promise<number> {
    if (this.httpServer) return this.actualPort

    const server = createServer((request, response) => {
      this.handleHttp(request, response).catch((error) => {
        this.options.logger?.error('HTTP handler failed', error)
        if (!response.headersSent) json(response, 500, { error: 'Internal server error' })
        else response.end()
      })
    })
    const wss = new WebSocketServer({ noServer: true, clientTracking: true, maxPayload: 256 * 1024 })
    this.httpServer = server
    this.wss = wss

    server.on('upgrade', (request, socket, head) => {
      // Nagle can add ~40 ms of jitter to a 60 Hz pointer stream.
      const upgradeSocket = socket as Socket
      upgradeSocket.setNoDelay(true)
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const auth = this.authorize(request, url)
      if (!auth.ok) {
        const status = auth.blocked ? '429 Too Many Requests' : '401 Unauthorized'
        socket.write(`HTTP/1.1 ${status}\r\nRetry-After: 60\r\nConnection: close\r\n\r\n`)
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    })

    wss.on('connection', (ws, request) => this.handleConnection(ws, request))

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        this.httpServer = null
        this.wss = null
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address()
        this.actualPort = typeof address === 'object' && address ? address.port : this.options.port
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.options.port, '0.0.0.0')
    })

    this.heartbeat = setInterval(() => this.checkHeartbeats(), 30_000)
    this.heartbeat.unref?.()
    this.options.logger?.info(`Deck server listening on 0.0.0.0:${this.actualPort}`)
    return this.actualPort
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const record of this.clients.values()) {
      try {
        record.ws.close(1001, 'Server stopping')
      } catch {
        // ignore
      }
    }
    this.clients.clear()
    this.notifyClients()

    const wss = this.wss
    const server = this.httpServer
    this.wss = null
    this.httpServer = null

    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
        // ws.close() waits for clients; we already asked them to close.
        setTimeout(resolve, 1000).unref?.()
      })
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        setTimeout(resolve, 1000).unref?.()
      })
    }
    this.options.logger?.info('Deck server stopped')
  }

  setToken(token: string): void {
    this.token = token
    this.authFailures.clear()
    this.authBlockedUntil.clear()
    for (const record of this.clients.values()) {
      try {
        record.ws.close(1008, 'Pairing PIN changed')
      } catch {
        // ignore
      }
    }
  }

  broadcastConfig(): void {
    const message: ServerMessage = { type: 'config', config: this.options.getConfig() }
    this.broadcast(message)
    for (const record of this.clients.values()) this.maybeNotifyOutdated(record)
  }

  getClients(): ConnectedClient[] {
    return [...this.clients.values()]
      .map((record) => ({
        ...record.info,
        device: record.info.device ? { ...record.info.device } : null,
        capabilities: record.info.capabilities ? [...record.info.capabilities] : undefined,
      }))
      .sort((a, b) => a.connectedAt - b.connectedAt)
  }

  /** Send a message to one connected phone. Returns false when it is gone. */
  sendToClient(clientId: string, message: ServerMessage): boolean {
    const record = this.clients.get(clientId)
    if (!record || record.ws.readyState !== WebSocket.OPEN) return false
    try {
      record.ws.send(JSON.stringify(message))
      return true
    } catch (error) {
      this.options.logger?.warn(`Could not send WebSocket message: ${String(error)}`)
      return false
    }
  }

  /**
   * Set transient window brightness on one phone (0..1, or null = system).
   * Only clients that advertised `brightness-v1` can be controlled.
   */
  setClientBrightness(clientId: string, level: number | null): { ok: boolean; error?: string } {
    if (level !== null && (!Number.isFinite(level) || level < 0 || level > 1)) {
      return { ok: false, error: 'Brightness must be between 0 and 100%' }
    }

    const record = this.clients.get(clientId)
    if (!record || record.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'Phone is not connected' }
    }
    if (!record.info.capabilities?.includes(BRIGHTNESS_CAPABILITY)) {
      return { ok: false, error: 'Update the phone app to control brightness' }
    }

    const now = Date.now()
    record.brightnessTimes = record.brightnessTimes.filter((time) => now - time < 1000)
    if (record.brightnessTimes.length >= BRIGHTNESS_RATE_LIMIT) {
      return { ok: false, error: 'Too many brightness updates, slow down' }
    }
    record.brightnessTimes.push(now)

    const message: BrightnessMessage = { type: 'brightness', level }
    if (!this.sendToClient(clientId, message)) {
      return { ok: false, error: 'Phone is not connected' }
    }
    record.info.brightnessLevel = level
    this.options.logger?.info(
      `Phone brightness ${level === null ? 'restored to system' : `${Math.round(level * 100)}%`} for ${record.info.address}`,
    )
    return { ok: true }
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const id = randomUUID()
    const now = Date.now()
    const info: ConnectedClient = {
      id,
      address: remoteAddress(request),
      device: null,
      connectedAt: now,
      lastSeenAt: now,
    }
    const record: ClientRecord = {
      ws,
      info,
      alive: true,
      pressTimes: [],
      inputTimes: [],
      brightnessTimes: [],
      pointerTimes: [],
      outdatedNotice: null,
    }
    this.clients.set(id, record)
    this.options.logger?.info(`Phone connected from ${info.address}`)

    ws.on('pong', () => {
      record.alive = true
    })
    ws.on('message', (data) => {
      record.alive = true
      record.info.lastSeenAt = Date.now()
      this.handleClientMessage(record, data.toString()).catch((error) => {
        this.options.logger?.error('WebSocket message failed', error)
        this.send(ws, { type: 'error', code: 'INTERNAL', message: 'Message handling failed' })
      })
    })
    ws.on('close', () => {
      try {
        this.options.onClientClosed?.(record.info)
      } catch (error) {
        this.options.logger?.warn(`Client close handler failed: ${String(error)}`)
      }
      this.clients.delete(id)
      this.notifyClients()
      this.options.logger?.info(`Phone disconnected: ${info.address}`)
    })
    ws.on('error', (error) => {
      this.options.logger?.warn(`WebSocket error from ${info.address}: ${error.message}`)
    })

    this.send(ws, {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      serverName: this.options.getServerName(),
      config: this.options.getConfig(),
      serverTime: Date.now(),
      capabilities: this.capabilities,
    })
    this.notifyClients()
  }

  private async handleClientMessage(record: ClientRecord, raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.send(record.ws, { type: 'error', code: 'BAD_JSON', message: 'Expected a JSON message' })
      return
    }

    const result = parseClientMessage(parsed)
    if (!result.ok) {
      this.send(record.ws, { type: 'error', code: 'BAD_MESSAGE', message: result.error })
      return
    }
    const message: ClientMessage = result.message

    switch (message.type) {
      case 'hello':
        record.info.device = { ...message.device }
        record.info.capabilities = message.capabilities ? [...message.capabilities] : []
        this.maybeNotifyOutdated(record)
        this.notifyClients()
        break
      case 'ping':
        this.send(record.ws, { type: 'pong', t: message.t })
        break
      case 'press':
        await this.handlePress(record, message)
        break
      case 'input':
        await this.handleInput(record, message)
        break
      case 'pointer':
        await this.handlePointer(record, message)
        break
    }
  }

  private async handlePress(record: ClientRecord, message: PressMessage): Promise<void> {
    const now = Date.now()
    record.pressTimes = record.pressTimes.filter((time) => now - time < 1000)
    if (record.pressTimes.length >= 25) {
      this.send(record.ws, {
        type: 'pressResult',
        requestId: message.requestId,
        buttonId: message.buttonId,
        ok: false,
        error: 'Too many presses, slow down',
      })
      return
    }
    record.pressTimes.push(now)

    const config = this.options.getConfig()
    const profile = config.profiles.find((item) => item.id === message.profileId)
    const page = profile?.pages.find((item) => item.id === message.pageId)
    const button = page?.buttons.find((item) => item.id === message.buttonId)
    if (!profile || !page || !button) {
      this.send(record.ws, {
        type: 'pressResult',
        requestId: message.requestId,
        buttonId: message.buttonId,
        ok: false,
        error: 'Button not found. Refresh the deck.',
      })
      return
    }

    let result: PressResult
    try {
      result = await this.options.onPress(record.info, message, { profile, page, button })
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    this.send(record.ws, {
      type: 'pressResult',
      requestId: message.requestId,
      buttonId: message.buttonId,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      ...(result.message ? { message: result.message } : {}),
    })
  }

  private sendInputResult(record: ClientRecord, message: InputMessage, result: InputResult): void {
    this.send(record.ws, {
      type: 'inputResult',
      requestId: message.requestId,
      controlId: message.controlId,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    })
  }

  private async handleInput(record: ClientRecord, message: InputMessage): Promise<void> {
    const now = Date.now()
    // Moves are rate-limited; `end` always gets through so coalesced deltas
    // flush even after a burst. Input has its own bucket, separate from presses.
    if (message.phase !== 'end') {
      record.inputTimes = record.inputTimes.filter((time) => now - time < 1000)
      if (record.inputTimes.length >= INPUT_RATE_LIMIT) {
        this.sendInputResult(record, message, {
          ok: false,
          error: 'Too many control events, slow down',
        })
        return
      }
      record.inputTimes.push(now)
    }

    const config = this.options.getConfig()
    const profile = config.profiles.find((item) => item.id === message.profileId)
    const page = profile?.pages.find((item) => item.id === message.pageId)
    const button = page?.buttons.find((item) => item.id === message.controlId)
    if (!profile || !page || !button) {
      this.sendInputResult(record, message, {
        ok: false,
        error: 'Control not found. Refresh the deck.',
      })
      return
    }
    if (!button.control) {
      this.sendInputResult(record, message, {
        ok: false,
        error: 'This button is not a continuous control.',
      })
      return
    }

    let result: InputResult
    if (!this.options.onInput) {
      result = { ok: false, error: 'Control input is not supported by this desktop.' }
    } else {
      try {
        result = await this.options.onInput(record.info, message, {
          profile,
          page,
          button,
          control: button.control,
        })
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    // Success is acknowledged only on `end`; start/move stay silent to keep
    // the stream cheap. Errors are acknowledged immediately.
    if (message.phase === 'end' || !result.ok) {
      this.sendInputResult(record, message, result)
    }
  }

  private sendPointerResult(record: ClientRecord, message: PointerMessage, result: PointerResult): void {
    this.send(record.ws, {
      type: 'pointerResult',
      seq: message.seq,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    })
  }

  private async handlePointer(record: ClientRecord, message: PointerMessage): Promise<void> {
    const now = Date.now()
    // Moves are rate-limited with their own bucket. end/cancel always get
    // through so a final position and button release are never dropped.
    if (message.phase !== 'end' && message.phase !== 'cancel') {
      record.pointerTimes = record.pointerTimes.filter((time) => now - time < 1_000)
      if (record.pointerTimes.length >= POINTER_RATE_LIMIT) {
        this.sendPointerResult(record, message, {
          seq: message.seq,
          ok: false,
          error: 'Too many pointer events, slow down',
        })
        return
      }
      record.pointerTimes.push(now)
    }

    let context: PointerContext | null = null
    if (message.phase === 'start') {
      const config = this.options.getConfig()
      const profile = config.profiles.find((item) => item.id === message.profileId)
      const page = profile?.pages.find((item) => item.id === message.pageId)
      const button = page?.buttons.find((item) => item.id === message.controlId)
      if (!profile || !page || !button) {
        this.sendPointerResult(record, message, {
          seq: message.seq,
          ok: false,
          error: 'Trackpad not found. Refresh the deck.',
        })
        return
      }
      if (!button.control || button.control.kind !== 'trackpad') {
        this.sendPointerResult(record, message, {
          seq: message.seq,
          ok: false,
          error: 'This button is not a trackpad.',
        })
        return
      }
      context = { control: button.control, label: button.label }
    }

    let result: PointerResult
    if (!this.options.onPointer) {
      result = { seq: message.seq, ok: false, error: 'Pointer control is not supported by this desktop.' }
    } else {
      try {
        result = await this.options.onPointer(record.info, message, context)
      } catch (error) {
        result = {
          seq: message.seq,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    // Movement has no success acks; a single result closes end/cancel and
    // errors are reported immediately.
    if (message.phase === 'end' || message.phase === 'cancel' || !result.ok) {
      this.sendPointerResult(record, message, { ...result, seq: message.seq })
    }
  }

  private async handleImport(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.importInProgress) {
      request.resume()
      json(response, 409, { ok: false, error: 'Another import is already waiting for approval.' })
      return
    }

    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) {
      request.resume()
      json(response, 413, { ok: false, error: 'Backup is larger than 300 MB' })
      return
    }

    this.importInProgress = true
    this.options.logger?.info(
      `Phone import upload started from ${remoteAddress(request)} (${Number.isFinite(declared) ? `${declared} bytes` : 'unknown size'})`,
    )
    let tempDir = ''
    try {
      tempDir = mkdtempSync(join(tmpdir(), IMPORT_TEMP_PREFIX))
      const tempPath = join(tempDir, 'upload.zip')
      const upload = await receiveUpload(request, tempPath, MAX_IMPORT_BYTES)
      if (upload === 'too-large') {
        json(response, 413, { ok: false, error: 'Backup is larger than 300 MB' })
        return
      }
      if (upload === 'aborted') {
        json(response, 400, { ok: false, error: 'Upload was interrupted' })
        return
      }

      let preview: BackupPreview
      try {
        preview = previewBackup(readBackupFile(tempPath))
        this.options.logger?.info(
          `Phone import validated "${preview.serverName}": ` +
            `${preview.profiles} profiles, ${preview.pages} pages, ${preview.buttons} buttons, ` +
            `${preview.assets} assets, ${preview.bytes} bytes`,
        )
      } catch (error) {
        this.options.logger?.warn(
          `Phone import rejected: ${error instanceof Error ? error.message : String(error)}`,
        )
        json(response, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }

      if (!this.options.importBackup) {
        json(response, 500, { ok: false, error: 'Import is not available in this build' })
        return
      }

      let result: { ok: boolean; error?: string }
      try {
        result = await this.options.importBackup(tempPath, preview)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (!result.ok) {
        this.options.logger?.warn(`Phone import not applied: ${result.error ?? 'Import failed'}`)
        json(response, 500, { ok: false, error: result.error ?? 'Import failed' })
        return
      }

      this.options.logger?.info(
        `Phone backup import applied (${preview.profiles} profiles, ${preview.assets} assets)`,
      )
      json(response, 200, { ok: true, preview })
    } finally {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true, force: true })
        } catch {
          // Best effort; the OS eventually clears its temp directory.
        }
      }
      this.importInProgress = false
    }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')

    if (request.method === 'GET' && url.pathname === '/api/health') {
      json(response, 200, { ok: true, app: 'PhoneDeck' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/info') {
      json(response, 200, {
        app: 'PhoneDeck',
        protocol: PROTOCOL_VERSION,
        serverName: this.options.getServerName(),
        version: this.options.version,
        pairingRequired: true,
        capabilities: this.capabilities,
      })
      return
    }

    if (url.pathname === '/api/import') {
      this.options.logger?.info(
        `Phone import HTTP ${request.method} from ${remoteAddress(request)} ` +
          `(${request.headers['content-length'] ?? 'chunked'} bytes)`,
      )
    }

    const auth = this.authorize(request, url)
    if (!auth.ok) {
      if (url.pathname === '/api/import') {
        this.options.logger?.warn(
          `Phone import rejected: ${auth.blocked ? 'rate limited' : 'PIN rejected'}`,
        )
      }
      if (auth.blocked) {
        json(response, 429, { error: 'Too many wrong PIN attempts. Wait a minute and try again.' }, { 'Retry-After': '60' })
      } else {
        json(response, 401, { error: 'Pairing PIN required' })
      }
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/import') {
      await this.handleImport(request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      const body = `${JSON.stringify(this.options.getConfig(), null, 2)}\n`
      const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ETag: etag,
      })
      response.end(body)
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/backup') {
      const filename = backupExportFileName()
      // A fresh directory per request also makes concurrent exports independent.
      const tempDir = mkdtempSync(join(tmpdir(), 'phonedek-export-'))
      const tempPath = join(tempDir, filename)
      let cleaned = false
      const cleanup = (): void => {
        if (cleaned) return
        cleaned = true
        try {
          rmSync(tempDir, { recursive: true, force: true })
        } catch {
          // Best effort: the OS will eventually clear its temp directory.
        }
      }

      try {
        writeBackupFile(tempPath, this.options.getConfig(), this.options.assets.dir)
        const size = statSync(tempPath).size
        const headers = {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          'Accept-Ranges': 'bytes',
        }

        const rangeHeader = request.headers.range
        let range: ByteRange | null = null
        if (rangeHeader !== undefined) {
          range = typeof rangeHeader === 'string' ? parseByteRange(rangeHeader, size) : null
          if (!range) {
            response.writeHead(416, {
              ...headers,
              'Content-Range': `bytes */${size}`,
              'Content-Length': 0,
            })
            response.end()
            cleanup()
            return
          }
          response.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
            'Content-Length': range.end - range.start + 1,
          })
        } else {
          response.writeHead(200, {
            ...headers,
            'Content-Length': size,
          })
        }

        if (request.method === 'HEAD') {
          response.end()
          cleanup()
          return
        }

        const stream = range
          ? createReadStream(tempPath, { start: range.start, end: range.end })
          : createReadStream(tempPath)
        // Wait for the read handle to close before deleting the temp directory
        // (Windows will reject deleting an open file). Aborted responses destroy
        // the stream, whose close event then performs the cleanup.
        response.once('close', () => {
          if (!stream.closed) stream.destroy()
        })
        stream.once('close', cleanup)
        stream.once('error', (error) => {
          this.options.logger?.warn(`Backup stream failed: ${error.message}`)
          if (!response.headersSent) json(response, 500, { error: 'Could not stream backup' })
          else response.destroy()
        })
        stream.pipe(response)
      } catch (error) {
        cleanup()
        this.options.logger?.warn(
          `Could not create backup: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (!response.headersSent) json(response, 500, { error: 'Could not create backup' })
        else response.end()
      }
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/press') {
      let body: unknown
      try {
        body = await readJson(request)
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : 'Invalid body' })
        return
      }
      const parsed = parseClientMessage(body)
      if (!parsed.ok || parsed.message.type !== 'press') {
        json(response, 400, { error: parsed.ok ? 'Expected a press message' : parsed.error })
        return
      }
      const message = parsed.message
      const config = this.options.getConfig()
      const profile = config.profiles.find((item) => item.id === message.profileId)
      const page = profile?.pages.find((item) => item.id === message.pageId)
      const button = page?.buttons.find((item) => item.id === message.buttonId)
      if (!profile || !page || !button) {
        json(response, 404, { ok: false, error: 'Button not found' })
        return
      }
      const client: ConnectedClient = {
        id: 'http',
        address: remoteAddress(request),
        device: null,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
      }
      const result = await this.options.onPress(client, message, { profile, page, button })
      json(response, result.ok ? 200 : 500, result)
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/assets/')) {
      const name = decodeURIComponent(url.pathname.slice('/assets/'.length))
      const path = this.options.assets.pathFor(name)
      if (!path) {
        json(response, 404, { error: 'Asset not found' })
        return
      }

      const size = statSync(path).size
      const commonHeaders = {
        'Content-Type': this.options.assets.contentType(name),
        'Cache-Control': 'public, max-age=3600',
        'Accept-Ranges': 'bytes',
      }
      const rangeHeader = request.headers.range
      if (rangeHeader !== undefined) {
        const range = typeof rangeHeader === 'string' ? parseByteRange(rangeHeader, size) : null
        if (!range) {
          response.writeHead(416, {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${size}`,
            'Content-Length': 0,
            'Cache-Control': 'no-store',
          })
          response.end()
          return
        }
        response.writeHead(206, {
          ...commonHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': range.end - range.start + 1,
        })
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        streamAsset(path, response, range)
        return
      }

      response.writeHead(200, {
        ...commonHeaders,
        'Content-Length': size,
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      streamAsset(path, response)
      return
    }

    json(response, 404, { error: 'Not found' })
  }

  private authorize(request: IncomingMessage, url: URL): AuthResult {
    const ip = remoteAddress(request)
    const now = Date.now()
    const blockedUntil = this.authBlockedUntil.get(ip) ?? 0
    if (blockedUntil > now) return { ok: false, blocked: true }

    const failures = (this.authFailures.get(ip) ?? []).filter((time) => now - time < AUTH_WINDOW_MS)
    if (tokenMatches(this.token, bearerToken(request, url))) {
      this.authFailures.delete(ip)
      this.authBlockedUntil.delete(ip)
      return { ok: true, blocked: false }
    }

    failures.push(now)
    if (failures.length >= AUTH_MAX_FAILURES) {
      this.authFailures.delete(ip)
      this.authBlockedUntil.set(ip, now + AUTH_BLOCK_MS)
      this.options.logger?.warn(`Too many wrong pairing PIN attempts from ${ip}; temporarily blocked`)
    } else {
      this.authFailures.set(ip, failures)
    }
    return { ok: false, blocked: false }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      this.options.logger?.warn(`Could not send WebSocket message: ${String(error)}`)
    }
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const record of this.clients.values()) {
      if (record.ws.readyState === WebSocket.OPEN) {
        try {
          record.ws.send(payload)
        } catch {
          // close handler will clean up
        }
      }
    }
  }

  private notifyClients(): void {
    this.options.onClientsChanged?.(this.getClients())
  }

  /**
   * Tell a connected phone once when its app is too old for the current deck.
   * Repeat only if the required feature changes. Old apps show `error`
   * messages as a normal notice, so no new message type is needed.
   */
  private maybeNotifyOutdated(record: ClientRecord): void {
    if (record.info.capabilities === undefined) return
    const message = outdatedClientMessage(
      this.options.getConfig(),
      record.info.capabilities,
      this.capabilities.includes(POINTER_CAPABILITY),
    )
    if (message === record.outdatedNotice) return
    record.outdatedNotice = message
    if (!message) return
    this.send(record.ws, { type: 'error', code: 'APP_OUTDATED', message })
    this.options.logger?.info(`Phone app outdated for ${record.info.address}: ${message}`)
  }

  private checkHeartbeats(): void {
    for (const record of this.clients.values()) {
      if (!record.alive) {
        try {
          record.ws.terminate()
        } catch {
          // ignore
        }
        this.clients.delete(record.info.id)
        continue
      }
      record.alive = false
      try {
        record.ws.ping()
      } catch {
        // ignore
      }
    }
    this.notifyClients()
  }
}
