/**
 * Event-rule service (P2).
 *
 * Owns the one `RuleEngine` and the five typed source adapters. The engine
 * decides *whether* a rule fires; this service only feeds it observations:
 *
 *   obs-client events/status ──┐
 *   twitch live poll ──────────┤
 *   game-watcher snapshots ────┼──► RuleService ──► RuleEngine ──► RigRunner
 *   server phone presence ─────┤                    (match,       + broadcast
 *   config.rules ──────────────┘                     debounce)      profile/page
 *
 * Design rules:
 * - Edges, not levels. The first value per OBS/Twitch/phone key is a silent
 *   baseline; reconnects call `resetBaselines` and never synthesize `false`.
 * - Sources are refcounted by enabled rules *and* the local arm switch. A
 *   disarmed desktop polls nothing except presence.
 * - Process polling is shared with auto-profile through `GameWatcher`; this
 *   service only diffs the snapshots it receives.
 */

import {
  RULE_PROCESS_EXIT_TICKS,
  RULE_TWITCH_POLL_MS,
  normalizeRuleProcess,
  type ConnectedClient,
  type DeckConfig,
  type EventRule,
  type EventTriggerKind,
  type RuleActionOutcome,
  type RuleHistoryEntry,
  type RuleRunStatus,
  type ServerMessage,
} from '@phonedek/shared'
import { normalizeProcessName } from './settings-store'
import { RuleEngine, type RulePreview, type RuleStatus } from './rule-engine'
import type { RigGuardProbes } from './rig-guards'
import type { RigGuardView } from '../shared/api'
import type { RigRunResult } from './rig-runner'
import type { Logger } from './logger'

/** OBS event names consumed by rules. */
export const RULE_OBS_EVENTS = [
  'StreamStateChanged',
  'RecordStateChanged',
  'ReplayBufferStateChanged',
  'CurrentProgramSceneChanged',
] as const

/** Minimal OBS client surface (fake-friendly; `ObsClient` satisfies it). */
export interface RuleObsClient {
  readonly connected: boolean
  onStatus(listener: (status: { state: string }) => void): () => void
  onEvent(listener: (type: string, data: Record<string, unknown>) => void): () => void
}

/** Read-only OBS status surface (`ObsStateSource` satisfies it). */
export interface RuleObsReader {
  readStatus(target: 'streaming' | 'recording' | 'replay'): Promise<{
    active?: boolean
  }>
}

/** Minimal Twitch surface (`TwitchStateSource` satisfies it). */
export interface RuleTwitchSource {
  readonly connected: boolean
  readStatus(target: 'live'): Promise<{ active?: boolean }>
}

/** One live source row for the Automation dialog. */
export interface RuleSourceView {
  name: 'obs' | 'twitch' | 'process' | 'phone'
  label: string
  available: boolean
  detail: string
}

/** Per-rule status row; `detail` is `ARMED`/`PAUSED`/`RUNNING`/… */
export interface RuleStatusView {
  ruleId: string
  enabled: boolean
  detail: string
  lastAt?: number
  lastStatus?: RuleRunStatus
  lastDetail?: string
}

/** Full live surface returned by `getEventRules()`. */
export interface EventRulesView {
  armed: boolean
  statuses: RuleStatusView[]
  sources: RuleSourceView[]
  history: RuleHistoryEntry[]
}

/** Dry-run result; structurally mirrors the IPC contract. */
export interface RulePreviewView {
  ruleId: string
  ok: boolean
  wouldRun: boolean
  reason?: RulePreview['reason']
  blocked: RigGuardView[]
  missing: string[]
  error?: string
}

/** Manual FIRE NOW result; mirrors the engine's fire report. */
export interface RuleFireView {
  ruleId: string
  ruleName: string
  status: RuleRunStatus
  ok: boolean
  detail?: string
  durationMs: number
  actions: RuleActionOutcome[]
  source: 'event' | 'manual'
}

export interface RuleServiceOptions {
  getConfig: () => DeckConfig
  /** Current settings `automationEnabled`; read once at construction. */
  isArmed: () => boolean
  probes: RigGuardProbes
  runRig: (presetId: string) => Promise<RigRunResult>
  showProfile: (profileId: string) => boolean
  showPage: (profileId: string, pageId: string) => boolean
  /** Phase 2; omitted today. */
  notice?: (text: string) => number
  /** OBS source pair; omitted when OBS is unavailable on this desktop. */
  obs?: { client: RuleObsClient; source: RuleObsReader }
  /** Twitch source; omitted when the integration was not constructed. */
  twitch?: RuleTwitchSource
  /** Send one message to one phone (server `sendToClient`). */
  sendToClient?: (clientId: string, message: ServerMessage) => boolean
  logger?: Logger
  now?: () => number
  twitchPollMs?: number
  engine?: {
    settleMs?: number
    maxFiresPerMinute?: number
    historyMax?: number
  }
}

