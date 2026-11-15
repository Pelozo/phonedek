/**
 * Event-rule orchestration (P1).
 *
 * The engine is deliberately pure and injectable: it owns baselines, matching,
 * debounce/cooldown/suppression, the serialized action loop, history and status.
 * It has no sockets, Electron imports or knowledge of OBS/Twitch/processes —
 * `RuleService` (P2) is the only caller that feeds observations in.
 *
 * Rules are edges, not levels. For OBS/Twitch/phone the first observation of a
 * key is a silent baseline; a reconnect/disconnect must call `resetBaselines`
 * and let the service absorb the next observation instead of synthesizing a
 * false "stopped/offline" edge.
 */

import {
  RULE_COOLDOWN_DEFAULT_MS,
  RULE_DEBOUNCE_DEFAULT_MS,
  RULE_HISTORY_MAX,
  RULE_MAX_FIRES_PER_MINUTE,
  RULE_SETTLE_MS,
  appendRuleHistory,
  describeRuleAction,
  describeTrigger,
  normalizeRuleProcess,
  ruleMatchesTrigger,
} from '@phonedek/shared'
import type {
  DeckConfig,
  EventRule,
  EventTrigger,
  EventTriggerKind,
  RuleAction,
  RuleActionOutcome,
  RuleHistoryEntry,
  RuleRunStatus,
  RuleTriggerObservation,
} from '@phonedek/shared'
import { evaluateRigGuards, type RigGuardProbes, type RigGuardResult } from './rig-guards'
import { rigPressMessages, type RigRunResult } from './rig-runner'
import type { Logger } from './logger'

/** Guard/condition timeout; matches the rig pre-flight contract. */
export const RULE_CONDITION_TIMEOUT_MS = 3_000

/** Sources that own in-memory level baselines. `manual` has none. */
export type RuleSourceName = 'obs' | 'twitch' | 'process' | 'phone' | 'manual'

/** A level observation (OBS/Twitch/phone). The first value per key is a baseline. */
export interface RuleLevelEvent {
  /** Canonical key, e.g. `obs.streaming`, `twitch.live`, `phone.present`. */
  key: string
  kind: EventTriggerKind
  active: boolean
  at: number
}

/** A discrete edge already proven by its adapter (scene, process). */
export interface RuleEdgeEvent {
  /** e.g. `obs.scene`, `process.started:game`. */
  key: string
  kind: EventTriggerKind
  scene?: string
  process?: string
  at: number
}

/**
 * Everything host-facing is injected. P2 passes the real `RigRunner`,
 * `server.broadcastProfile`/navigate wrapper and presence count.
 */
export type RuleLogSink = Pick<Logger, 'info' | 'warn'>

export interface RuleEngineDeps {
  getConfig: () => DeckConfig
  isArmed: () => boolean
  runRig: (presetId: string) => Promise<RigRunResult>
  showProfile: (profileId: string) => boolean
  showPage: (profileId: string, pageId: string) => boolean
  /** Phase 2 notice transport; returns the number of phones reached. */
  notice?: (text: string) => number
  probes: RigGuardProbes
  now?: () => number
  /** Contract name for the log sink. */
  logger?: RuleLogSink
  /** Alias used by the P1 wiring prompt; `logger` wins when both are given. */
  log?: RuleLogSink
  settleMs?: number
  maxFiresPerMinute?: number
  historyMax?: number
}

/** Why a rule did not run an event. */
export type RuleSkipReason = 'disabled' | 'suppressed' | 'cooldown' | 'stale' | 'throttled'

/** Last skip recorded for a rule, surfaced by `status()`. */
export interface RuleSkip {
  reason: RuleSkipReason
  at: number
  detail: string
}

/** Live per-rule state for the Automation dialog / IPC view. */
export interface RuleStatus {
  ruleId: string
  name: string
  enabled: boolean
  armed: boolean
  executing: boolean
  /** Alias for `executing` used by the shared status contract. */
  active: boolean
  pending: boolean
  lastAt?: number
  lastStatus?: RuleRunStatus
  lastDetail?: string
  skipped?: RuleSkip
  /** Flat convenience copy of `skipped.reason` for IPC/UI mapping. */
  skippedReason?: RuleSkipReason
}

