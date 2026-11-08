import type {
  ControlSpec,
  PointerButton,
  PointerButtonEvent,
  PointerMessage,
  PointerResult,
} from '@phonedek/shared'
import type { PointerSenderLike } from './pointer-sender'
import type { Logger } from './logger'

export interface PointerTarget {
  control: ControlSpec
  /** Human-readable button label, used in logs. */
  label: string
}

export interface PointerRouterOptions {
  sender: PointerSenderLike
  logger?: Logger
  /** Milliseconds of pointer silence before held buttons are released. */
  watchdogMs?: number
  /** Messages allowed per second per connection (end/cancel are exempt). */
  rateLimit?: number
  now?: () => number
}

interface PointerClientState {
  /** Highest accepted sequence number; stale/duplicate frames are ignored. */
  lastSeq: number | null
  residualScrollX: number
  residualScrollY: number
  held: Set<PointerButton>
  target: PointerTarget | null
  times: number[]
  lastSeen: number
  watchdog: NodeJS.Timeout | null
}

const DEFAULT_WATCHDOG_MS = 6_000
const DEFAULT_RATE_LIMIT = 120
const MAX_DELTA = 2
const MAX_SCROLL = 10
const SUPPORTED_BUTTONS = new Set<PointerButton>(['left', 'right', 'middle'])

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function clampDelta(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return clamp(value, -MAX_DELTA, MAX_DELTA)
}

function clampScroll(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return clamp(value, -MAX_SCROLL, MAX_SCROLL)
}

function sensitivityOf(target: PointerTarget | null): number {
  if (!target) return 1
  if (target.control.kind !== 'trackpad') return 1
  if (target.control.binding.type !== 'pointer') return 1
  return clamp(target.control.binding.sensitivity ?? 1, 0.25, 3)
}

/**
 * Routes pointer gestures from connected phones to a dedicated sender.
 *
 * Applies every message immediately (no 50 ms coalescing), owns per-connection
 * sequence/button state, and guarantees that only one phone controls the
 * cursor. A new `start` preempts the previous phone and releases its buttons;
 * `cancel`, a WebSocket close, the 6 s watchdog and the `blocked` gate (native
 * dialogs) all release held buttons as well. `end` deliberately does not.
 */
export class PointerRouter {
  private readonly sender: PointerSenderLike
  private readonly logger?: Logger
  private readonly watchdogMs: number
  private readonly rateLimit: number
  private readonly now: () => number
  private readonly clients = new Map<string, PointerClientState>()
  private activeClientId: string | null = null
  private blocked = false
  private disposed = false

  constructor(options: PointerRouterOptions) {
    this.sender = options.sender
    this.logger = options.logger
    this.watchdogMs = Math.max(1, options.watchdogMs ?? DEFAULT_WATCHDOG_MS)
    this.rateLimit = Math.max(1, options.rateLimit ?? DEFAULT_RATE_LIMIT)
    this.now = options.now ?? Date.now
  }

  get activeClient(): string | null {
    return this.activeClientId
  }

  get isBlocked(): boolean {
    return this.blocked
  }

  handle(clientId: string, message: PointerMessage, target?: PointerTarget): PointerResult {
    if (this.disposed) {
      return { seq: message.seq, ok: false, error: 'Pointer control is shutting down.' }
    }

    const state = this.stateFor(clientId)
    const now = this.now()

    if (this.blocked) {
      if (message.phase === 'cancel') {
        this.releaseHeld(clientId, 'pointer cancelled while blocked')
        return { seq: message.seq, ok: true }
      }
      return {
        seq: message.seq,
        ok: false,
        error: 'Pointer control is suspended while a dialog is open on the PC.',
      }
    }

    if (state.lastSeq !== null && message.seq <= state.lastSeq) {
      // Duplicate/reordered datagram: acknowledge quietly, never replay it.
      return { seq: message.seq, ok: true }
    }

    if (message.phase !== 'end' && message.phase !== 'cancel') {
      state.times = state.times.filter((time) => now - time < 1_000)
      if (state.times.length >= this.rateLimit) {
        return { seq: message.seq, ok: false, error: 'Too many pointer events, slow down' }
      }
      state.times.push(now)
    }

    state.lastSeq = message.seq
    state.lastSeen = now

    switch (message.phase) {
      case 'start':
        return this.start(clientId, state, message, target)
      case 'move':
      case 'end':
        return this.move(clientId, state, message)
      case 'cancel':
        return this.cancel(clientId, state, message)
    }
  }

