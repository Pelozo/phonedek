import { createHash } from 'node:crypto'
import { WebSocket, type RawData } from 'ws'
import type { Logger } from './logger'

/** OBS WebSocket v5 event subscription mask used by the MVP: General | Config | Inputs. */
export const OBS_EVENT_SUBSCRIPTIONS = 1 | 2 | 8

/** Base64(SHA-256(secret)) challenge response used by obs-websocket v5. */
export function obsAuthString(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(`${password}${salt}`, 'utf8').digest('base64')
  return createHash('sha256').update(`${secret}${challenge}`, 'utf8').digest('base64')
}

/** Build the ws:// URL without letting a host inject a scheme or port. */
export function obsWebSocketUrl(host: string, port: number): string {
  const cleanHost = host.startsWith('[') || !host.includes(':') ? host : `[${host}]`
  return `ws://${cleanHost}:${port}`
}

/** Default reconnect delays: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s. */
export function defaultObsBackoff(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(5, attempt - 1)))
  // ±20 % jitter keeps multiple OBS clients from retrying in lockstep.
  const jitter = 0.8 + Math.random() * 0.4
  return Math.round(base * jitter)
}

export type ObsState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'disconnected'
  | 'reconnecting'
  | 'error'

export interface ObsStatus {
  state: ObsState
  host: string
  port: number
  obsVersion?: string
  websocketVersion?: string
  lastError?: string
  nextRetryMs?: number
}

export type ObsEvent = (type: string, data: Record<string, unknown>) => void
export type ObsStatusListener = (status: ObsStatus) => void

export interface ObsClientConfig {
  host: string
  port: number
  password: string
  enabled: boolean
}

export interface ObsClientOptions extends Partial<ObsClientConfig> {
  logger?: Logger
  /** Request timeout; default 5000 ms. */
  requestTimeoutMs?: number
  /** Hello/Identify timeout; default 3000 ms. */
  connectTimeoutMs?: number
  /** WebSocket ping interval; default 20 s. `0` disables it. */
  heartbeatMs?: number
  /** Return the delay before the next reconnect attempt. */
  backoffMs?: (attempt: number) => number
  /** Authentication-failure retry floor; default 30 s. */
  authRetryMs?: number
  /** Test seam; defaults to a real `ws` client. */
  socketFactory?: (url: string) => WebSocket
  now?: () => number
}

export class ObsRequestError extends Error {
  readonly code: number
  readonly comment?: string

  constructor(type: string, code: number, comment?: string) {
    super(`OBS request ${type} failed (${code})${comment ? `: ${comment}` : ''}`)
    this.name = 'ObsRequestError'
    this.code = code
    if (comment !== undefined) this.comment = comment
  }
}

interface PendingRequest {
  type: string
  resolve: (data: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const CONNECT_TIMEOUT_MS = 3000
const REQUEST_TIMEOUT_MS = 5000
const AUTH_RETRY_MS = 30_000
const HEARTBEAT_MS = 20_000
const EXIT_RESTART_MS = 10_000

/**
 * obs-websocket v5 client.
 *
 * One instance owns one socket. It performs the Hello/Identify handshake,
 * correlates requests by id, surfaces requestStatus errors, emits events and
 * reconnects with backoff while enabled. It never logs the password or the
 * Identify payload.
 */
export class ObsClient {
  private config: ObsClientConfig
  private readonly logger?: Logger
  private readonly requestTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly heartbeatMs: number
  private readonly backoffMs: (attempt: number) => number
  private readonly authRetryMs: number
  private readonly socketFactory: (url: string) => WebSocket

  private socket: WebSocket | null = null
  private generation = 0
  private sequence = 0
  private attempt = 0
  private enabled = false
  private disposed = false
  private scenePaused = false
  private exitPending = false
  private awaitingPong = false
  private statusValue: ObsStatus
  private retryTimer: NodeJS.Timeout | null = null
  private connectTimer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly statusListeners = new Set<ObsStatusListener>()
  private readonly eventListeners = new Set<ObsEvent>()

  constructor(options: ObsClientOptions = {}) {
    this.config = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 4455,
      password: options.password ?? '',
      enabled: options.enabled ?? false,
    }
    this.logger = options.logger
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    this.connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS)
    this.heartbeatMs = Math.max(0, options.heartbeatMs ?? HEARTBEAT_MS)
    this.backoffMs = options.backoffMs ?? defaultObsBackoff
    this.authRetryMs = Math.max(1000, options.authRetryMs ?? AUTH_RETRY_MS)
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
    this.enabled = this.config.enabled
    this.statusValue = {
      state: this.enabled ? 'connecting' : 'disabled',
      host: this.config.host,
      port: this.config.port,
    }
  }

  get connected(): boolean {
    return this.statusValue.state === 'connected'
  }

  /** True between CurrentSceneCollectionChanging and ...Changed. */
  get paused(): boolean {
    return this.scenePaused
  }

  get status(): ObsStatus {
    return { ...this.statusValue }
  }

