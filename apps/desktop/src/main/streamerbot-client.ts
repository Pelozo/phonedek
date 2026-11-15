import { createHash } from 'node:crypto'
import { WebSocket, type RawData } from 'ws'
import {
  STREAMERBOT_DEFAULT_HOST,
  STREAMERBOT_DEFAULT_PORT,
  STREAMERBOT_MAX_ACTION_NAME,
  STREAMERBOT_MAX_ARGS,
  STREAMERBOT_MAX_ARG_KEY,
  STREAMERBOT_MAX_ARG_VALUE,
} from '@phonedek/shared'
import type { Logger } from './logger'

export const DEFAULT_STREAMERBOT_HOST = STREAMERBOT_DEFAULT_HOST
export const STREAMERBOT_ENDPOINT = '/'

/**
 * Base64(SHA-256(secret + challenge)) response used by Streamer.bot 0.2.5+.
 * The first SHA-256 covers `password + salt`, exactly like OBS.
 */
export function streamerBotAuthString(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(`${password}${salt}`, 'utf8').digest('base64')
  return createHash('sha256').update(`${secret}${challenge}`, 'utf8').digest('base64')
}

/** Build the ws:// URL without letting a host inject a scheme or path. */
export function streamerBotWebSocketUrl(host: string, port: number): string {
  const cleanHost = host.startsWith('[') || !host.includes(':') ? host : `[${host}]`
  return `ws://${cleanHost}:${port}${STREAMERBOT_ENDPOINT}`
}

/** Default reconnect delays: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s (±20 %). */
export function defaultStreamerBotBackoff(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(5, attempt - 1)))
  const jitter = 0.8 + Math.random() * 0.4
  return Math.round(base * jitter)
}

export type StreamerBotState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'disconnected'
  | 'reconnecting'
  | 'error'

export interface StreamerBotStatus {
  state: StreamerBotState
  host: string
  port: number
  instanceName?: string
  version?: string
  actionCount?: number
  lastError?: string
  nextRetryMs?: number
}

/** One action returned by `GetActions`, normalized for the picker. */
export interface StreamerBotActionInfo {
  id: string
  name: string
  group?: string
  enabled: boolean
  subactionCount: number
  triggerCount: number
}

export interface StreamerBotClientConfig {
  host: string
  port: number
  password: string
  enabled: boolean
}

export type StreamerBotStatusListener = (status: StreamerBotStatus) => void

export interface StreamerBotClientOptions extends Partial<StreamerBotClientConfig> {
  logger?: Logger
  /** Request timeout; default 5000 ms. */
  requestTimeoutMs?: number
  /** Hello/Authenticate timeout; default 3000 ms. */
  connectTimeoutMs?: number
  /** WebSocket ping interval; default 20 s. `0` disables it. */
  heartbeatMs?: number
  /** Return the delay before the next reconnect attempt. */
  backoffMs?: (attempt: number) => number
  /** Authentication-failure retry floor; default 30 s. */
  authRetryMs?: number
  /** Test seam; defaults to a real `ws` client. */
  socketFactory?: (url: string) => WebSocket
}

export class StreamerBotRequestError extends Error {
  constructor(
    readonly request: string,
    message: string,
  ) {
    super(message)
    this.name = 'StreamerBotRequestError'
  }
}

interface PendingRequest {
  request: string
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const CONNECT_TIMEOUT_MS = 3000
const REQUEST_TIMEOUT_MS = 5000
const AUTH_RETRY_MS = 30_000
const HEARTBEAT_MS = 20_000

/**
 * Streamer.bot WebSocket client (v0.2.x).
 *
 * One instance owns one socket. The server sends `Hello` on connect; when
 * authentication is enabled the client answers with `Authenticate`, then marks
 * itself connected. Requests are correlated by id, errors are surfaced as
 * `StreamerBotRequestError`, and the client reconnects with backoff while
 * enabled. Passwords and authentication payloads are never logged.
 */
export class StreamerBotClient {
  private config: StreamerBotClientConfig
  private readonly logger?: Logger
  private readonly requestTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly heartbeatMs: number
  private readonly backoffMs: (attempt: number) => number
  private readonly authRetryMs: number
  private readonly socketFactory: (url: string) => WebSocket

