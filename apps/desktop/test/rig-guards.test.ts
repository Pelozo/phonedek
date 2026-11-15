import { describe, expect, it } from 'vitest'
import type { RigGuard } from '@phonedek/shared'
import { evaluateRigGuards, type RigGuardProbes } from '../src/main/rig-guards'

describe('evaluateRigGuards', () => {
  it('passes guards whose probe matches expect (default true)', async () => {
    const probes: RigGuardProbes = {
      obsStreaming: async () => true,
      micMuted: async () => false,
    }
    const evaluation = await evaluateRigGuards(
      [{ probe: 'obsStreaming' }, { probe: 'micMuted', expect: false }],
      probes,
    )

    expect(evaluation.ok).toBe(true)
    expect(evaluation.blocked).toEqual([])
    expect(evaluation.results).toEqual([
      {
        probe: 'obsStreaming',
        label: 'OBS streaming',
        expect: true,
        actual: true,
        ok: true,
        available: true,
      },
      {
        probe: 'micMuted',
        label: 'Not Microphone muted',
        expect: false,
        actual: false,
        ok: true,
        available: true,
      },
    ])
  })

  it('blocks when expect is inverted and the actual state matches', async () => {
    const evaluation = await evaluateRigGuards([{ probe: 'micMuted' }], {
      micMuted: async () => false,
    })

    expect(evaluation.ok).toBe(false)
    expect(evaluation.blocked).toHaveLength(1)
    expect(evaluation.results[0]).toMatchObject({ actual: false, ok: false, available: true })
    expect(evaluation.results[0]?.error).toBe('Microphone muted (actual: unmuted).')
  })

  it('uses a custom guard label in errors', async () => {
    const guard: RigGuard = { probe: 'obsRecording', label: 'Capture running' }
    const evaluation = await evaluateRigGuards([guard], { obsRecording: async () => false })
    expect(evaluation.results[0]?.label).toBe('Capture running')
    expect(evaluation.results[0]?.error).toBe('Capture running (actual: not recording).')
  })

  it('fails closed when a probe is not wired or throws', async () => {
    const missing = await evaluateRigGuards([{ probe: 'twitchLive' }], {})
    expect(missing.ok).toBe(false)
    expect(missing.results[0]).toMatchObject({ available: false, actual: null, ok: false })
    expect(missing.results[0]?.error).toMatch(/Twitch live is unavailable/)

    const thrown = await evaluateRigGuards([{ probe: 'twitchLive' }], {
      twitchLive: async () => {
        throw new Error('Twitch is not connected')
      },
    })
    expect(thrown.ok).toBe(false)
    expect(thrown.results[0]?.error).toBe('Twitch live is unavailable: Twitch is not connected')
  })

  it('fails closed when a probe returns a non-boolean', async () => {
    const probes = {
      obsStreaming: async () => 'yes' as unknown as boolean,
    }
    const evaluation = await evaluateRigGuards([{ probe: 'obsStreaming' }], probes)
    expect(evaluation.ok).toBe(false)
    expect(evaluation.results[0]?.available).toBe(false)
    expect(evaluation.results[0]?.error).toMatch(/returned no value/)
  })

  it('times out a hanging probe and blocks the rig', async () => {
    const evaluation = await evaluateRigGuards(
      [{ probe: 'obsRecording' }],
      { obsRecording: () => new Promise<boolean>(() => undefined) },
      { timeoutMs: 10 },
    )

    expect(evaluation.ok).toBe(false)
    expect(evaluation.results[0]).toMatchObject({ available: false, actual: null, ok: false })
    expect(evaluation.results[0]?.error).toMatch(/timed out/)
  })

  it('dedupes identical probe/arg reads but keeps both guard rows', async () => {
    let calls = 0
    const probes: RigGuardProbes = {
      appRunning: async () => {
        calls += 1
        return true
      },
    }
    const evaluation = await evaluateRigGuards(
      [
        { probe: 'appRunning', arg: 'discord' },
        { probe: 'appRunning', arg: 'discord', expect: true, label: 'Discord' },
      ],
      probes,
    )

    expect(calls).toBe(1)
    expect(evaluation.results).toHaveLength(2)
    expect(evaluation.results[1]?.label).toBe('Discord (discord)')
    expect(evaluation.ok).toBe(true)

    let otherCalls = 0
    await evaluateRigGuards(
      [
        { probe: 'appRunning', arg: 'discord' },
        { probe: 'appRunning', arg: 'obs' },
      ],
      {
        appRunning: async () => {
          otherCalls += 1
          return true
        },
      },
    )
    expect(otherCalls).toBe(2)
  })

  it('evaluates unique probes in parallel', async () => {
    const started: string[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const probe = (name: string) => async () => {
      started.push(name)
      await gate
      return true
    }

    const pending = evaluateRigGuards(
      [{ probe: 'obsStreaming' }, { probe: 'twitchLive' }, { probe: 'micMuted' }],
      {
        obsStreaming: probe('obs'),
        twitchLive: probe('twitch'),
        micMuted: probe('mic'),
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started.sort()).toEqual(['mic', 'obs', 'twitch'])
    if (release) (release as () => void)()
    const evaluation = await pending
    expect(evaluation.ok).toBe(true)
  })

  it('passes app and light arguments and requires an app name', async () => {
    const seen: Array<string | undefined> = []
    const probes: RigGuardProbes = {
      appRunning: async (arg) => {
        seen.push(arg)
        return true
      },
      lightOn: async (arg) => {
        seen.push(arg)
        return true
      },
    }
    const evaluation = await evaluateRigGuards(
      [
        { probe: 'appRunning', arg: 'discord' },
        { probe: 'lightOn' },
        { probe: 'lightOn', arg: 'keylight' },
      ],
      probes,
    )
    expect(evaluation.ok).toBe(true)
    expect(seen).toEqual(['discord', undefined, 'keylight'])

    const noArg = await evaluateRigGuards([{ probe: 'appRunning' }], probes)
    expect(noArg.ok).toBe(false)
    expect(noArg.results[0]?.error).toMatch(/unavailable/)
  })

  it('treats an empty guard list as ready', async () => {
    await expect(evaluateRigGuards([], {})).resolves.toEqual({ ok: true, results: [], blocked: [] })
    await expect(evaluateRigGuards(undefined, {})).resolves.toEqual({
      ok: true,
      results: [],
      blocked: [],
    })
  })
})
