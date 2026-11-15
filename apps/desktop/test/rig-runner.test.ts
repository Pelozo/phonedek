import { describe, expect, it } from 'vitest'
import type { PlanGroup, RigPreset } from '@phonedek/shared'
import type { ExecutePlanOptions, PlanResult } from '../src/main/executor'
import type { RigGuardProbes } from '../src/main/rig-guards'
import {
  RigRunner,
  rigPressMessages,
  type RigProgressFrame,
  type RigRunnerDeps,
} from '../src/main/rig-runner'

interface ExecutorCall {
  groups: readonly PlanGroup[]
  label: string
  options: ExecutePlanOptions
}

function plan(partial: Partial<PlanResult> = {}): PlanResult {
  return {
    ok: false,
    completed: 0,
    total: 0,
    failures: [],
    cancelled: false,
    timedOut: false,
    stoppedOnFailure: false,
    ...partial,
  }
}

function rig(overrides: Partial<RigPreset> = {}): RigPreset {
  return {
    id: 'go-live',
    name: 'Go Live',
    steps: [
      { label: 'Scene', action: { type: 'obs', action: 'setScene', scene: 'Main' } },
      { label: 'Record', action: { type: 'obs', action: 'startRecord' } },
    ],
    ...overrides,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(
  execute: (call: ExecutorCall) => Promise<PlanResult>,
  extra: Partial<RigRunnerDeps> = {},
): {
  runner: RigRunner
  calls: ExecutorCall[]
  frames: RigProgressFrame[]
} {
  const calls: ExecutorCall[] = []
  const frames: RigProgressFrame[] = []
  const runner = new RigRunner(
    {
      executePlan: (groups, label, options) => {
        const call: ExecutorCall = { groups, label, options }
        calls.push(call)
        return execute(call)
      },
      probes: {},
      ...extra,
    },
    { onProgress: (frame) => frames.push(frame) },
  )
  return { runner, calls, frames }
}

describe('RigRunner run', () => {
  it('runs a rig, emits start/step/done and stores the last run', async () => {
    let clock = 1_000
    const { runner, calls, frames } = harness(
      async (call) => {
        clock = 5_000
        call.options.onProgress?.({ index: 1, total: 2, label: 'Scene', ok: true })
        call.options.onProgress?.({ index: 2, total: 2, label: 'Record', ok: true })
        return plan({ ok: true, completed: 2, total: 2 })
      },
      { now: () => clock },
    )

    const result = await runner.run(rig())

    expect(result).toMatchObject({
      presetId: 'go-live',
      name: 'Go Live',
      status: 'ok',
      ok: true,
      completed: 2,
      total: 2,
      durationMs: 4_000,
      at: 5_000,
      message: 'Go Live: 2/2 steps in 4.0s',
    })
    expect(result.error).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.groups.map((group) => group.label)).toEqual(['Scene', 'Record'])
    expect(frames).toEqual([
      { phase: 'start', presetId: 'go-live', index: 0, total: 2, label: 'Go Live' },
      { phase: 'step', presetId: 'go-live', index: 1, total: 2, label: 'Scene', ok: true },
      { phase: 'step', presetId: 'go-live', index: 2, total: 2, label: 'Record', ok: true },
      {
        phase: 'done',
        presetId: 'go-live',
        index: 2,
        total: 2,
        label: 'Go Live',
        status: 'ok',
        ok: true,
        durationMs: 4_000,
      },
    ])
    expect(runner.lastRun('go-live')).toEqual({
      presetId: 'go-live',
      status: 'ok',
      ok: true,
      completed: 2,
      total: 2,
      at: 5_000,
      durationMs: 4_000,
      message: 'Go Live: 2/2 steps in 4.0s',
    })
    expect(runner.readStatus(rig())).toEqual({
      detail: 'RUN NOW',
      active: false,
      available: true,
      status: 'ok',
    })
  })

  it('passes mode and deadline to the executor and defaults them', async () => {
    const { runner, calls } = harness(async () => plan({ ok: true, completed: 2, total: 2 }))
    await runner.run(rig({ onError: 'continue', deadlineMs: 5_000 }))
    expect(calls[0]?.options.mode).toBe('continue')
    expect(calls[0]?.options.deadlineMs).toBe(5_000)
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal)

    await runner.run(rig({ id: 'other', name: 'Other', steps: [rig().steps[0]!] }))
    expect(calls[1]?.options.mode).toBe('failFast')
    expect(calls[1]?.options.deadlineMs).toBe(120_000)
  })

  it('maps executor outcomes to ok/partial/failed/stopped/timeout details and messages', async () => {
    const failure = { index: 2, label: 'Record', error: 'OBS is not available' }
    const cases: Array<{
      result: PlanResult
      status: string
      detail: string
      error?: string
    }> = [
      {
        result: plan({ ok: true, completed: 2, total: 2 }),
        status: 'ok',
        detail: 'RUN NOW',
      },
      {
        result: plan({ completed: 1, total: 2, failures: [failure] }),
        status: 'partial',
        detail: 'PARTIAL',
        error: 'Go Live: 1/2 steps, 1 failed — OBS is not available',
      },
      {
        result: plan({ completed: 1, total: 2, failures: [failure], stoppedOnFailure: true }),
        status: 'failed',
        detail: 'FAILED',
        error: 'Go Live: failed at step 2/2 — OBS is not available',
      },
      {
        result: plan({
          completed: 0,
          total: 2,
          failures: [{ index: 1, label: 'Scene', error: 'scene missing' }],
          stoppedOnFailure: true,
        }),
        status: 'failed',
        detail: 'FAILED',
        error: 'Go Live: failed at step 1/2 — scene missing',
      },
      {
        result: plan({ completed: 1, total: 2, cancelled: true }),
        status: 'cancelled',
        detail: 'STOPPED',
        error: 'Go Live: stopped after 1/2 steps.',
      },
      {
        result: plan({ completed: 1, total: 2, timedOut: true }),
        status: 'timeout',
        detail: 'TIMEOUT',
        error: 'Go Live: timed out after 0.0s at 1/2 steps.',
      },
    ]

    for (const entry of cases) {
      const { runner } = harness(async () => entry.result)
      const result = await runner.run(rig())
      expect(result.status).toBe(entry.status)
      expect(result.ok).toBe(entry.status === 'ok')
      if (entry.error === undefined) {
        expect(result.error).toBeUndefined()
      } else {
        expect(result.error).toBe(entry.error)
      }
      expect(runner.readStatus(rig()).detail).toBe(entry.detail)
      expect(runner.readStatus(rig()).active).toBe(false)
    }
  })

  it('blocks before running any step when a guard fails', async () => {
    let executed = false
    const { runner, frames } = harness(
      async () => {
        executed = true
        return plan({ ok: true, completed: 2, total: 2 })
      },
      { probes: { obsStreaming: async () => false } },
    )

    const result = await runner.run(rig({ guards: [{ probe: 'obsStreaming' }] }))

    expect(executed).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.ok).toBe(false)
    expect(result.completed).toBe(0)
    expect(result.error).toBe('Go Live: blocked — OBS streaming (actual: not streaming).')
    expect(result.guards).toHaveLength(1)
    expect(frames[0]?.phase).toBe('start')
    expect(frames.at(-1)).toMatchObject({
      phase: 'done',
      status: 'blocked',
      ok: false,
      index: 0,
      total: 2,
      error: 'Go Live: blocked — OBS streaming (actual: not streaming).',
    })
    expect(runner.readStatus(rig()).detail).toBe('BLOCKED')
  })

  it('fails cleanly when the preset no longer exists', async () => {
    const { runner, calls, frames } = harness(async () => plan({ ok: true }))
    const result = await runner.run(undefined, { presetId: 'gone' })

    expect(result).toMatchObject({
      presetId: 'gone',
      name: 'gone',
      status: 'failed',
      ok: false,
      completed: 0,
      total: 0,
      error: 'Rig "gone" is not configured.',
    })
    expect(calls).toEqual([])
    expect(frames).toEqual([])
    expect(runner.lastRun('gone')).toBeUndefined()
    expect(runner.readStatus(undefined)).toEqual({
      detail: 'NO RIG',
      active: false,
      available: false,
    })
  })

  it('rejects a second run while one is active, with name and progress', async () => {
    const pending = deferred<PlanResult>()
    const { runner, calls } = harness(async () => pending.promise)
    const first = runner.run(rig())
    await flush()
    expect(calls).toHaveLength(1)

    const busy = await runner.run(rig({ id: 'other', name: 'Raid Mode' }))
    expect(busy.status).toBe('busy')
    expect(busy.ok).toBe(false)
    expect(busy.error).toBe('Rig "Go Live" is already running (0/2).')
    expect(busy.active).toEqual({ presetId: 'go-live', name: 'Go Live', index: 0, total: 2 })
    expect(runner.lastRun('other')).toBeUndefined()

    calls[0]?.options.onProgress?.({ index: 1, total: 2, label: 'Scene', ok: true })
    const busyAgain = await runner.run(rig({ id: 'other', name: 'Raid Mode' }))
    expect(busyAgain.error).toBe('Rig "Go Live" is already running (1/2).')

    pending.resolve(plan({ ok: true, completed: 2, total: 2 }))
    await expect(first).resolves.toMatchObject({ status: 'ok', completed: 2 })
    expect(runner.active).toBeUndefined()
    expect(runner.lastRun('go-live')?.status).toBe('ok')
  })

  it('aborts at the executor boundary', async () => {
    const { runner } = harness(
      async (call) =>
        new Promise<PlanResult>((resolve) => {
          call.options.signal?.addEventListener('abort', () =>
            resolve(plan({ completed: 0, total: 2, cancelled: true })),
          )
        }),
    )
    const running = runner.run(rig())
    await flush()
    expect(runner.active).toEqual({ presetId: 'go-live', name: 'Go Live', index: 0, total: 2 })
    expect(runner.abort()).toBe(true)
    const result = await running

    expect(result.status).toBe('cancelled')
    expect(result.error).toBe('Go Live: stopped after 0/2 steps.')
    expect(runner.abort()).toBe(false)
    expect(runner.readStatus(rig()).detail).toBe('STOPPED')
    expect(runner.active).toBeUndefined()
  })

  it('survives the preset being deleted mid-run', async () => {
    const pending = deferred<PlanResult>()
    const { runner } = harness(async () => pending.promise)
    const running = runner.run(rig())
    await flush()

    expect(runner.readStatus(undefined).detail).toBe('NO RIG')
    const preview = await runner.preview(undefined, 'go-live')
    expect(preview.ok).toBe(false)
    expect(preview.error).toBe('Rig "go-live" is not configured.')

    pending.resolve(plan({ ok: true, completed: 2, total: 2 }))
    await expect(running).resolves.toMatchObject({ status: 'ok', completed: 2 })
    expect(runner.lastRun('go-live')?.status).toBe('ok')
    expect(runner.readStatus(undefined).detail).toBe('NO RIG')
    expect(runner.readStatus(rig()).detail).toBe('RUN NOW')
  })

  it('aborts a run that was already cancelled by its caller', async () => {
    const controller = new AbortController()
    controller.abort()
    const { runner } = harness(async () => plan({ completed: 0, total: 2, cancelled: true }))
    const result = await runner.run(rig(), { signal: controller.signal })
    expect(result.status).toBe('cancelled')
  })
})