  private socket: WebSocket | null = null
  private socketGeneration = 0
  private sequence = 0
  private attempt = 0
  private enabled = false
  private disposed = false
  private authenticating = false
  private awaitingPong = false
  private retryTimer: NodeJS.Timeout | null = null
  private connectTimer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private actionQueue: Promise<void> = Promise.resolve()

  private state: StreamerBotState
  private lastError: string | undefined
  private nextRetryMs: number | undefined
  private instanceName: string | undefined
  private version: string | undefined
  private actionCount: number | undefined
  private cachedActions: StreamerBotActionInfo[] = []

  private readonly pending = new Map<string, PendingRequest>()
  private readonly statusListeners = new Set<StreamerBotStatusListener>()

  constructor(options: StreamerBotClientOptions = {}) {
    this.config = {
      host: options.host ?? DEFAULT_STREAMERBOT_HOST,
      port: options.port ?? STREAMERBOT_DEFAULT_PORT,
      password: options.password ?? '',
      enabled: options.enabled ?? false,
    }
    this.logger = options.logger
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    this.connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS)
    this.heartbeatMs = Math.max(0, options.heartbeatMs ?? HEARTBEAT_MS)
    this.backoffMs = options.backoffMs ?? defaultStreamerBotBackoff
    this.authRetryMs = Math.max(1000, options.authRetryMs ?? AUTH_RETRY_MS)
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
    this.enabled = this.config.enabled
    this.state = this.enabled ? 'connecting' : 'disabled'
  }

  get connected(): boolean {
    return this.state === 'connected'
  }

  get status(): StreamerBotStatus {
    return {
      state: this.state,
      host: this.config.host,
      port: this.config.port,
      ...(this.instanceName ? { instanceName: this.instanceName } : {}),
      ...(this.version ? { version: this.version } : {}),
      ...(this.actionCount !== undefined ? { actionCount: this.actionCount } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.nextRetryMs !== undefined ? { nextRetryMs: this.nextRetryMs } : {}),
    }
  }

  /** Last successful `GetActions` result; never fetches on its own. */
  get actions(): StreamerBotActionInfo[] {
    return this.cachedActions.map((action) => ({ ...action }))
  }

  /** Apply new connection settings. A real change restarts the connection. */
  configure(config: Partial<StreamerBotClientConfig>): void {
    if (this.disposed) return
    const next: StreamerBotClientConfig = {
      host: config.host ?? this.config.host,
      port: config.port ?? this.config.port,
      password: config.password ?? this.config.password,
      enabled: config.enabled ?? this.config.enabled,
    }
    const changed =
      next.host !== this.config.host ||
      next.port !== this.config.port ||
      next.password !== this.config.password ||
      next.enabled !== this.config.enabled
    this.config = next

    if (!next.enabled) {
      this.enabled = false
      this.stopInternal('disabled')
      return
    }

    this.enabled = true
    if (changed || !this.socket) {
      this.resetConnectionDetails()
      this.attempt = 0
      this.stopInternal(null)
      this.connect()
    }
  }

  start(): void {
    if (this.disposed) return
    this.enabled = true
    this.config = { ...this.config, enabled: true }
    if (this.socket || this.retryTimer) return
    this.attempt = 0
    this.connect()
  }

  stop(): void {
    this.enabled = false
    this.config = { ...this.config, enabled: false }
    this.stopInternal('disabled')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.enabled = false
    this.stopInternal(null)
    this.statusListeners.clear()
  }