/**
 * Dry-run result. Never executes: `actions` reports the configured labels and
 * whether their references exist, `conditions`/`blocked` are the real guard
 * evaluations, and `wouldRun` says whether FIRE NOW would execute.
 */
export interface RulePreview {
  ruleId: string
  ruleName: string
  enabled: boolean
  /** False when disabled, missing references, or blocked conditions. */
  wouldRun: boolean
  /** True when the rule and all references/conditions are healthy. */
  ok: boolean
  reason?: RuleSkipReason
  actions: RuleActionOutcome[]
  conditions: RigGuardResult[]
  blocked: RigGuardResult[]
  missing: string[]
  error?: string
}

/** Result of a manual FIRE NOW (also written to history unless disabled). */
export interface RuleFireResult {
  ruleId: string
  ruleName: string
  status: RuleRunStatus
  ok: boolean
  detail?: string
  durationMs: number
  actions: RuleActionOutcome[]
  source: 'event' | 'manual'
}

interface RuleRuntime {
  lastAttemptAt?: number
  lastAt?: number
  lastStatus?: RuleRunStatus
  lastDetail?: string
  skipped?: RuleSkip
}

interface PendingCandidate {
  rule: EventRule
  observation: RuleTriggerObservation
  /** Present for level observations; used for the stale re-check. */
  levelKey?: string
  active?: boolean
  /** Present for scene/process edges; detects a flip before the debounce. */
  edgeKey?: string
  edgeValue?: string
  dueAt: number
  timer?: ReturnType<typeof setTimeout>
}

interface ActionRun {
  outcome: RuleActionOutcome
  stop: boolean
  busy: boolean
  missing: boolean
  failed: boolean
  partial: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function triggerSource(trigger: EventTrigger): 'obs' | 'twitch' | 'process' | 'phone' {
  switch (trigger.kind) {
    case 'obs.streaming':
    case 'obs.recording':
    case 'obs.replay':
    case 'obs.scene':
      return 'obs'
    case 'twitch.live':
      return 'twitch'
    case 'process.started':
    case 'process.stopped':
      return 'process'
    case 'phone.connected':
    case 'phone.disconnected':
      return 'phone'
  }
}

function isPhoneKind(kind: EventTriggerKind): boolean {
  return kind === 'phone.connected' || kind === 'phone.disconnected'
}

function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * One event-rule engine for the whole desktop. Callers must use exactly one
 * instance; the engine itself is not a global singleton.
 */
export class RuleEngine {
  private readonly deps: RuleEngineDeps
  private rules: EventRule[] = []
  private disposed = false

  /** `key -> active` for level sources only. */
  private readonly baselines = new Map<string, boolean>()
  /** Latest scene/process edge value, used to discard a superseded candidate. */
  private readonly edgeValues = new Map<string, string>()
  private readonly runtimes = new Map<string, RuleRuntime>()
  private readonly candidates = new Map<string, PendingCandidate>()

  /** Rules currently inside their action loop (manual and event runs). */
  private readonly executing = new Set<string>()
  /** `Infinity` while any run is active, then now + settle. */
  private suppressUntil = 0
  /** Incremented per suppression window, so one skip row per rule/window. */
  private suppressionWindow = 0
  private readonly suppressedWindows = new Map<string, number>()

  /** Actual event-driven executions in the rolling minute. */
  private fireTimes: number[] = []

  /** Serializes event-driven action loops; manual fires bypass the queue. */
  private executionChain: Promise<void> = Promise.resolve()

  private entries: RuleHistoryEntry[] = []
  private seq = 0

