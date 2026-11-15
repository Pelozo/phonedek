import {
  RIG_DEFAULT_DEADLINE_MS,
  estimateRigMs,
  formatRigRunAge,
  rigToPlan,
} from '@phonedek/shared'
import type { PlanGroup, RigPreset, RigRunStatus } from '@phonedek/shared'
import type { ExecutePlanOptions, PlanFailure, PlanResult } from './executor'
import type { Logger } from './logger'
import {
  RIG_GUARD_TIMEOUT_MS,
  evaluateRigGuards,
  type RigGuardProbes,
  type RigGuardResult,
} from './rig-guards'

/** Compact, ≤12-char strings shown on a rig status tile. */
export const RIG_DETAIL_READY = 'READY'
export const RIG_DETAIL_NO_RIG = 'NO RIG'
export const RIG_DETAIL_PARTIAL = 'PARTIAL'
export const RIG_DETAIL_FAILED = 'FAILED'
export const RIG_DETAIL_BLOCKED = 'BLOCKED'
export const RIG_DETAIL_STOPPED = 'STOPPED'
export const RIG_DETAIL_TIMEOUT = 'TIMEOUT'

/** Progress of the rig that currently owns the runner, exposed to a busy call. */
export interface RigActiveProgress {
  presetId: string
  name: string
  /** Steps completed so far (0-based count). */
  index: number
  total: number
}

/** Final outcome of one rig attempt. Mirrors the API `RigRunResult` in P2. */
export interface RigRunResult {
  presetId: string
  name: string
  status: RigRunStatus
  ok: boolean
  completed: number
  total: number
  durationMs: number
  /** End time in ms; renderer turns this into `NOW`/`12m`/`3h`. */
  at: number
  failures: PlanFailure[]
  error?: string
  /** Success summary, e.g. `Studio: 9/9 steps in 12.3s`. */
  message?: string
  /** Guard results when guards ran (blocked or passed). */
  guards?: RigGuardResult[]
  /** Present on `busy`: the run that owns the runner. */
  active?: RigActiveProgress
}

/** Guard pre-flight result; never mutates last-run state. */
export interface RigPreview {
  presetId: string
  name: string
  ok: boolean
  total: number
  estimatedMs: number
  guards: RigGuardResult[]
  blocked: RigGuardResult[]
  error?: string
}

/** One status tile reading. `detail` follows the control-state contract. */
export interface RigStatusReading {
  detail: string
  active: boolean
  available: boolean
  status?: RigRunStatus
  error?: string
}

/** In-memory last attempt; reset on app restart. */
export interface RigLastRun {
  presetId: string
  status: RigRunStatus
  ok: boolean
  completed: number
  total: number
  at: number
  durationMs: number
  error?: string
  message?: string
}

/** `rigProgress` frame, mapped to the shared wire message by P2. */
export interface RigProgressFrame {
  phase: 'start' | 'step' | 'done'
  presetId: string
  buttonId?: string
  index: number
  total: number
  label?: string
  status?: RigRunStatus
  ok?: boolean
  error?: string
  durationMs?: number
}

export interface RigRunOptions {
  /** Defaults to the preset's id. Used by the missing-preset error. */
  presetId?: string
  /** Deck button that started the run; echoed on every progress frame. */
  buttonId?: string
  /** External cancellation (for example an HTTP caller going away). */
  signal?: AbortSignal
}

export interface RigRunnerDeps {
  /** Usually `(groups, label, options) => executor.executePlan(groups, label, options)`. */
  executePlan: (
    groups: readonly PlanGroup[],
    label: string,
    options: ExecutePlanOptions,
  ) => Promise<PlanResult>
  probes: RigGuardProbes
  /** Injectable clock for tests and status ages. */
  now?: () => number
  /** Per-guard timeout; defaults to 3 s. */
  guardTimeoutMs?: number
  logger?: Logger
}

export interface RigRunnerOptions {
  /** Called with `start`, one `step` per completed group, then `done`. */
  onProgress?: (frame: RigProgressFrame) => void
}

