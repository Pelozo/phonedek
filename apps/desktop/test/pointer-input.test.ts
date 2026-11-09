import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PointerButtonEvent,
  PointerMessage,
  PointerResult,
} from '@phonedek/shared'
import { PointerRouter, pointerInputAllowed, type PointerTarget } from '../src/main/pointer-input'
import type { PointerSenderLike } from '../src/main/pointer-sender'

const target: PointerTarget = {
  control: { kind: 'trackpad', emit: 'delta', binding: { type: 'pointer' } },
  label: 'Pad',
}

type MovePhase = 'move' | 'end'

interface SenderEvent {
  kind: 'move' | 'scroll' | 'buttons'
  dx?: number
  dy?: number
  scrollX?: number
  scrollY?: number
  buttons?: PointerButtonEvent[]
}

class FakeSender implements PointerSenderLike {
  readonly events: SenderEvent[] = []
  readonly moves: Array<{ dx?: number; dy?: number }> = []
  readonly scrolls: Array<{ scrollX?: number; scrollY?: number }> = []
  readonly buttonBatches: PointerButtonEvent[][] = []
  disposed = false

  move(dx?: number, dy?: number): void {
    this.moves.push({ dx, dy })
    this.events.push({ kind: 'move', dx, dy })
  }

  scroll(scrollX?: number, scrollY?: number): void {
    this.scrolls.push({ scrollX, scrollY })
    this.events.push({ kind: 'scroll', scrollX, scrollY })
  }

  buttons(events: PointerButtonEvent[]): void {
    const copy = events.map((event) => ({ ...event }))
    this.buttonBatches.push(copy)
    this.events.push({ kind: 'buttons', buttons: copy })
  }

  dispose(): void {
    this.disposed = true
  }

  allButtons(): PointerButtonEvent[] {
    return this.buttonBatches.flat()
  }

  ups(): string[] {
    return this.allButtons()
      .filter((event) => event.action === 'up')
      .map((event) => event.button)
  }
}

let counter = 0

function nextSeq(): number {
  counter += 1
  return counter
}

function start(seq = nextSeq()): PointerMessage {
  return {
    type: 'pointer',
    seq,
    phase: 'start',
    profileId: 'profile-desktop',
    pageId: 'page-main',
    controlId: 'btn-pad',
  }
}

function move(
  seq = nextSeq(),
  fields: {
    dx?: number
    dy?: number
    scrollX?: number
    scrollY?: number
    buttons?: PointerButtonEvent[]
    phase?: MovePhase
  } = {},
): PointerMessage {
  return {
    type: 'pointer',
    seq,
    phase: fields.phase ?? 'move',
    ...(fields.dx === undefined ? {} : { dx: fields.dx }),
    ...(fields.dy === undefined ? {} : { dy: fields.dy }),
    ...(fields.scrollX === undefined ? {} : { scrollX: fields.scrollX }),
    ...(fields.scrollY === undefined ? {} : { scrollY: fields.scrollY }),
    ...(fields.buttons === undefined ? {} : { buttons: fields.buttons }),
  }
}

function cancel(seq = nextSeq()): PointerMessage {
  return { type: 'pointer', seq, phase: 'cancel' }
}

function expectOk(result: PointerResult): void {
  expect(result.ok).toBe(true)
}

afterEach(() => {
  vi.useRealTimers()
  counter = 0
})

describe('PointerRouter sequencing', () => {
  it('ignores stale and duplicate sequence numbers', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    expectOk(router.handle('phone-a', start(10), target))
    expectOk(router.handle('phone-a', move(12, { dx: 0.1 }), target))
    expectOk(router.handle('phone-a', move(11, { dx: 0.9 }), target))
    expectOk(router.handle('phone-a', move(12, { dx: 0.9 }), target))
    expectOk(router.handle('phone-a', move(13, { dx: 0.2 }), target))

    expect(sender.moves).toEqual([
      { dx: 0.1, dy: undefined },
      { dx: 0.2, dy: undefined },
    ])
    router.dispose()
  })

  it('rejects movement before start and movement from a non-owner', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    expect(router.handle('phone-a', move(1, { dx: 0.1 }))).toMatchObject({ ok: false })
    expectOk(router.handle('phone-a', start(2), target))
    expect(router.handle('phone-b', move(1, { dx: 0.1 }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Another phone/),
    })
    expect(sender.moves).toHaveLength(0)
    router.dispose()
  })
})