  constructor(deps: RuleEngineDeps) {
    this.deps = deps
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private logger(): RuleLogSink | undefined {
    return this.deps.logger ?? this.deps.log
  }

  private historyMax(): number {
    return Math.max(0, Math.floor(this.deps.historyMax ?? RULE_HISTORY_MAX))
  }

  private settleMs(): number {
    return Math.max(0, this.deps.settleMs ?? RULE_SETTLE_MS)
  }

  private maxFires(): number {
    return Math.max(0, Math.floor(this.deps.maxFiresPerMinute ?? RULE_MAX_FIRES_PER_MINUTE))
  }

  private findRule(ruleId: string): EventRule | undefined {
    return this.rules.find((rule) => rule.id === ruleId)
  }

  /**
   * Replace the rule list. Rule identity is by id: history survives, pending
   * debounces for unchanged rules keep running, and removed/changed/disabled
   * rules lose their pending timer.
   */
  configure(rules: readonly EventRule[] | undefined): void {
    this.rules = [...(rules ?? [])]

    for (const [ruleId, candidate] of [...this.candidates]) {
      const next = this.findRule(ruleId)
      if (
        !next ||
        next.enabled === false ||
        JSON.stringify(next.trigger) !== JSON.stringify(candidate.rule.trigger)
      ) {
        this.cancelCandidate(ruleId)
      } else {
        candidate.rule = next
      }
    }

    const ids = new Set(this.rules.map((rule) => rule.id))
    for (const id of [...this.runtimes.keys()]) {
      if (!ids.has(id)) this.runtimes.delete(id)
    }
  }

  /**
   * Drop baselines for one source after a disconnect/reconnect/auth change.
   * Pending debounces from that source are cancelled too, so a reconnect cannot
   * fire on an observation that happened before the outage.
   */
  resetBaselines(source: 'obs' | 'twitch' | 'phone'): void {
    if (this.disposed) return

    for (const key of [...this.baselines.keys()]) {
      if (source === 'phone' ? key === 'phone.present' : key.startsWith(`${source}.`)) {
        this.baselines.delete(key)
      }
    }
    for (const key of [...this.edgeValues.keys()]) {
      if (key.startsWith(`${source}.`)) this.edgeValues.delete(key)
    }

    for (const [ruleId, candidate] of [...this.candidates]) {
      if (triggerSource(candidate.rule.trigger) === source) this.cancelCandidate(ruleId)
    }
  }

  /** Feed a level observation. The first value per key is always silent. */
  level(event: RuleLevelEvent): void {
    if (this.disposed) return

    const key = isPhoneKind(event.kind) ? 'phone.present' : event.key
    const hadBaseline = this.baselines.has(key)
    const baseline = this.baselines.get(key)
    this.baselines.set(key, event.active)

    if (!hadBaseline) return
    if (baseline === event.active) return

    this.consider({ kind: event.kind, active: event.active }, key, event.active)
  }

  /** Feed a discrete edge that the adapter already proved. */
  edge(event: RuleEdgeEvent): void {
    if (this.disposed) return

    const observation: RuleTriggerObservation = {
      kind: event.kind,
      scene: event.scene,
      process: event.process,
    }

    let edgeKey: string | undefined
    let edgeValue: string | undefined
    if (event.kind === 'obs.scene' && event.scene !== undefined) {
      edgeKey = 'obs.scene'
      edgeValue = event.scene.trim()
      this.edgeValues.set(edgeKey, edgeValue)
    } else if (
      (event.kind === 'process.started' || event.kind === 'process.stopped') &&
      event.process !== undefined
    ) {
      edgeKey = `process:${normalizeRuleProcess(event.process)}`
      edgeValue = event.kind
      this.edgeValues.set(edgeKey, edgeValue)
    }

    this.consider(observation, undefined, undefined, edgeKey, edgeValue)
  }

  private consider(
    observation: RuleTriggerObservation,
    levelKey?: string,
    active?: boolean,
    edgeKey?: string,
    edgeValue?: string,
  ): void {
    const now = this.now()
    // Disarmed rules write no history; baselines above still track the world.
    if (!this.deps.isArmed()) return

    if (this.isSuppressed(now)) {
      this.recordSuppression(observation, now)
      return
    }

    for (const rule of this.matchingRules(observation)) {
      this.considerRule(rule, observation, now, levelKey, active, edgeKey, edgeValue)
    }
  }

  private matchingRules(observation: RuleTriggerObservation): EventRule[] {
    return this.rules.filter(
      (rule) => rule.enabled !== false && ruleMatchesTrigger(rule.trigger, observation),
    )
  }

  private considerRule(
    rule: EventRule,
    observation: RuleTriggerObservation,
    now: number,
    levelKey?: string,
    active?: boolean,
    edgeKey?: string,
    edgeValue?: string,
  ): void {
    if (this.isThrottled(now)) {
      this.recordSkip(rule, 'throttled', now, 'Throttled: 12 fires per minute.')
      return
    }

    const runtime = this.runtime(rule.id)
    const cooldownMs = Math.max(0, rule.cooldownMs ?? RULE_COOLDOWN_DEFAULT_MS)
    if (
      runtime.lastAttemptAt !== undefined &&
      now - runtime.lastAttemptAt < cooldownMs
    ) {
      const remaining = cooldownMs - (now - runtime.lastAttemptAt)
      this.recordSkip(
        rule,
        'cooldown',
        now,
        `Cooldown: ${Math.max(0, Math.ceil(remaining / 1000))}s remaining.`,
      )
      return
    }

    this.schedule(rule, observation, now, levelKey, active, edgeKey, edgeValue)
  }

  private schedule(
    rule: EventRule,
    observation: RuleTriggerObservation,
    now: number,
    levelKey?: string,
    active?: boolean,
    edgeKey?: string,
    edgeValue?: string,
  ): void {
    const existing = this.candidates.get(rule.id)
    if (existing?.timer !== undefined) clearTimeout(existing.timer)

    const debounceMs = Math.max(
      0,
      Math.min(30_000, rule.debounceMs ?? RULE_DEBOUNCE_DEFAULT_MS),
    )
    const candidate: PendingCandidate = {
      rule,
      observation,
      dueAt: now + debounceMs,
      ...(levelKey !== undefined ? { levelKey } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(edgeKey !== undefined ? { edgeKey } : {}),
      ...(edgeValue !== undefined ? { edgeValue } : {}),
    }

    candidate.timer = setTimeout(() => {
      void this.runCandidate(candidate).catch((error) => this.reportError(error))
    }, debounceMs)
    this.candidates.set(rule.id, candidate)
  }

  private cancelCandidate(ruleId: string): void {
    const candidate = this.candidates.get(ruleId)
    if (!candidate) return
    if (candidate.timer !== undefined) clearTimeout(candidate.timer)
    this.candidates.delete(ruleId)
  }

  private async runCandidate(candidate: PendingCandidate): Promise<void> {
    if (this.disposed) return
    if (this.candidates.get(candidate.rule.id) !== candidate) return
    this.candidates.delete(candidate.rule.id)

    const rule = this.findRule(candidate.rule.id)
    if (!rule || rule.enabled === false) return
    // Re-check the arm switch: disarming during the debounce is silent.
    if (!this.deps.isArmed()) return

    const now = this.now()

    // A candidate scheduled *before* another run started is not a suppressed
    // event: it waits in `executionChain` and runs serially.
    if (candidate.levelKey !== undefined) {
      const baseline = this.baselines.get(candidate.levelKey)
      if (baseline !== candidate.active) {
        this.recordSkip(
          rule,
          'stale',
          now,
          'Stale: the trigger flipped back before the debounce settled.',
        )
        return
      }
    }
    if (
      candidate.edgeKey !== undefined &&
      this.edgeValues.get(candidate.edgeKey) !== candidate.edgeValue
    ) {
      this.recordSkip(
        rule,
        'stale',
        now,
        'Stale: a newer scene/process edge superseded this one.',
      )
      return
    }

    if (this.isThrottled(now)) {
      this.recordSkip(rule, 'throttled', now, 'Throttled: 12 fires per minute.')
      return
    }

    const evaluation = await evaluateRigGuards(rule.conditions, this.deps.probes, {
      timeoutMs: RULE_CONDITION_TIMEOUT_MS,
    })
    if (this.disposed) return

    if (!evaluation.ok) {
      this.recordBlocked(rule, evaluation, 'event', now)
      return
    }

    await this.enqueueEventExecution(rule, evaluation.results)
  }

  /**
   * Event runs are serialized (including two rules matching the same edge).
   * Re-check arm/throttle/rule existence when the queue reaches this task.
   */
  private enqueueEventExecution(
    rule: EventRule,
    conditions: RigGuardResult[],
  ): Promise<void> {
    const run = this.executionChain.then(async () => {
      if (this.disposed) return
      const current = this.findRule(rule.id)
      if (!current || current.enabled === false) return
      if (!this.deps.isArmed()) return

      const at = this.now()
      if (this.isThrottled(at)) {
        this.recordSkip(current, 'throttled', at, 'Throttled: 12 fires per minute.')
        return
      }
      await this.executeRule(current, 'event', conditions)
    })

    this.executionChain = run.catch((error) => {
      this.reportError(error)
    })
    return run
  }

  private isSuppressed(now: number): boolean {
    return this.executing.size > 0 || now < this.suppressUntil
  }

  private isThrottled(now: number): boolean {
    this.pruneFires(now)
    return this.fireTimes.length >= this.maxFires()
  }

  private pruneFires(now: number): void {
    this.fireTimes = this.fireTimes.filter((at) => now - at < 60_000)
  }

  /**
   * Record at most one suppressed row per matching rule per window. The first
   * event during execution and the first during the trailing settle window each
   * get one row; the rest are intentionally silent.
   */
  private recordSuppression(observation: RuleTriggerObservation, now: number): void {
    for (const rule of this.matchingRules(observation)) this.recordSuppressionFor(rule, now)
  }

  private recordSuppressionFor(rule: EventRule, now: number): void {
    const window = this.suppressionWindow
    if (this.suppressedWindows.get(rule.id) === window) return
    this.suppressedWindows.set(rule.id, window)
    this.recordSkip(
      rule,
      'suppressed',
      now,
      this.executing.size > 0
        ? 'Suppressed: another rule is running.'
        : 'Suppressed: settling after a run.',
    )
  }

  private beginExecution(ruleId: string): void {
    if (this.executing.size === 0) {
      this.suppressUntil = Number.POSITIVE_INFINITY
      this.suppressionWindow += 1
    }
    this.executing.add(ruleId)
  }

  private endExecution(ruleId: string): void {
    this.executing.delete(ruleId)
    if (this.executing.size === 0) {
      // Keep the same window through the trailing settle so one rule gets at
      // most one suppressed row for the whole execution + settle period.
      this.suppressUntil = this.disposed ? 0 : this.now() + this.settleMs()
    }
  }

  private runtime(ruleId: string): RuleRuntime {
    let runtime = this.runtimes.get(ruleId)
    if (!runtime) {
      runtime = {}
      this.runtimes.set(ruleId, runtime)
    }
    return runtime
  }

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  private record(
    rule: EventRule,
    source: 'event' | 'manual',
    status: RuleRunStatus,
    at: number,
    durationMs: number,
    actions: RuleActionOutcome[],
    detail: string | undefined,
    skip?: RuleSkip,
  ): RuleHistoryEntry {
    const entry: RuleHistoryEntry = {
      seq: this.nextSeq(),
      ruleId: rule.id,
      ruleName: rule.name,
      at,
      trigger: describeTrigger(rule.trigger),
      status,
      durationMs: Math.max(0, Math.round(durationMs)),
      source,
      actions: actions.map((action) => ({ ...action })),
      ...(detail ? { detail } : {}),
    }
    this.entries = appendRuleHistory(this.entries, entry, this.historyMax())

    const runtime = this.runtime(rule.id)
    runtime.lastAt = at
    runtime.lastStatus = status
    if (detail) runtime.lastDetail = detail
    else delete runtime.lastDetail
    if (skip) runtime.skipped = skip
    else delete runtime.skipped

    return entry
  }

  private recordSkip(
    rule: EventRule,
    reason: RuleSkipReason,
    at: number,
    detail: string,
    source: 'event' | 'manual' = 'event',
  ): void {
    const status: RuleRunStatus = reason === 'throttled' ? 'throttled' : 'skipped'
    this.record(rule, source, status, at, 0, [], detail, { reason, at, detail })
  }

  private recordBlocked(
    rule: EventRule,
    evaluation: { results: RigGuardResult[]; blocked: RigGuardResult[] },
    source: 'event' | 'manual',
    startedAt: number,
  ): RuleFireResult {
    const detail =
      evaluation.blocked[0]?.error ??
      `${pluralize(evaluation.blocked.length, 'condition', 'conditions')} blocked.`
    const at = this.now()
    const entry = this.record(rule, source, 'blocked', at, at - startedAt, [], detail)
    return this.fireResult(entry)
  }

  private fireResult(entry: RuleHistoryEntry): RuleFireResult {
    return {
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      status: entry.status,
      ok: entry.status === 'ok',
      ...(entry.detail ? { detail: entry.detail } : {}),
      durationMs: entry.durationMs,
      actions: entry.actions,
      source: entry.source,
    }
  }

  /**
   * Action loop shared by event fires and manual FIRE NOW. Marks the engine
   * executing *before* the first await, so two event candidates can never run
   * actions concurrently.
   */
  private async executeRule(
    rule: EventRule,
    source: 'event' | 'manual',
    conditions: RigGuardResult[],
  ): Promise<RuleFireResult> {
    void conditions
    const startedAt = this.now()
    if (source === 'event') {
      this.pruneFires(startedAt)
      this.fireTimes.push(startedAt)
    }

    const config = this.deps.getConfig()
    const outcomes: RuleActionOutcome[] = []
    let status: RuleRunStatus = 'ok'
    let busySeen = false
    let missingSeen = false
    let failedSeen = false
    let partialSeen = false

    this.beginExecution(rule.id)
    try {
      for (const action of rule.actions) {
        if (this.disposed) break
        const run = await this.runAction(action, config)
        outcomes.push(run.outcome)

        if (run.busy) {
          busySeen = true
          if (rule.onBusy !== 'continue') break
          continue
        }
        if (run.missing) {
          missingSeen = true
          break
        }
        if (run.failed) {
          failedSeen = true
          break
        }
        if (run.partial) {
          partialSeen = true
          break
        }
      }
    } finally {
      this.endExecution(rule.id)
    }

    if (failedSeen) status = 'failed'
    else if (missingSeen) status = 'missing'
    else if (busySeen) status = rule.onBusy === 'continue' && !partialSeen ? 'partial' : 'busy'
    else if (partialSeen) status = 'partial'

    const firstProblem = outcomes.find((outcome) => !outcome.ok)
    const detail =
      status === 'ok'
        ? `${outcomes.length} ${pluralize(outcomes.length, 'action', 'actions')} ok.`
        : (firstProblem?.message ??
          (busySeen ? 'A rig is already running.' : 'Rule action failed.'))

    if (this.disposed) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        status,
        ok: status === 'ok',
        ...(detail ? { detail } : {}),
        durationMs: this.now() - startedAt,
        actions: outcomes,
        source,
      }
    }

    const at = this.now()
    const runtime = this.runtime(rule.id)
    runtime.lastAttemptAt = at
    const entry = this.record(rule, source, status, at, at - startedAt, outcomes, detail)

    const target =
      outcomes.find((outcome) => outcome.target)?.target ?? `${outcomes.length} actions`
    this.logger()?.info(
      `Automation: "${rule.name}" -> ${status}${target ? ` (${target})` : ''}, ` +
        `${outcomes.length} ${pluralize(outcomes.length, 'action', 'actions')}, ` +
        `${(Math.max(0, at - startedAt) / 1000).toFixed(1)}s`,
    )

    return this.fireResult(entry)
  }