  /** Apply new connection settings. A real change restarts the connection. */
  configure(config: Partial<ObsClientConfig>): void {
    if (this.disposed) return
    const next: ObsClientConfig = {
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
      this.attempt = 0
      this.exitPending = false
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
    this.exitPending = false
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
    this.eventListeners.clear()
  }

  onStatus(listener: ObsStatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  onEvent(listener: ObsEvent): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /** Send an obs-websocket request. Rejects immediately while disconnected. */
  request<T = Record<string, unknown>>(type: string, data?: object): Promise<T> {
    if (this.disposed || !this.enabled) {
      return Promise.reject(new Error('OBS is not connected.'))
    }
    if (this.statusValue.state !== 'connected' || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OBS is not connected.'))
    }
    if (this.scenePaused) {
      return Promise.reject(new Error('OBS is switching scene collections.'))
    }

    const requestId = `obs-${++this.sequence}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error(`OBS request timed out: ${type}`))
      }, this.requestTimeoutMs)
      timer.unref?.()

      this.pending.set(requestId, {
        type,
        resolve: (payload) => resolve(payload as T),
        reject,
        timer,
      })

      try {
        this.socket!.send(
          JSON.stringify({
            op: 6,
            d: {
              requestType: type,
              requestId,
              ...(data ? { requestData: data } : {}),
            },
          }),
        )
      } catch (error) {
        this.failPending(requestId, new Error(`Could not send OBS request: ${message(error)}`))
      }
    })
  }

  private connect(): void {
    if (this.disposed || !this.enabled || this.socket) return
    this.clearRetry()
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting', { nextRetryMs: undefined })

    let socket: WebSocket
    try {
      socket = this.socketFactory(obsWebSocketUrl(this.config.host, this.config.port))
    } catch (error) {
      this.scheduleReconnect(`Could not connect to OBS: ${message(error)}`)
      return
    }

    this.socket = socket
    const generation = ++this.generation
    this.scenePaused = false
    this.awaitingPong = false

    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation || this.statusValue.state === 'connected') return
      this.connectTimer = null
      this.logger?.warn(`OBS connection to ${this.config.host}:${this.config.port} timed out`)
      this.closeSocket()
      this.scheduleReconnect('OBS connection timed out')
    }, this.connectTimeoutMs)
    this.connectTimer.unref?.()

    socket.on('open', () => {
      if (generation !== this.generation) return
      this.logger?.info(`OBS WebSocket opened to ${this.config.host}:${this.config.port}`)
    })
    socket.on('message', (data: RawData) => {
      if (generation !== this.generation) return
      this.handleMessage(data.toString())
    })
    socket.on('pong', () => {
      if (generation !== this.generation) return
      this.awaitingPong = false
    })
    socket.on('error', (error: Error) => {
      if (generation !== this.generation) return
      this.logger?.warn(`OBS socket error: ${error.message}`)
      this.setStatus({ lastError: error.message })
    })
    socket.on('close', (code: number, reason: Buffer) => {
      if (generation !== this.generation) return
      this.handleClose(code, reason.toString())
    })
  }

  private handleMessage(raw: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(raw)
    } catch {
      this.logger?.warn('OBS sent invalid JSON; ignoring frame')
      return
    }
    if (!isRecord(frame) || !Number.isInteger(frame['op'])) {
      this.logger?.warn('OBS sent an unknown frame; ignoring it')
      return
    }

    const op = frame['op'] as number
    const data = isRecord(frame['d']) ? frame['d'] : {}

    switch (op) {
      case 0:
        this.handleHello(data)
        break
      case 2:
        this.handleIdentified()
        break
      case 5:
        this.handleEvent(data)
        break
      case 7:
        this.handleResponse(data)
        break
      default:
        // Batches and unknown ops are not part of the MVP.
        break
    }
  }

  private handleHello(data: Record<string, unknown>): void {
    const rpcVersion = data['rpcVersion']
    if (!Number.isInteger(rpcVersion)) {
      this.failUnsupported('OBS 28+ required (obs-websocket v5).', 'error')
      return
    }

    let authentication: string | undefined
    const auth = data['authentication']
    if (isRecord(auth)) {
      const challenge = typeof auth['challenge'] === 'string' ? auth['challenge'] : ''
      const salt = typeof auth['salt'] === 'string' ? auth['salt'] : ''
      if (challenge && salt) {
        authentication = obsAuthString(this.config.password, salt, challenge)
      }
    }

    try {
      this.socket?.send(
        JSON.stringify({
          op: 1,
          d: {
            rpcVersion: 1,
            eventSubscriptions: OBS_EVENT_SUBSCRIPTIONS,
            ...(authentication ? { authentication } : {}),
          },
        }),
      )
    } catch (error) {
      this.closeSocket()
      this.scheduleReconnect(`Could not identify with OBS: ${message(error)}`)
    }
  }

  private handleIdentified(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.attempt = 0
    this.scenePaused = false
    this.exitPending = false
    this.setState('connected', { nextRetryMs: undefined, lastError: undefined })
    this.startHeartbeat()
    this.logger?.info(`OBS connected at ${this.config.host}:${this.config.port}`)

    void this.request<Record<string, unknown>>('GetVersion')
      .then((version) => {
        const obsVersion = typeof version['obsVersion'] === 'string' ? version['obsVersion'] : undefined
        const websocketVersion =
          typeof version['obsWebSocketVersion'] === 'string'
            ? version['obsWebSocketVersion']
            : undefined
        this.setStatus({
          ...(obsVersion ? { obsVersion } : {}),
          ...(websocketVersion ? { websocketVersion } : {}),
        })
      })
      .catch(() => {
        // Version is cosmetic; identification already succeeded.
      })
  }

  private handleEvent(data: Record<string, unknown>): void {
    const type = typeof data['eventType'] === 'string' ? data['eventType'] : ''
    if (!type) return
    const eventData = isRecord(data['eventData']) ? data['eventData'] : {}

    if (type === 'CurrentSceneCollectionChanging') this.scenePaused = true
    if (type === 'CurrentSceneCollectionChanged') this.scenePaused = false
    if (type === 'ExitStarted') {
      this.exitPending = true
      this.logger?.info('OBS is exiting; pausing reconnects')
      this.closeSocket()
      this.scheduleReconnect('OBS is exiting.')
      return
    }

    for (const listener of [...this.eventListeners]) {
      try {
        listener(type, eventData)
      } catch (error) {
        this.logger?.warn(`OBS event listener failed: ${message(error)}`)
      }
    }
  }

  private handleResponse(data: Record<string, unknown>): void {
    const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : ''
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)

    const status = isRecord(data['requestStatus']) ? data['requestStatus'] : {}
    if (status['result'] === true) {
      pending.resolve(isRecord(data['responseData']) ? data['responseData'] : {})
      return
    }
    const code = typeof status['code'] === 'number' ? status['code'] : 0
    const comment = typeof status['comment'] === 'string' ? status['comment'] : undefined
    pending.reject(new ObsRequestError(pending.type, code, comment))
  }

  private handleClose(code: number, reason: string): void {
    this.socket = null
    this.scenePaused = false
    this.clearHeartbeat()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.failAllPending('OBS connection closed')

    if (this.disposed) return
    if (code === 4009) {
      this.setState('auth-failed', { lastError: 'OBS authentication failed', nextRetryMs: this.authRetryMs })
      this.logger?.warn('OBS rejected the configured password')
      this.scheduleAuthRetry()
      return
    }
    if (code === 4011) {
      this.enabled = false
      this.setState('disabled', { lastError: 'OBS session was invalidated', nextRetryMs: undefined })
      this.logger?.warn('OBS session was invalidated; reconnect after changing OBS settings')
      return
    }
    if (code === 4010) {
      this.enabled = false
      this.setState('error', { lastError: 'OBS 28+ required (obs-websocket v5)', nextRetryMs: undefined })
      return
    }

    if (!this.enabled) return
    this.scheduleReconnect(reason || 'OBS connection closed')
  }

  private failUnsupported(error: string, state: ObsState): void {
    this.enabled = false
    this.clearRetry()
    this.setState(state, { lastError: error, nextRetryMs: undefined })
    this.closeSocket()
    this.logger?.warn(error)
  }

  private scheduleAuthRetry(): void {
    if (this.disposed || !this.enabled || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, this.authRetryMs)
    this.retryTimer.unref?.()
  }

  private scheduleReconnect(error: string): void {
    if (this.disposed || !this.enabled || this.retryTimer) return
    this.attempt += 1
    const delay = this.exitPending
      ? Math.max(EXIT_RESTART_MS, this.backoffMs(this.attempt))
      : this.backoffMs(this.attempt)
    if (this.exitPending) this.exitPending = false
    this.setState(this.statusValue.state === 'auth-failed' ? 'auth-failed' : 'reconnecting', {
      lastError: error,
      nextRetryMs: delay,
    })
    this.logger?.info(`OBS reconnect in ${delay} ms (attempt ${this.attempt})`)
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
        this.logger?.warn('OBS stopped responding to pings')
        this.closeSocket()
        this.scheduleReconnect('OBS stopped responding.')
        return
      }
      this.awaitingPong = true
      try {
        socket.ping()
      } catch {
        // The close handler will reconnect.
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

  private stopInternal(state: ObsState | null): void {
    this.clearRetry()
    this.closeSocket()
    if (state) this.setState(state, { nextRetryMs: undefined })
  }

  private closeSocket(): void {
    this.generation += 1
    const socket = this.socket
    this.socket = null
    this.clearHeartbeat()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.failAllPending('OBS connection closed')
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

  private setState(state: ObsState, extra: Partial<ObsStatus> = {}): void {
    this.statusValue = {
      state,
      host: this.config.host,
      port: this.config.port,
      ...extra,
    }
    this.emitStatus()
  }

  private setStatus(extra: Partial<ObsStatus>): void {
    this.statusValue = { ...this.statusValue, ...extra }
    this.emitStatus()
  }

  private emitStatus(): void {
    const snapshot = this.status
    for (const listener of [...this.statusListeners]) {
      try {
        listener(snapshot)
      } catch (error) {
        this.logger?.warn(`OBS status listener failed: ${message(error)}`)
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