describe('PointerRouter movement', () => {
  it('defensively clamps ±2 deltas and keeps fractional values', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle('phone-a', move(nextSeq(), { dx: 5, dy: -7 }), target)
    router.handle('phone-a', move(nextSeq(), { dx: -0.5, dy: 0.25 }), target)

    expect(sender.moves).toEqual([
      { dx: 2, dy: -2 },
      { dx: -0.5, dy: 0.25 },
    ])
    router.dispose()
  })

  it('applies the trackpad sensitivity gain once per gesture', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })
    const sensitive: PointerTarget = {
      control: {
        kind: 'trackpad',
        emit: 'delta',
        binding: { type: 'pointer', sensitivity: 1.5 },
      },
      label: 'Pad',
    }

    router.handle('phone-a', start(), sensitive)
    router.handle('phone-a', move(nextSeq(), { dx: 0.2, dy: -0.4 }), sensitive)
    expect(sender.moves).toHaveLength(1)
    expect(sender.moves[0]!.dx).toBeCloseTo(0.3)
    expect(sender.moves[0]!.dy).toBeCloseTo(-0.6)
    router.dispose()
  })

  it('keeps a fractional scroll residual instead of rounding slow scrolls away', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle('phone-a', move(nextSeq(), { scrollY: 0.75 }), target)
    expect(sender.scrolls).toEqual([])

    router.handle('phone-a', move(nextSeq(), { scrollY: 0.5 }), target)
    router.handle('phone-a', move(nextSeq(), { scrollY: 0.75 }), target)
    router.handle('phone-a', move(nextSeq(), { scrollY: -0.2 }), target)

    expect(sender.scrolls).toEqual([
      { scrollX: 0, scrollY: 1 },
      { scrollX: 0, scrollY: 1 },
    ])
    router.dispose()
  })

  it('keeps button transitions in order after movement', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle(
      'phone-a',
      move(nextSeq(), { dx: 0.1, buttons: [{ button: 'left', action: 'down' }] }),
      target,
    )
    router.handle(
      'phone-a',
      move(nextSeq(), {
        dy: 0.2,
        buttons: [
          { button: 'left', action: 'up' },
          { button: 'right', action: 'click' },
        ],
      }),
      target,
    )

    expect(sender.events.map((event) => event.kind)).toEqual([
      'move',
      'buttons',
      'move',
      'buttons',
    ])
    expect(sender.buttonBatches).toEqual([
      [{ button: 'left', action: 'down' }],
      [
        { button: 'left', action: 'up' },
        { button: 'right', action: 'click' },
      ],
    ])
    router.dispose()
  })
})

