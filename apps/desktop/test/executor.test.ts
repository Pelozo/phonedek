import { describe, expect, it } from 'vitest'
import type { Action, KeyboardPlanStep, ObsPlanStep, PlanGroup } from '@phonedek/shared'
import { ActionExecutor, type PlanProgress } from '../src/main/executor'
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

const SCREENSHOT_PATH = '/Users/ada/Desktop/PhoneDeck Screenshot 2026-11-07 at 12.34.56.png'
const SCREENSHOT_BASENAME = 'PhoneDeck Screenshot 2026-11-07 at 12.34.56.png'

function fakeHost(log: string[], screenshotPaths: string[] = [SCREENSHOT_PATH]): HostActions {
  let nextScreenshot = 0
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
      const path = screenshotPaths[Math.min(nextScreenshot, screenshotPaths.length - 1)] ?? SCREENSHOT_PATH
      nextScreenshot += 1
      log.push('screenshot')
      return path
    },
    async setVolume(level) {
      log.push(`volume:${level}`)
    },
    async setInputGain(level) {
      log.push(`input-gain:${level}`)
    },
    async toggleInputMute() {
      log.push('input-mute')
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

  it('releases modifier keys when a macro step fails', async () => {
    const log: string[] = []
    const keys: KeySender = {
      async send(step) {
        if (step.kind === 'keys') {
          log.push(`keys:${step.action}:${step.keys.join('+')}`)
          return
        }
        if (step.kind === 'mouse') throw new Error('wheel dispatch failed')
      },
    }
    const executor = new ActionExecutor(keys, fakeHost(log))
    const actions: Action[] = [
      {
        type: 'macro',
        steps: [
          { type: 'hotkey', keys: ['CTRL'], action: 'down' },
          { type: 'mouse', button: 'left', action: 'scroll', direction: 'up', amount: 2 },
          { type: 'hotkey', keys: ['CTRL'], action: 'up' },
        ],
      },
    ]
    const result = await executor.execute(actions, 'zoom')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/wheel dispatch failed/)
    expect(log).toEqual(['keys:down:CTRL', 'keys:up:CTRL'])
  })

  it('treats a button without actions as a successful no-op', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    await expect(executor.execute([], 'empty')).resolves.toEqual({ ok: true })
    expect(log).toEqual([])
  })

  it('captures the full screen on macOS and reports the saved file', async () => {
    const log: string[] = []
    const screenshots: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, {
      platform: 'darwin',
      onScreenshot: (path) => screenshots.push(path),
    })
    await expect(
      executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot'),
    ).resolves.toEqual({
      ok: true,
      message: `Screenshot saved to Desktop: ${SCREENSHOT_BASENAME}`,
    })
    expect(log).toEqual(['screenshot'])
    expect(screenshots).toEqual([SCREENSHOT_PATH])
  })

  it('reports multiple screenshots without exposing the home path', async () => {
    const log: string[] = []
    const paths = ['/Users/ada/Desktop/first.png', '/Users/ada/Desktop/second.png']
    const screenshots: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log, paths), undefined, {
      platform: 'darwin',
      onScreenshot: (path) => screenshots.push(path),
    })
    const result = await executor.execute(
      [
        { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] },
        { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] },
      ],
      'shots',
    )
    expect(result).toEqual({ ok: true, message: '2 screenshots saved to Desktop' })
    expect(result.message).not.toContain('/Users/ada')
    expect(screenshots).toEqual(paths)
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

  it('captures the full screen directly on Windows', async () => {
    const log: string[] = []
    const screenshots: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, {
      platform: 'win32',
      onScreenshot: (path) => screenshots.push(path),
    })
    await expect(
      executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot'),
    ).resolves.toEqual({
      ok: true,
      message: `Screenshot saved to Desktop: ${SCREENSHOT_BASENAME}`,
    })
    expect(log).toEqual(['screenshot'])
    expect(screenshots).toEqual([SCREENSHOT_PATH])
  })

  it('does not remap other chords on macOS', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, { platform: 'darwin' })
    await executor.execute([{ type: 'hotkey', keys: ['CTRL', 'SHIFT', 'S'] }], 'save as')
    expect(log).toEqual(['keys:CTRL+SHIFT+S'])
  })

  it('returns a useful error when the macOS capture fails and keeps the queue alive', async () => {
    const log: string[] = []
    const screenshots: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async screenshot() {
        throw new Error('screencapture exited with 1: Screen Recording permission denied')
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host, undefined, {
      platform: 'darwin',
      onScreenshot: (path) => screenshots.push(path),
    })
    const failed = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] }], 'shot')
    expect(failed.ok).toBe(false)
    expect(failed.error).toMatch(/permission denied/)
    expect(screenshots).toEqual([])

    const after = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'D'] }], 'good')
    expect(after.ok).toBe(true)
    expect(log).toContain('keys:WIN+D')
  })

  it('sets absolute volume through the executor queue', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    await expect(executor.executeVolume(42.6, 'volume')).resolves.toEqual({ ok: true })
    expect(log).toEqual(['volume:43'])

    await expect(executor.executeVolume(Number.NaN, 'volume')).resolves.toEqual({
      ok: false,
      error: 'Volume level must be a finite number',
    })
  })

  it('returns a useful volume error and keeps the queue alive', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async setVolume() {
        throw new Error('Could not set system volume with pactl')
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)
    const failed = await executor.executeVolume(40, 'volume')
    expect(failed).toEqual({ ok: false, error: 'Could not set system volume with pactl' })

    const after = await executor.execute([{ type: 'hotkey', keys: ['WIN', 'D'] }], 'good')
    expect(after.ok).toBe(true)
  })

  it('serializes volume with overlapping presses', async () => {
    const log: string[] = []
    let release: (() => void) | null = null
    const keys: KeySender = {
      async send(step) {
        if (step.kind === 'keys' && step.keys[0] === 'A') {
          log.push('start:A')
          await new Promise<void>((resolve) => {
            release = resolve
          })
          log.push('end:A')
        }
      },
    }
    const executor = new ActionExecutor(keys, fakeHost(log))
    const first = executor.execute([{ type: 'hotkey', keys: ['A'] }], 'one')
    const volume = executor.executeVolume(30, 'volume')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual(['start:A'])
    if (release) (release as () => void)()
    await first
    await volume
    expect(log).toEqual(['start:A', 'end:A', 'volume:30'])
  })

  it('routes mic actions and gain through the host queue', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))

    await expect(
      executor.execute([{ type: 'mic', action: 'toggleMute' }], 'mic'),
    ).resolves.toEqual({ ok: true })
    await expect(executor.executeInputGain(42.6, 'mic gain')).resolves.toEqual({ ok: true })
    await expect(executor.executeInputMute('mic mute')).resolves.toEqual({ ok: true })
    expect(log).toEqual(['input-mute', 'input-gain:43', 'input-mute'])

    await expect(executor.executeInputGain(Number.NaN, 'bad')).resolves.toEqual({
      ok: false,
      error: 'Microphone gain must be a finite number',
    })
  })

  it('returns a useful mic error and keeps the queue alive', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async setInputGain() {
        throw new Error('Could not set microphone gain with pactl')
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)
    await expect(executor.executeInputGain(40, 'mic')).resolves.toEqual({
      ok: false,
      error: 'Could not set microphone gain with pactl',
    })
    await expect(executor.execute([{ type: 'hotkey', keys: ['WIN', 'D'] }], 'good')).resolves.toEqual({
      ok: true,
    })
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

describe('ActionExecutor OBS mute', () => {
  it('executes an OBS toggleMute plan step through the host hook', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async toggleObsInputMute(input?: string) {
        log.push(`obs-mute:${input ?? '(auto)'}`)
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)
    await expect(
      executor.execute(
        [
          { type: 'obs', action: 'toggleMute', input: 'Mic/Aux' },
          { type: 'delay', ms: 5 },
          { type: 'obs', action: 'toggleMute' },
        ],
        'obs',
      ),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['obs-mute:Mic/Aux', 'delay:5', 'obs-mute:(auto)'])
  })

  it('returns a clear error when OBS is not wired', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const result = await executor.execute([{ type: 'obs', action: 'toggleMute' }], 'obs')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/OBS is not available on this desktop/)
  })
})