  /**
   * Suspend injection while a native dialog is open. Any held button is
   * released first so the dialog cannot be dragged/clicked by a stale press.
   * The gesture state is retained so input resumes when the dialog closes.
   */
  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return
    this.blocked = blocked
    if (!blocked) {
      this.logger?.info('Pointer control resumed')
      return
    }
    for (const [clientId, state] of this.clients) {
      if (state.held.size > 0) this.releaseHeld(clientId, 'pointer blocked by a dialog')
    }
    this.logger?.info('Pointer control suspended while a PC dialog is open')
  }

  /** Release everything this connection held; call from the WS close handler. */
  clientDisconnected(clientId: string): void {
    const state = this.clients.get(clientId)
    if (!state) return
    this.releaseHeld(clientId, 'pointer client disconnected')
    this.clearWatchdog(state)
    this.clients.delete(clientId)
    if (this.activeClientId === clientId) {
      this.activeClientId = null
      this.logger?.info('Pointer control released on disconnect')
    }
  }

  /** Release held buttons and stop all timers. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [clientId, state] of this.clients) {
      this.releaseHeld(clientId, 'pointer control shutting down')
      this.clearWatchdog(state)
    }
    this.clients.clear()
    this.activeClientId = null
  }

  private stateFor(clientId: string): PointerClientState {
    let state = this.clients.get(clientId)
    if (!state) {
      state = {
        lastSeq: null,
        residualScrollX: 0,
        residualScrollY: 0,
        held: new Set<PointerButton>(),
        target: null,
        times: [],
        lastSeen: this.now(),
        watchdog: null,
      }
      this.clients.set(clientId, state)
    }
    return state
  }

  private start(
    clientId: string,
    state: PointerClientState,
    message: Extract<PointerMessage, { phase: 'start' }>,
    target?: PointerTarget,
  ): PointerResult {
    if (!target || target.control.kind !== 'trackpad') {
      return { seq: message.seq, ok: false, error: 'Pointer start needs a trackpad control.' }
    }

    if (this.activeClientId && this.activeClientId !== clientId) {
      const previous = this.clients.get(this.activeClientId)
      if (previous) {
        this.releaseHeld(this.activeClientId, 'pointer taken over by another phone')
        previous.target = null
        previous.residualScrollX = 0
        previous.residualScrollY = 0
        this.clearWatchdog(previous)
      }
      this.logger?.info(`Pointer control taken over by ${clientId}`)
    }

    this.activeClientId = clientId
    // `start` resets movement state but must not release a drag-locked button.
    state.target = target
    state.residualScrollX = 0
    state.residualScrollY = 0
    this.touchWatchdog(clientId, state)
    this.logger?.info(`Pointer pad opened (${triggerLabel(target)}) by ${clientId}`)
    return { seq: message.seq, ok: true }
  }

  private move(
    clientId: string,
    state: PointerClientState,
    message: Extract<PointerMessage, { phase: 'move' | 'end' }>,
  ): PointerResult {
    if (this.activeClientId !== clientId) {
      return { seq: message.seq, ok: false, error: 'Another phone is controlling the pointer.' }
    }
    if (!state.target) {
      return { seq: message.seq, ok: false, error: 'Send pointer start before moving.' }
    }

    const gain = sensitivityOf(state.target)
    const rawDx = clampDelta(message.dx)
    const rawDy = clampDelta(message.dy)
    const dx = rawDx === undefined ? undefined : rawDx * gain
    const dy = rawDy === undefined ? undefined : rawDy * gain

    state.residualScrollX += clampScroll(message.scrollX)
    state.residualScrollY += clampScroll(message.scrollY)
    const scrollX = Math.trunc(state.residualScrollX)
    const scrollY = Math.trunc(state.residualScrollY)
    state.residualScrollX -= scrollX
    state.residualScrollY -= scrollY

    if (dx !== undefined || dy !== undefined) this.sender.move(dx, dy)
    if (scrollX !== 0 || scrollY !== 0) this.sender.scroll(scrollX, scrollY)

    const buttons = message.buttons ?? []
    if (buttons.length > 0) {
      this.applyButtons(state, buttons)
      this.sender.buttons(buttons)
    }
    this.touchWatchdog(clientId, state)

    if (message.phase === 'end') {
      this.logger?.info(`Pointer gesture ended by ${clientId}`)
    }
    return { seq: message.seq, ok: true }
  }

  private cancel(
    clientId: string,
    state: PointerClientState,
    message: Extract<PointerMessage, { phase: 'cancel' }>,
  ): PointerResult {
    this.releaseHeld(clientId, 'pointer cancelled')
    state.target = null
    state.residualScrollX = 0
    state.residualScrollY = 0
    this.clearWatchdog(state)
    if (this.activeClientId === clientId) this.activeClientId = null
    return { seq: message.seq, ok: true }
  }

  private applyButtons(state: PointerClientState, events: PointerButtonEvent[]): void {
    for (const event of events) {
      if (!SUPPORTED_BUTTONS.has(event.button)) continue
      if (event.action === 'down') state.held.add(event.button)
      else if (event.action === 'up') state.held.delete(event.button)
      // click/doubleclick are atomic down+up sequences; they never stay held.
    }
  }

  private releaseHeld(clientId: string, reason: string): void {
    const state = this.clients.get(clientId)
    if (!state || state.held.size === 0) return
    const events: PointerButtonEvent[] = [...state.held].map((button) => ({ button, action: 'up' }))
    state.held.clear()
    this.sender.buttons(events)
    this.logger?.info(`Pointer released ${events.map((event) => event.button).join(', ')} (${reason})`)
    this.clearWatchdog(state)
  }

  private touchWatchdog(clientId: string, state: PointerClientState): void {
    this.clearWatchdog(state)
    if (state.held.size === 0) return
    state.watchdog = setTimeout(() => this.onWatchdog(clientId), this.watchdogMs)
    state.watchdog.unref?.()
  }

  private onWatchdog(clientId: string): void {
    const state = this.clients.get(clientId)
    if (!state || this.disposed) return
    state.watchdog = null
    const silence = this.now() - state.lastSeen
    if (silence < this.watchdogMs) {
      state.watchdog = setTimeout(() => this.onWatchdog(clientId), this.watchdogMs - silence)
      state.watchdog.unref?.()
      return
    }
    this.releaseHeld(clientId, 'pointer watchdog timeout')
    if (this.activeClientId === clientId) {
      state.target = null
      state.residualScrollX = 0
      state.residualScrollY = 0
      this.activeClientId = null
    }
    this.logger?.info(`Pointer control timed out for ${clientId}`)
  }

  private clearWatchdog(state: PointerClientState): void {
    if (!state.watchdog) return
    clearTimeout(state.watchdog)
    state.watchdog = null
  }
}

function triggerLabel(target: PointerTarget): string {
  return target.label || 'trackpad'
}