describe('RigRunner status', () => {
  it('shows READY, live progress/age, then the terminal detail', async () => {
    let clock = 1_000
    const pending = deferred<PlanResult>()
    const { runner, calls } = harness(async () => pending.promise, { now: () => clock })

    expect(runner.readStatus(rig())).toEqual({
      detail: 'READY',
      active: false,
      available: true,
    })

    const running = runner.run(rig())
    await flush()
    expect(runner.readStatus(rig())).toEqual({
      detail: 'RUN NOW',
      active: true,
      available: true,
    })

    clock += 120_000
    expect(runner.readStatus(rig()).detail).toBe('RUN 2m')

    calls[0]?.options.onProgress?.({ index: 1, total: 2, label: 'Scene', ok: true })
    expect(runner.readStatus(rig())).toEqual({
      detail: '1/2',
      active: true,
      available: true,
    })

    pending.resolve(plan({ ok: true, completed: 2, total: 2 }))
    await running
    expect(runner.readStatus(rig())).toEqual({
      detail: 'RUN NOW',
      active: false,
      available: true,
      status: 'ok',
    })
  })

  it('keeps another rig’s status idle while one rig is running', async () => {
    const pending = deferred<PlanResult>()
    const { runner } = harness(async () => pending.promise)
    const other = rig({ id: 'other', name: 'Other' })
    const running = runner.run(rig())
    await flush()

    expect(runner.readStatus(other)).toEqual({ detail: 'READY', active: false, available: true })
    pending.resolve(plan({ ok: true, completed: 2, total: 2 }))
    await running
  })
})