describe('ActionExecutor OBS plan steps', () => {
  it('routes every OBS action to runObsAction when it is available', async () => {
    const log: string[] = []
    const steps: ObsPlanStep[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async runObsAction(step) {
        steps.push(step)
      },
      async toggleObsInputMute(input?: string) {
        log.push(`legacy-mute:${input ?? '(auto)'}`)
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)

    await expect(
      executor.execute(
        [
          { type: 'obs', action: 'setScene', scene: 'Gaming' },
          { type: 'obs', action: 'startStream' },
          { type: 'obs', action: 'saveReplay' },
          { type: 'obs', action: 'toggleSourceVisibility', source: 'Webcam' },
          {
            type: 'obs',
            action: 'setSourceVisibility',
            scene: 'Main',
            source: 'Webcam',
            visible: false,
          },
          { type: 'obs', action: 'addMarker', name: 'Boss' },
          { type: 'obs', action: 'toggleMute', input: 'Mic/Aux' },
        ],
        'obs',
      ),
    ).resolves.toEqual({ ok: true })

    expect(steps).toEqual([
      { kind: 'obs', action: 'setScene', scene: 'Gaming' },
      { kind: 'obs', action: 'startStream' },
      { kind: 'obs', action: 'saveReplay' },
      { kind: 'obs', action: 'toggleSourceVisibility', source: 'Webcam' },
      { kind: 'obs', action: 'setSourceVisibility', scene: 'Main', source: 'Webcam', visible: false },
      { kind: 'obs', action: 'addMarker', name: 'Boss' },
      { kind: 'obs', action: 'toggleMute', input: 'Mic/Aux' },
    ])
    expect(log).toEqual([])
  })

  it('falls back to toggleObsInputMute for legacy mute-only hosts', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async toggleObsInputMute(input?: string) {
        log.push(`legacy-mute:${input ?? '(auto)'}`)
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)

    await expect(
      executor.execute(
        [
          { type: 'obs', action: 'toggleMute', input: 'Mic/Aux' },
          { type: 'obs', action: 'toggleMute' },
        ],
        'obs',
      ),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['legacy-mute:Mic/Aux', 'legacy-mute:(auto)'])

    const unsupported = await executor.execute([{ type: 'obs', action: 'startStream' }], 'obs')
    expect(unsupported).toEqual({ ok: false, error: 'OBS is not available on this desktop.' })
    expect(log).toEqual(['legacy-mute:Mic/Aux', 'legacy-mute:(auto)'])
  })

  it('returns a useful error when an OBS action fails and keeps the queue alive', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async runObsAction(step) {
        if (step.action === 'setScene') throw new Error('OBS scene "Nope" was not found')
        log.push(`obs:${step.action}`)
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)

    await expect(
      executor.execute([{ type: 'obs', action: 'setScene', scene: 'Nope' }], 'obs'),
    ).resolves.toEqual({ ok: false, error: 'OBS scene "Nope" was not found' })

    await expect(
      executor.execute(
        [
          { type: 'obs', action: 'startStream' },
          { type: 'hotkey', keys: ['WIN', 'D'] },
        ],
        'after',
      ),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['obs:startStream', 'keys:WIN+D'])
  })
})

