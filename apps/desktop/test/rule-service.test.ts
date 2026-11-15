import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  type ConnectedClient,
  type DeckConfig,
  type EventRule,
  type ServerMessage,
} from '@phonedek/shared'
import { RuleService, type RuleObsClient, type RuleObsReader } from '../src/main/rule-service'
import type { RigRunResult } from '../src/main/rig-runner'

const services: RuleService[] = []

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

function sleep(ms = 15): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(fn: () => T | undefined | false, timeout = 2000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = fn()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for condition')
    await sleep(10)
  }
}

function client(id: string): ConnectedClient {
  return {
    id,
    address: '10.0.0.2',
    device: null,
    connectedAt: 1,
    lastSeenAt: 1,
  }
}

interface ObsHarness {
  client: RuleObsClient
  source: RuleObsReader
  reads: Map<'streaming' | 'recording' | 'replay', boolean>
  failReads: boolean
  readonly subscribed: boolean
  setConnected(connected: boolean): void
  emitEvent(type: string, data: Record<string, unknown>): void
}

function makeObs(): ObsHarness {
  let status: ((status: { state: string }) => void) | null = null
  let events: ((type: string, data: Record<string, unknown>) => void) | null = null
  let connected = true
  const reads = new Map<'streaming' | 'recording' | 'replay', boolean>()
  const harness: ObsHarness = {
    reads,
    failReads: false,
    get subscribed() {
      return status !== null && events !== null
    },
    client: {
      get connected() {
        return connected
      },
      onStatus(listener) {
        status = listener
        return () => {
          status = null
        }
      },
      onEvent(listener) {
        events = listener
        return () => {
          events = null
        }
      },
    },
    source: {
      async readStatus(target) {
        if (harness.failReads) throw new Error('OBS is not connected.')
        return { active: reads.get(target) === true }
      },
    },
    setConnected(next) {
      connected = next
      status?.({ state: next ? 'connected' : 'disconnected' })
    },
    emitEvent(type, data) {
      events?.(type, data)
    },
  }
  return harness
}

interface TwitchHarness {
  readonly connected: boolean
  calls: string[]
  queue: Array<boolean | Error>
  setConnected(connected: boolean): void
  source: {
    readonly connected: boolean
    readStatus(target: 'live'): Promise<{ active?: boolean }>
  }
}

function makeTwitch(): TwitchHarness {
  let connected = true
  const harness: TwitchHarness = {
    calls: [],
    queue: [],
    get connected() {
      return connected
    },
    setConnected(next) {
      connected = next
    },
    source: {
      get connected() {
        return connected
      },
      async readStatus(target) {
        harness.calls.push(target)
        const next = harness.queue.length > 0 ? harness.queue.shift()! : false
        if (next instanceof Error) throw next
        return { active: next }
      },
    },
  }
  return harness
}

function rigResult(presetId: string): RigRunResult {
  return {
    presetId,
    name: 'Go live',
    status: 'ok',
    ok: true,
    completed: 1,
    total: 1,
    durationMs: 1,
    at: Date.now(),
    failures: [],
  }
}

interface Harness {
  service: RuleService
  config: DeckConfig
  obs: ObsHarness
  twitch: TwitchHarness
  profiles: string[]
  pages: Array<{ profileId: string; pageId: string }>
  rigCalls: string[]
  sent: Array<{ clientId: string; message: ServerMessage }>
  armed: boolean
  setArmed(armed: boolean): void
}

function harness(options: { twitchPollMs?: number } = {}): Harness {
  const config = createDefaultConfig()
  config.rigs = [{ id: 'go-live', name: 'Go live', steps: [] }]
  const obs = makeObs()
  const twitch = makeTwitch()
  const profiles: string[] = []
  const pages: Array<{ profileId: string; pageId: string }> = []
  const rigCalls: string[] = []
  const sent: Array<{ clientId: string; message: ServerMessage }> = []
  const state = { armed: false }

  const service = new RuleService({
    getConfig: () => config,
    isArmed: () => state.armed,
    probes: {},
    runRig: async (presetId) => {
      rigCalls.push(presetId)
      return rigResult(presetId)
    },
    showProfile: (profileId) => {
      if (!config.profiles.some((profile) => profile.id === profileId)) return false
      profiles.push(profileId)
      return true
    },
    showPage: (profileId, pageId) => {
      const profile = config.profiles.find((candidate) => candidate.id === profileId)
      if (!profile || !profile.pages.some((page) => page.id === pageId)) return false
      pages.push({ profileId, pageId })
      return true
    },
    sendToClient: (clientId, message) => {
      sent.push({ clientId, message })
      return true
    },
    obs: { client: obs.client, source: obs.source },
    twitch: twitch.source,
    ...(options.twitchPollMs !== undefined ? { twitchPollMs: options.twitchPollMs } : {}),
    engine: { settleMs: 0 },
  })
  services.push(service)

  return {
    service,
    config,
    obs,
    twitch,
    profiles,
    pages,
    rigCalls,
    sent,
    get armed() {
      return state.armed
    },
    setArmed(armed) {
      state.armed = armed
      service.setArmed(armed)
    },
  }
}

