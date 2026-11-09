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