interface ProcessTrack {
  seen: boolean
  misses: number
  initialized: boolean
}

const PROCESS_POLL_DETAIL_MS = 3000

/**
 * One per desktop. Construct after the server and rig runner, call
 * `configure(store.get().rules)` and `setArmed(settings.get().automationEnabled)`,
 * then feed it snapshots/clients.
 */
export class RuleService {
  private readonly options: RuleServiceOptions
  private readonly engine: RuleEngine
  private readonly logger?: Logger
  private rules: EventRule[] = []
  private armed: boolean
  private disposed = false

  private obsAttached = false
  private unsubscribeStatus: (() => void) | null = null
  private unsubscribeEvents: (() => void) | null = null
  private obsSeedWarned = false

  private twitchTimer: NodeJS.Timeout | null = null
  private twitchPolling = false
  private twitchWasConnected = false
  private twitchWarned = false

  private readonly processes = new Map<string, ProcessTrack>()
  private lastRunning = new Set<string>()
  private hasSnapshot = false
  private lastSnapshotAt = 0

  private clientIds = new Set<string>()
  private phoneCount = 0
  private lastProfileId: string | undefined

  constructor(options: RuleServiceOptions) {
    this.options = options
    this.logger = options.logger
    this.armed = options.isArmed() === true
    this.engine = new RuleEngine({
      getConfig: options.getConfig,
      isArmed: () => this.armed && !this.disposed,
      runRig: options.runRig,
      showProfile: (profileId) => this.showProfile(profileId),
      showPage: (profileId, pageId) => this.showPage(profileId, pageId),
      ...(options.notice ? { notice: options.notice } : {}),
      probes: options.probes,
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.engine?.settleMs !== undefined ? { settleMs: options.engine.settleMs } : {}),
      ...(options.engine?.maxFiresPerMinute !== undefined
        ? { maxFiresPerMinute: options.engine.maxFiresPerMinute }
        : {}),
      ...(options.engine?.historyMax !== undefined
        ? { historyMax: options.engine.historyMax }
        : {}),
    })
  }

  /** Replace the rule list after a config save. */
  configure(rules: readonly EventRule[] | undefined): void {
    if (this.disposed) return
    this.rules = [...(rules ?? [])]
    this.engine.configure(this.rules)
    this.seedProcessNames()
    this.refreshActivations()
  }

  /**
   * Apply the local arm switch. Arming resets OBS/Twitch baselines so the first
   * post-arm observation is silent (a rule never fires on "already true").
   */
  setArmed(armed: boolean): void {
    if (this.disposed) return
    const next = armed === true
    if (next && !this.armed) {
      this.engine.resetBaselines('obs')
      this.engine.resetBaselines('twitch')
    }
    this.armed = next
    this.refreshActivations()
  }

  /** Re-read the settings switch (used after an import force-disarm). */
  syncArmed(): void {
    this.setArmed(this.options.isArmed() === true)
  }

  /** True while process rules need `GameWatcher` polling. */
  needsProcessPolling(): boolean {
    return !this.disposed && this.armed && this.processes.size > 0
  }

  /** Feed one `GameWatcher` snapshot (deduplicated by the watcher). */
  processSnapshot(running: ReadonlySet<string>): void {
    if (this.disposed) return
    this.hasSnapshot = true
    this.lastSnapshotAt = this.now()
    this.lastRunning = new Set(running)

    for (const [name, state] of this.processes) {
      const present = running.has(name)
      if (present) {
        state.misses = 0
        if (!state.initialized) {
          state.initialized = true
          state.seen = true
          continue
        }
        if (!state.seen) {
          state.seen = true
          this.editorEdge('process.started', name)
        }
        continue
      }

      if (!state.initialized) {
        state.initialized = true
        state.seen = false
        continue
      }
      state.misses += 1
      if (state.seen && state.misses >= RULE_PROCESS_EXIT_TICKS) {
        state.seen = false
        this.editorEdge('process.stopped', name)
      }
    }
  }

  /** Feed the connected-client list after a phone connects or disconnects. */
  clientsChanged(clients: readonly ConnectedClient[]): void {
    if (this.disposed) return
    const nextIds = new Set(clients.map((client) => client.id))
    const active = nextIds.size > 0
    const previousIds = this.clientIds
    this.clientIds = nextIds
    this.phoneCount = nextIds.size

    // One level for any phone; churn while another phone stays connected is a
    // no-op because the level does not change.
    this.engine.level({
      key: 'phone.present',
      kind: active ? 'phone.connected' : 'phone.disconnected',
      active,
      at: this.now(),
    })

    // Replay the last automation-chosen profile to each newly connected phone,
    // so a deck that reconnects after a game-triggered switch lands correctly.
    if (!this.lastProfileId || !this.options.sendToClient) return
    for (const client of clients) {
      if (previousIds.has(client.id)) continue
      try {
        this.options.sendToClient(client.id, { type: 'profile', profileId: this.lastProfileId })
      } catch {
        // A socket that closed between the list and the send is harmless.
      }
    }
  }

  /** Live status/history surface for the Automation dialog (P3). */
  getEventRules(): EventRulesView {
    const statuses: RuleStatusView[] = this.rules.map((rule) => {
      const status = this.engine.status(rule.id)
      return {
        ruleId: rule.id,
        enabled: status.enabled,
        detail: this.statusDetail(status),
        ...(status.lastAt !== undefined ? { lastAt: status.lastAt } : {}),
        ...(status.lastStatus !== undefined ? { lastStatus: status.lastStatus } : {}),
        ...(status.lastDetail !== undefined ? { lastDetail: status.lastDetail } : {}),
      }
    })
    return {
      armed: this.armed,
      statuses,
      sources: this.sourceViews(),
      history: this.engine.history(),
    }
  }

  /** Dry run; never executes an action. */
  async preview(ruleId: string): Promise<RulePreviewView> {
    const preview = await this.engine.preview(ruleId)
    return {
      ruleId: preview.ruleId,
      ok: preview.ok,
      wouldRun: preview.wouldRun,
      ...(preview.reason ? { reason: preview.reason } : {}),
      blocked: preview.blocked.map((guard) => ({ ...guard })),
      missing: [...preview.missing],
      ...(preview.error ? { error: preview.error } : {}),
    }
  }

  /** Manual FIRE NOW; still evaluates guards, bypasses cooldown/debounce. */
  async fire(ruleId: string): Promise<RuleFireView> {
    const result = await this.engine.fire(ruleId)
    return {
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      status: result.status,
      ok: result.ok,
      ...(result.detail ? { detail: result.detail } : {}),
      durationMs: result.durationMs,
      actions: result.actions.map((action) => ({ ...action })),
      source: result.source,
    }
  }

  clearHistory(): void {
    this.engine.clearHistory()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachObs()
    this.stopTwitchPoll()
    this.engine.dispose()
    this.processes.clear()
    this.clientIds.clear()
  }

  /* ------------------------------------------------------------------ */
  /* OBS                                                                 */
  /* ------------------------------------------------------------------ */

  private hasKind(kind: EventTriggerKind): boolean {
    return this.rules.some((rule) => rule.enabled !== false && rule.trigger.kind === kind)
  }

  private hasObsRule(): boolean {
    return (
      this.hasKind('obs.streaming') ||
      this.hasKind('obs.recording') ||
      this.hasKind('obs.replay') ||
      this.hasKind('obs.scene')
    )
  }

  private hasTwitchRule(): boolean {
    return this.hasKind('twitch.live')
  }

  private refreshActivations(): void {
    if (this.disposed) return
    const obsNeeded = this.armed && this.hasObsRule() && this.options.obs !== undefined
    if (obsNeeded) this.attachObs()
    else this.detachObs()

    const twitchNeeded = this.armed && this.hasTwitchRule() && this.options.twitch !== undefined
    if (twitchNeeded) this.startTwitchPoll()
    else this.stopTwitchPoll()
  }

  private attachObs(): void {
    const obs = this.options.obs
    if (!obs || this.obsAttached) return
    this.obsAttached = true
    this.engine.resetBaselines('obs')
    this.unsubscribeStatus = obs.client.onStatus((status) => {
      if (!this.obsAttached) return
      if (status.state === 'connected') {
        this.obsSeedWarned = false
        void this.seedObsLevels()
      } else {
        // Never synthesize "stopped/offline": just drop the baselines so the
        // next value after reconnect is a fresh baseline.
        this.engine.resetBaselines('obs')
      }
    })
    this.unsubscribeEvents = obs.client.onEvent((type, data) => {
      this.handleObsEvent(type, data)
    })
    if (obs.client.connected) void this.seedObsLevels()
  }

  private detachObs(): void {
    if (!this.obsAttached && !this.unsubscribeStatus && !this.unsubscribeEvents) return
    this.obsAttached = false
    this.unsubscribeStatus?.()
    this.unsubscribeEvents?.()
    this.unsubscribeStatus = null
    this.unsubscribeEvents = null
    this.obsSeedWarned = false
    this.engine.resetBaselines('obs')
  }

  /** One-shot status read; successes seed level baselines, failures stay unknown. */
  private async seedObsLevels(): Promise<void> {
    const obs = this.options.obs
    if (!obs || !this.obsAttached || !obs.client.connected) return
    const targets: Array<{ target: 'streaming' | 'recording' | 'replay'; kind: EventTriggerKind }> = [
      { target: 'streaming', kind: 'obs.streaming' },
      { target: 'recording', kind: 'obs.recording' },
      { target: 'replay', kind: 'obs.replay' },
    ]
    const results = await Promise.allSettled(
      targets.map(async ({ target, kind }) => {
        const reading = await obs.source.readStatus(target)
        return { kind, active: reading.active === true }
      }),
    )
    if (!this.obsAttached) return
    let seeded = 0
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      seeded += 1
      this.engine.level({
        key: result.value.kind,
        kind: result.value.kind,
        active: result.value.active,
        at: this.now(),
      })
    }
    if (seeded === 0 && !this.obsSeedWarned) {
      this.obsSeedWarned = true
      this.logger?.warn('Automation: could not read OBS output state; waiting for events.')
    }
  }

  private handleObsEvent(type: string, data: Record<string, unknown>): void {
    if (!this.obsAttached) return
    switch (type) {
      case 'StreamStateChanged':
        this.obsLevel(data, 'obs.streaming')
        break
      case 'RecordStateChanged':
        this.obsLevel(data, 'obs.recording')
        break
      case 'ReplayBufferStateChanged':
        this.obsLevel(data, 'obs.replay')
        break
      case 'CurrentProgramSceneChanged': {
        const scene = typeof data['sceneName'] === 'string' ? data['sceneName'].trim() : ''
        if (!scene) return
        this.engine.edge({
          key: 'obs.scene',
          kind: 'obs.scene',
          scene,
          at: this.now(),
        })
        break
      }
      default:
        break
    }
  }

  private obsLevel(data: Record<string, unknown>, kind: EventTriggerKind): void {
    const active = data['outputActive']
    if (typeof active !== 'boolean') return
    this.engine.level({ key: kind, kind, active, at: this.now() })
  }

  /* ------------------------------------------------------------------ */
  /* Twitch                                                              */
  /* ------------------------------------------------------------------ */

  private startTwitchPoll(): void {
    if (this.twitchTimer || !this.options.twitch) return
    this.twitchWasConnected = this.options.twitch.connected
    this.twitchWarned = false
    if (!this.twitchWasConnected) {
      // Not authorized yet: no baseline; the first authorized poll seeds it.
      this.engine.resetBaselines('twitch')
    }
    void this.pollTwitch()
    this.twitchTimer = setInterval(() => {
      void this.pollTwitch()
    }, Math.max(1, this.options.twitchPollMs ?? RULE_TWITCH_POLL_MS))
    this.twitchTimer.unref?.()
  }

  private stopTwitchPoll(): void {
    if (this.twitchTimer) {
      clearInterval(this.twitchTimer)
      this.twitchTimer = null
    }
    this.twitchWasConnected = false
    this.twitchWarned = false
    this.engine.resetBaselines('twitch')
  }

  private async pollTwitch(): Promise<void> {
    const twitch = this.options.twitch
    if (this.disposed || !twitch || !this.armed || !this.hasTwitchRule()) return
    if (this.twitchPolling) return

    if (!twitch.connected) {
      // Authorization gap: the next authorized poll must be a baseline.
      if (this.twitchWasConnected) this.engine.resetBaselines('twitch')
      this.twitchWasConnected = false
      return
    }
    if (!this.twitchWasConnected) {
      this.engine.resetBaselines('twitch')
      this.twitchWasConnected = true
    }

    this.twitchPolling = true
    try {
      const reading = await twitch.readStatus('live')
      if (this.disposed) return
      this.twitchWarned = false
      // A successful read without `active` means "no stream", not "unknown".
      this.engine.level({
        key: 'twitch.live',
        kind: 'twitch.live',
        active: reading.active === true,
        at: this.now(),
      })
    } catch {
      // Network/401 means unknown: no edge and no baseline change. One warn per
      // outage; never log the token or response body (there is none).
      if (!this.twitchWarned) {
        this.twitchWarned = true
        this.logger?.warn('Automation: Twitch live polling failed; live state is unknown.')
      }
    } finally {
      this.twitchPolling = false
    }
  }

  /* ------------------------------------------------------------------ */
  /* Process                                                             */
  /* ------------------------------------------------------------------ */

  private seedProcessNames(): void {
    const names = new Set<string>()
    for (const rule of this.rules) {
      if (rule.enabled === false) continue
      const trigger = rule.trigger
      if (trigger.kind !== 'process.started' && trigger.kind !== 'process.stopped') continue
      const name = normalizeRuleProcess(trigger.process)
      if (name) names.add(name)
    }

    for (const name of names) {
      if (this.processes.has(name)) continue
      // Adding a rule for an already-running process must not fire it.
      const seen = this.hasSnapshot && this.lastRunning.has(name)
      this.processes.set(name, {
        seen,
        misses: 0,
        initialized: this.hasSnapshot,
      })
    }
    for (const name of [...this.processes.keys()]) {
      if (!names.has(name)) this.processes.delete(name)
    }
  }

  private editorEdge(kind: 'process.started' | 'process.stopped', name: string): void {
    const process = normalizeProcessName(name) ?? name
    this.engine.edge({
      key: `process.${kind === 'process.started' ? 'started' : 'stopped'}:${process}`,
      kind,
      process,
      at: this.now(),
    })
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  private showProfile(profileId: string): boolean {
    const config = this.options.getConfig()
    if (!config.profiles.some((profile) => profile.id === profileId)) return false
    const ok = this.options.showProfile(profileId)
    if (ok) this.lastProfileId = profileId
    return ok
  }

  private showPage(profileId: string, pageId: string): boolean {
    const config = this.options.getConfig()
    const profile = config.profiles.find((candidate) => candidate.id === profileId)
    if (!profile || !profile.pages.some((page) => page.id === pageId)) return false
    const ok = this.options.showPage(profileId, pageId)
    if (ok) this.lastProfileId = profileId
    return ok
  }

  /* ------------------------------------------------------------------ */
  /* View helpers                                                        */
  /* ------------------------------------------------------------------ */

  private sourceViews(): RuleSourceView[] {
    const obs = this.options.obs
    const twitch = this.options.twitch
    const processAge = this.lastSnapshotAt ? this.now() - this.lastSnapshotAt : Number.POSITIVE_INFINITY
    const processPolling =
      this.hasKind('process.started') || this.hasKind('process.stopped')
        ? this.hasSnapshot && processAge < PROCESS_POLL_DETAIL_MS * 4
        : false
    return [
      {
        name: 'obs',
        label: 'OBS',
        available: obs?.client.connected === true,
        detail: obs ? (obs.client.connected ? 'CONNECTED' : 'OFFLINE') : 'DISABLED',
      },
      {
        name: 'twitch',
        label: 'Twitch',
        available: twitch?.connected === true,
        detail: twitch ? (twitch.connected ? 'CONNECTED' : 'OFFLINE') : 'DISABLED',
      },
      {
        name: 'process',
        label: 'Process',
        available: processPolling,
        detail: processPolling ? `${Math.round(PROCESS_POLL_DETAIL_MS / 1000)}s` : 'IDLE',
      },
      {
        name: 'phone',
        label: 'Phone',
        available: true,
        detail: `${this.phoneCount} ${this.phoneCount === 1 ? 'PHONE' : 'PHONES'}`,
      },
    ]
  }

  private statusDetail(status: RuleStatus): string {
    if (!this.armed) return 'DISARMED'
    if (!status.enabled) return 'PAUSED'
    if (status.executing) return 'RUNNING'
    if (status.skippedReason === 'cooldown') return 'COOLDOWN'
    if (
      status.lastStatus === 'failed' ||
      status.lastStatus === 'blocked' ||
      status.lastStatus === 'missing' ||
      status.lastStatus === 'busy'
    ) {
      return 'ERROR'
    }
    return 'ARMED'
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }
}
