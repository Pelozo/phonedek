import { afterEach, describe, expect, it } from 'vitest'
import type { Action, KeyboardMessage } from '@phonedek/shared'
import {
  KeyboardRouter,
  isKeyboardLauncher,
  keyboardInputAllowed,
  normalizeKeyboardText,
  type KeyboardTarget,
} from '../src/main/keyboard-input'
import {
  KEYBOARD_QUEUE_FULL,
  type KeyboardAccept,
  type KeyboardOperationMeta,
  type KeyboardSenderLike,
} from '../src/main/keyboard-sender'
import type { Logger } from '../src/main/logger'

interface SenderEvent {
  kind: 'text' | 'keys' | 'release' | 'end' | 'cancel'
  text?: string
  keys?: string[]
  repeat?: number
  action?: string
  seq?: number
}

class FakeSender implements KeyboardSenderLike {
  readonly events: SenderEvent[] = []
  failNext: string | null = null
  disposed = false

  sendText(text: string, meta?: KeyboardOperationMeta): KeyboardAccept {
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      return { ok: false, error }
    }
    this.events.push({ kind: 'text', text, seq: meta?.seq })
    return { ok: true }
  }

  sendKeys(
    keys: string[],
    options: { repeat?: number; action?: 'press' | 'down' | 'up'; holdMs?: number } = {},
    meta?: KeyboardOperationMeta,
  ): KeyboardAccept {
    this.events.push({
      kind: 'keys',
      keys: [...keys],
      repeat: options.repeat,
      action: options.action,
      seq: meta?.seq,
    })
    return { ok: true }
  }

  release(meta?: KeyboardOperationMeta): KeyboardAccept {
    this.events.push({ kind: 'release', seq: meta?.seq })
    return { ok: true }
  }

  end(meta?: KeyboardOperationMeta): KeyboardAccept {
    this.events.push({ kind: 'end', seq: meta?.seq })
    return { ok: true }
  }

  cancel(): void {
    this.events.push({ kind: 'cancel' })
  }

  dispose(): void {
    this.disposed = true
  }
}

function loggerSpy(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const add = (message: string): void => {
    lines.push(message)
  }
  return {
    logger: {
      logPath: null,
      info: add,
      warn: add,
      error: (message: string) => add(message),
    },
    lines,
  }
}

const target: KeyboardTarget = {
  button: {
    id: 'btn-keyboard',
    slot: 0,
    label: 'Keys',
    actions: [{ type: 'keyboard', action: 'open' }] as unknown as Action[],
  },
  label: 'Keys',
}

let counter = 0

function nextSeq(): number {
  counter += 1
  return counter
}

function start(seq = nextSeq()): KeyboardMessage {
  return {
    type: 'keyboard',
    seq,
    phase: 'start',
    profileId: 'profile-desktop',
    pageId: 'page-main',
    controlId: 'btn-keyboard',
  }
}

function text(value: string, seq = nextSeq()): KeyboardMessage {
  return { type: 'keyboard', seq, phase: 'text', text: value }
}

function key(keys: string[], seq = nextSeq(), repeat?: number): KeyboardMessage {
  return { type: 'keyboard', seq, phase: 'key', keys, ...(repeat ? { repeat } : {}) }
}

function simple(phase: 'release' | 'end' | 'cancel', seq = nextSeq()): KeyboardMessage {
  return { type: 'keyboard', seq, phase }
}

afterEach(() => {
  counter = 0
})

describe('keyboardInputAllowed', () => {
  it('requires the master switch and no native dialog', () => {
    expect(keyboardInputAllowed(true, false)).toBe(true)
    expect(keyboardInputAllowed(true, true)).toBe(false)
    expect(keyboardInputAllowed(false, false)).toBe(false)
    expect(keyboardInputAllowed(false, true)).toBe(false)
  })
})

describe('keyboard text normalization', () => {
  it('strips CR, keeps LF/TAB and replaces unpaired surrogates', () => {
    expect(normalizeKeyboardText('a\r\nb\tc')).toEqual({ ok: true, text: 'a\nb\tc' })
    expect(normalizeKeyboardText('a\rb')).toEqual({ ok: true, text: 'ab' })
    expect(normalizeKeyboardText('x\uD800y')).toEqual({ ok: true, text: 'x\ufffdy' })
    expect(normalizeKeyboardText('\uDC00')).toEqual({ ok: true, text: '\ufffd' })
  })

  it('rejects NUL, empty and oversized text', () => {
    expect(normalizeKeyboardText('a\u0000b').ok).toBe(false)
    expect(normalizeKeyboardText('').ok).toBe(false)
    expect(normalizeKeyboardText('a'.repeat(4097)).ok).toBe(false)
    expect(normalizeKeyboardText('a'.repeat(4096)).ok).toBe(true)
  })
})