  private async runAction(action: RuleAction, config: DeckConfig): Promise<ActionRun> {
    switch (action.kind) {
      case 'runRig': {
        const rig = config.rigs?.find((candidate) => candidate.id === action.presetId)
        if (!rig) {
          return this.actionFailure(
            action,
            action.presetId,
            rigPressMessages.missing(action.presetId),
            'missing',
          )
        }

        let result: RigRunResult
        try {
          result = await this.deps.runRig(action.presetId)
        } catch (error) {
          return this.actionFailure(action, rig.name, errorMessage(error), 'failed')
        }

        if (result.status === 'ok') {
          return {
            outcome: {
              kind: action.kind,
              ok: true,
              target: result.name,
              ...(result.message ? { message: result.message } : {}),
            },
            stop: false,
            busy: false,
            missing: false,
            failed: false,
            partial: false,
          }
        }

        if (result.status === 'busy') {
          return {
            outcome: {
              kind: action.kind,
              ok: false,
              target: result.name,
              message: result.error ?? `Rig "${result.name}" is already running.`,
            },
            stop: true,
            busy: true,
            missing: false,
            failed: false,
            partial: false,
          }
        }

        if (result.status === 'partial') {
          return this.actionFailure(
            action,
            result.name,
            result.error ?? `${result.name} completed partially.`,
            'partial',
          )
        }

        // `RigRunStatus` has no `missing` member, but a fake/P2 adapter may
        // surface one; also recover the runner's missing-preset failure.
        const missing =
          (result.status as string) === 'missing' ||
          result.error === rigPressMessages.missing(action.presetId)
        return this.actionFailure(
          action,
          result.name || action.presetId,
          result.error ?? `Rig "${rig.name}" failed.`,
          missing ? 'missing' : 'failed',
        )
      }

      case 'showProfile': {
        const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
        const target = profile?.name ?? action.profileId
        let ok = false
        try {
          ok = this.deps.showProfile(action.profileId)
        } catch (error) {
          return this.actionFailure(action, target, errorMessage(error), 'failed')
        }
        if (!ok) {
          return this.actionFailure(
            action,
            target,
            `Profile "${action.profileId}" is not configured.`,
            'failed',
          )
        }
        return this.actionSuccess(action, target)
      }

      case 'showPage': {
        const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
        const page = profile?.pages.find((candidate) => candidate.id === action.pageId)
        const target = `${profile?.name ?? action.profileId} / ${page?.name ?? action.pageId}`
        let ok = false
        try {
          ok = this.deps.showPage(action.profileId, action.pageId)
        } catch (error) {
          return this.actionFailure(action, target, errorMessage(error), 'failed')
        }
        if (!ok) {
          return this.actionFailure(
            action,
            target,
            `Page "${action.profileId} / ${action.pageId}" is not configured.`,
            'failed',
          )
        }
        return this.actionSuccess(action, target)
      }

      case 'notice': {
        if (!this.deps.notice) {
          return this.actionSuccess(action, '0 phones')
        }
        let phones = 0
        try {
          const reached = this.deps.notice(action.text)
          phones = Number.isFinite(reached) ? Math.max(0, Math.trunc(reached)) : 0
        } catch {
          // Never include notice text in a log/history error.
          return this.actionFailure(action, '0 phones', 'Notice could not be delivered.', 'failed')
        }
        return this.actionSuccess(
          action,
          `${phones} ${pluralize(phones, 'phone', 'phones')}`,
        )
      }
    }
  }

