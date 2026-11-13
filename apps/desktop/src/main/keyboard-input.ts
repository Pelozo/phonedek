import {
  isModifier,
  isValidKeyName,
  normalizeCombo,
  type DeckButton,
  type KeyboardMessage,
  type KeyboardResult,
} from '@phonedek/shared'
import type { KeyboardOperationMeta, KeyboardSenderLike } from './keyboard-sender'
import type { Logger } from './logger'

/** Button resolved from a `start` message; it must carry the keyboard action. */
export interface KeyboardTarget {
  button: DeckButton
  label: string
}

export interface KeyboardRouterOptions {
  sender: KeyboardSenderLike
  logger?: Logger
  /** Keyboard silence before held keys are released. */
  watchdogMs?: number
  /** Messages allowed per second per connection; release/end/cancel are exempt. */
  rateLimit?: number
  /** UTF-8 bytes of text allowed per second per connection. */
  bytesPerSecond?: number
  now?: () => number
}

interface KeyboardClientState {
  lastSeq: number | null
  times: number[]
  textBytes: Array<{ time: number; bytes: number }>
  target: KeyboardTarget | null
  held: Set<string>
  lastSeen: number
  watchdog: NodeJS.Timeout | null
}

export const KEYBOARD_MAX_TEXT = 4096
export const KEYBOARD_MAX_KEYS = 8
export const KEYBOARD_MAX_REPEAT = 100
export const KEYBOARD_RATE_LIMIT = 60
export const KEYBOARD_BYTES_PER_SEC = 64 * 1024
export const KEYBOARD_WATCHDOG_MS = 15_000

const EXEMPT_PHASES = new Set<KeyboardMessage['phase']>(['release', 'end', 'cancel'])

/**
 * Keyboard control is allowed only when the Settings master switch is on and no
 * native approval/destructive dialog is waiting for a decision on the PC.
 */
export function keyboardInputAllowed(
  allowKeyboardControl: boolean,
  dialogOpen: boolean,
): boolean {
  return allowKeyboardControl && !dialogOpen
}

/** A button opens the phone keyboard when any of its actions is `keyboard/open`. */
export function isKeyboardLauncher(button: DeckButton): boolean {
  return button.actions.some((action) => {
    const candidate = action as { type?: string; action?: string }
    return candidate.type === 'keyboard' && candidate.action === 'open'
  })
}

export interface NormalizedKeyboardText {
  ok: boolean
  text?: string
  error?: string
}

/**
 * Apply the wire rules before anything reaches the helper: strip CR, reject
 * NUL, replace unpaired surrogates and enforce the 4096 UTF-16 unit limit.
 * Newlines and tabs are preserved (the helper turns them into Enter/Tab).
 */
export function normalizeKeyboardText(raw: string): NormalizedKeyboardText {
  const withoutCr = raw.replace(/\r/g, '')
  if (withoutCr.includes('\u0000')) {
    return { ok: false, error: 'Keyboard text contains an invalid character.' }
  }

  let text = ''
  for (let index = 0; index < withoutCr.length; index += 1) {
    const code = withoutCr.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = withoutCr.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        text += withoutCr[index]! + withoutCr[index + 1]!
        index += 1
      } else {
        text += '\ufffd'
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      text += '\ufffd'
      continue
    }
    text += withoutCr[index]!
  }

  if (text.length === 0) return { ok: false, error: 'Keyboard text is empty.' }
  if (text.length > KEYBOARD_MAX_TEXT) {
    return { ok: false, error: `Keyboard text is limited to ${KEYBOARD_MAX_TEXT} characters.` }
  }
  return { ok: true, text }
}

/**
 * Routes phone keyboard sessions to the dedicated ordered sender.
 *
 * Sequence numbers are strict per connection; text/key/release stay in receive
 * order. One phone owns the keyboard at a time: a new `start` releases the
 * previous phone's keys and takes over. `end`/`cancel`/`release`, disconnect,
 * the blocked gate and the 15 s held-key watchdog all release modifiers.
 */
export class KeyboardRouter {
  private readonly sender: KeyboardSenderLike
  private readonly logger?: Logger
  private readonly watchdogMs: number
  private readonly rateLimit: number
  private readonly bytesPerSecond: number
  private readonly now: () => number
  private readonly clients = new Map<string, KeyboardClientState>()
  private activeClientId: string | null = null
  private blocked = false
  private disposed = false

  constructor(options: KeyboardRouterOptions) {
    this.sender = options.sender
    this.logger = options.logger
    this.watchdogMs = Math.max(1, options.watchdogMs ?? KEYBOARD_WATCHDOG_MS)
    this.rateLimit = Math.max(1, options.rateLimit ?? KEYBOARD_RATE_LIMIT)
    this.bytesPerSecond = Math.max(1, options.bytesPerSecond ?? KEYBOARD_BYTES_PER_SEC)
    this.now = options.now ?? Date.now
  }

  get activeClient(): string | null {
    return this.activeClientId
  }