const PROFILE = createDefaultConfig().profiles[0]!.id

function showProfileRule(
  id: string,
  trigger: EventRule['trigger'],
  options: Partial<EventRule> = {},
): EventRule {
  return {
    id,
    name: id,
    trigger,
    actions: [{ kind: 'showProfile', profileId: PROFILE }],
    debounceMs: 0,
    cooldownMs: 0,
    ...options,
  }
}

describe('RuleService OBS source', () => {
  it('subscribes only while armed and an OBS rule exists, and detaches on removal', async () => {
    const h = harness()
    h.service.configure([showProfileRule('stream', { kind: 'obs.streaming', active: true })])
    expect(h.obs.subscribed).toBe(false)

    h.setArmed(true)
    expect(h.obs.subscribed).toBe(true)
    await sleep()

    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await waitFor(() => h.profiles.length > 0)
    expect(h.profiles).toEqual([PROFILE])

    h.service.configure([])
    expect(h.obs.subscribed).toBe(false)

    h.setArmed(false)
    h.service.configure([showProfileRule('stream', { kind: 'obs.streaming', active: true })])
    expect(h.obs.subscribed).toBe(false)
  })

  it('seeds levels on connect and never synthesizes a false edge on disconnect', async () => {
    const h = harness()
    h.obs.reads.set('streaming', true)
    h.service.configure([showProfileRule('stop', { kind: 'obs.streaming', active: false })])
    h.setArmed(true)
    await sleep()

    // Disconnect resets baselines; the reconnect value is silent.
    h.obs.setConnected(false)
    h.obs.setConnected(true)
    await sleep()
    expect(h.profiles).toEqual([])

    // A real stop edge after the fresh baseline fires once.
    h.obs.reads.set('streaming', false)
    h.obs.emitEvent('StreamStateChanged', { outputActive: false })
    await waitFor(() => h.profiles.length > 0)
    expect(h.profiles).toEqual([PROFILE])
  })

  it('fires scene edges once and ignores a superseded debounce after a config change', async () => {
    const h = harness()
    h.service.configure([
      showProfileRule('scene', { kind: 'obs.scene', scene: 'Gameplay' }, { debounceMs: 25 }),
    ])
    h.setArmed(true)
    await sleep()

    h.obs.emitEvent('CurrentProgramSceneChanged', { sceneName: 'Gameplay' })
    h.service.configure([])
    await sleep(60)
    // Removing the rule cancels its pending debounce.
    expect(h.profiles).toEqual([])

    h.service.configure([
      showProfileRule('scene', { kind: 'obs.scene', scene: 'Gameplay' }, { debounceMs: 0 }),
    ])
    h.obs.emitEvent('CurrentProgramSceneChanged', { sceneName: 'Gameplay' })
    await waitFor(() => h.profiles.length > 0)
    expect(h.profiles).toEqual([PROFILE])
  })

  it('keeps the first unseeded observation silent when status reads fail', async () => {
    const h = harness()
    h.obs.failReads = true
    h.service.configure([showProfileRule('stream', { kind: 'obs.streaming', active: true })])
    h.setArmed(true)
    await sleep()

    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await sleep()
    expect(h.profiles).toEqual([])

    h.obs.emitEvent('StreamStateChanged', { outputActive: false })
    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await waitFor(() => h.profiles.length > 0)
    expect(h.profiles).toEqual([PROFILE])
  })
})

