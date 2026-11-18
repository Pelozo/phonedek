import { describe, expect, it } from 'vitest'
import { MacroRecorder } from '../src/actions'
import type { MacroStep, RawMouseEvent } from '../src/actions'

function click(recorder: MacroRecorder, x: number, y: number, time: number, button: 'left' | 'right' | 'middle' = 'left'): void {
  recorder.record({ kind: 'down', button, x, y, time })
  recorder.record({ kind: 'up', button, x, y, time: time + 20 })
}

describe('MacroRecorder mouse support', () => {
  it('records a click as absolute down/up steps', () => {
    const recorder = new MacroRecorder()
    click(recorder, 120, 240, 0)
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'mouse', button: 'left', action: 'down', x: 120, y: 240 },
      { type: 'mouse', button: 'left', action: 'up', x: 120, y: 240 },
    ])
  })

  it('records double-click pairs with the button preserved', () => {
    const recorder = new MacroRecorder()
    click(recorder, 50, 60, 0, 'right')
    click(recorder, 50, 60, 120, 'right')
    const steps = recorder.finish()
    expect(steps.map((step) => (step.type === 'mouse' ? `${step.action}:${step.button}` : step.type))).toEqual([
      'down:right',
      'up:right',
      'down:right',
      'up:right',
    ])
  })

  it('records drag paths even when movement capture is off', () => {
    const recorder = new MacroRecorder({ captureMouseMove: false })
    recorder.record({ kind: 'down', button: 'left', x: 100, y: 100, time: 0 })
    recorder.record({ kind: 'move', x: 101, y: 100, time: 10 }) // jitter, below 4px
    recorder.record({ kind: 'move', x: 105, y: 100, time: 20 }) // too soon (< 40ms)
    recorder.record({ kind: 'move', x: 110, y: 100, time: 60 })
    recorder.record({ kind: 'move', x: 111, y: 100, time: 80 }) // duplicate jitter
    recorder.record({ kind: 'up', button: 'left', x: 111, y: 100, time: 100 })
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'mouse', button: 'left', action: 'down', x: 100, y: 100 },
      { type: 'mouse', button: 'middle', action: 'move', x: 110, y: 100 },
      { type: 'mouse', button: 'left', action: 'up', x: 111, y: 100 },
    ])
  })

  it('ignores free movement unless captureMouseMove is enabled', () => {
    const off = new MacroRecorder({ captureMouseMove: false })
    off.record({ kind: 'move', x: 10, y: 10, time: 0 })
    off.record({ kind: 'move', x: 40, y: 40, time: 100 })
    expect(off.finish()).toEqual([])

    const on = new MacroRecorder({ captureMouseMove: true })
    on.record({ kind: 'move', x: 10, y: 10, time: 0 })
    on.record({ kind: 'move', x: 11, y: 11, time: 100 }) // below 4px
    on.record({ kind: 'move', x: 40, y: 10, time: 150 })
    expect(on.finish()).toEqual<MacroStep[]>([
      { type: 'mouse', button: 'middle', action: 'move', x: 10, y: 10 },
      { type: 'mouse', button: 'middle', action: 'move', x: 40, y: 10 },
    ])
  })

  it('maps wheel direction and clamps the amount to 1..100', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'wheel', direction: 'up', amount: 2, time: 0 })
    recorder.record({ kind: 'wheel', direction: 'down', amount: 0, rotation: -120, time: 50 })
    recorder.record({ kind: 'wheel', direction: 'left', amount: 1000, time: 100 })
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'mouse', button: 'middle', action: 'scroll', direction: 'up', amount: 2 },
      { type: 'mouse', button: 'middle', action: 'scroll', direction: 'down', amount: 1 },
      { type: 'mouse', button: 'middle', action: 'scroll', direction: 'left', amount: 100 },
    ])
  })

  it('flushes pending text before a mouse action', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 20 })
    recorder.record({ kind: 'down', button: 'left', x: 5, y: 6, time: 80 })
    recorder.record({ kind: 'up', button: 'left', x: 5, y: 6, time: 100 })
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'text', text: 'a' },
      { type: 'mouse', button: 'left', action: 'down', x: 5, y: 6 },
      { type: 'mouse', button: 'left', action: 'up', x: 5, y: 6 },
    ])
  })

  it('inserts a normal delay before a discrete mouse action', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 20 })
    recorder.record({ kind: 'down', button: 'left', x: 5, y: 6, time: 400 })
    recorder.record({ kind: 'up', button: 'left', x: 5, y: 6, time: 450 })
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'text', text: 'a' },
      { type: 'delay', ms: 380 },
      { type: 'mouse', button: 'left', action: 'down', x: 5, y: 6 },
      { type: 'mouse', button: 'left', action: 'up', x: 5, y: 6 },
    ])
  })

  it('emits modifier down/up around a modified click', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'SHIFT', time: 0 })
    recorder.record({ kind: 'down', button: 'left', x: 1, y: 2, time: 50 })
    recorder.record({ kind: 'up', button: 'left', x: 1, y: 2, time: 80 })
    recorder.record({ kind: 'up', key: 'SHIFT', time: 120 })
    expect(recorder.finish()).toEqual<MacroStep[]>([
      { type: 'hotkey', keys: ['SHIFT'], action: 'down' },
      { type: 'mouse', button: 'left', action: 'down', x: 1, y: 2 },
      { type: 'mouse', button: 'left', action: 'up', x: 1, y: 2 },
      { type: 'hotkey', keys: ['SHIFT'], action: 'up' },
    ])
  })

  it('does not press an already exploded modifier twice in a chord', () => {
    const recorder = new MacroRecorder({ coalesceText: false })
    recorder.record({ kind: 'down', key: 'CTRL', time: 0 })
    recorder.record({ kind: 'down', button: 'left', x: 1, y: 2, time: 50 })
    recorder.record({ kind: 'up', button: 'left', x: 1, y: 2, time: 70 })
    recorder.record({ kind: 'down', key: 'C', time: 100 })
    recorder.record({ kind: 'up', key: 'C', time: 120 })
    recorder.record({ kind: 'up', key: 'CTRL', time: 160 })
    const steps = recorder.finish()
    expect(steps[0]).toEqual({ type: 'hotkey', keys: ['CTRL'], action: 'down' })
    expect(steps).toContainEqual({ type: 'hotkey', keys: ['C'] })
    expect(steps.at(-1)).toEqual({ type: 'hotkey', keys: ['CTRL'], action: 'up' })
  })

  it('caps recorded movement and supports undo', () => {
    const recorder = new MacroRecorder({ captureMouseMove: true, maxMouseMoves: 2, mouseMoveMinMs: 0 })
    for (let index = 0; index < 6; index += 1) {
      recorder.record({ kind: 'move', x: index * 10, y: 0, time: index * 50 })
    }
    const moves = recorder.getSteps().filter((step) => step.type === 'mouse' && step.action === 'move')
    expect(moves).toHaveLength(2)
    expect(recorder.undoLast()).toHaveLength(1)
  })

  it('ignores mouse events when captureMouse is off', () => {
    const recorder = new MacroRecorder({ captureMouse: false, captureMouseMove: true })
    const events: RawMouseEvent[] = [
      { kind: 'down', button: 'left', x: 1, y: 2, time: 0 },
      { kind: 'move', x: 10, y: 20, time: 50 },
      { kind: 'up', button: 'left', x: 10, y: 20, time: 80 },
      { kind: 'wheel', direction: 'down', amount: 1, time: 100 },
    ]
    for (const event of events) recorder.record(event)
    expect(recorder.finish()).toEqual([])
  })
})