  get isBlocked(): boolean {
    return this.blocked
  }

  handle(clientId: string, message: KeyboardMessage, target?: KeyboardTarget): KeyboardResult {
    if (this.disposed) {
      return { seq: message.seq, ok: false, error: 'Keyboard control is shutting down.' }
    }

    const state = this.stateFor(clientId)
    const now = this.now()

    if (this.blocked) {
      if (EXEMPT_PHASES.has(message.phase)) {
        if (message.phase === 'release') {
          this.releaseHeld(clientId, 'keyboard released while blocked')
        } else {
          this.terminate(
            clientId,
            state,
            `keyboard ${message.phase} while blocked`,
            message.phase === 'cancel',
          )
        }
        return { seq: message.seq, ok: true }
      }
      return {
        seq: message.seq,
        ok: false,
        error: 'Keyboard control is suspended while a dialog is open on the PC.',
      }
    }

    const stale = state.lastSeq !== null && message.seq <= state.lastSeq
    if (stale && message.phase !== 'start' && !EXEMPT_PHASES.has(message.phase)) {
      // Duplicate/reordered datagram: acknowledge quietly, never replay it.
      return { seq: message.seq, ok: true }
    }
    if (!stale || message.phase === 'start') state.lastSeq = message.seq
    state.lastSeen = now

    if (!EXEMPT_PHASES.has(message.phase)) {
      state.times = state.times.filter((time) => now - time < 1_000)
      if (state.times.length >= this.rateLimit) {
        return { seq: message.seq, ok: false, error: 'Too many keyboard events, slow down.' }
      }
      state.times.push(now)
    }

    if (message.phase === 'text') {
      const bytes = Buffer.byteLength(message.text, 'utf8')
      state.textBytes = state.textBytes.filter((entry) => now - entry.time < 1_000)
      const total = state.textBytes.reduce((sum, entry) => sum + entry.bytes, 0)
      if (total + bytes > this.bytesPerSecond) {
        return { seq: message.seq, ok: false, error: 'Too much keyboard text, slow down.' }
      }
      state.textBytes.push({ time: now, bytes })
    }

    switch (message.phase) {
      case 'start':
        return this.start(clientId, state, message, target)
      case 'text':
        return this.text(clientId, state, message)
      case 'key':
        return this.key(clientId, state, message)
      case 'release':
        this.releaseHeld(clientId, 'keyboard released')
        return { seq: message.seq, ok: true }
      case 'end':
        this.terminate(clientId, state, 'keyboard session ended')
        return { seq: message.seq, ok: true }
      case 'cancel':
        this.terminate(clientId, state, 'keyboard session cancelled', true)
        return { seq: message.seq, ok: true }
    }
  }