  private actionSuccess(action: RuleAction, target: string): ActionRun {
    return {
      outcome: { kind: action.kind, ok: true, target },
      stop: false,
      busy: false,
      missing: false,
      failed: false,
      partial: false,
    }
  }

  private actionFailure(
    action: RuleAction,
    target: string,
    message: string,
    kind: 'failed' | 'missing' | 'partial',
  ): ActionRun {
    return {
      outcome: { kind: action.kind, ok: false, target, message },
      stop: true,
      busy: false,
      missing: kind === 'missing',
      failed: kind === 'failed',
      partial: kind === 'partial',
    }
  }

  /**
   * Evaluate conditions and references without executing anything. The arm
   * switch and cooldown are intentionally ignored: this reports what the world
   * currently allows.
   */
  async preview(ruleId: string): Promise<RulePreview> {
    const rule = this.findRule(ruleId)
    if (!rule) {
      return {
        ruleId,
        ruleName: ruleId,
        enabled: false,
        wouldRun: false,
        ok: false,
        actions: [],
        conditions: [],
        blocked: [],
        missing: [],
        error: `Rule "${ruleId}" is not configured.`,
      }
    }

    const config = this.deps.getConfig()
    const evaluation = await evaluateRigGuards(rule.conditions, this.deps.probes, {
      timeoutMs: RULE_CONDITION_TIMEOUT_MS,
    })

    const actions: RuleActionOutcome[] = []
    const missing: string[] = []
    for (const action of rule.actions) {
      const label = describeRuleAction(action, {
        rigs: config.rigs,
        profiles: config.profiles,
      })
      let exists = true
      let reason: string | undefined

      switch (action.kind) {
        case 'runRig': {
          const rig = config.rigs?.find((candidate) => candidate.id === action.presetId)
          exists = rig !== undefined
          if (!exists) {
            reason = rigPressMessages.missing(action.presetId)
            missing.push(`rig "${action.presetId}"`)
          }
          break
        }
        case 'showProfile': {
          exists = config.profiles.some((candidate) => candidate.id === action.profileId)
          if (!exists) {
            reason = `Profile "${action.profileId}" is not configured.`
            missing.push(`profile "${action.profileId}"`)
          }
          break
        }
        case 'showPage': {
          const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
          const page = profile?.pages.find((candidate) => candidate.id === action.pageId)
          exists = page !== undefined
          if (!exists) {
            reason = `Page "${action.profileId} / ${action.pageId}" is not configured.`
            missing.push(`page "${action.profileId} / ${action.pageId}"`)
          }
          break
        }
        case 'notice':
          exists = true
          break
      }

      actions.push({
        kind: action.kind,
        ok: exists,
        target: label,
        ...(reason ? { message: reason } : {}),
      })
    }

    const enabled = rule.enabled !== false
    const ok = evaluation.ok && missing.length === 0
    const wouldRun = enabled && ok
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      enabled,
      wouldRun,
      ok,
      ...(!enabled ? { reason: 'disabled' as const } : {}),
      actions,
      conditions: evaluation.results,
      blocked: evaluation.blocked,
      missing,
    }
  }

