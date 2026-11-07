import { describe, expect, it } from 'vitest'
import { actionsToPlan, describeAction, MacroRecorder, pageActions, hasHostActions } from '../src/actions'
import type { Action } from '../src/types'

describe('action plans', () => {
  it('flattens actions in order and expands macros', () => {
    const actions: Action[] = [
      { type: 'hotkey', keys: ['CTRL', 'C'] },
      {
        type: 'macro',
        steps: [
          { type: 'delay', ms: 100 },
          { type: 'text', text: 'hello' },
          { type: 'media', key: 'playpause' },
        ],
      },
      { type: 'url', url: 'https://example.com' },
    ]
    const plan = actionsToPlan(actions)
    expect(plan.map((step) => step.kind)).toEqual(['keys', 'delay', 'text', 'media', 'url'])
    expect(plan[0]).toMatchObject({ keys: ['CTRL', 'C'], holdMs: 35 })
    expect(plan[2]).toMatchObject({ text: 'hello', perCharMs: 4 })
  })

  it('keeps launch, command and page actions as host/page units', () => {
    const plan = actionsToPlan([
      { type: 'launch', path: 'C:\\Windows\\notepad.exe', args: ['a.txt'] },
      { type: 'command', command: 'echo hi' },
      { type: 'page', direction: 'next' },
    ])
    expect(plan[0]).toMatchObject({ kind: 'launch', args: ['a.txt'] })
    expect(plan[1]).toMatchObject({ kind: 'command', hidden: true })
    expect(plan[2]).toMatchObject({ kind: 'page', direction: 'next' })
  })

  it('expands macro repeats and host steps in order', () => {
    const plan = actionsToPlan([
      {
        type: 'macro',
        repeat: 3,
        repeatDelayMs: 25,
        steps: [
          { type: 'hotkey', keys: ['A'], action: 'down' },
          { type: 'delay', ms: 10 },
          { type: 'hotkey', keys: ['A'], action: 'up' },
          { type: 'launch', path: 'C:\\Tools\\app.exe', args: [] },
          { type: 'url', url: 'https://example.com' },
          { type: 'command', command: 'echo hi' },
        ],
      },
    ])
    expect(plan.map((step) => step.kind)).toEqual([
      'keys', 'delay', 'keys', 'launch', 'url', 'command',
      'delay',
      'keys', 'delay', 'keys', 'launch', 'url', 'command',
      'delay',
      'keys', 'delay', 'keys', 'launch', 'url', 'command',
    ])
    expect(plan[0]).toMatchObject({ keys: ['A'], action: 'down' })
    expect(plan[2]).toMatchObject({ keys: ['A'], action: 'up' })
  })

  it('maps extended mouse actions', () => {
    const plan = actionsToPlan([
      {
        type: 'macro',
        steps: [
          { type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 3 },
          { type: 'mouse', button: 'right', action: 'doubleclick' },
          { type: 'mouse', button: 'left', action: 'move', x: 10, y: 20 },
        ],
      },
    ])
    expect(plan[0]).toMatchObject({ kind: 'mouse', action: 'scroll', direction: 'up', amount: 3 })
    expect(plan[1]).toMatchObject({ kind: 'mouse', action: 'doubleclick' })
    expect(plan[2]).toMatchObject({ kind: 'mouse', action: 'move', x: 10, y: 20 })
  })

  it('separates page actions', () => {
    const actions: Action[] = [
      { type: 'hotkey', keys: ['WIN', 'D'] },
      { type: 'page', direction: 'goto', pageId: 'page-media' },
    ]
    expect(pageActions(actions)).toHaveLength(1)
    expect(hasHostActions(actions)).toBe(true)
    expect(hasHostActions([{ type: 'page', direction: 'next' }])).toBe(false)
  })

  it('describes hotkeys with platform-aware labels', () => {
    const screenshot: Action = { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }
    expect(describeAction(screenshot, 'darwin')).toBe('Cmd + Shift + S')
    expect(describeAction(screenshot, 'win32')).toBe('Win + Shift + S')
    expect(describeAction(screenshot)).toBe('Win + Shift + S')
    expect(describeAction(screenshot, 'linux')).toBe('Win + Shift + S')

    const formatMac: Action = { type: 'hotkey', keys: ['SHIFT', 'ALT', 'F'] }
    expect(describeAction(formatMac, 'darwin')).toBe('Shift + Option + F')
    expect(describeAction(formatMac, 'win32')).toBe('Shift + Alt + F')

    // Non-hotkey descriptions are unchanged.
    expect(describeAction({ type: 'delay', ms: 250 }, 'darwin')).toBe('Wait 250 ms')
    expect(describeAction({ type: 'media', key: 'playpause' }, 'darwin')).toBe('Media: playpause')
  })
})

