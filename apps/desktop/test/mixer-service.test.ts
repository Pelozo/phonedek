import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MixerSession, MixerSnapshot, MixerStateMessage } from '@phonedek/shared'
import {
  MAX_MIXER_SESSIONS,
  MIXER_POLL_INTERVAL_MS,
  MixerService,
  mixerSnapshotSignature,
  type MixerSource,
} from '../src/main/mixer-service'

function session(overrides: Partial<MixerSession> = {}): MixerSession {
  return {
    id: 'sink-input-42',
    process: 'chrome',
    name: 'Google Chrome',
    volume: 42,
    muted: false,
    available: true,
    ...overrides,
  }
}

function snapshot(overrides: Partial<MixerSnapshot> = {}): MixerSnapshot {
  return {
    available: true,
    sessions: [session()],
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

class FakeMixerSource implements MixerSource {
  current: MixerSnapshot = snapshot()
  failure: Error | null = null
  snapshots = 0
  volumeWrites: Array<{ id: string; level: number }> = []
  muteWrites: Array<{ id: string; muted: boolean }> = []
  writeFailure: Error | null = null
  onVolume?: () => void

  async snapshot(): Promise<MixerSnapshot> {
    this.snapshots += 1
    if (this.failure) throw this.failure
    // A real source stamps every read, so unchanged content must not spam.
    return {
      ...this.current,
      sessions: this.current.sessions.map((entry) => ({ ...entry })),
      updatedAt: this.current.updatedAt + this.snapshots,
    }
  }

  async setVolumeById(id: string, level: number): Promise<void> {
    if (this.writeFailure) throw this.writeFailure
    this.volumeWrites.push({ id, level })
    this.onVolume?.()
  }

  async setMuteById(id: string, muted: boolean): Promise<void> {
    if (this.writeFailure) throw this.writeFailure
    this.muteWrites.push({ id, muted })
  }
}

const services: MixerService[] = []

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
})

function create(source: MixerSource | null, options: { onWriteApplied?: () => void } = {}): MixerService {
  const service = new MixerService({
    ...(source ? { source } : {}),
    ...options,
  })
  services.push(service)
  return service
}

function collector(): { messages: MixerStateMessage[]; send: (message: MixerStateMessage) => void } {
  const messages: MixerStateMessage[] = []
  return { messages, send: (message) => messages.push(message) }
}

describe('mixer snapshot signature', () => {
  it('ignores updatedAt but notices content and availability changes', () => {
    const base = snapshot()
    expect(mixerSnapshotSignature({ ...base, updatedAt: 1 })).toBe(
      mixerSnapshotSignature({ ...base, updatedAt: 2 }),
    )
    expect(mixerSnapshotSignature({ ...base, available: false })).not.toBe(
      mixerSnapshotSignature(base),
    )
    expect(
      mixerSnapshotSignature({ ...base, sessions: [session({ volume: 43 })] }),
    ).not.toBe(mixerSnapshotSignature(base))
    expect(
      mixerSnapshotSignature({ ...base, reason: 'No mixer' }),
    ).not.toBe(mixerSnapshotSignature(base))
  })
})