  onStatus(listener: StreamerBotStatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /**
   * Fetch and cache the action list. Rejects while disconnected so Settings can
   * show a clear error instead of an empty picker.
   */
  async getActions(): Promise<StreamerBotActionInfo[]> {
    const payload = await this.request('GetActions')
    const rows = Array.isArray(payload['actions']) ? payload['actions'] : []
    const actions: StreamerBotActionInfo[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const name = str(row['name'])
      if (!name) continue
      actions.push({
        id: str(row['id']),
        name,
        ...(str(row['group']) && str(row['group']) !== 'None' ? { group: str(row['group']) } : {}),
        enabled: row['enabled'] !== false,
        subactionCount: num(row['subaction_count']),
        triggerCount: num(row['trigger_count']),
      })
    }
    this.cachedActions = actions
    this.actionCount = actions.length
    this.emitStatus()
    return this.actions
  }

  /**
   * Trigger an action by name. Calls are serialized so two phones (or a macro)
   * never race each other inside Streamer.bot, and they never wait behind the
   * keyboard executor queue.
   */
  doAction(actionName: string, args?: Record<string, string>): Promise<void> {
    const normalized = normalizeDoAction(actionName, args)
    const run = this.actionQueue.then(() => this.sendDoAction(normalized.name, normalized.args))
    this.actionQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async sendDoAction(actionName: string, args?: Record<string, string>): Promise<void> {
    await this.request('DoAction', {
      action: { name: actionName },
      ...(args && Object.keys(args).length > 0 ? { args } : {}),
    })
  }

  private request(
    request: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (this.disposed || !this.enabled) {
      return Promise.reject(new Error('Streamer.bot is not connected.'))
    }
    if (this.state !== 'connected' || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Streamer.bot is not connected.'))
    }

    const requestId = `sb-${++this.sequence}`
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error(`Streamer.bot request timed out: ${request}`))
      }, this.requestTimeoutMs)
      timer.unref?.()

      this.pending.set(requestId, { request, resolve, reject, timer })

