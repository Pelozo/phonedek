import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action, ControlSpec, InputMessage, PressResult } from '@phonedek/shared'
import { ControlInputRouter } from '../src/main/control-input'

const volume: ControlSpec = {
  kind: 'slider',
  emit: 'delta',
  binding: { type: 'volume', mode: 'relative' },
}

const scroll: ControlSpec = {
  kind: 'dial',
  emit: 'delta',
  binding: { type: 'scroll', axis: 'vertical' },
}

const absoluteVolume: ControlSpec = {
  kind: 'slider',
  emit: 'value',
  binding: { type: 'volume', mode: 'absolute' },
}

let counter = 0

function message(
  phase: InputMessage['phase'],
  delta?: number,
  controlId = 'btn-vol',
  value?: number,
): InputMessage {
  counter += 1
  return {
    type: 'input',
    requestId: `req-${counter}`,
    profileId: 'profile-desktop',
    pageId: 'page-main',
    controlId,
    phase,
    ...(delta === undefined ? {} : { delta }),
    ...(value === undefined ? {} : { value }),
  }
}

function target(control: ControlSpec = volume, label = 'Volume') {
  return { control, label }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ControlInputRouter', () => {
  it('coalesces many moves into one bounded batch', async () => {
    vi.useFakeTimers()
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
      flushMs: 50,
    })

    for (let index = 0; index < 10; index += 1) {
      await router.handle(message('move', 0.2), target())
    }
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      { type: 'media', key: 'volumeup' },
      { type: 'media', key: 'volumeup' },
    ])
    router.dispose()
  })

  it('flushes immediately and awaits execution on end', async () => {
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
      flushMs: 50,
    })

    await router.handle(message('move', 3), target())
    const result = await router.handle(message('end'), target())
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)
    expect(calls[0]!.every((action) => action.type === 'media' && action.key === 'volumeup')).toBe(true)
    router.dispose()
  })

  it('coalesces while an executor run is in flight and preserves order', async () => {
    vi.useFakeTimers()
    const calls: Action[][] = []
    let release: (() => void) | null = null
    const router = new ControlInputRouter({
      execute: (actions): Promise<PressResult> => {
        calls.push(actions)
        if (calls.length === 1) {
          return new Promise<PressResult>((resolve) => {
            release = () => resolve({ ok: true })
          })
        }
        return Promise.resolve({ ok: true })
      },
      flushMs: 50,
    })

    await router.handle(message('move', 2), target())
    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toHaveLength(1)

    await router.handle(message('move', 3), target())
    await router.handle(message('move', 1), target())
    const endPromise = router.handle(message('end'), target())
    await Promise.resolve()
    expect(calls).toHaveLength(1)

    expect(release).toBeTypeOf('function')
    release!()
    await expect(endPromise).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toHaveLength(4)
    router.dispose()
  })

  it('caps a batch and supports scroll controls', async () => {
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
    })

    await router.handle(message('move', 100, 'btn-volume'), target())
    await router.handle(message('end', undefined, 'btn-volume'), target())
    expect(calls[0]).toHaveLength(20)

    await router.handle(message('move', -250, 'btn-scroll'), target(scroll, 'Scroll'))
    await router.handle(message('end', undefined, 'btn-scroll'), target(scroll, 'Scroll'))
    expect(calls[1]).toEqual([
      {
        type: 'macro',
        steps: [{ type: 'mouse', button: 'left', action: 'scroll', direction: 'down', amount: 100 }],
      },
    ])
    router.dispose()
  })

  it('resets stale movement on start', async () => {
    vi.useFakeTimers()
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
      flushMs: 50,
    })

    await router.handle(message('move', 5), target())
    await router.handle(message('start'), target())
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(0)
    await expect(router.handle(message('end'), target())).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(0)
    router.dispose()
  })

  it('coalesces absolute volume with latest-wins semantics', async () => {
    vi.useFakeTimers()
    const applied: number[] = []
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      applyAbsolute: async (_control, value) => {
        applied.push(value)
        return { ok: true }
      },
      flushMs: 50,
    })

    await router.handle(message('move', undefined, 'btn-abs', 0.2), target(absoluteVolume))
    await router.handle(message('move', undefined, 'btn-abs', 0.8), target(absoluteVolume))
    expect(applied).toEqual([])

    await vi.advanceTimersByTimeAsync(50)
    expect(applied).toEqual([0.8])

    await expect(router.handle(message('end', undefined, 'btn-abs'), target(absoluteVolume))).resolves.toEqual({
      ok: true,
    })
    expect(applied).toEqual([0.8])
    router.dispose()
  })

  it('flushes the latest absolute value immediately on end', async () => {
    const applied: number[] = []
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      applyAbsolute: async (_control, value) => {
        applied.push(value)
        return { ok: true }
      },
    })

    await router.handle(message('move', undefined, 'btn-abs', 0), target(absoluteVolume))
    await router.handle(message('move', undefined, 'btn-abs', 0.35), target(absoluteVolume))
    await expect(router.handle(message('end', undefined, 'btn-abs'), target(absoluteVolume))).resolves.toEqual({
      ok: true,
    })
    expect(applied).toEqual([0.35])
    router.dispose()
  })

  it('applies the newest absolute value after an in-flight update', async () => {
    vi.useFakeTimers()
    const applied: number[] = []
    let release: (() => void) | null = null
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      applyAbsolute: async (_control, value) => {
        applied.push(value)
        if (applied.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        return { ok: true }
      },
      flushMs: 50,
    })

    await router.handle(message('move', undefined, 'btn-abs', 0.1), target(absoluteVolume))
    await vi.advanceTimersByTimeAsync(50)
    expect(applied).toEqual([0.1])

    await router.handle(message('move', undefined, 'btn-abs', 0.9), target(absoluteVolume))
    const end = router.handle(message('end', undefined, 'btn-abs'), target(absoluteVolume))
    await Promise.resolve()
    expect(applied).toEqual([0.1])

    expect(release).toBeTypeOf('function')
    release!()
    await expect(end).resolves.toEqual({ ok: true })
    expect(applied).toEqual([0.1, 0.9])
    router.dispose()
  })

  it('rejects absolute volume when no absolute backend is wired', async () => {
    const router = new ControlInputRouter({ execute: async () => ({ ok: true }) })
    const result = await router.handle(
      message('move', undefined, 'btn-abs', 0.5),
      target(absoluteVolume),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not available/)
    router.dispose()
  })

  it('rejects absolute controls with a clear error', async () => {
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
    })
    const absolute: ControlSpec = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'volume', mode: 'relative' },
    }
    const result = await router.handle(message('move', 0.5), target(absolute))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Absolute controls/)
    expect(calls).toHaveLength(0)
    router.dispose()
  })

  it('applies mic gain values with latest-wins coalescing', async () => {
    vi.useFakeTimers()
    const applied: Array<{ value: number; type: string }> = []
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      applyAbsolute: async (control, value) => {
        applied.push({ value, type: control.binding.type })
        return { ok: true }
      },
      flushMs: 50,
    })
    const mic: ControlSpec = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'mic', mode: 'gain' },
      min: 0,
      max: 100,
      step: 1,
      initial: 50,
      unit: '%',
    }

    await router.handle(message('move', undefined, 'btn-mic', 0.2), target(mic, 'Microphone'))
    await router.handle(message('move', undefined, 'btn-mic', 0.8), target(mic, 'Microphone'))
    expect(applied).toEqual([])
    await vi.advanceTimersByTimeAsync(50)
    expect(applied).toEqual([{ value: 0.8, type: 'mic' }])

    await expect(
      router.handle(message('end', undefined, 'btn-mic'), target(mic, 'Microphone')),
    ).resolves.toEqual({ ok: true })
    expect(applied).toEqual([{ value: 0.8, type: 'mic' }])
    router.dispose()
  })

  it('rejects malformed mic controls and a missing mic backend', async () => {
    const router = new ControlInputRouter({ execute: async () => ({ ok: true }) })
    const deltaMic: ControlSpec = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'mic', mode: 'gain' },
    }
    let result = await router.handle(message('move', 0.5, 'btn-mic'), target(deltaMic, 'Mic'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Mic gain requires a value control/)

    const valueMic: ControlSpec = {
      kind: 'slider',
      emit: 'value',
      binding: { type: 'mic', mode: 'gain' },
    }
    result = await router.handle(message('move', undefined, 'btn-mic', 0.5), target(valueMic, 'Mic'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Microphone gain is not available/)
    router.dispose()
  })
})

