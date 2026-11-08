import { describe, expect, it } from 'vitest'
import { isInputMessage, isPointerMessage, isPressMessage, parseClientMessage } from '../src/protocol'
import type { BrightnessMessage, PointerResult, ServerMessage } from '../src/types'

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

describe('pointer protocol', () => {
  const start = {
    type: 'pointer',
    seq: 41,
    phase: 'start',
    profileId: 'profile-desktop',
    pageId: 'page-main',
    controlId: 'btn-pad',
  }
  const move = { type: 'pointer', seq: 42, phase: 'move', dx: 0.012, dy: -0.004 }
  const end = { type: 'pointer', seq: 45, phase: 'end', buttons: [{ button: 'left', action: 'up' }] }
  const cancel = { type: 'pointer', seq: 46, phase: 'cancel' }

  it('accepts start, move, end and cancel messages', () => {
    for (const message of [start, move, end, cancel]) {
      const parsed = parseClientMessage(message)
      expect(parsed.ok, JSON.stringify(message)).toBe(true)
      if (parsed.ok) {
        expect(isPointerMessage(parsed.message)).toBe(true)
        expect(isInputMessage(parsed.message)).toBe(false)
        expect(isPressMessage(parsed.message)).toBe(false)
      }
    }

    expect(
      parseClientMessage({ ...move, scrollX: 0.5, scrollY: -0.75 }).ok,
    ).toBe(true)
    expect(
      parseClientMessage({
        ...move,
        buttons: [{ button: 'left', action: 'down' }, { button: 'right', action: 'click' }],
      }).ok,
    ).toBe(true)
    expect(parseClientMessage({ ...move, dx: 2, dy: -2 }).ok).toBe(true)
    expect(parseClientMessage({ ...move, scrollX: 10, scrollY: -10 }).ok).toBe(true)
    expect(
      parseClientMessage({
        ...move,
        buttons: Array.from({ length: 4 }, () => ({ button: 'left', action: 'click' })),
      }).ok,
    ).toBe(true)
  })

  it('requires profileId/pageId/controlId on start', () => {
    for (const key of ['profileId', 'pageId', 'controlId'] as const) {
      expect(parseClientMessage({ ...start, [key]: undefined }).ok, key).toBe(false)
      expect(parseClientMessage({ ...start, [key]: '' }).ok, key).toBe(false)
    }
    expect(parseClientMessage(start).ok).toBe(true)
  })

  it('rejects ids outside start and movement on start/cancel', () => {
    expect(parseClientMessage({ ...move, profileId: 'profile-desktop' }).ok).toBe(false)
    expect(parseClientMessage({ ...end, pageId: 'page-main' }).ok).toBe(false)
    expect(parseClientMessage({ ...end, controlId: 'btn-pad' }).ok).toBe(false)
    expect(parseClientMessage({ ...start, dx: 0.1 }).ok).toBe(false)
    expect(parseClientMessage({ ...start, buttons: [{ button: 'left', action: 'down' }] }).ok).toBe(false)
    expect(parseClientMessage({ ...cancel, dx: 0.1 }).ok).toBe(false)
    expect(parseClientMessage({ ...cancel, buttons: [{ button: 'left', action: 'up' }] }).ok).toBe(false)
    expect(parseClientMessage({ ...cancel, profileId: 'profile-desktop' }).ok).toBe(false)
  })

  it('rejects out-of-bounds deltas and scroll notches', () => {
    for (const dx of [2.01, -2.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseClientMessage({ ...move, dx }).ok, `dx ${dx}`).toBe(false)
    }
    for (const dy of [2.01, -2.01, Number.NaN]) {
      expect(parseClientMessage({ ...move, dy }).ok, `dy ${dy}`).toBe(false)
    }
    for (const scrollY of [10.01, -10.01, Number.NaN]) {
      expect(parseClientMessage({ ...move, scrollY }).ok, `scrollY ${scrollY}`).toBe(false)
    }
    expect(parseClientMessage({ ...move, scrollX: 10.01 }).ok).toBe(false)
  })

  it('rejects too many buttons and unknown button/action values', () => {
    const buttons = Array.from({ length: 5 }, () => ({ button: 'left', action: 'click' }))
    expect(parseClientMessage({ ...move, buttons }).ok).toBe(false)
    expect(parseClientMessage({ ...move, buttons: [{ button: 'back', action: 'click' }] }).ok).toBe(false)
    expect(parseClientMessage({ ...move, buttons: [{ button: 'left', action: 'hold' }] }).ok).toBe(false)
    expect(parseClientMessage({ ...move, buttons: [{ button: 'left' }] }).ok).toBe(false)
  })

  it('rejects stale, non-integer and missing sequence numbers', () => {
    for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(parseClientMessage({ ...move, seq }).ok, `seq ${seq}`).toBe(false)
    }
    expect(parseClientMessage({ ...move, seq: 0 }).ok).toBe(true)
    expect(parseClientMessage({ ...move, phase: 'hold' }).ok).toBe(false)
    expect(parseClientMessage({ ...move, type: 'pointerResult' }).ok).toBe(false)
  })

  it('defines the pointerResult server message shape', () => {
    const ok: PointerResult = { seq: 45, ok: true }
    const failed: PointerResult = { seq: 42, ok: false, error: 'Trackpad is not supported on this desktop.' }
    const messages: ServerMessage[] = [
      { type: 'pointerResult', ...ok },
      { type: 'pointerResult', ...failed },
    ]
    expect(messages).toEqual([
      { type: 'pointerResult', seq: 45, ok: true },
      {
        type: 'pointerResult',
        seq: 42,
        ok: false,
        error: 'Trackpad is not supported on this desktop.',
      },
    ])
  })
})
