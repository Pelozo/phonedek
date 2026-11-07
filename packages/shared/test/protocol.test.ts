import { describe, expect, it } from 'vitest'
import { isInputMessage, isPressMessage, parseClientMessage } from '../src/protocol'

const press = {
  type: 'press',
  requestId: 'r1',
  profileId: 'profile-desktop',
  pageId: 'page-main',
  buttonId: 'btn-vol-down',
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
})