  /**
   * Manual FIRE NOW. Bypasses debounce, cooldown, suppression and the arm
   * switch, but still evaluates conditions and reference existence. Disabled
   * rules stay inert (and write no history); use `preview` for a dry run.
   */
  async fire(ruleId: string): Promise<RuleFireResult> {
    const empty = { actions: [], durationMs: 0, source: 'manual' as const }
    if (this.disposed) {
      return {
        ruleId,
        ruleName: ruleId,
        status: 'skipped',
        ok: false,
        detail: 'The rule engine is disposed.',
        ...empty,
      }
    }

    const rule = this.findRule(ruleId)
    if (!rule) {
      return {
        ruleId,
        ruleName: ruleId,
        status: 'missing',
        ok: false,
        detail: `Rule "${ruleId}" is not configured.`,
        ...empty,
      }
    }

    if (rule.enabled === false) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'skipped',
        ok: false,
        detail: 'Rule is disabled.',
        ...empty,
      }
    }

    const startedAt = this.now()
    const evaluation = await evaluateRigGuards(rule.conditions, this.deps.probes, {
      timeoutMs: RULE_CONDITION_TIMEOUT_MS,
    })
    if (this.disposed) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'skipped',
        ok: false,
        detail: 'The rule engine is disposed.',
        ...empty,
      }
    }

    if (!evaluation.ok) return this.recordBlocked(rule, evaluation, 'manual', startedAt)
    return this.executeRule(rule, 'manual', evaluation.results)
  }

  /** Newest-first defensive copy. */
  history(): RuleHistoryEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      actions: entry.actions.map((action) => ({ ...action })),
    }))
  }

  clearHistory(): void {
    this.entries = []
    this.seq = 0
  }

  status(ruleId: string): RuleStatus {
    const rule = this.findRule(ruleId)
    const runtime = this.runtimes.get(ruleId)
    const executing = this.executing.has(ruleId)
    return {
      ruleId,
      name: rule?.name ?? ruleId,
      enabled: rule !== undefined && rule.enabled !== false,
      armed: this.deps.isArmed(),
      executing,
      active: executing,
      pending: this.candidates.has(ruleId),
      ...(runtime?.lastAt !== undefined ? { lastAt: runtime.lastAt } : {}),
      ...(runtime?.lastStatus !== undefined ? { lastStatus: runtime.lastStatus } : {}),
      ...(runtime?.lastDetail !== undefined ? { lastDetail: runtime.lastDetail } : {}),
      ...(runtime?.skipped !== undefined ? { skipped: { ...runtime.skipped } } : {}),
      ...(runtime?.skipped !== undefined ? { skippedReason: runtime.skipped.reason } : {}),
    }
  }

  /** Cancel every debounce; in-flight actions finish their current await. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const ruleId of [...this.candidates.keys()]) this.cancelCandidate(ruleId)
    this.executing.clear()
    this.suppressUntil = 0
  }

  private reportError(error: unknown): void {
    if (this.disposed) return
    this.logger()?.warn(`Automation rule failed: ${errorMessage(error)}`)
  }
}