  /**
   * Suspend typing while a native dialog is open. Held keys are released first
   * so the dialog cannot receive a stale modifier. The session is retained.
   */
  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return
    this.blocked = blocked
    if (!blocked) {
      this.logger?.info('Keyboard control resumed')
      return
    }
    for (const clientId of this.clients.keys()) {
      this.releaseHeld(clientId, 'keyboard input suspended')
    }
    // Drop anything already queued: finishing a paste into a native approval
    // dialog would type into the dialog.
    this.sender.cancel()
    this.logger?.info('Keyboard control suspended on the PC')
  }

  /** Cancel queued typing and release keys for a connection that closed. */
  clientDisconnected(clientId: string): void {
    const state = this.clients.get(clientId)
    if (!state) return
    this.releaseHeld(clientId, 'keyboard client disconnected')
    this.clearWatchdog(state)
    this.clients.delete(clientId)
    if (this.activeClientId === clientId) {
      this.sender.cancel()
      this.activeClientId = null
      this.logger?.info('Keyboard control released on disconnect')
    }
  }

  /** Release held keys and stop all timers. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [clientId, state] of this.clients) {
      this.releaseHeld(clientId, 'keyboard control shutting down')
      this.clearWatchdog(state)
    }
    this.clients.clear()
    if (this.activeClientId) this.sender.cancel()
    this.activeClientId = null
  }

  private stateFor(clientId: string): KeyboardClientState {
    let state = this.clients.get(clientId)
    if (!state) {
      state = {
        lastSeq: null,
        times: [],
        textBytes: [],
        target: null,
        held: new Set<string>(),
        lastSeen: this.now(),
        watchdog: null,
      }
      this.clients.set(clientId, state)
    }
    return state
  }

  private meta(clientId: string, seq: number): KeyboardOperationMeta {
    return { clientId, seq }
  }

  private start(
    clientId: string,
    state: KeyboardClientState,
    message: Extract<KeyboardMessage, { phase: 'start' }>,
    target?: KeyboardTarget,
  ): KeyboardResult {
    if (!target || !isKeyboardLauncher(target.button)) {
      return {
        seq: message.seq,
        ok: false,
        error: 'Keyboard start needs a button with the phone-keyboard action.',
      }
    }

    if (this.activeClientId && this.activeClientId !== clientId) {
      const previous = this.clients.get(this.activeClientId)
      if (previous) {
        this.releaseHeld(this.activeClientId, 'keyboard taken over by another phone')
        previous.target = null
        this.clearWatchdog(previous)
      }
      this.sender.cancel()
      this.logger?.info(`Keyboard control taken over by ${clientId}`)
    }

    this.releaseHeld(clientId, 'keyboard opened')
    this.activeClientId = clientId
    state.target = target
    this.logger?.info(`Phone keyboard opened (${target.label || 'keyboard'}) by ${clientId}`)
    return { seq: message.seq, ok: true }
  }

  private text(
    clientId: string,
    state: KeyboardClientState,
    message: Extract<KeyboardMessage, { phase: 'text' }>,
  ): KeyboardResult {
    const guard = this.sessionGuard(clientId, state, message.seq)
    if (guard) return guard

    const normalized = normalizeKeyboardText(message.text)
    if (!normalized.ok || normalized.text === undefined) {
      return { seq: message.seq, ok: false, error: normalized.error ?? 'Keyboard text is invalid.' }
    }

    const accepted = this.sender.sendText(normalized.text, this.meta(clientId, message.seq))
    if (!accepted.ok) return { seq: message.seq, ok: false, error: accepted.error }

    this.touchWatchdog(clientId, state)
    // Privacy: lengths only, never the text itself.
    this.logger?.info(`Keyboard text queued (${normalized.text.length} chars)`)
    return { seq: message.seq, ok: true }
  }

  private key(
    clientId: string,
    state: KeyboardClientState,
    message: Extract<KeyboardMessage, { phase: 'key' }>,
  ): KeyboardResult {
    const guard = this.sessionGuard(clientId, state, message.seq)
    if (guard) return guard

    if (!Array.isArray(message.keys) || message.keys.length === 0) {
      return { seq: message.seq, ok: false, error: 'A keyboard key is required.' }
    }
    if (message.keys.length > KEYBOARD_MAX_KEYS) {
      return {
        seq: message.seq,
        ok: false,
        error: `A keyboard chord is limited to ${KEYBOARD_MAX_KEYS} keys.`,
      }
    }
    for (const key of message.keys) {
      if (!isValidKeyName(key)) {
        return { seq: message.seq, ok: false, error: 'Unknown keyboard key.' }
      }
    }

    let keys: string[]
    try {
      keys = normalizeCombo(message.keys)
    } catch (error) {
      return { seq: message.seq, ok: false, error: (error as Error).message }
    }

    const repeat = Math.max(1, Math.min(KEYBOARD_MAX_REPEAT, Math.round(message.repeat ?? 1)))
    const accepted = this.sender.sendKeys(
      keys,
      { repeat, action: 'press' },
      this.meta(clientId, message.seq),
    )
    if (!accepted.ok) return { seq: message.seq, ok: false, error: accepted.error }

    this.touchWatchdog(clientId, state)
    this.logger?.info(
      `Keyboard chord queued (${keys.filter((key) => isModifier(key)).length} modifiers, ` +
        `${keys.length} keys, repeat ${repeat})`,
    )
    return { seq: message.seq, ok: true }
  }

  /** Active-client + started-session guard shared by text and key. */
  private sessionGuard(
    clientId: string,
    state: KeyboardClientState,
    seq: number,
  ): KeyboardResult | null {
    if (this.activeClientId !== clientId) {
      return { seq, ok: false, error: 'Another phone is using the keyboard.' }
    }
    if (!state.target) {
      return { seq, ok: false, error: 'Send keyboard start before typing.' }
    }
    return null
  }

  private releaseHeld(clientId: string, reason: string): void {
    const state = this.clients.get(clientId)
    const held = state ? [...state.held] : []
    if (state) state.held.clear()
    // The panic path is always forwarded; the sender knows exactly what it held
    // (including keys pressed with a future down action).
    this.sender.release(this.meta(clientId, 0))
    if (held.length > 0) {
      this.logger?.info(`Keyboard released ${held.length} key(s) (${reason})`)
    }
  }

  private terminate(
    clientId: string,
    state: KeyboardClientState,
    reason: string,
    cancel = false,
  ): void {
    state.held.clear()
    if (cancel) this.sender.cancel()
    else this.sender.end()
    state.target = null
    this.clearWatchdog(state)
    if (this.activeClientId === clientId) {
      this.activeClientId = null
      this.logger?.info(`Keyboard control released (${reason})`)
    }
  }

  private touchWatchdog(clientId: string, state: KeyboardClientState): void {
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
    this.releaseHeld(clientId, 'keyboard watchdog timeout')
    this.logger?.info(`Keyboard control timed out for ${clientId}`)
  }

  private clearWatchdog(state: KeyboardClientState): void {
    if (!state.watchdog) return
    clearTimeout(state.watchdog)
    state.watchdog = null
  }
}
