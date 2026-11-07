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

let counter = 0

function message(
  phase: InputMessage['phase'],
  delta?: number,
  controlId = 'btn-vol',
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
})
