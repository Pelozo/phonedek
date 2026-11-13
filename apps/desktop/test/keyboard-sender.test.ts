import { describe, expect, it } from 'vitest'
import {
  chunkKeyboardText,
  KeyboardSender,
  keyboardPlatformSupport,
  KEYBOARD_MAX_TEXT,
  KEYBOARD_QUEUE_FULL,
  type KeyboardTransport,
  type KeyboardTransportStep,
} from '../src/main/keyboard-sender'

class FakeTransport implements KeyboardTransport {
  readonly steps: KeyboardTransportStep[] = []
  disposed = false
  failNext: Error | null = null

  async send(step: KeyboardTransportStep): Promise<void> {
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
    this.steps.push(step)
  }

  dispose(): void {
    this.disposed = true
  }
}

function waitFor(check: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (check()) {
        resolve()
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('Timed out waiting for keyboard sender'))
        return
      }
      setTimeout(tick, 1)
    }
    tick()
  })
}

describe('keyboardPlatformSupport', () => {
  it('supports Windows and macOS without a display probe', () => {
    expect(keyboardPlatformSupport('win32')).toEqual({ supported: true })
    expect(keyboardPlatformSupport('darwin')).toEqual({ supported: true })
  })

  it('refuses Wayland even when a display is set', () => {
    const support = keyboardPlatformSupport('linux', {
      XDG_SESSION_TYPE: 'wayland',
      DISPLAY: ':0',
    })
    expect(support.supported).toBe(false)
    expect(support.reason).toContain('Wayland')
  })

  it('requires an X11 display and rejects other operating systems', () => {
    expect(keyboardPlatformSupport('linux', {}).supported).toBe(false)
    expect(keyboardPlatformSupport('linux', { XDG_SESSION_TYPE: 'x11' }).supported).toBe(false)
    expect(keyboardPlatformSupport('freebsd', {}).supported).toBe(false)
  })
})

describe('chunkKeyboardText', () => {
  it('splits long text at 512 UTF-16 units and preserves it exactly', () => {
    const text = 'a'.repeat(5000)
    const chunks = chunkKeyboardText(text)
    expect(chunks.length).toBe(10)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(512)
    expect(chunks.join('')).toBe(text)
  })

  it('prefers a whitespace boundary in the second half', () => {
    const text = 'word '.repeat(300)
    const chunks = chunkKeyboardText(text, 512)
    expect(chunks.join('')).toBe(text)
    expect(chunks[0]!.endsWith(' ')).toBe(true)
  })

  it('never splits a surrogate pair', () => {
    const text = '😀'.repeat(600)
    const chunks = chunkKeyboardText(text, 512)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
      expect(chunk.length).toBeLessThanOrEqual(512)
    }
  })
})

