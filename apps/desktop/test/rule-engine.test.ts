import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_SCHEMA_VERSION } from '@phonedek/shared'
import type {
  DeckConfig,
  DeckProfile,
  EventRule,
  RigPreset,
} from '@phonedek/shared'
import type { RigGuardProbes } from '../src/main/rig-guards'
import type { RigRunResult } from '../src/main/rig-runner'
import {
  RuleEngine,
  type RuleEdgeEvent,
  type RuleLevelEvent,
  type RuleLogSink,
} from '../src/main/rule-engine'

const goLive: RigPreset = {
  id: 'go-live',
  name: 'Go live',
  steps: [{ label: 'Stream', action: { type: 'obs', action: 'startStream' } }],
}

function profile(id: string, name: string, pages = ['home']): DeckProfile {
  return {
    id,
    name,
    grid: { columns: 3, rows: 2, gap: 8, padding: 8 },
    theme: {
      background: { type: 'color', color: '#000000' },
      buttonBackground: { type: 'color', color: '#111111' },
      textColor: '#ffffff',
      accentColor: '#ff6b1a',
      fontSize: 14,
      buttonRadius: 8,
    },
    pages: pages.map((pageId) => ({
      id: pageId,
      name: pageId === 'home' ? 'Home' : 'Gameplay',
      buttons: [],
    })),
    defaultPageId: 'home',
  }
}

function baseRule(overrides: Partial<EventRule> = {}): EventRule {
  return {
    id: 'rule-1',
    name: 'Stream started',
    enabled: true,
    trigger: { kind: 'obs.streaming', active: true },
    actions: [{ kind: 'showProfile', profileId: 'streaming' }],
    debounceMs: 1_500,
    cooldownMs: 0,
    ...overrides,
  }
}

function rigRun(overrides: Partial<RigRunResult> = {}): RigRunResult {
  return {
    presetId: 'go-live',
    name: 'Go live',
    status: 'ok',
    ok: true,
    completed: 1,
    total: 1,
    durationMs: 1_000,
    at: 0,
    failures: [],
    message: 'Go live: 1/1 steps in 1.0s',
    ...overrides,
  }
}

function levelEvent(
  active: boolean,
  kind: RuleLevelEvent['kind'] = 'obs.streaming',
  key: string = kind,
): RuleLevelEvent {
  return { key, kind, active, at: 0 }
}