/**
 * Human strings for press results. These are the exact strings P2 forwards as
 * `pressResult.error` / `pressResult.message`; keep them stable.
 *
 * | outcome   | field   | string                                             |
 * |-----------|---------|----------------------------------------------------|
 * | ok        | message | `<rig>: n/n steps in X.Xs`                         |
 * | partial   | error   | `<rig>: n/n steps, k failed — <first error>`       |
 * | failed    | error   | `<rig>: failed at step i/n — <error>`              |
 * | blocked   | error   | `<rig>: blocked — <guard error>`                   |
 * | cancelled | error   | `<rig>: stopped after n/n steps.`                  |
 * | timeout   | error   | `<rig>: timed out after X.Xs at n/n steps.`        |
 * | busy      | error   | `Rig "<active>" is already running (n/n).`         |
 * | missing   | error   | `Rig "<id>" is not configured.`                    |
 */
export const rigPressMessages = {
  missing: (presetId: string): string => `Rig "${presetId}" is not configured.`,
  busy: (name: string, index: number, total: number): string =>
    `Rig "${name}" is already running (${index}/${total}).`,
  ok: (name: string, completed: number, total: number, durationMs: number): string =>
    `${name}: ${completed}/${total} steps in ${formatSeconds(durationMs)}`,
  partial: (
    name: string,
    completed: number,
    total: number,
    failureCount: number,
    firstError: string,
  ): string => `${name}: ${completed}/${total} steps, ${failureCount} failed — ${firstError}`,
  failed: (name: string, index: number, total: number, reason: string): string =>
    `${name}: failed at step ${index}/${total} — ${reason}`,
  blocked: (name: string, reason: string): string => `${name}: blocked — ${reason}`,
  cancelled: (name: string, completed: number, total: number): string =>
    `${name}: stopped after ${completed}/${total} steps.`,
  timeout: (name: string, completed: number, total: number, durationMs: number): string =>
    `${name}: timed out after ${formatSeconds(durationMs)} at ${completed}/${total} steps.`,
}

