import { spawn, spawnSync } from 'node:child_process'
import {
  HelperKeySender,
  LINUX_KEYS,
  macHelperLaunch,
  windowsHelperLaunch,
  type HelperLaunch,
  type KeySender,
} from './key-sender'
import type { Logger } from './logger'

/** One keyboard operation after routing, before it reaches the helper. */
export type KeyboardTransportStep =
  | { kind: 'text'; text: string; perCharMs: 0 }
  | {
      kind: 'keys'
      keys: string[]
      holdMs: number
      action: 'press' | 'down' | 'up'
    }
  | { kind: 'release'; keys: string[] }

/** Low-level transport used by {@link KeyboardSender}; injected in tests. */
export interface KeyboardTransport {
  send(step: KeyboardTransportStep): Promise<void>
  dispose(): void
}

export interface KeyboardOperationMeta {
  clientId?: string
  seq?: number
}

/** The router needs the ordered FIFO, not the transport. */
export interface KeyboardSenderLike {
  sendText(text: string, meta?: KeyboardOperationMeta): KeyboardAccept
  sendKeys(
    keys: string[],
    options?: {
      repeat?: number
      action?: 'press' | 'down' | 'up'
      holdMs?: number
    },
    meta?: KeyboardOperationMeta,
  ): KeyboardAccept
  /** Release anything held, after queued work (panic / end). */
  release(meta?: KeyboardOperationMeta): KeyboardAccept
  /** Finish accepted work, then release held keys. */
  end(meta?: KeyboardOperationMeta): KeyboardAccept
  /** Drop queued work and release held keys immediately. */
  cancel(): void
  /** Attach/replace the async helper-failure reporter. */
  setErrorHandler?(handler: (error: Error, meta?: KeyboardOperationMeta) => void): void
  dispose(): void
}

export type KeyboardAccept = { ok: true } | { ok: false; error: string }

export const KEYBOARD_MAX_TEXT = 4096
export const KEYBOARD_MAX_KEYS = 8
export const KEYBOARD_MAX_REPEAT = 100
export const KEYBOARD_MAX_QUEUE = 64
export const KEYBOARD_MAX_QUEUE_BYTES = 256 * 1024
/** UTF-16 units per helper line; keeps one paste cancellable and bounded. */
export const KEYBOARD_TEXT_CHUNK = 512
export const KEYBOARD_HOLD_MS = 35
export const KEYBOARD_QUEUE_FULL = 'Keyboard queue is full, slow down.'

type KeyboardOperation =
  | { kind: 'text'; text: string; bytes: number; generation: number; meta?: KeyboardOperationMeta }
  | {
      kind: 'keys'
      keys: string[]
      repeat: number
      holdMs: number
      action: 'press' | 'down' | 'up'
      generation: number
      meta?: KeyboardOperationMeta
    }
  | { kind: 'release'; generation: number; meta?: KeyboardOperationMeta }

export interface KeyboardSenderOptions {
  logger?: Logger
  /** Called for helper failures; never receives the typed text. */
  onError?: (error: Error, meta?: KeyboardOperationMeta) => void
  maxQueue?: number
  maxQueueBytes?: number
}

function accept(): KeyboardAccept {
  return { ok: true }
}