describe('MixerService subscriptions', () => {
  it('sends an immediate snapshot and then polls at ~1 Hz', async () => {
    vi.useFakeTimers()
    const source = new FakeMixerSource()
    const service = create(source)
    const { messages, send } = collector()

    await service.subscribe('client-1', { send })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'mixerState', available: true })
    expect(messages[0]!.sessions).toEqual([session()])
    expect(service.subscriptionCount).toBe(1)
    expect(source.snapshots).toBe(1)

    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS - 1)
    expect(source.snapshots).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(source.snapshots).toBe(2)
    // Nothing changed: a fresh updatedAt alone must not cause a state message.
    expect(messages).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(source.snapshots).toBe(3)
    expect(messages).toHaveLength(1)
  })

  it('pushes changed sessions and unavailable reasons without spam', async () => {
    vi.useFakeTimers()
    const source = new FakeMixerSource()
    const service = create(source)
    const { messages, send } = collector()
    await service.subscribe('client-1', { send })

    source.current = snapshot({
      sessions: [session(), session({ id: 'sink-input-7', process: 'discord', name: 'Discord', volume: 10 })],
    })
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(messages).toHaveLength(2)
    expect(messages[1]!.sessions.map((entry) => entry.id)).toEqual([
      'sink-input-42',
      'sink-input-7',
    ])

    source.current = snapshot({
      available: false,
      sessions: [],
      reason: 'Could not list per-app audio with pactl.',
    })
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(messages).toHaveLength(3)
    expect(messages[2]).toMatchObject({
      available: false,
      sessions: [],
      reason: 'Could not list per-app audio with pactl.',
    })
  })

  it('serves every subscriber from one poll and stops when the last leaves', async () => {
    vi.useFakeTimers()
    const source = new FakeMixerSource()
    const service = create(source)
    const first = collector()
    const second = collector()
    await service.subscribe('client-1', { send: first.send })
    await service.subscribe('client-2', { send: second.send })
    expect(first.messages).toHaveLength(1)
    expect(second.messages).toHaveLength(1)
    expect(source.snapshots).toBe(2)

    source.current = snapshot({ sessions: [session({ volume: 70 })] })
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(source.snapshots).toBe(3)
    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(2)
    expect(first.messages[1]!.sessions[0]!.volume).toBe(70)

    service.unsubscribe('client-1')
    expect(service.subscriptionCount).toBe(1)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(source.snapshots).toBe(4)
    expect(first.messages).toHaveLength(2)
    // The remaining subscriber is polled but the unchanged snapshot is silent.
    expect(second.messages).toHaveLength(2)

    source.current = snapshot({ sessions: [session({ volume: 85 })] })
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS)
    expect(second.messages).toHaveLength(3)

    service.unsubscribe('client-2')
    expect(service.subscriptionCount).toBe(0)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS * 3)
    expect(source.snapshots).toBe(5)
  })

  it('replaces a connection subscription and caps the wire session list', async () => {
    const source = new FakeMixerSource()
    source.current = snapshot({
      sessions: Array.from({ length: MAX_MIXER_SESSIONS + 5 }, (_, index) =>
        session({ id: `s${index}` }),
      ),
    })
    const service = create(source)
    const first = collector()
    const second = collector()
    await service.subscribe('client-1', { send: first.send })
    await service.subscribe('client-1', { send: second.send })

    expect(service.subscriptionCount).toBe(1)
    expect(first.messages).toHaveLength(1)
    expect(second.messages).toHaveLength(1)
    expect(second.messages[0]!.sessions).toHaveLength(MAX_MIXER_SESSIONS)
  })

  it('reports an unavailable snapshot without a source and stops after dispose', async () => {
    vi.useFakeTimers()
    const source = new FakeMixerSource()
    const service = create(source)
    const { messages, send } = collector()
    await service.subscribe('client-1', { send })

    service.dispose()
    await vi.advanceTimersByTimeAsync(MIXER_POLL_INTERVAL_MS * 3)
    expect(source.snapshots).toBe(1)
    expect(messages).toHaveLength(1)

    const missing = create(null)
    const unavailable = collector()
    await missing.subscribe('client-2', { send: unavailable.send })
    expect(unavailable.messages[0]).toMatchObject({
      type: 'mixerState',
      available: false,
      sessions: [],
    })
    expect(unavailable.messages[0]!.reason).toContain('not available')
  })

  it('survives a snapshot failure with a clear reason', async () => {
    vi.useFakeTimers()
    const source = new FakeMixerSource()
    source.failure = new Error('pactl is not installed')
    const service = create(source)
    const { messages, send } = collector()
    await service.subscribe('client-1', { send })
    expect(messages[0]).toMatchObject({
      available: false,
      sessions: [],
      reason: 'pactl is not installed',
    })
  })
})

describe('MixerService commands', () => {
  it('writes volume and mute by session id and notifies the state service once', async () => {
    const source = new FakeMixerSource()
    let applied = 0
    const service = create(source, { onWriteApplied: () => void (applied += 1) })

    await expect(service.command({ sessionId: 'sink-input-42', volume: 63 })).resolves.toEqual({
      ok: true,
    })
    expect(source.volumeWrites).toEqual([{ id: 'sink-input-42', level: 63 }])

    await expect(service.command({ sessionId: 'sink-input-42', muted: true })).resolves.toEqual({
      ok: true,
    })
    expect(source.muteWrites).toEqual([{ id: 'sink-input-42', muted: true }])

    await expect(
      service.command({ sessionId: 'sink-input-42', volume: 0, muted: false }),
    ).resolves.toEqual({ ok: true })
    expect(source.volumeWrites.at(-1)).toEqual({ id: 'sink-input-42', level: 0 })
    expect(source.muteWrites.at(-1)).toEqual({ id: 'sink-input-42', muted: false })
    expect(applied).toBe(3)
  })

  it('rejects bad ids, values and empty commands with clear errors', async () => {
    const source = new FakeMixerSource()
    const service = create(source)

    await expect(service.command({ sessionId: '  ', volume: 10 })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid mixer session',
    })
    await expect(
      service.command({ sessionId: 'x'.repeat(513), volume: 10 }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid mixer session' })
    await expect(service.command({ sessionId: 's', volume: -1 })).resolves.toMatchObject({
      ok: false,
      error: 'Mixer volume must be between 0 and 100',
    })
    await expect(service.command({ sessionId: 's', volume: 101 })).resolves.toMatchObject({
      ok: false,
      error: 'Mixer volume must be between 0 and 100',
    })
    await expect(
      service.command({ sessionId: 's', volume: Number.POSITIVE_INFINITY }),
    ).resolves.toMatchObject({ ok: false, error: 'Mixer volume must be between 0 and 100' })
    await expect(
      service.command({ sessionId: 's', muted: 'yes' as unknown as boolean }),
    ).resolves.toMatchObject({ ok: false, error: 'Mixer mute must be true or false' })
    await expect(service.command({ sessionId: 's' })).resolves.toMatchObject({
      ok: false,
      error: 'Mixer command requires a volume or mute value',
    })
    expect(source.volumeWrites).toHaveLength(0)
    expect(source.muteWrites).toHaveLength(0)
  })

  it('returns source errors verbatim and an unavailable host reason', async () => {
    const source = new FakeMixerSource()
    source.writeFailure = new Error('That audio session is no longer available.')
    const service = create(source)
    await expect(service.command({ sessionId: 'gone', volume: 50 })).resolves.toEqual({
      ok: false,
      error: 'That audio session is no longer available.',
    })

    const missing = create(null)
    await expect(missing.command({ sessionId: 's', volume: 50 })).resolves.toMatchObject({
      ok: false,
    })
  })
})
