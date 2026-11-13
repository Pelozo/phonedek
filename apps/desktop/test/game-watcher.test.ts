import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProcessProvider,
  GameWatcher,
  parsePsOutput,
  parseTasklistOutput,
  type GameWatcherOptions,
} from '../src/main/game-watcher'
import type { AutoProfileRule } from '../src/main/settings-store'
import type { Logger } from '../src/main/logger'

const RULES: AutoProfileRule[] = [
  { id: 'browser', process: 'chrome', profileId: 'browser' },
  { id: 'game', process: 'game', profileId: 'game' },
]

function fakeLogger(): Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return {
    logPath: null,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

interface WatcherHarness {
  watcher: GameWatcher
  switches: Array<{ profileId: string; rule: AutoProfileRule }>
  settings: { enabled: boolean; rules: AutoProfileRule[] }
  setProcesses(names: string[]): void
  logger: ReturnType<typeof fakeLogger>
}

function harness(options: Partial<GameWatcherOptions> = {}): WatcherHarness {
  let processes: string[] = []
  const switches: Array<{ profileId: string; rule: AutoProfileRule }> = []
  const settings = { enabled: true, rules: RULES.map((rule) => ({ ...rule })) }
  const logger = fakeLogger()
  const watcher = new GameWatcher({
    getSettings: () => ({ enabled: settings.enabled, rules: settings.rules }),
    getProfileIds: () => ['browser', 'game'],
    provider: { list: async () => [...processes] },
    onSwitch: (profileId, rule) => switches.push({ profileId, rule }),
    intervalMs: 1000,
    logger,
    ...options,
  })
  return {
    watcher,
    switches,
    settings,
    setProcesses: (names) => {
      processes = names
    },
    logger,
  }
}

async function tick(times = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000 * times)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('process output parsing', () => {
  it('parses the first tasklist CSV column and deduplicates names', () => {
    const output = [
      '"Game.exe","1234","Console","1","1,234 K"',
      '"Chrome.EXE","99","Console","1","900 K"',
      '"My,Game.exe","7","Console","1","10 K"',
      '"game","5","Console","1","10 K"',
      'INFO: No tasks are running which match the specified criteria.',
      '',
    ].join('\r\n')

    expect(parseTasklistOutput(output)).toEqual(['game', 'chrome', 'my,game'])
    expect(parseTasklistOutput('')).toEqual([])
  })

  it('handles quoted image names with escaped quotes', () => {
    expect(parseTasklistOutput('"weird""name.exe","1","Console","1","1 K"')).toEqual([
      'weird"name',
    ])
  })

  it('parses ps comm output as basenames and normalizes case', () => {
    const output = [
      '/usr/lib/firefox/firefox',
      '/usr/bin/Team Fortress 2',
      '/opt/Game.EXE',
      '',
      '/usr/lib/firefox/firefox',
    ].join('\n')

    expect(parsePsOutput(output)).toEqual(['firefox', 'team fortress 2', 'game'])
    expect(parsePsOutput('   \n')).toEqual([])
  })

  it('builds platform-specific providers with no native dependency', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const run = async (command: string, args: string[]): Promise<string> => {
      calls.push({ command, args })
      return command === 'tasklist' ? '"Game.exe","1","Console","1","1 K"' : '/usr/bin/Game\n'
    }

    const windows = createProcessProvider('win32', run)
    expect(await windows.list()).toEqual(['game'])
    const ps = createProcessProvider('linux', run)
    expect(await ps.list()).toEqual(['game'])

    expect(calls).toEqual([
      { command: 'tasklist', args: ['/FO', 'CSV', '/NH'] },
      { command: 'ps', args: ['-eo', 'comm='] },
    ])
  })
})

