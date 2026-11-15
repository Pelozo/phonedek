import { RIG_GUARD_LABELS, describeRigGuard } from '@phonedek/shared'
import type { RigGuard, RigGuardProbe } from '@phonedek/shared'

/** Every guard probe is raced against this timeout; unknown fails closed. */
export const RIG_GUARD_TIMEOUT_MS = 3_000

/**
 * Desktop probes used by rig guards. Each returns the *observed* state; the
 * guard's `expect` (default true) decides whether that state allows the run.
 *
 * Methods are optional so P2 can wire only the integrations that exist on the
 * current desktop. A missing method makes its guard unavailable, which blocks
 * the rig (fail closed) instead of silently passing.
 */
export interface RigGuardProbes {
  obsStreaming?: () => Promise<boolean>
  obsRecording?: () => Promise<boolean>
  twitchLive?: () => Promise<boolean>
  micMuted?: () => Promise<boolean>
  /** `arg` is the configured process/application name. */
  appRunning?: (arg: string) => Promise<boolean>
  /** `arg` is the configured light id; omitted = the first light. */
  lightOn?: (arg?: string) => Promise<boolean>
}

/** One evaluated guard, in the same order as the preset's `guards` array. */
export interface RigGuardResult {
  probe: RigGuardProbe
  /** Human description, e.g. `Not OBS streaming` or `App running (discord)`. */
  label: string
  /** Effective expectation (defaults to true). */
  expect: boolean
  /** Observed value, or null when the probe was unavailable/timed out. */
  actual: boolean | null
  /** True only when the probe answered and matched `expect`. */
  ok: boolean
  available: boolean
  /** Human error for a mismatch/unavailable probe; absent on success. */
  error?: string
}

export interface RigGuardEvaluation {
  ok: boolean
  results: RigGuardResult[]
  /** Results with `ok: false`, in preset order. Empty when the rig may run. */
  blocked: RigGuardResult[]
}

export interface RigGuardOptions {
  /** Per-probe timeout; defaults to {@link RIG_GUARD_TIMEOUT_MS}. */
  timeoutMs?: number
}

interface ProbeRead {
  available: boolean
  actual: boolean | null
  error?: string
}

const STATE_WORDS: Record<RigGuardProbe, [true: string, false: string]> = {
  obsStreaming: ['streaming', 'not streaming'],
  obsRecording: ['recording', 'not recording'],
  twitchLive: ['live', 'offline'],
  micMuted: ['muted', 'unmuted'],
  appRunning: ['running', 'not running'],
  lightOn: ['on', 'off'],
}

function probeKey(guard: RigGuard): string {
  return `${guard.probe}\u0000${guard.arg ?? ''}`
}

function mismatchError(guard: RigGuard, actual: boolean): string {
  return `${describeRigGuard(guard)} (actual: ${STATE_WORDS[guard.probe][actual ? 0 : 1]}).`
}

function unavailableError(guard: RigGuard, detail?: string): string {
  const label = `${describeRigGuard(guard)} is unavailable`
  return detail ? `${label}: ${detail}` : `${label}.`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Race one probe read against the guard timeout. */
async function readWithTimeout(
  read: Promise<boolean>,
  label: string,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const budget = timeoutMs >= 1000 ? `${(timeoutMs / 1000).toFixed(1)}s` : `${timeoutMs}ms`
      reject(new Error(`${label} check timed out after ${budget}.`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([read, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function callProbe(guard: RigGuard, probes: RigGuardProbes): Promise<boolean> | undefined {
  switch (guard.probe) {
    case 'appRunning':
      // Schema requires an arg; without one the probe cannot be evaluated.
      return guard.arg ? probes.appRunning?.(guard.arg) : undefined
    case 'lightOn':
      return probes.lightOn?.(guard.arg)
    case 'obsStreaming':
      return probes.obsStreaming?.()
    case 'obsRecording':
      return probes.obsRecording?.()
    case 'twitchLive':
      return probes.twitchLive?.()
    case 'micMuted':
      return probes.micMuted?.()
  }
  return undefined
}

async function readProbe(
  guard: RigGuard,
  probes: RigGuardProbes,
  timeoutMs: number,
): Promise<ProbeRead> {
  const label = RIG_GUARD_LABELS[guard.probe]
  const promise = callProbe(guard, probes)
  if (!promise) return { available: false, actual: null, error: unavailableError(guard) }
  try {
    const value = await readWithTimeout(promise, label, timeoutMs)
    if (typeof value !== 'boolean') {
      return { available: false, actual: null, error: unavailableError(guard, 'probe returned no value') }
    }
    return { available: true, actual: value }
  } catch (error) {
    return { available: false, actual: null, error: unavailableError(guard, errorMessage(error)) }
  }
}

/**
 * Evaluate every guard in parallel, deduping identical `probe + arg` reads.
 *
 * Each unique probe has its own timeout, so the whole evaluation is bounded by
 * roughly one timeout. Unavailable probes, thrown errors and timeouts all
 * produce `ok: false` (fail closed); `expect` defaults to true and
 * `expect: false` inverts the comparison.
 */
export async function evaluateRigGuards(
  guards: readonly RigGuard[] | undefined,
  probes: RigGuardProbes,
  options: RigGuardOptions = {},
): Promise<RigGuardEvaluation> {
  const list = guards ?? []
  const timeoutMs = Math.max(1, options.timeoutMs ?? RIG_GUARD_TIMEOUT_MS)

  const unique = new Map<string, RigGuard>()
  for (const guard of list) {
    const key = probeKey(guard)
    if (!unique.has(key)) unique.set(key, guard)
  }

  // Start every unique probe before awaiting any of them; the map preserves
  // insertion order, which keeps the result list deterministic.
  const pending = new Map<string, Promise<ProbeRead>>()
  for (const [key, guard] of unique) pending.set(key, readProbe(guard, probes, timeoutMs))

  const reads = new Map<string, ProbeRead>()
  await Promise.all(
    [...pending].map(async ([key, promise]) => {
      reads.set(key, await promise)
    }),
  )

  const results: RigGuardResult[] = list.map((guard) => {
    const read = reads.get(probeKey(guard)) ?? {
      available: false,
      actual: null,
      error: unavailableError(guard),
    }
    const expect = guard.expect !== false
    const ok = read.available && read.actual === expect
    const result: RigGuardResult = {
      probe: guard.probe,
      label: describeRigGuard(guard),
      expect,
      actual: read.actual,
      ok,
      available: read.available,
    }
    if (!ok) {
      result.error =
        read.available && read.actual !== null
          ? mismatchError(guard, read.actual)
          : (read.error ?? unavailableError(guard))
    }
    return result
  })

  const blocked = results.filter((result) => !result.ok)
  return { ok: blocked.length === 0, results, blocked }
}