describe('KeyboardSender ordering', () => {
  it('serializes text, key and release without coalescing', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)

    expect(sender.sendText('hello')).toEqual({ ok: true })
    expect(sender.sendKeys(['CTRL', 'C'])).toEqual({ ok: true })
    expect(sender.sendText('after')).toEqual({ ok: true })
    expect(sender.release()).toEqual({ ok: true })

    await waitFor(() => transport.steps.length === 4)
    expect(transport.steps.map((step) => step.kind)).toEqual(['text', 'keys', 'text', 'release'])
    expect(transport.steps[0]).toMatchObject({ kind: 'text', text: 'hello', perCharMs: 0 })
    expect(transport.steps[1]).toMatchObject({
      kind: 'keys',
      keys: ['CTRL', 'C'],
      action: 'press',
    })
    expect(transport.steps[2]).toMatchObject({ kind: 'text', text: 'after' })
  })

  it('sends text chunks in order with perCharMs 0', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)
    const text = 'x'.repeat(1300)
    sender.sendText(text)
    await waitFor(() => transport.steps.length === 3)

    const chunks = transport.steps.map((step) => (step.kind === 'text' ? step.text : ''))
    expect(chunks.join('')).toBe(text)
    expect(chunks.map((chunk) => chunk.length)).toEqual([512, 512, 276])
    for (const step of transport.steps) {
      expect(step).toMatchObject({ perCharMs: 0 })
    }
  })

  it('expands repeat sequentially', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)
    sender.sendKeys(['BACKSPACE'], { repeat: 4 })
    await waitFor(() => transport.steps.length === 4)

    expect(transport.steps).toHaveLength(4)
    for (const step of transport.steps) {
      expect(step).toMatchObject({ kind: 'keys', keys: ['BACKSPACE'], action: 'press' })
    }
  })

  it('supports down/up and releases held keys', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)

    sender.sendKeys(['CTRL'], { action: 'down' })
    sender.sendKeys(['C'], { action: 'press' })
    sender.sendKeys(['CTRL'], { action: 'up' })
    sender.release()
    await waitFor(() => transport.steps.length === 4)

    expect(transport.steps.map((step) => (step.kind === 'keys' ? step.action : step.kind))).toEqual([
      'down',
      'press',
      'up',
      'release',
    ])
    expect(transport.steps[3]).toMatchObject({ kind: 'release', keys: [] })
  })

  it('releases a key that was held when the sender is disposed', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)

    sender.sendKeys(['SHIFT'], { action: 'down' })
    await waitFor(() => transport.steps.length === 1)
    expect(transport.steps).toHaveLength(1)

    sender.dispose()
    await waitFor(() => transport.disposed)
    expect(transport.steps[1]).toMatchObject({ kind: 'release', keys: ['SHIFT'] })
  })
})

describe('KeyboardSender cancellation and limits', () => {
  it('drops queued work on cancel and still releases', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)

    sender.sendText('first')
    sender.sendText('queued-1')
    sender.sendText('queued-2')
    sender.cancel()

    await waitFor(() => transport.steps.some((step) => step.kind === 'release'))
    const texts = transport.steps.filter((step) => step.kind === 'text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatchObject({ text: 'first' })
    expect(transport.steps[transport.steps.length - 1]).toMatchObject({ kind: 'release' })
  })

  it('rejects a full operation queue', () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport, { maxQueue: 2 })
    expect(sender.sendKeys(['A'])).toEqual({ ok: true })
    expect(sender.sendKeys(['B'])).toEqual({ ok: true })
    expect(sender.sendKeys(['C'])).toEqual({ ok: false, error: KEYBOARD_QUEUE_FULL })
  })

  it('rejects text past the per-operation and queue byte limits', () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport, { maxQueue: 1000, maxQueueBytes: 4096 })
    expect(sender.sendText('a'.repeat(KEYBOARD_MAX_TEXT + 1))).toMatchObject({ ok: false })
    expect(sender.sendText('a'.repeat(4096))).toEqual({ ok: true })
    expect(sender.sendText('b'.repeat(4096))).toEqual({ ok: true })
    expect(sender.sendText('c'.repeat(4096))).toEqual({ ok: false, error: KEYBOARD_QUEUE_FULL })
  })

  it('reports a helper failure without echoing the text', async () => {
    const transport = new FakeTransport()
    const errors: Array<{ message: string; meta?: unknown }> = []
    const sender = new KeyboardSender(transport, {
      onError: (error, meta) => errors.push({ message: error.message, meta }),
    })
    transport.failNext = new Error('Windows blocked input to an elevated or secure window.')

    sender.sendText('super secret', { clientId: 'c1', seq: 9 })
    await waitFor(() => errors.length === 1)
    expect(errors[0]?.message).toContain('elevated')
    expect(errors[0]?.message).not.toContain('super secret')
    expect(errors[0]?.meta).toEqual({ clientId: 'c1', seq: 9 })
  })

  it('accepts a late-bound error handler', async () => {
    const transport = new FakeTransport()
    const sender = new KeyboardSender(transport)
    const errors: string[] = []
    sender.setErrorHandler((error) => errors.push(error.message))
    transport.failNext = new Error('macOS secure input is enabled.')

    sender.sendKeys(['A'], {}, { clientId: 'c2', seq: 4 })
    await waitFor(() => errors.length === 1)
    expect(errors[0]).toContain('secure input')
  })
})
