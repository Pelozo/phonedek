import { describe, expect, it } from 'vitest'
import type { PointerButtonEvent } from '@phonedek/shared'
import {
  PointerSender,
  clampPointerTarget,
  pointerDeltaPixels,
  pointerPlatformSupport,
  pointerTarget,
  type PointerFrame,
  type PointerTransport,
} from '../src/main/pointer-sender'

interface PendingFrame {
  frame: PointerFrame
  resolve: () => void
  reject: (error: Error) => void
}

class ControlledTransport implements PointerTransport {
  readonly frames: PendingFrame[] = []
  disposed = false

  send(frame: PointerFrame): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.frames.push({
        frame: {
          ...frame,
          ...(frame.buttons ? { buttons: frame.buttons.map((event) => ({ ...event })) } : {}),
        },
        resolve,
        reject,
      })
    })
  }

  dispose(): void {
    this.disposed = true
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('pointerDeltaPixels', () => {
  it('converts normalized deltas against the monitor height', () => {
    expect(pointerDeltaPixels(0.5, -0.25, 1000)).toEqual({ x: 500, y: -250 })
    expect(pointerDeltaPixels(0.012, -0.004, 1440)).toEqual({ x: 17, y: -6 })
  })

  it('applies sensitivity and rounds instead of truncating', () => {
    expect(pointerDeltaPixels(0.5, -0.25, 1000, 2)).toEqual({ x: 1000, y: -500 })
    expect(pointerDeltaPixels(0.1, 0.1, 1080, 1.25)).toEqual({ x: 135, y: 135 })
  })

  it('never divides by zero or produces NaN', () => {
    expect(pointerDeltaPixels(1, 1, 0)).toEqual({ x: 1, y: 1 })
    expect(pointerDeltaPixels(Number.NaN, 1, Number.NaN, Number.NaN)).toEqual({ x: 0, y: 1 })
  })
})

describe('clampPointerTarget', () => {
  const desktop = { x: -1920, y: 0, width: 3840, height: 1080 }

  it('clamps to the virtual desktop inclusive bounds', () => {
    expect(clampPointerTarget({ x: -3000, y: 2000 }, desktop)).toEqual({ x: -1920, y: 1079 })
    expect(clampPointerTarget({ x: 3000, y: -100 }, desktop)).toEqual({ x: 1919, y: 0 })
  })

  it('applies a pixel delta to the current cursor first', () => {
    expect(pointerTarget({ x: -1900, y: 500 }, { x: -100, y: 2000 }, desktop)).toEqual({
      x: -1920,
      y: 1079,
    })
    expect(pointerTarget({ x: 100, y: 100 }, { x: 25, y: -50 }, desktop)).toEqual({
      x: 125,
      y: 50,
    })
  })
})

describe('PointerSender coalescing', () => {
  it('drops stale moves, accumulates scroll and keeps buttons while busy', async () => {
    const transport = new ControlledTransport()
    const sender = new PointerSender(transport)

    sender.move(0.1, -0.1)
    expect(transport.frames).toHaveLength(1)
    expect(transport.frames[0]!.frame).toMatchObject({ dx: 0.1, dy: -0.1 })

    sender.move(0.2, 0.2)
    sender.move(0.3, 0.3)
    sender.scroll(0, 2)
    sender.scroll(0.5, 0)
    const buttons: PointerButtonEvent[] = [{ button: 'left', action: 'down' }]
    sender.buttons(buttons)

    expect(transport.frames).toHaveLength(1)

    transport.frames[0]!.resolve()
    await flush()

    expect(transport.frames).toHaveLength(2)
    expect(transport.frames[1]!.frame).toEqual({
      dx: 0.3,
      dy: 0.3,
      scrollX: 0.5,
      scrollY: 2,
      buttons,
    })
    sender.dispose()
  })

  it('never merges away or reorders button transitions', async () => {
    const transport = new ControlledTransport()
    const sender = new PointerSender(transport)

    sender.move(0, 0)
    sender.buttons([{ button: 'left', action: 'down' }])
    sender.move(0.1, 0.1)
    sender.buttons([{ button: 'left', action: 'up' }])

    expect(transport.frames).toHaveLength(1)
    transport.frames[0]!.resolve()
    await flush()

    expect(transport.frames).toHaveLength(2)
    expect(transport.frames[1]!.frame.buttons).toEqual([
      { button: 'left', action: 'down' },
      { button: 'left', action: 'up' },
    ])
    sender.dispose()
  })

  it('sends button-only frames immediately in queue order', () => {
    const transport = new ControlledTransport()
    const sender = new PointerSender(transport)

    sender.buttons([
      { button: 'left', action: 'down' },
      { button: 'left', action: 'up' },
      { button: 'right', action: 'click' },
    ])

    expect(transport.frames).toHaveLength(1)
    expect(transport.frames[0]!.frame.buttons).toEqual([
      { button: 'left', action: 'down' },
      { button: 'left', action: 'up' },
      { button: 'right', action: 'click' },
    ])
    sender.dispose()
  })

  it('survives a failed frame and continues with the next one', async () => {
    const transport = new ControlledTransport()
    const sender = new PointerSender(transport)

    sender.move(0.1, 0.1)
    sender.move(0.2, 0.2)
    transport.frames[0]!.reject(new Error('helper died'))
    await flush()

    expect(transport.frames).toHaveLength(2)
    expect(transport.frames[1]!.frame).toMatchObject({ dx: 0.2, dy: 0.2 })
    sender.dispose()
  })

  it('disposes the transport and ignores later frames', () => {
    const transport = new ControlledTransport()
    const sender = new PointerSender(transport)

    sender.dispose()
    sender.move(0.5, 0.5)
    sender.buttons([{ button: 'left', action: 'down' }])

    expect(transport.disposed).toBe(true)
    expect(transport.frames).toHaveLength(0)
  })
})

describe('pointerPlatformSupport', () => {
  it('supports Windows and macOS', () => {
    expect(pointerPlatformSupport('win32', {})).toEqual({ supported: true })
    expect(pointerPlatformSupport('darwin', {})).toEqual({ supported: true })
  })

  it('supports Linux only on X11', () => {
    expect(pointerPlatformSupport('linux', { DISPLAY: ':0' })).toEqual({ supported: true })
    expect(pointerPlatformSupport('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' })).toEqual({
      supported: true,
    })

    expect(
      pointerPlatformSupport('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }),
    ).toMatchObject({ supported: false, reason: expect.stringMatching(/Wayland/) })
    expect(
      pointerPlatformSupport('linux', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }),
    ).toMatchObject({ supported: false })
    expect(pointerPlatformSupport('linux', {})).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/X11/),
    })
  })

  it('refuses unknown platforms', () => {
    expect(pointerPlatformSupport('aix', {})).toMatchObject({ supported: false })
  })
})