      try {
        this.socket!.send(JSON.stringify({ request, id: requestId, ...payload }))
      } catch (error) {
        this.failPending(requestId, new Error(`Could not send Streamer.bot request: ${message(error)}`))
      }
    })
  }

  private connect(): void {
    if (this.disposed || !this.enabled || this.socket) return
    this.clearRetry()
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting', { nextRetryMs: undefined })

    let socket: WebSocket
    try {
      socket = this.socketFactory(
        streamerBotWebSocketUrl(this.config.host, this.config.port),
      )
    } catch (error) {
      this.scheduleReconnect(`Could not connect to Streamer.bot: ${message(error)}`)
      return
    }

    this.socket = socket
    const generation = ++this.socketGeneration
    this.awaitingPong = false
    this.authenticating = false

    this.connectTimer = setTimeout(() => {
      if (generation !== this.socketGeneration || this.state === 'connected') return
      this.connectTimer = null
      this.logger?.warn(
        `Streamer.bot connection to ${this.config.host}:${this.config.port} timed out`,
      )
      this.closeSocket()
      this.scheduleReconnect('Streamer.bot did not complete its handshake')
    }, this.connectTimeoutMs)
    this.connectTimer.unref?.()

    socket.on('open', () => {
      if (generation !== this.socketGeneration) return
      this.logger?.info(`Streamer.bot WebSocket opened to ${this.config.host}:${this.config.port}`)
    })
    socket.on('message', (data: RawData) => {
      if (generation !== this.socketGeneration) return
      this.handleMessage(data.toString())
    })
    socket.on('pong', () => {
      if (generation !== this.socketGeneration) return
      this.awaitingPong = false
    })
    socket.on('error', (error: Error) => {
      if (generation !== this.socketGeneration) return
      this.logger?.warn(`Streamer.bot socket error: ${error.message}`)
      this.lastError = error.message
    })
    socket.on('close', (code: number, reason: Buffer) => {
      if (generation !== this.socketGeneration) return
      this.handleClose(code, reason.toString())
    })
  }

  private handleMessage(raw: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(raw)
    } catch {
      this.logger?.warn('Streamer.bot sent invalid JSON; ignoring frame')
      return
    }
    if (!isRecord(frame)) {
      this.logger?.warn('Streamer.bot sent an unknown frame; ignoring it')
      return
    }

    if (frame['request'] === 'Hello') {
      this.handleHello(frame)
      return
    }

    const requestId = typeof frame['id'] === 'string' ? frame['id'] : ''
    if (requestId) this.handleResponse(requestId, frame)
  }

  private handleHello(frame: Record<string, unknown>): void {
    const info = isRecord(frame['info']) ? frame['info'] : {}
    this.instanceName =
      str(info['name']) || str(info['instanceId']) || this.instanceName
    this.version = str(info['version']) || this.version

    const authentication = isRecord(frame['authentication']) ? frame['authentication'] : null
    const salt = authentication ? str(authentication['salt']) : ''
    const challenge = authentication ? str(authentication['challenge']) : ''

    if (!salt || !challenge) {
      this.markConnected()
      return
    }

    if (!this.config.password) {
      this.handleAuthFailure(
        'Streamer.bot requires a WebSocket password. Add it in Settings.',
      )
      return
    }

    this.authenticating = true
    const authenticationString = streamerBotAuthString(
      this.config.password,
      salt,
      challenge,
    )
    const requestId = `sb-${++this.sequence}`
    const timer = setTimeout(() => {
      if (!this.pending.delete(requestId)) return
      this.authenticating = false
      this.handleAuthFailure('Streamer.bot did not answer the authentication request.')
    }, this.requestTimeoutMs)
    timer.unref?.()

    this.pending.set(requestId, {
      request: 'Authenticate',
      resolve: () => {
        this.authenticating = false
        this.markConnected()
      },
      reject: () => {
        this.authenticating = false
        this.handleAuthFailure('Streamer.bot rejected the WebSocket password.')
      },
      timer,
    })

    try {
      this.socket?.send(
        JSON.stringify({
          request: 'Authenticate',
          id: requestId,
          authentication: authenticationString,
        }),
      )
    } catch (error) {
      this.failPending(
        requestId,
        new Error(`Could not authenticate with Streamer.bot: ${message(error)}`),
      )
    }
  }

  private handleResponse(requestId: string, frame: Record<string, unknown>): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)

    if (frame['status'] === 'ok') {
      pending.resolve(frame)
      return
    }
    const detail =
      str(frame['error']) ||
      str(frame['message']) ||
      (pending.request === 'Authenticate'
        ? 'Streamer.bot rejected the WebSocket password.'
        : `Streamer.bot rejected ${pending.request}.`)
    pending.reject(new StreamerBotRequestError(pending.request, detail))
  }

  private markConnected(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.attempt = 0
    this.authenticating = false
    this.setState('connected', { lastError: undefined, nextRetryMs: undefined })
    this.startHeartbeat()
    this.logger?.info(
      `Streamer.bot connected at ${this.config.host}:${this.config.port}` +
        `${this.version ? ` (v${this.version})` : ''}`,
    )
  }

  private handleAuthFailure(reason: string): void {
    this.clearRetry()
    this.closeSocket()
    this.lastError = reason
    this.nextRetryMs = this.authRetryMs
    this.state = 'auth-failed'
    this.emitStatus()
    this.logger?.warn(`Streamer.bot authentication failed: ${reason}`)
    if (this.disposed || !this.enabled || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, this.authRetryMs)
    this.retryTimer.unref?.()
  }

  private handleClose(code: number, reason: string): void {
    this.socket = null
    this.clearHeartbeat()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    const wasAuthenticating = this.authenticating
    this.authenticating = false
    this.failAllPending('Streamer.bot connection closed')

    if (this.disposed) return
    if (wasAuthenticating || this.state === 'auth-failed') {
      this.handleAuthFailure(
        this.lastError ?? 'Streamer.bot closed the connection during authentication.',
      )
      return
    }

    if (!this.enabled) return
    this.scheduleReconnect(reason || 'Streamer.bot connection closed')
  }

  private scheduleReconnect(error: string): void {
    if (this.disposed || !this.enabled || this.retryTimer) return
    this.attempt += 1
    const delay = this.backoffMs(this.attempt)
    this.setState('reconnecting', { lastError: error, nextRetryMs: delay })
    this.logger?.info(`Streamer.bot reconnect in ${delay} ms (attempt ${this.attempt})`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
    this.retryTimer.unref?.()
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    if (this.heartbeatMs <= 0) return
    this.heartbeat = setInterval(() => {
      const socket = this.socket
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      if (this.awaitingPong) {
        this.logger?.warn('Streamer.bot stopped responding to pings')
        this.closeSocket()
        this.scheduleReconnect('Streamer.bot stopped responding.')
        return
      }
      this.awaitingPong = true
      try {
        socket.ping()
      } catch {
        // The close handler reconnects.
      }
    }, this.heartbeatMs)
    this.heartbeat.unref?.()
  }

  private clearHeartbeat(): void {
    if (!this.heartbeat) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private clearRetry(): void {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private stopInternal(state: StreamerBotState | null): void {
    this.clearRetry()
    this.closeSocket()
    if (state) {
      this.lastError = undefined
      this.setState(state, { lastError: undefined, nextRetryMs: undefined })
    }
  }

  private closeSocket(): void {
    this.socketGeneration += 1
    const socket = this.socket
    this.socket = null
    this.clearHeartbeat()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.failAllPending('Streamer.bot connection closed')
    if (!socket) return
    try {
      socket.close(1000, 'PhoneDeck closing')
    } catch {
      // already closed
    }
  }

  private failPending(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.reject(error)
  }

  private failAllPending(error: string): void {
    for (const [requestId, pending] of [...this.pending]) {
      this.pending.delete(requestId)
      clearTimeout(pending.timer)
      pending.reject(new Error(error))
    }
  }

  private resetConnectionDetails(): void {
    this.instanceName = undefined
    this.version = undefined
    this.actionCount = undefined
    this.cachedActions = []
  }

  private setState(state: StreamerBotState, extra: Partial<StreamerBotStatus> = {}): void {
    this.state = state
    if ('lastError' in extra) this.lastError = extra.lastError
    if ('nextRetryMs' in extra) this.nextRetryMs = extra.nextRetryMs
    this.emitStatus()
  }

  private emitStatus(): void {
    const snapshot = this.status
    for (const listener of [...this.statusListeners]) {
      try {
        listener(snapshot)
      } catch (error) {
        this.logger?.warn(`Streamer.bot status listener failed: ${message(error)}`)
      }
    }
  }
}

/** Validate an action name/args coming from IPC or a plan step. */
export function normalizeDoAction(
  actionName: unknown,
  args?: unknown,
): { name: string; args?: Record<string, string> } {
  if (typeof actionName !== 'string') throw new Error('Streamer.bot action name must be text')
  const name = actionName.trim()
  if (!name) throw new Error('Streamer.bot action name cannot be empty')
  if (name.length > STREAMERBOT_MAX_ACTION_NAME) {
    throw new Error(
      `Streamer.bot action names are limited to ${STREAMERBOT_MAX_ACTION_NAME} characters`,
    )
  }
  if (args === undefined) return { name }
  if (!isRecord(args)) throw new Error('Streamer.bot arguments must be an object')
  const keys = Object.keys(args)
  if (keys.length > STREAMERBOT_MAX_ARGS) {
    throw new Error(`Streamer.bot actions accept at most ${STREAMERBOT_MAX_ARGS} arguments`)
  }
  const normalized: Record<string, string> = {}
  for (const key of keys) {
    if (!key || key.length > STREAMERBOT_MAX_ARG_KEY) {
      throw new Error(`Streamer.bot argument names must be 1..${STREAMERBOT_MAX_ARG_KEY} characters`)
    }
    const value = args[key]
    if (typeof value !== 'string') {
      throw new Error('Streamer.bot argument values must be text')
    }
    if (value.length > STREAMERBOT_MAX_ARG_VALUE) {
      throw new Error(
        `Streamer.bot argument values are limited to ${STREAMERBOT_MAX_ARG_VALUE} characters`,
      )
    }
    normalized[key] = value
  }
  return { name, ...(keys.length > 0 ? { args: normalized } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
