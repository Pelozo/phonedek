import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  PROTOCOL_VERSION,
  parseClientMessage,
} from '@phonedek/shared'
import type {
  ClientMessage,
  ConnectedClient,
  DeckButton,
  DeckConfig,
  DeckPage,
  DeckProfile,
  PressMessage,
  PressResult,
  ServerMessage,
} from '@phonedek/shared'
import type { AssetStore } from './assets'
import type { Logger } from './logger'

export interface PressContext {
  profile: DeckProfile
  page: DeckPage
  button: DeckButton
}

export interface DeckServerOptions {
  port: number
  token: string
  version: string
  assets: AssetStore
  getConfig: () => DeckConfig
  getServerName: () => string
  onPress: (client: ConnectedClient, message: PressMessage, context: PressContext) => Promise<PressResult>
  onClientsChanged?: (clients: ConnectedClient[]) => void
  logger?: Logger
}

interface ClientRecord {
  ws: WebSocket
  info: ConnectedClient
  alive: boolean
  pressTimes: number[]
}

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

  async start(): Promise<number> {
    if (this.httpServer) return this.actualPort

    const server = createServer((request, response) => {
      this.handleHttp(request, response).catch((error) => {
        this.options.logger?.error('HTTP handler failed', error)
        if (!response.headersSent) json(response, 500, { error: 'Internal server error' })
        else response.end()
      })
    })
    const wss = new WebSocketServer({ noServer: true, clientTracking: true })
    this.httpServer = server
    this.wss = wss

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      if (!tokenMatches(this.token, bearerToken(request, url))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
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
    for (const record of this.clients.values()) {
      try {
        record.ws.close(1008, 'Pairing token changed')
      } catch {
        // ignore
      }
    }
  }

  broadcastConfig(): void {
    const message: ServerMessage = { type: 'config', config: this.options.getConfig() }
    this.broadcast(message)
  }

  getClients(): ConnectedClient[] {
    return [...this.clients.values()]
      .map((record) => ({ ...record.info, device: record.info.device ? { ...record.info.device } : null }))
      .sort((a, b) => a.connectedAt - b.connectedAt)
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
    const record: ClientRecord = { ws, info, alive: true, pressTimes: [] }
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
        this.notifyClients()
        break
      case 'ping':
        this.send(record.ws, { type: 'pong', t: message.t })
        break
      case 'press':
        await this.handlePress(record, message)
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
    })
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
      })
      return
    }

    if (!tokenMatches(this.token, bearerToken(request, url))) {
      json(response, 401, { error: 'Pairing token required' })
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
      response.writeHead(200, {
        'Content-Type': this.options.assets.contentType(name),
        'Cache-Control': 'public, max-age=3600',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      const stream = createReadStream(path)
      stream.on('error', () => {
        if (!response.headersSent) json(response, 500, { error: 'Could not read asset' })
        else response.end()
      })
      stream.pipe(response)
      return
    }

    json(response, 404, { error: 'Not found' })
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