describe('RuleService Twitch source', () => {
  it('polls only while a Twitch rule exists, ignores errors and resets after an auth gap', async () => {
    const h = harness({ twitchPollMs: 10 })
    h.setArmed(true)
    await sleep(40)
    expect(h.twitch.calls).toEqual([])

    // Baseline offline, then an unknown read (no edge), then a live edge.
    h.twitch.queue.push(false, new Error('network'), true)
    h.service.configure([showProfileRule('live', { kind: 'twitch.live', active: true })])
    await waitFor(() => h.twitch.calls.length >= 3)
    await waitFor(() => h.profiles.length > 0)
    expect(h.profiles).toEqual([PROFILE])

    // Removing the Twitch rule stops the timer (no further polls).
    h.service.configure([])
    const calls = h.twitch.calls.length
    await sleep(40)
    expect(h.twitch.calls.length).toBe(calls)

    // Auth gap + reconnect: the first authorized poll is a baseline again.
    h.service.configure([showProfileRule('offline', { kind: 'twitch.live', active: false })])
    h.twitch.setConnected(false)
    await sleep(30)
    h.twitch.setConnected(true)
    h.twitch.queue.push(true, false)
    await waitFor(() => h.profiles.length >= 2)
    expect(h.profiles.at(-1)).toBe(PROFILE)
  })
})

describe('RuleService process source', () => {
  function processRule(
    id: string,
    kind: 'process.started' | 'process.stopped',
    process = 'game',
  ): EventRule {
    return showProfileRule(id, { kind, process })
  }

  it('seeds the first snapshot, starts once, stops after two misses and recovers', async () => {
    const h = harness()
    h.setArmed(true)
    h.service.configure([processRule('start', 'process.started'), processRule('stop', 'process.stopped')])

    h.service.processSnapshot(new Set(['game']))
    await sleep()
    expect(h.profiles).toEqual([])

    h.service.processSnapshot(new Set())
    await sleep()
    expect(h.profiles).toEqual([])
    h.service.processSnapshot(new Set())
    await waitFor(() => h.profiles.length === 1)

    h.service.processSnapshot(new Set(['game']))
    await waitFor(() => h.profiles.length === 2)
    expect(h.profiles).toEqual([PROFILE, PROFILE])
  })

  it('does not fire for a rule added while its process is already running', async () => {
    const h = harness()
    h.setArmed(true)
    h.service.processSnapshot(new Set(['game']))
    h.service.configure([processRule('start', 'process.started')])
    h.service.processSnapshot(new Set(['game']))
    await sleep()
    expect(h.profiles).toEqual([])
  })

  it('needs process polling only when armed with process rules', () => {
    const h = harness()
    h.service.configure([processRule('start', 'process.started')])
    expect(h.service.needsProcessPolling()).toBe(false)
    h.setArmed(true)
    expect(h.service.needsProcessPolling()).toBe(true)
    h.service.configure([showProfileRule('stream', { kind: 'obs.streaming', active: true })])
    expect(h.service.needsProcessPolling()).toBe(false)
  })
})

describe('RuleService phone presence', () => {
  it('fires one edge per 0→1 and 1→0 transition and ignores churn', async () => {
    const h = harness()
    h.setArmed(true)
    h.service.configure([
      showProfileRule('connected', { kind: 'phone.connected' }),
      showProfileRule('disconnected', { kind: 'phone.disconnected' }),
    ])

    h.service.clientsChanged([])
    await sleep()
    h.service.clientsChanged([client('a')])
    await waitFor(() => h.profiles.length === 1)

    h.service.clientsChanged([client('a'), client('b')])
    h.service.clientsChanged([client('b')])
    await sleep()
    expect(h.profiles).toHaveLength(1)

    h.service.clientsChanged([])
    await waitFor(() => h.profiles.length === 2)
  })

  it('replays only the last automation-chosen profile to a newly connected phone', async () => {
    const h = harness()
    h.obs.reads.set('streaming', false)
    h.service.configure([
      showProfileRule('stream', { kind: 'obs.streaming', active: true }),
    ])
    h.setArmed(true)
    await sleep()

    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await waitFor(() => h.profiles.length === 1)

    h.service.clientsChanged([])
    h.service.clientsChanged([client('new-phone')])
    await waitFor(() => h.sent.length > 0)
    expect(h.sent).toEqual([
      { clientId: 'new-phone', message: { type: 'profile', profileId: PROFILE } },
    ])

    // An existing client never receives a replay again.
    h.service.clientsChanged([client('new-phone')])
    await sleep()
    expect(h.sent).toHaveLength(1)
  })
})