function reject(error: string): KeyboardAccept {
  return { ok: false, error }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Split committed text into helper-sized chunks of at most `maxUnits` UTF-16
 * units. Never splits a surrogate pair and prefers the last whitespace in the
 * second half of a chunk so words stay intact.
 */
export function chunkKeyboardText(text: string, maxUnits = KEYBOARD_TEXT_CHUNK): string[] {
  const size = Math.max(2, Math.floor(maxUnits))
  const chunks: string[] = []
  let rest = text

  while (rest.length > size) {
    let cut = size
    if (isHighSurrogate(rest.charCodeAt(cut - 1)) && isLowSurrogate(rest.charCodeAt(cut))) cut -= 1
    if (cut < 2) cut = size

    const window = rest.slice(0, cut)
    const space = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'))
    if (space >= Math.floor(cut / 2)) cut = space + 1

    const chunk = rest.slice(0, cut)
    if (!chunk) break
    chunks.push(chunk)
    rest = rest.slice(cut)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/**
 * Ordered keyboard FIFO with its own helper process.
 *
 * Typing is never coalesced or reordered: a backspace may not overtake the
 * text it deletes. Unlike the pointer sender there is no latest-wins logic.
 * Text is chunked at 512 UTF-16 units with `perCharMs: 0`; `cancel` stops the
 * chunk loop and drops everything still queued, while `end` lets accepted work
 * finish and then releases held keys.
 */
export class KeyboardSender implements KeyboardSenderLike {
  private readonly transport: KeyboardTransport
  private readonly logger?: Logger
  private onError?: (error: Error, meta?: KeyboardOperationMeta) => void
  private readonly maxQueue: number
  private readonly maxQueueBytes: number
  private readonly queue: KeyboardOperation[] = []
  private queuedBytes = 0
  private held = new Set<string>()
  private busy = false
  private disposed = false
  /** Bumped by cancel so in-flight text stops at the next chunk boundary. */
  private generation = 0

  constructor(transport: KeyboardTransport, options: KeyboardSenderOptions = {}) {
    this.transport = transport
    this.logger = options.logger
    this.onError = options.onError
    this.maxQueue = Math.max(1, options.maxQueue ?? KEYBOARD_MAX_QUEUE)
    this.maxQueueBytes = Math.max(1, options.maxQueueBytes ?? KEYBOARD_MAX_QUEUE_BYTES)
  }

  /** Queue length excluding the operation the helper is currently running. */
  get pendingCount(): number {
    return this.queue.length
  }

  /** Wire a late-bound error reporter (the WebSocket server exists after this). */
  setErrorHandler(handler: (error: Error, meta?: KeyboardOperationMeta) => void): void {
    this.onError = handler
  }

  sendText(text: string, meta?: KeyboardOperationMeta): KeyboardAccept {
    if (this.disposed) return reject('Keyboard control is shutting down.')
    if (!text) return reject('Keyboard text is empty.')
    if (text.length > KEYBOARD_MAX_TEXT) {
      return reject(`Keyboard text is limited to ${KEYBOARD_MAX_TEXT} characters.`)
    }
    if (this.queue.length + (this.busy ? 1 : 0) >= this.maxQueue) {
      return reject(KEYBOARD_QUEUE_FULL)
    }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (this.queuedBytes + bytes > this.maxQueueBytes) return reject(KEYBOARD_QUEUE_FULL)

    this.queue.push({
      kind: 'text',
      text,
      bytes,
      generation: this.generation,
      ...(meta ? { meta } : {}),
    })
    this.queuedBytes += bytes
    this.schedule()
    return accept()
  }

  sendKeys(
    keys: string[],
    options: { repeat?: number; action?: 'press' | 'down' | 'up'; holdMs?: number } = {},
    meta?: KeyboardOperationMeta,
  ): KeyboardAccept {
    if (this.disposed) return reject('Keyboard control is shutting down.')
    if (keys.length === 0) return reject('A keyboard key is required.')
    if (keys.length > KEYBOARD_MAX_KEYS) {
      return reject(`A keyboard chord is limited to ${KEYBOARD_MAX_KEYS} keys.`)
    }
    if (this.queue.length + (this.busy ? 1 : 0) >= this.maxQueue) {
      return reject(KEYBOARD_QUEUE_FULL)
    }

    const repeat = Math.max(1, Math.min(KEYBOARD_MAX_REPEAT, Math.round(options.repeat ?? 1)))
    const holdMs = Math.max(0, Math.min(5000, Math.round(options.holdMs ?? KEYBOARD_HOLD_MS)))
    this.queue.push({
      kind: 'keys',
      keys: [...keys],
      repeat,
      holdMs,
      action: options.action ?? 'press',
      generation: this.generation,
      ...(meta ? { meta } : {}),
    })
    this.schedule()
    return accept()
  }

  /** Release held keys after accepted work; the session stays open. */
  release(meta?: KeyboardOperationMeta): KeyboardAccept {
    if (this.disposed) return reject('Keyboard control is shutting down.')
    this.queue.push({ kind: 'release', generation: this.generation, ...(meta ? { meta } : {}) })
    this.schedule()
    return accept()
  }

  /** Finish queued work, then release held keys. */
  end(meta?: KeyboardOperationMeta): KeyboardAccept {
    return this.release(meta)
  }

  /** Drop queued work; the in-flight chunk finishes, then keys are released. */
  cancel(): void {
    if (this.disposed) return
    this.generation += 1
    this.queue.length = 0
    this.queuedBytes = 0
    this.queue.push({ kind: 'release', generation: this.generation })
    this.schedule()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.queue.length = 0
    this.queuedBytes = 0
    const held = [...this.held]
    this.held = new Set<string>()
    if (held.length === 0) {
      this.transport.dispose()
      return
    }
    // A held modifier must not stay down because the app is quitting.
    let result: Promise<void>
    try {
      result = this.transport.send({ kind: 'release', keys: held })
    } catch (error) {
      result = Promise.reject(error)
    }
    void result
      .catch(() => undefined)
      .finally(() => this.transport.dispose())
  }

  private schedule(): void {
    if (this.disposed || this.busy) return
    const operation = this.queue.shift()
    if (!operation) return
    if (operation.kind === 'text') {
      this.queuedBytes = Math.max(0, this.queuedBytes - operation.bytes)
    }
    this.busy = true
    void this.run(operation)
  }

  private async run(operation: KeyboardOperation): Promise<void> {
    try {
      await this.execute(operation)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Error strings come from the helper and never include typed text.
      this.logger?.warn(`Keyboard sender failed: ${message}`)
      this.held.clear()
      try {
        await this.transport.send({ kind: 'release', keys: [] })
      } catch {
        // Best effort.
      }
      this.onError?.(error instanceof Error ? error : new Error(message), operation.meta)
    } finally {
      this.busy = false
      this.schedule()
    }
  }

  private async execute(operation: KeyboardOperation): Promise<void> {
    if (operation.kind === 'text') {
      for (const chunk of chunkKeyboardText(operation.text)) {
        if (this.disposed || operation.generation !== this.generation) return
        await this.transport.send({ kind: 'text', text: chunk, perCharMs: 0 })
      }
      return
    }

    if (operation.kind === 'keys') {
      for (let index = 0; index < operation.repeat; index += 1) {
        if (this.disposed || operation.generation !== this.generation) return
        await this.transport.send({
          kind: 'keys',
          keys: [...operation.keys],
          holdMs: operation.holdMs,
          action: operation.action,
        })
        if (operation.action === 'down') {
          for (const key of operation.keys) this.held.add(key)
        } else if (operation.action === 'up') {
          for (const key of operation.keys) this.held.delete(key)
        }
      }
      return
    }

    const held = [...this.held]
    this.held.clear()
    await this.transport.send({ kind: 'release', keys: held })
  }
}

/** Dedicated persistent helper process for Windows and macOS. */
export class HelperKeyboardTransport implements KeyboardTransport {
  private readonly sender: KeySender

  constructor(helperPath: string, launch: HelperLaunch, logger?: Logger) {
    // A second HelperKeySender instance is intentional: a sleeping macro in the
    // shared executor helper must not add latency to typing.
    this.sender = new HelperKeySender(helperPath, launch, logger)
  }

  async send(step: KeyboardTransportStep): Promise<void> {
    if (step.kind === 'text') {
      await this.sender.send({ kind: 'text', text: step.text, perCharMs: 0 })
      return
    }
    if (step.kind === 'keys') {
      if (step.keys.length === 0) return
      await this.sender.send({
        kind: 'keys',
        keys: [...step.keys],
        holdMs: step.holdMs,
        action: step.action,
      })
      return
    }
    // Release deepest key first. The helper tracks held keys per process.
    for (const key of [...step.keys].reverse()) {
      await this.sender.send({ kind: 'keys', keys: [key], holdMs: 0, action: 'up' })
    }
  }

  dispose(): void {
    this.sender.dispose?.()
  }
}

function linuxKey(key: string): string {
  return LINUX_KEYS[key] ?? key
}

function xdotoolAvailable(): boolean {
  try {
    return spawnSync('which', ['xdotool'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/**
 * Linux/X11 transport. One xdotool process per operation: the sender already
 * serializes operations, and a persistent `xdotool -` cannot report failures.
 */
export class XdotoolKeyboardTransport implements KeyboardTransport {
  private disposed = false

  constructor(private readonly logger?: Logger) {}

  async send(step: KeyboardTransportStep): Promise<void> {
    if (this.disposed) throw new Error('Keyboard sender was disposed')
    if (step.kind === 'text') {
      await this.typeText(step.text)
      return
    }
    if (step.kind === 'keys') {
      if (step.keys.length === 0) return
      if (step.action === 'press') {
        await this.run(['key', '--clearmodifiers', '--delay', '12', step.keys.map(linuxKey).join('+')])
        return
      }
      if (step.action === 'down') {
        for (const key of step.keys) await this.run(['keydown', linuxKey(key)])
        return
      }
      for (const key of [...step.keys].reverse()) await this.run(['keyup', linuxKey(key)])
      return
    }
    for (const key of [...step.keys].reverse()) await this.run(['keyup', linuxKey(key)])
  }

  dispose(): void {
    this.disposed = true
  }

  /** Newlines/tabs become explicit Return/Tab key events, not type text. */
  private async typeText(text: string): Promise<void> {
    const parts = text.split(/(\n|\t)/)
    for (const part of parts) {
      if (!part) continue
      if (part === '\n') await this.run(['key', 'Return'])
      else if (part === '\t') await this.run(['key', 'Tab'])
      else await this.run(['type', '--clearmodifiers', '--delay', '0', '--', part])
    }
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('xdotool', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          // ignore
        }
        reject(new Error('xdotool keyboard operation timed out'))
      }, 20_000)
      timer.unref?.()

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000)
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`xdotool failed: ${error.message}`))
      })
      child.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          resolve()
          return
        }
        if (stderr.trim()) this.logger?.warn(`xdotool keyboard: ${stderr.trim()}`)
        reject(new Error(`xdotool exited with ${code ?? 'unknown'}`))
      })
    })
  }
}