function edgeEvent(
  kind: RuleEdgeEvent['kind'],
  fields: Pick<RuleEdgeEvent, 'key' | 'scene' | 'process'>,
): RuleEdgeEvent {
  return { kind, at: 0, ...fields }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface HarnessOptions {
  rules?: EventRule[]
  rigs?: RigPreset[]
  armed?: boolean
  probes?: RigGuardProbes
  runRig?: (presetId: string) => Promise<RigRunResult>
  showProfile?: (profileId: string) => boolean
  showPage?: (profileId: string, pageId: string) => boolean
  notice?: (text: string) => number
  settleMs?: number
  maxFiresPerMinute?: number
  historyMax?: number
}

function makeHarness(options: HarnessOptions = {}) {
  let clock = 1_000
  let armed = options.armed ?? true
  const calls = {
    rigs: [] as string[],
    profiles: [] as string[],
    pages: [] as string[],
    notices: [] as string[],
  }
  const logger: RuleLogSink & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } = {
    info: vi.fn(),
    warn: vi.fn(),
  }

  const config: DeckConfig = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: '2026-11-15T00:00:00.000Z',
    serverName: 'Test deck',
    defaultProfileId: 'main',
    profiles: [profile('main', 'Main'), profile('streaming', 'Streaming', ['home', 'gameplay'])],
    rigs: options.rigs ?? [goLive],
    rules: options.rules ?? [],
  }

  const runRig =
    options.runRig ??
    (async (presetId: string): Promise<RigRunResult> => {
      const rig = config.rigs?.find((candidate) => candidate.id === presetId)
      return rigRun({ presetId, name: rig?.name ?? presetId, at: clock })
    })
  const showProfile =
    options.showProfile ??
    ((profileId: string): boolean =>
      config.profiles.some((candidate) => candidate.id === profileId))
  const showPage =
    options.showPage ??
    ((profileId: string, pageId: string): boolean => {
      const target = config.profiles.find((candidate) => candidate.id === profileId)
      return target?.pages.some((candidate) => candidate.id === pageId) === true
    })

  const engine = new RuleEngine({
    getConfig: () => config,
    isArmed: () => armed,
    runRig: (presetId) => {
      calls.rigs.push(presetId)
      return runRig(presetId)
    },
    showProfile: (profileId) => {
      calls.profiles.push(profileId)
      return showProfile(profileId)
    },
    showPage: (profileId, pageId) => {
      calls.pages.push(`${profileId}/${pageId}`)
      return showPage(profileId, pageId)
    },
    ...(options.notice
      ? {
          notice: (text: string) => {
            calls.notices.push(text)
            return options.notice!(text)
          },
        }
      : {}),
    probes: options.probes ?? {},
    now: () => clock,
    log: logger,
    settleMs: options.settleMs ?? 0,
    ...(options.maxFiresPerMinute !== undefined
      ? { maxFiresPerMinute: options.maxFiresPerMinute }
      : {}),
    ...(options.historyMax !== undefined ? { historyMax: options.historyMax } : {}),
  })
  engine.configure(config.rules)

  return {
    engine,
    config,
    calls,
    logger,
    get clock() {
      return clock
    },
    setArmed(value: boolean) {
      armed = value
    },
    setRules(rules: EventRule[]) {
      config.rules = rules
      engine.configure(rules)
    },
    removeRules() {
      config.rules = []
      engine.configure([])
    },
    async advance(ms = 0) {
      clock += ms
      await vi.advanceTimersByTimeAsync(ms)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('RuleEngine level baselines', () => {
  it('treats the first observation as a silent baseline and fires the next transition once', async () => {
    const h = makeHarness({ rules: [baseRule()] })

    h.engine.level(levelEvent(false))
    expect(h.engine.history()).toHaveLength(0)
    expect(h.engine.status('rule-1').pending).toBe(false)

    h.engine.level(levelEvent(true))
    expect(h.engine.status('rule-1').pending).toBe(true)
    await h.advance(1_500)

    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()[0]).toMatchObject({
      ruleId: 'rule-1',
      status: 'ok',
      source: 'event',
      trigger: 'OBS stream started',
      durationMs: 0,
    })

    h.engine.level(levelEvent(true))
    await h.advance(1_500)
    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()).toHaveLength(1)
  })

  it('ignores repeated no-op echoes without a history row', async () => {
    const h = makeHarness({ rules: [baseRule()] })

    h.engine.level(levelEvent(true))
    h.engine.level(levelEvent(true))
    h.engine.level(levelEvent(true))
    await h.advance(5_000)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()).toEqual([])
  })

  it('matches phone presence only on 0 -> 1 and 1 -> 0, not 1 -> 2', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          id: 'connected',
          name: 'Phone docked',
          trigger: { kind: 'phone.connected' },
          actions: [{ kind: 'showProfile', profileId: 'streaming' }],
          debounceMs: 0,
        }),
        baseRule({
          id: 'disconnected',
          name: 'Phone away',
          trigger: { kind: 'phone.disconnected' },
          actions: [{ kind: 'showProfile', profileId: 'main' }],
          debounceMs: 0,
        }),
      ],
    })

    // Service seeds a connected phone at arm time: no fire.
    h.engine.level(levelEvent(true, 'phone.connected', 'phone.present'))
    h.engine.level(levelEvent(true, 'phone.connected', 'phone.present'))
    await h.advance(0)
    expect(h.calls.profiles).toEqual([])

    h.engine.level(levelEvent(false, 'phone.disconnected', 'phone.present'))
    await h.advance(0)
    h.engine.level(levelEvent(true, 'phone.connected', 'phone.present'))
    await h.advance(0)

    expect(h.calls.profiles).toEqual(['main', 'streaming'])
    expect(h.engine.history().map((entry) => entry.status)).toEqual(['ok', 'ok'])
  })

  it('resetBaselines drops the baseline, cancels pending candidates and never synthesizes an edge', async () => {
    const h = makeHarness({ rules: [baseRule()] })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    h.engine.resetBaselines('obs')
    await h.advance(2_000)
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()).toEqual([])

    // The first post-reconnect value is a baseline, even when it is "stopped".
    h.engine.level(levelEvent(false))
    await h.advance(2_000)
    expect(h.calls.profiles).toEqual([])

    h.engine.level(levelEvent(true))
    await h.advance(2_000)
    expect(h.calls.profiles).toEqual(['streaming'])
  })
})