describe('RuleService action wiring and API views', () => {
  it('runs a rig through the injected runner and records status and history', async () => {
    const h = harness()
    h.setArmed(true)
    h.service.configure([
      {
        id: 'go',
        name: 'Go live',
        trigger: { kind: 'obs.streaming', active: true },
        actions: [{ kind: 'runRig', presetId: 'go-live' }],
        debounceMs: 0,
        cooldownMs: 0,
      },
    ])
    await sleep()

    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await waitFor(() => h.rigCalls.length > 0)
    expect(h.rigCalls).toEqual(['go-live'])

    await waitFor(() => h.service.getEventRules().history.length > 0)
    const view = h.service.getEventRules()
    expect(view.armed).toBe(true)
    expect(view.statuses).toEqual([
      expect.objectContaining({ ruleId: 'go', enabled: true, detail: 'ARMED', lastStatus: 'ok' }),
    ])
    expect(view.sources.map((source) => source.name)).toEqual([
      'obs',
      'twitch',
      'process',
      'phone',
    ])
    expect(view.sources.find((source) => source.name === 'obs')).toMatchObject({
      available: true,
      detail: 'CONNECTED',
    })
    expect(view.sources.find((source) => source.name === 'phone')?.detail).toBe('0 PHONES')

    h.service.clearHistory()
    expect(h.service.getEventRules().history).toEqual([])
  })

  it('reports DISARMED/PAUSED and never executes an event while disarmed', async () => {
    const h = harness()
    h.service.configure([
      showProfileRule('stream', { kind: 'obs.streaming', active: true }),
      showProfileRule('paused', { kind: 'obs.streaming', active: true }, { enabled: false }),
    ])
    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await sleep()
    expect(h.profiles).toEqual([])

    const view = h.service.getEventRules()
    expect(view.armed).toBe(false)
    expect(view.statuses.map((status) => status.detail)).toEqual(['DISARMED', 'DISARMED'])
    expect(view.history).toEqual([])

    h.setArmed(true)
    const armedView = h.service.getEventRules()
    expect(armedView.armed).toBe(true)
    expect(armedView.statuses.map((status) => status.detail)).toEqual(['ARMED', 'PAUSED'])
  })

  it('switches profile then page for showPage and replays that profile to a reconnect', async () => {
    const h = harness()
    const profile = h.config.profiles[0]!
    const page = profile.pages[0]!
    h.service.configure([
      {
        id: 'page',
        name: 'Show page',
        trigger: { kind: 'obs.streaming', active: true },
        actions: [{ kind: 'showPage', profileId: profile.id, pageId: page.id }],
        debounceMs: 0,
        cooldownMs: 0,
      },
    ])
    h.setArmed(true)
    await sleep()

    h.obs.emitEvent('StreamStateChanged', { outputActive: true })
    await waitFor(() => h.pages.length > 0)
    expect(h.pages).toEqual([{ profileId: profile.id, pageId: page.id }])

    h.service.clientsChanged([])
    h.service.clientsChanged([client('reconnected')])
    await waitFor(() => h.sent.length > 0)
    expect(h.sent[0]).toEqual({
      clientId: 'reconnected',
      message: { type: 'profile', profileId: profile.id },
    })
  })

  it('previews missing references without executing and allows a manual fire', async () => {
    const h = harness()
    h.service.configure([
      {
        id: 'missing',
        name: 'Missing profile',
        trigger: { kind: 'obs.streaming', active: true },
        actions: [{ kind: 'showProfile', profileId: 'deleted-profile' }],
      },
      showProfileRule('manual', { kind: 'obs.streaming', active: true }),
    ])

    const preview = await h.service.preview('missing')
    expect(preview.ok).toBe(false)
    expect(preview.wouldRun).toBe(false)
    expect(preview.missing).toEqual(['profile "deleted-profile"'])
    expect(h.profiles).toEqual([])

    // Manual fire bypasses the arm switch but still checks references.
    const fired = await h.service.fire('manual')
    expect(fired.ok).toBe(true)
    expect(fired.source).toBe('manual')
    expect(h.profiles).toEqual([PROFILE])
  })
})