export interface KeyboardPlatformSupport {
  supported: boolean
  reason?: string
}

/**
 * Whether this host can inject keyboard events. Wayland has no standard global
 * injection path, and Linux needs X11 plus xdotool.
 */
export function keyboardPlatformSupport(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): KeyboardPlatformSupport {
  if (platform === 'win32' || platform === 'darwin') return { supported: true }
  if (platform !== 'linux') {
    return { supported: false, reason: `Keyboard control is not implemented on ${platform}.` }
  }
  const session = (env['XDG_SESSION_TYPE'] ?? '').toLowerCase()
  if (session === 'wayland' || env['WAYLAND_DISPLAY']) {
    return {
      supported: false,
      reason: 'Keyboard control is not available on Wayland. Log in with an X11 session.',
    }
  }
  if (!env['DISPLAY']) {
    return { supported: false, reason: 'Keyboard control needs an X11 display.' }
  }
  if (!xdotoolAvailable()) {
    return {
      supported: false,
      reason: 'Keyboard control needs xdotool on Linux X11. Install it with: sudo apt install xdotool',
    }
  }
  return { supported: true }
}

/**
 * Build the dedicated keyboard sender for this platform. Returns null when the
 * host cannot inject keyboard events; the capability is then not advertised.
 */
export function createKeyboardSender(
  platform: NodeJS.Platform,
  helperPath: string,
  logger?: Logger,
  env: NodeJS.ProcessEnv = process.env,
): KeyboardSender | null {
  const support = keyboardPlatformSupport(platform, env)
  if (!support.supported) {
    logger?.info(`Keyboard control disabled: ${support.reason ?? 'not supported on this host'}`)
    return null
  }
  if (platform === 'win32') {
    return new KeyboardSender(
      new HelperKeyboardTransport(helperPath, windowsHelperLaunch(helperPath), logger),
      { logger },
    )
  }
  if (platform === 'darwin') {
    return new KeyboardSender(
      new HelperKeyboardTransport(helperPath, macHelperLaunch(helperPath), logger),
      { logger },
    )
  }
  return new KeyboardSender(new XdotoolKeyboardTransport(logger), { logger })
}