describe('RuleEngine edge matching', () => {
  it('matches trimmed scene names and flips A -> B -> A to the settled scene only', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          trigger: { kind: 'obs.scene', scene: 'Gameplay' },
          actions: [{ kind: 'showProfile', profileId: 'streaming' }],
          debounceMs: 1_000,
        }),
        baseRule({
          id: 'intro',
          name: 'Intro scene',
          trigger: { kind: 'obs.scene', scene: 'Intro' },
          actions: [{ kind: 'showProfile', profileId: 'main' }],
          debounceMs: 1_000,
        }),
      ],
    })

    h.engine.edge(edgeEvent('obs.scene', { key: 'obs.scene', scene: ' Gameplay ' }))
    expect(h.engine.status('rule-1').pending).toBe(true)
    h.engine.edge(edgeEvent('obs.scene', { key: 'obs.scene', scene: 'Intro' }))
    await h.advance(1_000)

    expect(h.calls.profiles).toEqual(['main'])
    expect(h.engine.history().map((entry) => entry.ruleId)).toEqual(['intro', 'rule-1'])
    expect(h.engine.history()[1]).toMatchObject({
      status: 'skipped',
      detail: expect.stringMatching(/stale/i),
    })
  })

  it('normalizes process names (basename, lowercase, no .exe)', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          trigger: { kind: 'process.started', process: 'C:\\Games\\Game.EXE' },
          actions: [{ kind: 'showProfile', profileId: 'streaming' }],
          debounceMs: 0,
        }),
        baseRule({
          id: 'stopped',
          name: 'Game left',
          trigger: { kind: 'process.stopped', process: 'game' },
          actions: [{ kind: 'showProfile', profileId: 'main' }],
          debounceMs: 0,
        }),
      ],
    })

    h.engine.edge(
      edgeEvent('process.started', { key: 'process.started:game', process: '/opt/game.exe' }),
    )
    await h.advance(0)
    h.engine.edge(
      edgeEvent('process.stopped', { key: 'process.stopped:game', process: 'GAME' }),
    )
    await h.advance(0)

    expect(h.calls.profiles).toEqual(['streaming', 'main'])
  })
})

describe('RuleEngine fire gates', () => {
  it('does not fire or write history while disarmed, but keeps baselines current', async () => {
    const h = makeHarness({ rules: [baseRule()], armed: false })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(2_000)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()).toEqual([])
    expect(h.engine.status('rule-1').armed).toBe(false)

    h.setArmed(true)
    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(2_000)

    expect(h.calls.profiles).toEqual(['streaming'])
  })

  it('never fires a disabled rule and writes no history', async () => {
    const h = makeHarness({ rules: [baseRule({ enabled: false })] })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(2_000)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()).toEqual([])
    const status = h.engine.status('rule-1')
    expect(status.enabled).toBe(false)
    expect(status.lastAt).toBeUndefined()
    expect(status.lastStatus).toBeUndefined()
  })

  it('coalesces a burst to the last event of the debounce window', async () => {
    const h = makeHarness({ rules: [baseRule({ debounceMs: 1_500 })] })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(1_000)
    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(1_000)
    expect(h.calls.profiles).toEqual([])

    await h.advance(500)
    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()).toHaveLength(1)
  })

  it('re-checks a level candidate at the timer and records stale when it flipped back', async () => {
    const h = makeHarness({ rules: [baseRule({ debounceMs: 1_000 })] })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(500)
    h.engine.level(levelEvent(false))
    await h.advance(1_000)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'skipped',
      detail: expect.stringMatching(/stale/i),
    })
    expect(h.engine.status('rule-1').skipped?.reason).toBe('stale')
  })

  it('enforces per-rule cooldown and records one skipped/cooldown row', async () => {
    const h = makeHarness({
      rules: [baseRule({ debounceMs: 0, cooldownMs: 10_000 })],
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)
    expect(h.calls.profiles).toEqual(['streaming'])

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'skipped',
      detail: expect.stringMatching(/cooldown/i),
    })
    expect(h.engine.status('rule-1').skipped?.reason).toBe('cooldown')

    await h.advance(10_000)
    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)
    expect(h.calls.profiles).toEqual(['streaming', 'streaming'])
  })

  it('drops the 13th event-driven fire in a rolling minute as throttled', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          trigger: { kind: 'process.started', process: 'game' },
          debounceMs: 0,
          cooldownMs: 0,
          actions: [{ kind: 'showProfile', profileId: 'streaming' }],
        }),
      ],
    })

    for (let index = 0; index < 13; index += 1) {
      h.engine.edge(
        edgeEvent('process.started', { key: 'process.started:game', process: 'game' }),
      )
      await h.advance(0)
    }

    expect(h.calls.profiles).toHaveLength(12)
    const [latest] = h.engine.history()
    expect(latest).toMatchObject({
      status: 'throttled',
      detail: expect.stringMatching(/throttled/i),
    })
    expect(h.engine.status('rule-1').skipped?.reason).toBe('throttled')
  })
})