function formatSeconds(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}s`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ActiveRun {
  progress: RigActiveProgress
  controller: AbortController
  startedAt: number
}

function statusForPlan(plan: PlanResult): RigRunStatus {
  if (plan.cancelled) return 'cancelled'
  if (plan.timedOut) return 'timeout'
  if (plan.ok) return 'ok'
  // A fail-fast failure stops the rig; continue-mode failures report partial.
  return plan.stoppedOnFailure ? 'failed' : 'partial'
}

/**
 * Single-flight rig orchestration: guards, one atomic executor slot, abort,
 * progress and an in-memory last-run record for status tiles.
 *
 * The runner never resolves a preset id from a phone request; P2 passes the
 * config-resolved preset (or `undefined` when it no longer exists).
 */
export class RigRunner {
  private readonly deps: RigRunnerDeps
  private readonly options: RigRunnerOptions
  private activeRun: ActiveRun | undefined
  private readonly lastRuns = new Map<string, RigLastRun>()

  constructor(deps: RigRunnerDeps, options: RigRunnerOptions = {}) {
    this.deps = deps
    this.options = options
  }

  /** The run that currently owns the executor, if any. */
  get active(): RigActiveProgress | undefined {
    return this.activeRun ? { ...this.activeRun.progress } : undefined
  }

  /** Abort the active run at the next group/delay boundary. */
  abort(): boolean {
    if (!this.activeRun) return false
    this.activeRun.controller.abort()
    return true
  }

  lastRun(presetId: string): RigLastRun | undefined {
    const last = this.lastRuns.get(presetId)
    return last ? { ...last } : undefined
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private emit(frame: RigProgressFrame): void {
    try {
      this.options.onProgress?.(frame)
    } catch (error) {
      this.deps.logger?.warn(`Rig progress listener failed: ${errorMessage(error)}`)
    }
  }

  /**
   * Evaluate guards without running steps or touching last-run state.
   * Useful for the editor's pre-flight `Check` and the Inspector card.
   */
  async preview(rig: RigPreset | undefined, presetId?: string): Promise<RigPreview> {
    const id = presetId ?? rig?.id ?? ''
    if (!rig) {
      return {
        presetId: id,
        name: id,
        ok: false,
        total: 0,
        estimatedMs: 0,
        guards: [],
        blocked: [],
        error: rigPressMessages.missing(id),
      }
    }
    const evaluation = await evaluateRigGuards(rig.guards ?? [], this.deps.probes, {
      timeoutMs: this.deps.guardTimeoutMs ?? RIG_GUARD_TIMEOUT_MS,
    })
    const first = evaluation.blocked[0]
    return {
      presetId: rig.id,
      name: rig.name,
      ok: evaluation.ok,
      total: rig.steps.length,
      estimatedMs: estimateRigMs(rig),
      guards: evaluation.results,
      blocked: evaluation.blocked,
      ...(first ? { error: first.error ?? `${first.label} failed` } : {}),
    }
  }

  /**
   * Run one rig. Returns `busy` immediately if another rig is in flight, and a
   * `failed` result with the missing-preset string when the config no longer
   * contains the preset.
   */
  async run(rig: RigPreset | undefined, options: RigRunOptions = {}): Promise<RigRunResult> {
    const at = this.now()
    const presetId = options.presetId ?? rig?.id ?? ''
    if (!rig) {
      return {
        presetId,
        name: presetId,
        status: 'failed',
        ok: false,
        completed: 0,
        total: 0,
        durationMs: 0,
        at,
        failures: [],
        error: rigPressMessages.missing(presetId),
      }
    }

    const existing = this.activeRun
    if (existing) {
      const active = existing.progress
      return {
        presetId,
        name: rig.name,
        status: 'busy',
        ok: false,
        completed: 0,
        total: rig.steps.length,
        durationMs: 0,
        at,
        failures: [],
        error: rigPressMessages.busy(active.name, active.index, active.total),
        active: { ...active },
      }
    }

    const total = rig.steps.length
    const groups = rigToPlan(rig)
    const startedAt = at
    const controller = new AbortController()
    const activeRun: ActiveRun = {
      progress: { presetId: rig.id, name: rig.name, index: 0, total },
      controller,
      startedAt,
    }
    this.activeRun = activeRun

    const buttonId = options.buttonId
    const emit = (frame: Omit<RigProgressFrame, 'presetId' | 'buttonId'>): void => {
      this.emit({
        ...frame,
        presetId: rig.id,
        ...(buttonId !== undefined ? { buttonId } : {}),
      })
    }
    emit({ phase: 'start', index: 0, total, label: rig.name })

    const external = options.signal
    const onAbort = (): void => controller.abort()
    if (external) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onAbort, { once: true })
    }

    /** Store the outcome, emit `done`, and return the result. */
    const complete = (
      status: RigRunStatus,
      completed: number,
      failures: PlanFailure[],
      extra: { error?: string; message?: string; guards?: RigGuardResult[] },
    ): RigRunResult => {
      const end = this.now()
      const durationMs = Math.max(0, end - startedAt)
      const result: RigRunResult = {
        presetId: rig.id,
        name: rig.name,
        status,
        ok: status === 'ok',
        completed,
        total,
        durationMs,
        at: end,
        failures,
        ...(extra.error !== undefined ? { error: extra.error } : {}),
        ...(extra.message !== undefined ? { message: extra.message } : {}),
        ...(extra.guards !== undefined ? { guards: extra.guards } : {}),
      }
      this.lastRuns.set(rig.id, {
        presetId: rig.id,
        status,
        ok: result.ok,
        completed,
        total,
        at: end,
        durationMs,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.message !== undefined ? { message: result.message } : {}),
      })
      emit({
        phase: 'done',
        index: completed,
        total,
        label: rig.name,
        status,
        ok: result.ok,
        ...(result.error !== undefined ? { error: result.error } : {}),
        durationMs,
      })
      return result
    }

    try {
      const evaluation = await evaluateRigGuards(rig.guards ?? [], this.deps.probes, {
        timeoutMs: this.deps.guardTimeoutMs ?? RIG_GUARD_TIMEOUT_MS,
      })
      if (controller.signal.aborted) {
        return complete('cancelled', 0, [], {
          error: rigPressMessages.cancelled(rig.name, 0, total),
          guards: evaluation.results,
        })
      }
      const blocked = evaluation.blocked[0]
      if (blocked) {
        return complete('blocked', 0, [], {
          error: rigPressMessages.blocked(
            rig.name,
            blocked.error ?? `${blocked.label} failed`,
          ),
          guards: evaluation.results,
        })
      }

      const plan = await this.deps.executePlan(groups, rig.name, {
        mode: rig.onError ?? 'failFast',
        deadlineMs: rig.deadlineMs ?? RIG_DEFAULT_DEADLINE_MS,
        signal: controller.signal,
        onProgress: (progress) => {
          activeRun.progress.index = progress.index
          emit({
            phase: 'step',
            index: progress.index,
            total: progress.total,
            label: progress.label,
            ok: progress.ok,
            ...(progress.error !== undefined ? { error: progress.error } : {}),
          })
        },
      })

      const status = statusForPlan(plan)
      if (status === 'ok') {
        return complete('ok', plan.completed, plan.failures, {
          message: rigPressMessages.ok(rig.name, plan.completed, plan.total, this.now() - startedAt),
          guards: evaluation.results,
        })
      }
      if (status === 'partial') {
        const first = plan.failures[0]
        return complete('partial', plan.completed, plan.failures, {
          error: rigPressMessages.partial(
            rig.name,
            plan.completed,
            plan.total,
            plan.failures.length,
            first?.error ?? 'unknown error',
          ),
          guards: evaluation.results,
        })
      }
      if (status === 'cancelled') {
        return complete('cancelled', plan.completed, plan.failures, {
          error: rigPressMessages.cancelled(rig.name, plan.completed, plan.total),
          guards: evaluation.results,
        })
      }
      if (status === 'timeout') {
        return complete('timeout', plan.completed, plan.failures, {
          error: rigPressMessages.timeout(
            rig.name,
            plan.completed,
            plan.total,
            this.now() - startedAt,
          ),
          guards: evaluation.results,
        })
      }
      const first = plan.failures[0]
      return complete('failed', plan.completed, plan.failures, {
        error: rigPressMessages.failed(
          rig.name,
          first?.index ?? 1,
          plan.total,
          first?.error ?? 'unknown error',
        ),
        guards: evaluation.results,
      })
    } catch (error) {
      // The executor is expected to return failures, not throw; fail closed if
      // a custom implementation breaks that contract.
      return complete('failed', 0, [], { error: rigPressMessages.failed(rig.name, 1, total, errorMessage(error)) })
    } finally {
      external?.removeEventListener('abort', onAbort)
      if (this.activeRun === activeRun) this.activeRun = undefined
    }
  }

  /**
   * Detail/active reading for a rig status tile.
   *
   * While running: `3/9` once a step has completed, otherwise `RUN <age>`
   * (e.g. `RUN 2m` when guards/first step are slow). Afterwards the last-run
   * status is `READY`, `PARTIAL`, `FAILED`, `BLOCKED`, `STOPPED` or `TIMEOUT`.
   * A deleted/unknown preset reads `NO RIG`.
   */
  readStatus(rig: RigPreset | undefined, now: number = this.now()): RigStatusReading {
    if (!rig) {
      return { detail: RIG_DETAIL_NO_RIG, active: false, available: false }
    }
    const active = this.activeRun
    if (active && active.progress.presetId === rig.id) {
      const detail =
        active.progress.total > 0 && active.progress.index > 0
          ? `${active.progress.index}/${active.progress.total}`
          : `RUN ${formatRigRunAge(active.startedAt, now)}`
      return { detail, active: true, available: true }
    }

    const last = this.lastRuns.get(rig.id)
    if (!last) return { detail: RIG_DETAIL_READY, active: false, available: true }
    const details: Record<RigRunStatus, string> = {
      ok: `RUN ${formatRigRunAge(last.at, now)}`,
      partial: RIG_DETAIL_PARTIAL,
      failed: RIG_DETAIL_FAILED,
      blocked: RIG_DETAIL_BLOCKED,
      cancelled: RIG_DETAIL_STOPPED,
      timeout: RIG_DETAIL_TIMEOUT,
      busy: RIG_DETAIL_READY,
    }
    return {
      detail: details[last.status],
      active: false,
      available: true,
      status: last.status,
      ...(last.status !== 'ok' && last.error !== undefined ? { error: last.error } : {}),
    }
  }
}