describe('GameWatcher transitions', () => {
  it('switches once when a mapped process appears and stays quiet while it runs', async () => {
    const h = harness()
    h.setProcesses(['Game.exe'])
    h.watcher.start()
    expect(h.watcher.running).toBe(true)

    await tick()
    expect(h.switches).toHaveLength(1)
    expect(h.switches[0]).toMatchObject({
      profileId: 'game',
      rule: { id: 'game', process: 'game' },
    })

    await tick(3)
    expect(h.switches).toHaveLength(1)
  })

  it('switches again only after the process exits and is relaunched', async () => {
    const h = harness()
    h.setProcesses(['game'])
    h.watcher.start()

    await tick()
    expect(h.switches).toHaveLength(1)

    h.setProcesses([])
    await tick(2)
    expect(h.switches).toHaveLength(1)

    h.setProcesses(['game'])
    await tick()
    expect(h.switches).toHaveLength(2)
  })

  it('uses the first matching rule as priority', async () => {
    const h = harness()
    h.setProcesses(['game', 'chrome'])
    h.watcher.start()

    await tick()
    expect(h.switches.map((item) => item.profileId)).toEqual(['browser'])

    h.setProcesses(['game'])
    await tick()
    expect(h.switches.map((item) => item.profileId)).toEqual(['browser', 'game'])
  })

  it('ignores rules for missing profiles and falls through to the next rule', async () => {
    const h = harness({ getProfileIds: () => ['game'] })
    h.settings.rules = [
      { id: 'stale', process: 'chrome', profileId: 'deleted-profile' },
      { id: 'game', process: 'game', profileId: 'game' },
    ]
    h.setProcesses(['chrome', 'game'])
    h.watcher.start()

    await tick()
    expect(h.switches.map((item) => item.profileId)).toEqual(['game'])
  })

  it('does not switch when every matching rule has a missing profile', async () => {
    const h = harness({ getProfileIds: () => ['game'] })
    h.settings.rules = [{ id: 'stale', process: 'chrome', profileId: 'deleted-profile' }]
    h.setProcesses(['chrome'])
    h.watcher.start()

    await tick(2)
    expect(h.switches).toEqual([])
  })

  it('ignores the watcher and shell process names', async () => {
    const h = harness({
      getProfileIds: () => ['game'],
      ignoredProcesses: ['custom-scan'],
    })
    h.settings.rules = [
      { id: 'node', process: 'node', profileId: 'game' },
      { id: 'electron', process: 'electron', profileId: 'game' },
      { id: 'custom', process: 'custom-scan', profileId: 'game' },
    ]
    h.setProcesses(['node', 'electron', 'custom-scan'])
    h.watcher.start()

    await tick(2)
    expect(h.switches).toEqual([])
  })

  it('stops polling when disabled or when there are no rules', async () => {
    const h = harness()
    h.setProcesses(['game'])
    h.watcher.refresh()
    expect(h.watcher.running).toBe(true)

    h.settings.enabled = false
    h.watcher.refresh()
    expect(h.watcher.running).toBe(false)

    await tick(2)
    expect(h.switches).toEqual([])

    h.settings.enabled = true
    h.settings.rules = []
    h.watcher.refresh()
    expect(h.watcher.running).toBe(false)
  })

  it('does not poll while disabled even if started explicitly', async () => {
    const h = harness()
    h.settings.enabled = false
    h.setProcesses(['game'])
    h.watcher.start()

    await tick(2)
    expect(h.switches).toEqual([])
  })

  it('logs a process-scan failure once, keeps running and recovers', async () => {
    let fail = true
    const h = harness({
      provider: {
        list: async () => {
          if (fail) throw new Error('tasklist not found')
          return ['game']
        },
      },
    })
    h.watcher.start()

    await tick(3)
    expect(h.logger.warn).toHaveBeenCalledTimes(1)
    expect(String(h.logger.warn.mock.calls[0]?.[0])).toContain('tasklist not found')
    expect(h.watcher.running).toBe(true)
    expect(h.switches).toEqual([])

    fail = false
    await tick()
    expect(h.switches.map((item) => item.profileId)).toEqual(['game'])
  })

  it('dispose stops the timer', async () => {
    const h = harness()
    h.setProcesses(['game'])
    h.watcher.start()
    h.watcher.dispose()
    expect(h.watcher.running).toBe(false)

    await tick()
    expect(h.switches).toEqual([])
  })
})
