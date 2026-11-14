import { describe, expect, it } from 'vitest'
import {
  MixerCommandMessageSchema,
  MixerMessageSchema,
  MixerResultMessageSchema,
  MixerSessionSchema,
  MixerStateMessageSchema,
  isMixerCommandMessage,
  isMixerMessage,
  parseClientMessage,
} from '../src/protocol'

const session = {
  id: 'sink-input-42',
  process: 'chrome',
  name: 'Google Chrome',
  volume: 42,
  muted: false,
  available: true,
}

const state = {
  type: 'mixerState',
  available: true,
  sessions: [session],
  updatedAt: 1_700_000_000_000,
}

const command = {
  type: 'mixerCommand',
  requestId: 'm1',
  sessionId: 'sink-input-42',
  volume: 55,
}

describe('mixer subscription message', () => {
  it('accepts start and stop only', () => {
    expect(MixerMessageSchema.parse({ type: 'mixer', phase: 'start' })).toEqual({
      type: 'mixer',
      phase: 'start',
    })
    expect(MixerMessageSchema.parse({ type: 'mixer', phase: 'stop' }).phase).toBe('stop')
    expect(MixerMessageSchema.safeParse({ type: 'mixer', phase: 'pause' }).success).toBe(false)
    expect(MixerMessageSchema.safeParse({ type: 'mixer' }).success).toBe(false)
  })

  it('parses through the client union with the expected guard', () => {
    const parsed = parseClientMessage({ type: 'mixer', phase: 'start' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(isMixerMessage(parsed.message)).toBe(true)
      expect(isMixerCommandMessage(parsed.message)).toBe(false)
    }
  })
})

describe('mixer state message', () => {
  it('accepts a full snapshot and optional reason', () => {
    expect(MixerStateMessageSchema.parse(state)).toEqual(state)
    expect(
      MixerStateMessageSchema.safeParse({
        type: 'mixerState',
        available: false,
        sessions: [],
        reason: 'Per-app audio is not available on macOS.',
        updatedAt: 0,
      }).success,
    ).toBe(true)
    expect(
      MixerStateMessageSchema.safeParse({ ...state, sessions: [], reason: undefined }).success,
    ).toBe(true)
  })

  it('bounds ids, volume, session count and reason', () => {
    expect(MixerSessionSchema.safeParse({ ...session, id: '' }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, id: 'x'.repeat(513) }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, process: '' }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, name: '' }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, volume: -1 }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, volume: 101 }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, volume: 42.5 }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, muted: 'no' }).success).toBe(false)
    expect(MixerSessionSchema.safeParse({ ...session, available: 1 }).success).toBe(false)

    const tooMany = Array.from({ length: 129 }, (_, index) => ({ ...session, id: `s${index}` }))
    expect(MixerStateMessageSchema.safeParse({ ...state, sessions: tooMany }).success).toBe(false)
    expect(MixerStateMessageSchema.safeParse({ ...state, reason: 'x'.repeat(301) }).success).toBe(
      false,
    )
    expect(MixerStateMessageSchema.safeParse({ ...state, updatedAt: -1 }).success).toBe(false)
    expect(MixerStateMessageSchema.safeParse({ ...state, updatedAt: 1.5 }).success).toBe(false)
    expect(MixerStateMessageSchema.safeParse({ ...state, type: 'mixer' }).success).toBe(false)
  })
})

describe('mixer command and result messages', () => {
  it('accepts volume, mute or both', () => {
    expect(MixerCommandMessageSchema.parse(command)).toEqual(command)
    expect(MixerCommandMessageSchema.safeParse({ ...command, volume: undefined, muted: true }).success).toBe(
      true,
    )
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, volume: 0, muted: false }).success,
    ).toBe(true)
    expect(MixerCommandMessageSchema.safeParse({ ...command, volume: 100 }).success).toBe(true)
  })

  it('rejects missing payloads, bad ids and out-of-range values', () => {
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, volume: undefined }).success,
    ).toBe(false)
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, volume: undefined, muted: undefined }).success,
    ).toBe(false)
    expect(MixerCommandMessageSchema.safeParse({ ...command, requestId: '' }).success).toBe(false)
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, requestId: 'x'.repeat(65) }).success,
    ).toBe(false)
    expect(MixerCommandMessageSchema.safeParse({ ...command, sessionId: '' }).success).toBe(false)
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, sessionId: 'x'.repeat(513) }).success,
    ).toBe(false)
    expect(MixerCommandMessageSchema.safeParse({ ...command, volume: -0.1 }).success).toBe(false)
    expect(MixerCommandMessageSchema.safeParse({ ...command, volume: 100.1 }).success).toBe(false)
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, volume: Number.NaN }).success,
    ).toBe(false)
    expect(
      MixerCommandMessageSchema.safeParse({ ...command, muted: 'yes' }).success,
    ).toBe(false)
  })

  it('parses through the client union and guards commands', () => {
    const parsed = parseClientMessage(command)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(isMixerCommandMessage(parsed.message)).toBe(true)
      expect(isMixerMessage(parsed.message)).toBe(false)
    }
    expect(parseClientMessage({ ...command, volume: undefined }).ok).toBe(false)
    expect(parseClientMessage({ ...command, sessionId: 'x'.repeat(513) }).ok).toBe(false)
  })

  it('validates mixerResult acknowledgements', () => {
    expect(
      MixerResultMessageSchema.parse({ type: 'mixerResult', requestId: 'm1', ok: true }),
    ).toEqual({ type: 'mixerResult', requestId: 'm1', ok: true })
    expect(
      MixerResultMessageSchema.safeParse({
        type: 'mixerResult',
        requestId: 'm1',
        ok: false,
        error: 'That audio session is no longer available.',
      }).success,
    ).toBe(true)
    expect(
      MixerResultMessageSchema.safeParse({ type: 'mixerResult', requestId: '', ok: true }).success,
    ).toBe(false)
    expect(
      MixerResultMessageSchema.safeParse({ type: 'mixerResult', requestId: 'm1' }).success,
    ).toBe(false)
  })
})