describe('OBS control input', () => {  const obsVolume: ControlSpec = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
    min: 0,
    max: 200,
    step: 1,
    initial: 100,
    unit: '%',
  }

  it('routes the latest normalized OBS value to applyAbsolute', async () => {
    vi.useFakeTimers()
    const applied: Array<{ value: number; type: string }> = []
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      applyAbsolute: async (control, value) => {
        applied.push({ value, type: control.binding.type })
        return { ok: true }
      },
      flushMs: 50,
    })

    await router.handle(message('move', undefined, 'btn-obs', 0.2), target(obsVolume, 'OBS'))
    await router.handle(message('move', undefined, 'btn-obs', 0.85), target(obsVolume, 'OBS'))
    expect(applied).toEqual([])
    await vi.advanceTimersByTimeAsync(50)
    expect(applied).toEqual([{ value: 0.85, type: 'obs' }])

    await expect(
      router.handle(message('end', undefined, 'btn-obs'), target(obsVolume, 'OBS')),
    ).resolves.toEqual({ ok: true })
    expect(applied).toEqual([{ value: 0.85, type: 'obs' }])
    router.dispose()
  })

  it('rejects an OBS control with a delta emit', async () => {
    const router = new ControlInputRouter({ execute: async () => ({ ok: true }) })
    const delta: ControlSpec = {
      kind: 'slider',
      emit: 'delta',
      binding: { type: 'obs', target: 'inputVolume', input: 'Mic/Aux' },
    }
    const result = await router.handle(message('move', 0.5, 'btn-obs'), target(delta, 'OBS'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/OBS input volume requires a value control/)
    router.dispose()
  })

  it('reports a clear error when OBS is not wired', async () => {
    const router = new ControlInputRouter({ execute: async () => ({ ok: true }) })
    const result = await router.handle(
      message('move', undefined, 'btn-obs', 0.5),
      target(obsVolume, 'OBS'),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/OBS input volume is not available/)
    router.dispose()
  })
})