describe('RuleEngine suppression and serialization', () => {
  it('suppresses a loop while a rig runs, records one row, and allows a later transition', async () => {
    const gate = deferred<RigRunResult>()
    let runs = 0
    const h = makeHarness({
      settleMs: 4_000,
      rules: [
        baseRule({
          debounceMs: 0,
          cooldownMs: 0,
          actions: [{ kind: 'runRig', presetId: 'go-live' }],
        }),
      ],
      runRig: async () => {
        runs += 1
        return runs === 1 ? gate.promise : rigRun({ at: 0 })
      },
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)
    expect(runs).toBe(1)
    expect(h.engine.status('rule-1').executing).toBe(true)

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))

    expect(
      h.engine.history().filter((entry) => entry.status === 'skipped').length,
    ).toBe(1)
    expect(h.engine.status('rule-1').skipped?.reason).toBe('suppressed')

    gate.resolve(rigRun({ at: 0 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toBe(1)
    expect(h.engine.status('rule-1').executing).toBe(false)

    await h.advance(4_000)
    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)
    expect(runs).toBe(2)
  })

  it('runs two rules that match the same edge serially', async () => {
    const order: string[] = []
    const h = makeHarness({
      rules: [
        baseRule({
          id: 'first',
          name: 'First',
          debounceMs: 0,
          cooldownMs: 0,
          actions: [{ kind: 'showProfile', profileId: 'main' }],
        }),
        baseRule({
          id: 'second',
          name: 'Second',
          debounceMs: 0,
          cooldownMs: 0,
          actions: [{ kind: 'showProfile', profileId: 'streaming' }],
        }),
      ],
      showProfile: (profileId) => {
        order.push(profileId)
        return true
      },
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(order).toEqual(['main', 'streaming'])
    expect(h.engine.history().map((entry) => entry.ruleId).sort()).toEqual([
      'first',
      'second',
    ])
  })

  it('runs configured actions sequentially, awaiting a slow rig before the next action', async () => {
    const gate = deferred<RigRunResult>()
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          cooldownMs: 0,
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
      runRig: () => gate.promise,
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.rigs).toEqual(['go-live'])
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.status('rule-1').executing).toBe(true)

    gate.resolve(rigRun())
    await vi.advanceTimersByTimeAsync(0)

    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()[0]?.status).toBe('ok')
  })
})