describe('PointerRouter button lifecycle', () => {
  it('does not release held buttons on start or end', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle(
      'phone-a',
      move(nextSeq(), { buttons: [{ button: 'left', action: 'down' }] }),
      target,
    )
    router.handle('phone-a', move(nextSeq(), { dx: 0.1, phase: 'end' }), target)
    router.handle('phone-a', start(), target)

    expect(sender.ups()).toEqual([])
    router.dispose()
    expect(sender.ups()).toEqual(['left'])
  })

  it('releases every held button on cancel', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle(
      'phone-a',
      move(nextSeq(), {
        buttons: [
          { button: 'left', action: 'down' },
          { button: 'right', action: 'down' },
          { button: 'middle', action: 'down' },
        ],
      }),
      target,
    )
    expectOk(router.handle('phone-a', cancel(), target))

    expect(new Set(sender.ups())).toEqual(new Set(['left', 'right', 'middle']))
    expect(sender.disposed).toBe(false)
    router.dispose()
  })

  it('releases held buttons when the WebSocket closes', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(), target)
    router.handle(
      'phone-a',
      move(nextSeq(), { buttons: [{ button: 'right', action: 'down' }] }),
      target,
    )
    router.clientDisconnected('phone-a')

    expect(sender.ups()).toEqual(['right'])
    expect(router.activeClient).toBeNull()
    router.dispose()
  })

  it('releases the previous client and ignores its moves after preemption', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(1), target)
    router.handle(
      'phone-a',
      move(2, { buttons: [{ button: 'left', action: 'down' }] }),
      target,
    )
    expect(() => router.handle('phone-b', start(1), target)).not.toThrow()

    expect(sender.ups()).toEqual(['left'])
    expect(router.activeClient).toBe('phone-b')
    expect(router.handle('phone-a', move(3, { dx: 0.5 }), target)).toMatchObject({ ok: false })
    expectOk(router.handle('phone-b', move(2, { dx: 0.5 }), target))
    expect(sender.moves).toEqual([{ dx: 0.5, dy: undefined }])
    router.dispose()
  })

  it('releases after 6 s of silence but is kept alive by zero-delta frames', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const sender = new FakeSender()
    const router = new PointerRouter({ sender, watchdogMs: 6_000 })

    router.handle('phone-a', start(1), target)
    router.handle(
      'phone-a',
      move(2, { buttons: [{ button: 'left', action: 'down' }] }),
      target,
    )

    vi.advanceTimersByTime(4_000)
    router.handle('phone-a', move(3, { dx: 0, dy: 0 }), target)
    vi.advanceTimersByTime(5_000)
    expect(sender.ups()).toEqual([])

    vi.advanceTimersByTime(1_000)
    expect(sender.ups()).toEqual(['left'])
    router.dispose()
  })
})

describe('pointerInputAllowed gate', () => {
  it('requires the master switch and no native dialog', () => {
    expect(pointerInputAllowed(true, false)).toBe(true)
    expect(pointerInputAllowed(false, false)).toBe(false)
    expect(pointerInputAllowed(true, true)).toBe(false)
    expect(pointerInputAllowed(false, true)).toBe(false)
  })
})

describe('PointerRouter rate limit and blocked gate', () => {
  it('limits moves but lets end and cancel through', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender, rateLimit: 3 })

    expectOk(router.handle('phone-a', start(1), target))
    expectOk(router.handle('phone-a', move(2, { dx: 0.1 }), target))
    expectOk(router.handle('phone-a', move(3, { dx: 0.1 }), target))
    expect(router.handle('phone-a', move(4, { dx: 0.1 }), target)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Too many pointer events/),
    })
    expectOk(router.handle('phone-a', move(5, { phase: 'end' }), target))
    expectOk(router.handle('phone-a', cancel(6), target))
    router.dispose()
  })

  it('releases buttons and rejects input while a native dialog is open', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })

    router.handle('phone-a', start(1), target)
    router.handle(
      'phone-a',
      move(2, { buttons: [{ button: 'left', action: 'down' }] }),
      target,
    )

    router.setBlocked(true)
    expect(sender.ups()).toEqual(['left'])
    expect(router.isBlocked).toBe(true)
    expect(router.handle('phone-a', move(3, { dx: 0.2 }), target)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/suspended/),
    })
    expectOk(router.handle('phone-a', cancel(4), target))

    router.setBlocked(false)
    expectOk(router.handle('phone-a', start(5), target))
    expectOk(router.handle('phone-a', move(6, { dx: 0.2 }), target))
    router.dispose()
  })

  it('rejects start while blocked', () => {
    const sender = new FakeSender()
    const router = new PointerRouter({ sender })
    router.setBlocked(true)
    expect(router.handle('phone-a', start(1), target)).toMatchObject({ ok: false })
    expect(router.activeClient).toBeNull()
    router.dispose()
  })
})