describe('ActionExecutor executePlan', () => {
  const stepText = (text: string) => ({ kind: 'text', text, perCharMs: 0 }) as const
  const stepKeys = (keys: string[]) => ({ kind: 'keys', keys, holdMs: 0, action: 'press' }) as const

  it('runs groups in order and emits 1-based progress', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const progress: PlanProgress[] = []
    const groups: PlanGroup[] = [
      { label: 'first', steps: [stepText('one')], delayMs: 2 },
      { label: 'second', steps: [stepKeys(['A'])] },
    ]
    const result = await executor.executePlan(groups, 'rig', {
      onProgress: (entry) => progress.push(entry),
    })

    expect(result).toEqual({
      ok: true,
      completed: 2,
      total: 2,
      failures: [],
      cancelled: false,
      timedOut: false,
      stoppedOnFailure: false,
    })
    expect(log).toEqual(['text:one', 'keys:A'])
    expect(progress).toEqual([
      { index: 1, total: 2, label: 'first', ok: true },
      { index: 2, total: 2, label: 'second', ok: true },
    ])
  })

  it('holds one queue slot for the whole rig', async () => {
    const log: string[] = []
    let release: (() => void) | null = null
    const keys: KeySender = {
      async send(step) {
        if (step.kind !== 'keys') return
        log.push(`start:${step.keys.join('+')}`)
        if (step.keys[0] === 'A') {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        log.push(`end:${step.keys.join('+')}`)
      },
    }
    const executor = new ActionExecutor(keys, fakeHost(log))
    const rig = executor.executePlan(
      [
        { label: 'a', steps: [stepKeys(['A'])] },
        { label: 'b', steps: [stepKeys(['B'])] },
      ],
      'rig',
    )
    const press = executor.execute([{ type: 'hotkey', keys: ['C'] }], 'press')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(log).toEqual(['start:A'])
    if (release) (release as () => void)()
    await rig
    await press
    expect(log).toEqual(['start:A', 'end:A', 'start:B', 'end:B', 'start:C', 'end:C'])
  })

  it('stops on the first failed group by default', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const progress: PlanProgress[] = []
    const result = await executor.executePlan(
      [
        { label: 'ok', steps: [stepText('one')] },
        { label: 'bad', steps: [stepText('boom')] },
        { label: 'after', steps: [stepText('three')] },
      ],
      'rig',
      { onProgress: (entry) => progress.push(entry) },
    )

    expect(result.ok).toBe(false)
    expect(result.completed).toBe(1)
    expect(result.total).toBe(3)
    expect(result.failures).toEqual([{ index: 2, label: 'bad', error: 'key sender exploded' }])
    expect(result.error).toBe('key sender exploded')
    expect(log).toEqual(['text:one', 'text:boom'])
    expect(progress[1]).toEqual({
      index: 2,
      total: 3,
      label: 'bad',
      ok: false,
      error: 'key sender exploded',
    })
  })

  it('continues in continue mode and honours a per-group override', async () => {
    const groups: PlanGroup[] = [
      { label: 'ok', steps: [stepText('one')] },
      { label: 'bad', steps: [stepText('boom')] },
      { label: 'after', steps: [stepText('three')] },
    ]

    const continueLog: string[] = []
    const continuing = await new ActionExecutor(fakeKeys(continueLog), fakeHost(continueLog)).executePlan(
      groups,
      'rig',
      { mode: 'continue' },
    )
    expect(continuing.ok).toBe(false)
    expect(continuing.completed).toBe(2)
    expect(continuing.failures).toHaveLength(1)
    expect(continueLog).toEqual(['text:one', 'text:boom', 'text:three'])

    const overrideLog: string[] = []
    const stopped = await new ActionExecutor(fakeKeys(overrideLog), fakeHost(overrideLog)).executePlan(
      [
        { label: 'ok', steps: [stepText('one')] },
        { label: 'bad', steps: [stepText('boom')], continueOnError: false },
        { label: 'after', steps: [stepText('three')] },
      ],
      'rig',
      { mode: 'continue' },
    )
    expect(stopped.completed).toBe(1)
    expect(overrideLog).toEqual(['text:one', 'text:boom'])

    const perStepLog: string[] = []
    const perStep = await new ActionExecutor(fakeKeys(perStepLog), fakeHost(perStepLog)).executePlan(
      [
        { label: 'bad', steps: [stepText('boom')], continueOnError: true },
        { label: 'after', steps: [stepText('three')] },
      ],
      'rig',
    )
    expect(perStep.ok).toBe(false)
    expect(perStep.completed).toBe(1)
    expect(perStepLog).toEqual(['text:boom', 'text:three'])
  })

  it('checks the deadline before each group without cancelling an in-flight call', async () => {
    const log: string[] = []
    const host: HostActions = {
      ...fakeHost(log),
      async runCommand(command) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        log.push(`command:${command}`)
      },
    }
    const executor = new ActionExecutor(fakeKeys(log), host)
    const result = await executor.executePlan(
      [
        { label: 'slow', steps: [{ kind: 'command', command: 'slow', hidden: true }] },
        { label: 'never', steps: [stepText('never')] },
      ],
      'rig',
      { deadlineMs: 20 },
    )

    expect(result.timedOut).toBe(true)
    expect(result.cancelled).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.completed).toBe(1)
    expect(result.error).toBe('Timed out')
    expect(log).toEqual(['command:slow'])
  })

  it('times out inside a group delay', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const started = Date.now()
    const result = await executor.executePlan(
      [
        { label: 'first', steps: [], delayMs: 80 },
        { label: 'second', steps: [stepText('second')] },
      ],
      'rig',
      { deadlineMs: 20 },
    )

    expect(result.timedOut).toBe(true)
    expect(result.completed).toBe(1)
    expect(Date.now() - started).toBeLessThan(70)
    expect(log).toEqual([])
  })

  it('aborts during a group delay and skips the remaining groups', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const controller = new AbortController()
    const pending = executor.executePlan(
      [
        { label: 'first', steps: [stepText('one')], delayMs: 200 },
        { label: 'second', steps: [stepText('two')] },
      ],
      'rig',
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 10)

    const result = await pending
    expect(result.cancelled).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.completed).toBe(1)
    expect(result.error).toBe('Cancelled')
    expect(log).toEqual(['text:one'])
  })

  it('does not start when the signal is already aborted', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log))
    const controller = new AbortController()
    controller.abort()
    const result = await executor.executePlan(
      [{ label: 'first', steps: [stepText('one')] }],
      'rig',
      { signal: controller.signal },
    )
    expect(result).toEqual({
      ok: false,
      error: 'Cancelled',
      completed: 0,
      total: 1,
      failures: [],
      cancelled: true,
      timedOut: false,
      stoppedOnFailure: false,
    })
    expect(log).toEqual([])
  })

  it('releases only the failing group’s held keys', async () => {
    const log: string[] = []
    const keys: KeySender = {
      async send(step) {
        if (step.kind === 'keys') {
          log.push(`keys:${step.action}:${step.keys.join('+')}`)
          return
        }
        if (step.kind === 'text') throw new Error('text failed')
      },
    }
    const executor = new ActionExecutor(keys, fakeHost(log))
    const result = await executor.executePlan(
      [
        { label: 'hold', steps: [{ kind: 'keys', keys: ['CTRL'], holdMs: 0, action: 'down' }] },
        {
          label: 'bad',
          steps: [
            { kind: 'keys', keys: ['SHIFT'], holdMs: 0, action: 'down' },
            { kind: 'text', text: 'boom', perCharMs: 0 },
          ],
        },
      ],
      'rig',
    )

    expect(result.completed).toBe(1)
    expect(result.failures).toHaveLength(1)
    // SHIFT (pressed by the failed group) is released; CTRL stays held.
    expect(log).toEqual(['keys:down:CTRL', 'keys:down:SHIFT', 'keys:up:SHIFT'])
  })

  it('keeps the screenshot message through executePlan', async () => {
    const log: string[] = []
    const screenshots: string[] = []
    const executor = new ActionExecutor(fakeKeys(log), fakeHost(log), undefined, {
      platform: 'darwin',
      onScreenshot: (path) => screenshots.push(path),
    })
    const result = await executor.executePlan(
      [{ label: 'shot', steps: [stepKeys(['WIN', 'SHIFT', 'S'])] }],
      'shot',
    )
    expect(result.ok).toBe(true)
    expect(result.message).toBe(`Screenshot saved to Desktop: ${SCREENSHOT_BASENAME}`)
    expect(screenshots).toEqual([SCREENSHOT_PATH])
  })
})