describe('RuleEngine conditions and action failures', () => {
  it('blocks every action when a condition probe mismatches and reports the actual state', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          conditions: [{ probe: 'micMuted' }],
          debounceMs: 0,
        }),
      ],
      probes: { micMuted: async () => false },
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'blocked',
      detail: expect.stringMatching(/actual: unmuted/i),
      actions: [],
    })
    expect(h.engine.status('rule-1').lastStatus).toBe('blocked')
  })

  it('fails closed when a condition probe is unavailable', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          conditions: [{ probe: 'twitchLive' }],
          debounceMs: 0,
        }),
      ],
      probes: {},
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'blocked',
      detail: expect.stringMatching(/unavailable/i),
    })
  })

  it('maps a busy rig to busy and skips the remaining actions by default', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
      runRig: async () =>
        rigRun({
          status: 'busy',
          ok: false,
          error: 'Rig "Phone press" is already running (2/5).',
        }),
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'busy',
      detail: 'Rig "Phone press" is already running (2/5).',
    })
  })

  it('continues after a busy rig with onBusy continue and marks the run partial', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          onBusy: 'continue',
          debounceMs: 0,
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
      runRig: async () => rigRun({ status: 'busy', ok: false, error: 'Rig is busy.' }),
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'partial',
      actions: [
        { kind: 'runRig', ok: false },
        { kind: 'showProfile', ok: true },
      ],
    })
  })

  it('records missing when the rig no longer exists and never calls the runner', async () => {
    const h = makeHarness({
      rigs: [],
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.rigs).toEqual([])
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'missing',
      detail: 'Rig "go-live" is not configured.',
    })
  })

  it('stops after a profile failure and keeps the first error in history', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [
            { kind: 'showProfile', profileId: 'ghost' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.profiles).toEqual(['ghost'])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'failed',
      detail: 'Profile "ghost" is not configured.',
    })
  })

  it('stops after a missing page', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [
            { kind: 'showPage', profileId: 'streaming', pageId: 'nope' },
            { kind: 'showProfile', profileId: 'main' },
          ],
        }),
      ],
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.pages).toEqual(['streaming/nope'])
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]).toMatchObject({
      status: 'failed',
      detail: 'Page "streaming / nope" is not configured.',
    })
  })

  it('treats a notice with no capable phones as ok with 0 phones', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [{ kind: 'notice', text: 'Stream is live' }],
        }),
      ],
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.engine.history()[0]).toMatchObject({
      status: 'ok',
      actions: [{ kind: 'notice', ok: true, target: '0 phones' }],
    })
  })

  it('reports the number of phones reached by a notice', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          debounceMs: 0,
          actions: [{ kind: 'notice', text: 'Stream is live' }],
        }),
      ],
      notice: () => 3,
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(0)

    expect(h.calls.notices).toEqual(['Stream is live'])
    expect(h.engine.history()[0]?.actions[0]?.target).toBe('3 phones')
  })
})

describe('RuleEngine preview and manual fire', () => {
  it('previews conditions, action labels and references without executing anything', async () => {
    const h = makeHarness({
      rules: [
        baseRule({
          conditions: [{ probe: 'micMuted' }],
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: 'streaming' },
          ],
        }),
      ],
      probes: { micMuted: async () => true },
    })

    const preview = await h.engine.preview('rule-1')

    expect(h.calls).toEqual({ rigs: [], profiles: [], pages: [], notices: [] })
    expect(preview).toMatchObject({
      ruleId: 'rule-1',
      enabled: true,
      wouldRun: true,
      ok: true,
      blocked: [],
    })
    expect(preview.conditions).toHaveLength(1)
    expect(preview.actions).toEqual([
      { kind: 'runRig', ok: true, target: 'Run rig "Go live"' },
      { kind: 'showProfile', ok: true, target: 'Show profile "Streaming"' },
    ])
    expect(h.engine.history()).toEqual([])
  })

  it('reports missing references and blocked conditions in preview', async () => {
    const h = makeHarness({
      rigs: [],
      rules: [
        baseRule({
          conditions: [{ probe: 'twitchLive' }],
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showPage', profileId: 'streaming', pageId: 'nope' },
            { kind: 'notice', text: 'Hi' },
          ],
        }),
      ],
      probes: {},
    })

    const preview = await h.engine.preview('rule-1')

    expect(preview.wouldRun).toBe(false)
    expect(preview.ok).toBe(false)
    expect(preview.blocked).toHaveLength(1)
    expect(preview.missing).toEqual(['rig "go-live"', 'page "streaming / nope"'])
    expect(preview.actions.map((action) => action.ok)).toEqual([false, false, true])
  })

  it('marks a disabled rule as not wouldRun but still evaluates a dry run', async () => {
    const h = makeHarness({ rules: [baseRule({ enabled: false })] })

    const preview = await h.engine.preview('rule-1')

    expect(preview).toMatchObject({
      enabled: false,
      wouldRun: false,
      ok: true,
      reason: 'disabled',
    })
    expect(preview.conditions).toEqual([])
  })

  it('manual fire bypasses armed, cooldown and debounce but still writes manual history', async () => {
    const h = makeHarness({
      armed: false,
      rules: [baseRule({ debounceMs: 60_000, cooldownMs: 60_000 })],
    })

    const first = await h.engine.fire('rule-1')
    const second = await h.engine.fire('rule-1')

    expect(first).toMatchObject({ status: 'ok', source: 'manual' })
    expect(second.status).toBe('ok')
    expect(h.calls.profiles).toEqual(['streaming', 'streaming'])
    expect(h.engine.history()[0]).toMatchObject({
      source: 'manual',
      status: 'ok',
    })
  })

  it('manual fire still evaluates conditions and records blocked', async () => {
    const h = makeHarness({
      rules: [baseRule({ conditions: [{ probe: 'micMuted' }] })],
      probes: { micMuted: async () => false },
    })

    const result = await h.engine.fire('rule-1')

    expect(result).toMatchObject({
      status: 'blocked',
      source: 'manual',
    })
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()[0]?.status).toBe('blocked')
  })
})

