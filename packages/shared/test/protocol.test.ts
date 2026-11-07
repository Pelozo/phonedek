import { describe, expect, it } from 'vitest'
import { isInputMessage, isPressMessage, parseClientMessage } from '../src/protocol'
import type { BrightnessMessage, ServerMessage } from '../src/types'

const press = {
  type: 'press',
  requestId: 'r1',
  profileId: 'profile-desktop',
  pageId: 'page-main',
  buttonId: 'btn-vol-down',
}

const hello = {
  type: 'hello',
  protocol: 1,
  device: { name: 'Pixel 8', model: 'Google Pixel 8' },
}

const input = {
  type: 'input',
  requestId: 'r2',
  profileId: 'profile-desktop',
  pageId: 'page-main',
  controlId: 'btn-vol-down',
  phase: 'move',
  delta: 2,
}

describe('client protocol', () => {
  it('accepts press and control input messages', () => {
    const parsedPress = parseClientMessage(press)
    expect(parsedPress.ok).toBe(true)
    if (parsedPress.ok) {
      expect(isPressMessage(parsedPress.message)).toBe(true)
      expect(isInputMessage(parsedPress.message)).toBe(false)
    }

    for (const phase of ['start', 'move', 'end']) {
      const parsed = parseClientMessage({ ...input, phase, value: phase === 'end' ? 0.5 : undefined })
      expect(parsed.ok, phase).toBe(true)
      if (parsed.ok) {
        expect(isInputMessage(parsed.message)).toBe(true)
        expect(isPressMessage(parsed.message)).toBe(false)
      }
    }

    expect(parseClientMessage({ ...input, value: 0 }).ok).toBe(true)
    expect(parseClientMessage({ ...input, value: 1 }).ok).toBe(true)
    expect(parseClientMessage({ ...input, delta: 0 }).ok).toBe(true)
    expect(parseClientMessage({ ...input, delta: 100 }).ok).toBe(true)
    expect(parseClientMessage({ ...input, delta: -100 }).ok).toBe(true)
  })

  it('rejects invalid input phases, ids and ranges', () => {
    expect(parseClientMessage({ ...input, phase: 'hold' }).ok).toBe(false)
    expect(parseClientMessage({ ...input, phase: undefined }).ok).toBe(false)
    expect(parseClientMessage({ ...input, requestId: 'x'.repeat(65) }).ok).toBe(false)
    expect(parseClientMessage({ ...input, controlId: 'x'.repeat(129) }).ok).toBe(false)
    expect(parseClientMessage({ ...input, value: -0.01 }).ok).toBe(false)
    expect(parseClientMessage({ ...input, value: 1.01 }).ok).toBe(false)
    expect(parseClientMessage({ ...input, value: Number.POSITIVE_INFINITY }).ok).toBe(false)
    expect(parseClientMessage({ ...input, delta: 100.01 }).ok).toBe(false)
    expect(parseClientMessage({ ...input, delta: -100.01 }).ok).toBe(false)
    expect(parseClientMessage({ ...input, delta: Number.NaN }).ok).toBe(false)
    expect(parseClientMessage({ ...input, type: 'unknown' }).ok).toBe(false)
  })

  it('accepts bounded hello capability lists', () => {
    expect(parseClientMessage(hello).ok).toBe(true)
    expect(parseClientMessage({ ...hello, capabilities: ['brightness-v1', 'input-v1'] }).ok).toBe(true)
    expect(parseClientMessage({ ...hello, capabilities: Array.from({ length: 16 }, (_, i) => `cap-${i}`) }).ok).toBe(
      true,
    )
    expect(parseClientMessage({ ...hello, capabilities: Array.from({ length: 17 }, (_, i) => `cap-${i}`) }).ok).toBe(
      false,
    )
    expect(parseClientMessage({ ...hello, capabilities: [''] }).ok).toBe(false)
    expect(parseClientMessage({ ...hello, capabilities: ['x'.repeat(41)] }).ok).toBe(false)
    expect(parseClientMessage({ ...hello, capabilities: 'brightness-v1' }).ok).toBe(false)
  })

  it('defines the brightness server message shape', () => {
    const level: BrightnessMessage = { type: 'brightness', level: 0.45 }
    const system: BrightnessMessage = { type: 'brightness', level: null }
    const messages: ServerMessage[] = [level, system]
    expect(messages).toEqual([
      { type: 'brightness', level: 0.45 },
      { type: 'brightness', level: null },
    ])
  })
})