describe('macro recorder', () => {
  it('coalesces typing into text', () => {
    const recorder = new MacroRecorder()
    let t = 1000
    for (const key of ['H', 'E', 'L', 'L', 'O']) {
      recorder.record({ kind: 'down', key, time: t })
      t += 20
      recorder.record({ kind: 'up', key, time: t })
      t += 30
    }
    expect(recorder.finish()).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('records chords regardless of release order', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'CTRL', time: 0 })
    recorder.record({ kind: 'down', key: 'C', time: 20 })
    recorder.record({ kind: 'up', key: 'CTRL', time: 60 })
    recorder.record({ kind: 'up', key: 'C', time: 90 })
    expect(recorder.finish()).toEqual([{ type: 'hotkey', keys: ['CTRL', 'C'] }])
  })

  it('records a pause as a bounded delay', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 20 })
    recorder.record({ kind: 'down', key: 'B', time: 720 })
    recorder.record({ kind: 'up', key: 'B', time: 740 })
    const steps = recorder.finish()
    expect(steps[0]).toEqual({ type: 'text', text: 'a' })
    expect(steps[1]).toEqual({ type: 'delay', ms: 700 })
    expect(steps[2]).toEqual({ type: 'text', text: 'b' })
  })

  it('records space and enter as text', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 10 })
    recorder.record({ kind: 'down', key: 'SPACE', time: 20 })
    recorder.record({ kind: 'up', key: 'SPACE', time: 30 })
    recorder.record({ kind: 'down', key: 'B', time: 40 })
    recorder.record({ kind: 'up', key: 'B', time: 50 })
    recorder.record({ kind: 'down', key: 'ENTER', time: 60 })
    recorder.record({ kind: 'up', key: 'ENTER', time: 70 })
    expect(recorder.finish()).toEqual([{ type: 'text', text: 'a b\n' }])
  })

  it('can skip delays and text coalescing', () => {
    const recorder = new MacroRecorder({ captureDelays: false, coalesceText: false })
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 20 })
    recorder.record({ kind: 'down', key: 'B', time: 900 })
    recorder.record({ kind: 'up', key: 'B', time: 920 })
    expect(recorder.finish()).toEqual([
      { type: 'hotkey', keys: ['A'] },
      { type: 'hotkey', keys: ['B'] },
    ])
  })

  it('supports pause/resume and undo', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'A', time: 0 })
    recorder.record({ kind: 'up', key: 'A', time: 20 })
    recorder.pause(30)
    recorder.record({ kind: 'down', key: 'B', time: 40 })
    recorder.record({ kind: 'up', key: 'B', time: 60 })
    expect(recorder.getSteps()).toEqual([{ type: 'text', text: 'a' }])
    recorder.resume(100)
    recorder.record({ kind: 'down', key: 'C', time: 120 })
    recorder.record({ kind: 'up', key: 'C', time: 140 })
    expect(recorder.undoLast()).toEqual([{ type: 'text', text: 'a' }])
    recorder.record({ kind: 'down', key: 'D', time: 160 })
    recorder.record({ kind: 'up', key: 'D', time: 180 })
    expect(recorder.finish()).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'd' }])
  })

  it('ignores modifier-only presses', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'SHIFT', time: 0 })
    recorder.record({ kind: 'up', key: 'SHIFT', time: 40 })
    expect(recorder.finish()).toEqual([])
  })
})