describe('RuleEngine history, status and lifecycle', () => {
  it('keeps history newest-first, caps it and clears it', async () => {
    const h = makeHarness({ rules: [baseRule()], historyMax: 2 })

    await h.engine.fire('rule-1')
    await h.engine.fire('rule-1')
    await h.engine.fire('rule-1')

    const entries = h.engine.history()
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.seq)).toEqual([3, 2])
    expect(entries[0]?.at).toBe(h.clock)

    h.engine.clearHistory()
    expect(h.engine.history()).toEqual([])

    await h.engine.fire('rule-1')
    expect(h.engine.history()[0]?.seq).toBe(1)
  })

  it('reports enabled, armed, pending, executing, lastAt, lastStatus and skip reason', async () => {
    const h = makeHarness({
      rules: [baseRule({ debounceMs: 1_000, cooldownMs: 10_000 })],
    })

    expect(h.engine.status('rule-1')).toMatchObject({
      ruleId: 'rule-1',
      name: 'Stream started',
      enabled: true,
      armed: true,
      pending: false,
      executing: false,
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    expect(h.engine.status('rule-1').pending).toBe(true)

    await h.advance(1_000)
    expect(h.engine.status('rule-1')).toMatchObject({
      pending: false,
      executing: false,
      lastStatus: 'ok',
      lastAt: 2_000,
      lastDetail: '1 action ok.',
    })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    await h.advance(1_000)
    expect(h.engine.status('rule-1')).toMatchObject({
      lastStatus: 'skipped',
      skipped: { reason: 'cooldown', at: 2_000 },
    })
  })

  it('cancels a pending debounce on dispose and leaves no timers', async () => {
    const h = makeHarness({ rules: [baseRule({ debounceMs: 1_000 })] })

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    expect(vi.getTimerCount()).toBe(1)

    h.engine.dispose()
    expect(vi.getTimerCount()).toBe(0)

    await h.advance(5_000)
    expect(h.calls.profiles).toEqual([])
    expect(h.engine.history()).toEqual([])
  })

  it('keeps history when configure removes a rule and cancels its pending candidate', async () => {
    const h = makeHarness({ rules: [baseRule({ debounceMs: 1_000 })] })

    await h.engine.fire('rule-1')
    expect(h.engine.history()).toHaveLength(1)

    h.engine.level(levelEvent(false))
    h.engine.level(levelEvent(true))
    h.removeRules()
    await h.advance(2_000)

    expect(h.calls.profiles).toEqual(['streaming'])
    expect(h.engine.history()).toHaveLength(1)
    expect(h.engine.status('rule-1').enabled).toBe(false)
  })
})