describe('KeyboardRouter sessions', () => {
  it('requires a button with the keyboard action', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    const missing = router.handle('c1', start())
    expect(missing.ok).toBe(false)

    const wrongTarget: KeyboardTarget = {
      button: { ...target.button, actions: [] },
      label: 'Plain',
    }
    expect(router.handle('c1', start(), wrongTarget).ok).toBe(false)
    expect(isKeyboardLauncher(wrongTarget.button)).toBe(false)
    expect(router.handle('c1', start(), target).ok).toBe(true)
    expect(router.activeClient).toBe('c1')
  })

  it('keeps text and keys in receive order', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    router.handle('c1', start(), target)
    sender.events.length = 0

    expect(router.handle('c1', text('one')).ok).toBe(true)
    expect(router.handle('c1', key(['BACKSPACE'])).ok).toBe(true)
    expect(router.handle('c1', text('two')).ok).toBe(true)

    expect(sender.events.map((event) => event.kind)).toEqual(['text', 'keys', 'text'])
    expect(sender.events[0]).toMatchObject({ text: 'one' })
    expect(sender.events[1]).toMatchObject({ keys: ['BACKSPACE'] })
    expect(sender.events[2]).toMatchObject({ text: 'two' })
  })

  it('rejects a second phone and transfers ownership', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    router.handle('c1', start(), target)
    router.handle('c2', start(), target)
    expect(router.activeClient).toBe('c2')
    expect(sender.events.some((event) => event.kind === 'cancel')).toBe(true)

    const rejected = router.handle('c1', text('hello'))
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('Another phone')
    expect(router.handle('c2', text('hello')).ok).toBe(true)
  })

  it('rejects text before start and after end', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    expect(router.handle('c1', text('early')).ok).toBe(false)
    router.handle('c1', start(), target)
    expect(router.handle('c1', simple('end')).ok).toBe(true)
    expect(sender.events.some((event) => event.kind === 'end')).toBe(true)
    expect(router.activeClient).toBeNull()
    expect(router.handle('c1', text('late')).ok).toBe(false)
  })

  it('releases keys on release and drops the session on cancel', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    router.handle('c1', start(), target)
    sender.events.length = 0
    expect(router.handle('c1', simple('release')).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'release' })
    expect(router.activeClient).toBe('c1')

    expect(router.handle('c1', simple('cancel')).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'cancel' })
    expect(router.activeClient).toBeNull()
  })

  it('cleans up queued typing when a client disconnects', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    router.handle('c1', start(), target)
    router.clientDisconnected('c1')
    expect(router.activeClient).toBeNull()
    expect(sender.events.at(-1)).toMatchObject({ kind: 'cancel' })
    expect(router.handle('c1', text('orphan')).ok).toBe(false)
  })

  it('resets the sequence baseline on a new start', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })

    expect(router.handle('c1', start(50), target).ok).toBe(true)
    expect(router.handle('c1', simple('end', 51)).ok).toBe(true)
    expect(router.handle('c1', start(1), target).ok).toBe(true)
    expect(router.handle('c1', text('fresh', 2)).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'text', text: 'fresh', seq: 2 })
  })
})

describe('KeyboardRouter limits', () => {
  it('enforces text, chord, repeat and key-name limits', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })
    router.handle('c1', start(), target)
    sender.events.length = 0

    expect(router.handle('c1', text('a'.repeat(4097))).ok).toBe(false)
    expect(router.handle('c1', text('')).ok).toBe(false)
    expect(router.handle('c1', key(Array.from({ length: 9 }, () => 'A'))).ok).toBe(false)
    expect(router.handle('c1', key(['NOT_A_KEY'])).ok).toBe(false)

    expect(router.handle('c1', key(['TAB'], nextSeq(), 999)).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'keys', repeat: 100 })
  })

  it('rate limits messages but always lets end through', () => {
    let now = 0
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender, rateLimit: 2, now: () => now })

    expect(router.handle('c1', start(), target).ok).toBe(true)
    expect(router.handle('c1', key(['A'])).ok).toBe(true)
    const limited = router.handle('c1', key(['B']))
    expect(limited.ok).toBe(false)
    expect(limited.error).toContain('Too many keyboard events')

    now += 1000
    expect(router.handle('c1', simple('end')).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'end' })
  })

  it('caps typed bytes per second', () => {
    let now = 0
    const sender = new FakeSender()
    const router = new KeyboardRouter({
      sender,
      bytesPerSecond: 4096,
      rateLimit: 100,
      now: () => now,
    })
    router.handle('c1', start(), target)

    expect(router.handle('c1', text('a'.repeat(4096))).ok).toBe(true)
    const over = router.handle('c1', text('b'.repeat(4096)))
    expect(over.ok).toBe(false)
    expect(over.error).toContain('Too much keyboard text')

    now += 1000
    expect(router.handle('c1', text('b'.repeat(4096))).ok).toBe(true)
  })

  it('ignores stale sequence numbers but always processes end/cancel', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })
    router.handle('c1', start(1), target)
    sender.events.length = 0

    expect(router.handle('c1', key(['A'], 5)).ok).toBe(true)
    expect(router.handle('c1', key(['B'], 5)).ok).toBe(true)
    expect(sender.events).toHaveLength(1)
    expect(router.handle('c1', simple('cancel', 2)).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'cancel' })
  })

  it('propagates a full sender queue immediately', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })
    router.handle('c1', start(), target)
    sender.failNext = KEYBOARD_QUEUE_FULL
    const result = router.handle('c1', text('hello'))
    expect(result).toEqual({ seq: result.seq, ok: false, error: KEYBOARD_QUEUE_FULL })
  })
})

describe('KeyboardRouter safety gates and privacy', () => {
  it('suspends start/text/key while a dialog is open but releases', () => {
    const sender = new FakeSender()
    const router = new KeyboardRouter({ sender })
    router.setBlocked(true)

    expect(router.handle('c1', start(), target).ok).toBe(false)
    expect(router.handle('c1', text('hello')).ok).toBe(false)
    expect(router.handle('c1', simple('release')).ok).toBe(true)
    expect(sender.events.at(-1)).toMatchObject({ kind: 'release' })

    router.setBlocked(false)
    expect(router.handle('c1', start(), target).ok).toBe(true)
  })

  it('never logs typed text', () => {
    const sender = new FakeSender()
    const { logger, lines } = loggerSpy()
    const router = new KeyboardRouter({ sender, logger })
    router.handle('c1', start(), target)
    router.handle('c1', text('hunter2 secret line'))

    expect(lines.some((line) => line.includes('hunter2'))).toBe(false)
    expect(lines.some((line) => line.includes('Keyboard text queued'))).toBe(true)
  })
})
