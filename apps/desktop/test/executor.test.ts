import { describe, expect, it } from 'vitest'
import type { Action, KeyboardPlanStep } from '@phonedek/shared'
import { ActionExecutor } from '../src/main/executor'
import type { HostActions } from '../src/main/host-actions'
import type { KeySender } from '../src/main/key-sender'

function fakeKeys(log: string[]): KeySender {
  return {
    async send(step: KeyboardPlanStep) {
      if (step.kind === 'keys') log.push(`keys:${step.keys.join('+')}`)
      else if (step.kind === 'text') log.push(`text:${step.text}`)
      else if (step.kind === 'delay') log.push(`delay:${step.ms}`)
      else if (step.kind === 'media') log.push(`media:${step.key}`)
      else log.push(`mouse:${step.button}:${step.action}`)
      if (step.kind === 'text' && step.text === 'boom') throw new Error('key sender exploded')
    },
  }
}

function fakeHost(log: string[]): HostActions {
  return {
    async launch(path, args) {
      log.push(`launch:${path}:${args.join(',')}`)
    },
    async openUrl(url) {
      log.push(`url:${url}`)
    },
    async runCommand(command) {
      log.push(`command:${command}`)
    },
    async screenshot() {
      log.push('screenshot')
    },
  }
}

describe('ActionExecutor', () => {
  it('executes actions in order and ignores page actions', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const actions: Action[] = [
      { type: 'hotkey', keys: ['CTRL', 'C'] },
      { type: 'page', direction: 'next' },
      { type: 'macro', steps: [{ type: 'delay', ms: 50 }, { type: 'text', text: 'hello' }] },
      { type: 'launch', path: 'notepad.exe', args: ['a.txt'] },
      { type: 'url', url: 'https://example.com' },
      { type: 'command', command: 'echo hi', hidden: true },
      { type: 'media', key: 'playpause' },
    ]
    await expect(executor.execute(actions, 'test')).resolves.toEqual({ ok: true })
    expect(log).toEqual([
      'keys:CTRL+C',
      'delay:50',
      'text:hello',
      'launch:notepad.exe:a.txt',
      'url:https://example.com',
      'command:echo hi',
      'media:playpause',
    ])
  })

  it('returns a useful error and keeps the queue alive', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const failed = await executor.execute([{ type: 'text', text: 'boom' }], 'bad')
    expect(failed.ok).toBe(false)
    expect(failed.error).toMatch(/exploded/)

    const after = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'D'] }], 'good')
    expect(after.ok).toBe(true)
    expect(log).toContain('keys:WIN+D')
  })

  it('treats a button without actions as a successful no-op', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    await expect(executor.execute([], 'empty')).resolves.toEqual({ ok: true })
    expect(log).toEqual([])
  })

  it('captures the full screen on macOS for the Win+Shift+S intent', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, { platform: 'darwin' })
    await expect(
      executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot'),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['screenshot'])
  })

  it('replaces the intent inside a macro on macOS', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, { platform: 'darwin' })
    await executor.execute(
      [
        { type: 'macro', steps: [{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }, { type: 'delay', ms: 10 }] },
      ],
      'macro shot',
    )
    expect(log).toEqual(['screenshot', 'delay:10'])
  })

  it('still sends Win+Shift+S on Windows', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, { platform: 'win32' })
    await expect(
      executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot'),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['keys:SHIFT+WIN+S'])
  })

  it('does not remap other chords on macOS', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, { platform: 'darwin' })
    await executor.execute([{ type: 'hotkey', keys: ['CTRL', 'SHIFT', 'S'] }], 'save as')
    expect(log).toEqual(['keys:CTRL+SHIFT+S'])
  })

  it('returns a useful error when the macOS capture fails and keeps the queue alive', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async screenshot() {
        throw new Error('screencapture exited with 1: Screen Recording permission denied')
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host, undefined, { platform: 'darwin' })
    const failed = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot')
    expect(failed.ok).toBe(false)
    expect(failed.error).toMatch(/permission denied/)

    const after = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'D'] }], 'good')
    expect(after.ok).toBe(true)
    expect(log).toContain('keys:WIN+D')
  })

  it('serializes overlapping presses', async () => {
    const log: string[] = []
    let resolveFirst: (() => void) | null = null
    const gates: Array<Promise<void>> = []
    const keys: KeySender = {
      async send(step) {
        if (step.kind === 'keys') {
          log.push(`start:${step.keys.join('+')}`)
          if (step.keys[0] === 'A') {
            await new Promise<void>((resolve) => {
              resolveFirst = resolve
              gates.push(Promise.resolve())
            })
          }
          log.push(`end:${step.keys.join('+')}`)
        }
      },
    }
    const executor = new ActionExecutor(keys, fakeHost(log))
    const first = executor.execute([{ type: 'hotkey', keys: ['A'] }], 'one')
    const second = executor.execute([{ type: 'hotkey', keys: ['B'] }], 'two')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual(['start:A'])
    if (resolveFirst) (resolveFirst as () => void)()
    await first
    await second
    expect(log).toEqual(['start:A', 'end:A', 'start:B', 'end:B'])
  })
})