describe('RigRunner preview', () => {
  it('checks guards without mutating the last run', async () => {
    let streaming = true
    const probes: RigGuardProbes = { obsStreaming: async () => streaming }
    let clock = 1_000
    const { runner } = harness(async () => plan({ ok: true, completed: 2, total: 2 }), {
      probes,
      now: () => clock,
    })
    const preset = rig({ guards: [{ probe: 'obsStreaming' }] })
    await runner.run(preset)
    const before = runner.lastRun('go-live')
    expect(before?.status).toBe('ok')

    streaming = false
    const preview = await runner.preview(preset)
    expect(preview).toMatchObject({
      presetId: 'go-live',
      name: 'Go Live',
      ok: false,
      total: 2,
    })
    expect(preview.blocked).toHaveLength(1)
    expect(preview.error).toBe('OBS streaming (actual: not streaming).')
    expect(preview.estimatedMs).toBeGreaterThan(0)

    expect(runner.lastRun('go-live')).toEqual(before)
    expect(runner.readStatus(preset).detail).toBe('RUN NOW')
  })

  it('passes a clean preview and reports missing presets', async () => {
    const { runner } = harness(async () => plan({ ok: true }), {
      probes: { micMuted: async () => true },
    })
    const preview = await runner.preview(
      rig({ steps: [], guards: [{ probe: 'micMuted' }] }),
    )
    expect(preview.ok).toBe(true)
    expect(preview.blocked).toEqual([])
    expect(preview.total).toBe(0)

    const missing = await runner.preview(undefined, 'gone')
    expect(missing).toEqual({
      presetId: 'gone',
      name: 'gone',
      ok: false,
      total: 0,
      estimatedMs: 0,
      guards: [],
      blocked: [],
      error: 'Rig "gone" is not configured.',
    })
  })

  it('exposes the exact press strings', () => {
    expect(rigPressMessages.ok('Go Live', 2, 2, 4_000)).toBe('Go Live: 2/2 steps in 4.0s')
    expect(rigPressMessages.partial('Go Live', 1, 2, 1, 'boom')).toBe(
      'Go Live: 1/2 steps, 1 failed — boom',
    )
    expect(rigPressMessages.failed('Go Live', 1, 2, 'boom')).toBe(
      'Go Live: failed at step 1/2 — boom',
    )
    expect(rigPressMessages.blocked('Go Live', 'reason')).toBe('Go Live: blocked — reason')
    expect(rigPressMessages.cancelled('Go Live', 1, 2)).toBe('Go Live: stopped after 1/2 steps.')
    expect(rigPressMessages.timeout('Go Live', 1, 2, 3_000)).toBe(
      'Go Live: timed out after 3.0s at 1/2 steps.',
    )
    expect(rigPressMessages.busy('Other', 1, 2)).toBe('Rig "Other" is already running (1/2).')
    expect(rigPressMessages.missing('gone')).toBe('Rig "gone" is not configured.')
  })
})