const appWheel: ControlSpec = {
  kind: 'dial',
  emit: 'delta',
  binding: {
    type: 'shortcut',
    keys: ['TAB'],
    reverseKeys: ['SHIFT', 'TAB'],
    holdKeys: ['ALT'],
  },
}

const brushSlider: ControlSpec = {
  kind: 'slider',
  emit: 'delta',
  binding: { type: 'shortcut', keys: ['['], reverseKeys: [']'], travelSteps: 20 },
}

const held = (keys: string[], action: 'down' | 'up') => ({
  type: 'hotkey' as const,
  keys,
  holdMs: 0,
  action,
})

describe('shortcut wheel hold keys', () => {
  function setup(options: { watchdogMs?: number } = {}) {
    const calls: Action[][] = []
    const router = new ControlInputRouter({
      execute: async (actions) => {
        calls.push(actions)
        return { ok: true }
      },
      flushMs: 50,
      ...(options.watchdogMs ? { watchdogMs: options.watchdogMs } : {}),
    })
    return { calls, router }
  }

  it('presses holdKeys on the first non-zero move, before the chord, and releases last', async () => {
    vi.useFakeTimers()
    const { calls, router } = setup()
    const wheel = target(appWheel, 'App wheel')

    await router.handle(message('start'), wheel)
    await router.handle(message('move', 0), wheel)
    expect(calls).toEqual([])

    await router.handle(message('move', 1), wheel)
    expect(calls).toEqual([[held(['ALT'], 'down')]])

    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toEqual([[held(['ALT'], 'down')], [{ type: 'hotkey', keys: ['TAB'] }]])

    await expect(router.handle(message('end'), wheel)).resolves.toEqual({ ok: true })
    expect(calls).toEqual([
      [held(['ALT'], 'down')],
      [{ type: 'hotkey', keys: ['TAB'] }],
      [held(['ALT'], 'up')],
    ])
    await router.dispose()
  })

  it('sends nothing for a tap with no movement', async () => {
    const { calls, router } = setup()
    await router.handle(message('start'), target(appWheel, 'App wheel'))
    await expect(router.handle(message('end'), target(appWheel, 'App wheel'))).resolves.toEqual({
      ok: true,
    })
    expect(calls).toEqual([])
    await router.dispose()
  })

  it('releases held keys on cancel and client close', async () => {
    const { calls, router } = setup()
    const wheel = { control: appWheel, label: 'App wheel', clientId: 'phone-1' }
    await router.handle(message('start'), wheel)
    await router.handle(message('move', 1), wheel)

    await router.cancel('test cancel')
    expect(calls.at(-1)).toEqual([held(['ALT'], 'up')])

    calls.length = 0
    await router.handle(message('start'), wheel)
    await router.handle(message('move', 1), wheel)
    expect(calls[0]).toEqual([held(['ALT'], 'down')])

    router.clientDisconnected('phone-2')
    expect(calls.at(-1)).toEqual([held(['ALT'], 'down')])
    router.clientDisconnected('phone-1')
    expect(calls.at(-1)).toEqual([held(['ALT'], 'up')])
    await router.dispose()
  })

  it('releases held keys when the stuck-key watchdog fires', async () => {
    vi.useFakeTimers()
    const { calls, router } = setup({ watchdogMs: 6_000 })
    await router.handle(message('start'), target(appWheel, 'App wheel'))
    await router.handle(message('move', 1), target(appWheel, 'App wheel'))
    expect(calls).toEqual([[held(['ALT'], 'down')]])

    await vi.advanceTimersByTimeAsync(5_999)
    expect(calls.at(-1)).toEqual([{ type: 'hotkey', keys: ['TAB'] }])
    expect(
      calls.some((batch) => batch[0]?.type === 'hotkey' && batch[0].action === 'up'),
    ).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls.at(-1)).toEqual([held(['ALT'], 'up')])
    await router.dispose()
  })

  it('releases previous hold keys when another control starts a gesture', async () => {
    vi.useFakeTimers()
    const { calls, router } = setup()
    await router.handle(message('start', undefined, 'btn-wheel'), target(appWheel, 'App wheel'))
    await router.handle(message('move', 1, 'btn-wheel'), target(appWheel, 'App wheel'))
    expect(calls).toEqual([[held(['ALT'], 'down')]])

    await router.handle(
      message('start', undefined, 'btn-brush'),
      target(brushSlider, 'Brush size'),
    )
    expect(calls.at(-1)).toEqual([held(['ALT'], 'up')])

    await router.handle(message('move', 5, 'btn-brush'), target(brushSlider, 'Brush size'))
    await vi.advanceTimersByTimeAsync(50)
    await expect(
      router.handle(message('end', undefined, 'btn-brush'), target(brushSlider, 'Brush size')),
    ).resolves.toEqual({ ok: true })

    expect(
      calls.filter(
        (batch) => batch[0]?.type === 'hotkey' && batch[0].action === 'down',
      ),
    ).toHaveLength(1)
    expect(
      calls.filter(
        (batch) => batch[0]?.type === 'hotkey' && batch[0].action === 'up',
      ),
    ).toHaveLength(1)
    expect(calls.at(-1)).toEqual([{ type: 'hotkey', keys: ['['] }])
    await router.dispose()
  })

  it('accumulates slider movement until a whole travelSteps slice', async () => {
    vi.useFakeTimers()
    const { calls, router } = setup()
    const brush = target(brushSlider, 'Brush size')

    await router.handle(message('start'), brush)
    for (let index = 0; index < 4; index += 1) {
      await router.handle(message('move', 1), brush)
    }
    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toEqual([])

    await router.handle(message('move', 1), brush)
    await vi.advanceTimersByTimeAsync(50)
    expect(calls).toEqual([[{ type: 'hotkey', keys: ['['] }]])

    // A sub-slice remainder is dropped when the gesture ends.
    await router.handle(message('move', 2), brush)
    await expect(router.handle(message('end'), brush)).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    await router.dispose()
  })
})

