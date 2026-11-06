import { describe, expect, it } from 'vitest'
import { actionsToPlan, MacroRecorder, pageActions, hasHostActions } from '../src/actions'
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

  it('separates page actions', () => {
    const actions: Action[] = [
      { type: 'hotkey', keys: ['WIN', 'D'] },
      { type: 'page', direction: 'goto', pageId: 'page-media' },
    ]
    expect(pageActions(actions)).toHaveLength(1)
    expect(hasHostActions(actions)).toBe(true)
    expect(hasHostActions([{ type: 'page', direction: 'next' }])).toBe(false)
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

  it('ignores modifier-only presses', () => {
    const recorder = new MacroRecorder()
    recorder.record({ kind: 'down', key: 'SHIFT', time: 0 })
    recorder.record({ kind: 'up', key: 'SHIFT', time: 40 })
    expect(recorder.finish()).toEqual([])
  })
})
