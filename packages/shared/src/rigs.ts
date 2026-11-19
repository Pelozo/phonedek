/**
 * Rig preset helpers shared by the desktop (P1/P2) and the editor (P3).
 *
 * A rig is a named, guarded, ordered list of existing host actions. These
 * helpers only transform plain data; nothing here touches a window, process or
 * socket, so the phone and renderer bundles can import them safely.
 */

import { actionsToPlan, describeAction } from './actions'
import type {
  PlanGroup,
  PlanStep,
  RigGuard,
  RigGuardProbe,
  RigPreset,
  RigRunAction,
  RigStep,
} from './types'

/** Human labels for the guard probes, used by the editor and run report. */
export const RIG_GUARD_LABELS: Record<RigGuardProbe, string> = {
  obsStreaming: 'OBS streaming',
  obsRecording: 'OBS recording',
  twitchLive: 'Twitch live',
  micMuted: 'Microphone muted',
  appRunning: 'App running',
  lightOn: 'Light on',
}

/** Fixed cost per planned step; keeps estimates monotonic as steps are added. */
const STEP_OVERHEAD_MS = 50
/** A short launch/URL/command is assumed to take this long before returning. */
const SPAWN_OVERHEAD_MS = 100
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function stepLabel(step: RigStep): string {
  // Rig step labels are capped at 60 chars on the wire.
  return (step.label ?? describeAction(step.action)).slice(0, 60)
}

/**
 * Expand a rig into one plan group per step, in rig order.
 *
 * A macro step stays one group even though `actionsToPlan` expands it into many
 * `PlanStep`s, so `delayMs`/`continueOnError` keep their rig-step meaning and
 * progress can report `index/total` over rig steps. `continueOnError` is
 * resolved here: a per-step flag wins, otherwise `onError: 'continue'` makes
 * every group continue, and the default `failFast` aborts on the first failure.
 *
 * The rig's own `deadlineMs` is a runner concern and is not encoded in the
 * plan. Nested rigs/pages/keyboard/mixer steps are impossible by type/schema.
 */
export function rigToPlan(rig: RigPreset): PlanGroup[] {
  return rig.steps.map((step) => ({
    label: stepLabel(step),
    steps: actionsToPlan([step.action]),
    ...(step.delayMs !== undefined ? { delayMs: step.delayMs } : {}),
    continueOnError: step.continueOnError ?? rig.onError === 'continue',
  }))
}

function estimateStepMs(step: PlanStep): number {
  switch (step.kind) {
    case 'keys':
      // Held keys can dominate a rig; a press is short but still costs overhead.
      return STEP_OVERHEAD_MS + step.holdMs
    case 'text':
      return STEP_OVERHEAD_MS + step.text.length * step.perCharMs
    case 'delay':
      return step.ms
    case 'launch':
    case 'url':
    case 'command':
      return STEP_OVERHEAD_MS + SPAWN_OVERHEAD_MS
    case 'mouse':
      return STEP_OVERHEAD_MS + 10
    case 'audioDevice':
      // A device lookup plus one OS write is short, but not free (helper RPC).
      return STEP_OVERHEAD_MS + 25
    default:
      return STEP_OVERHEAD_MS
  }
}

/**
 * Conservative wall-clock estimate for one rig, excluding guard evaluation.
 *
 * The estimate is deterministic and monotonic: adding a step or increasing a
 * delay never decreases it. It is used for editor hints, not deadlines.
 */
export function estimateRigMs(rig: RigPreset): number {
  let total = 0
  for (const group of rigToPlan(rig)) {
    for (const step of group.steps) total += estimateStepMs(step)
    total += group.delayMs ?? 0
  }
  return total
}

/** One-line guard description, e.g. `Not OBS streaming` or `App running (discord)`. */
export function describeRigGuard(guard: RigGuard): string {
  const base = guard.label?.trim() || RIG_GUARD_LABELS[guard.probe]
  const arg =
    guard.arg !== undefined && (guard.probe === 'appRunning' || guard.probe === 'lightOn')
      ? ` (${guard.arg})`
      : ''
  const text = `${base}${arg}`
  return guard.expect === false ? `Not ${text}` : text
}

/**
 * Compact age for a last-run chip: `NOW`, `12m`, `3h`, `2d`.
 *
 * Boundaries are floor-based: under a minute is NOW, then minutes under an
 * hour, hours under a day, and days above that. Future/invalid timestamps do
 * not produce negative labels.
 */
export function formatRigRunAge(at: number | null | undefined, now: number = Date.now()): string {
  if (at === null || at === undefined || !Number.isFinite(at) || !Number.isFinite(now)) return 'NEVER'
  const age = Math.max(0, now - at)
  if (age < MINUTE_MS) return 'NOW'
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m`
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)}h`
  return `${Math.floor(age / DAY_MS)}d`
}

/** Find a configured rig by id; tolerates an older config without rigs. */
export function rigById(rigs: readonly RigPreset[] | undefined, id: string): RigPreset | undefined {
  return rigs?.find((rig) => rig.id === id)
}

/** Structural check for a rig run action (safe on both staged and widened unions). */
export function isRigRunAction(value: unknown): value is RigRunAction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; action?: unknown; presetId?: unknown }
  return candidate.type === 'rig' && candidate.action === 'run' && typeof candidate.presetId === 'string'
}

/** True when any action starts a rig. */
export function hasRigAction(actions: readonly unknown[] | undefined): boolean {
  return rigActionOf(actions) !== undefined
}

/** First rig run action in a button's action list, if any. */
export function rigActionOf(actions: readonly unknown[] | undefined): RigRunAction | undefined {
  return actions?.find(isRigRunAction)
}

/** Editor label for a rig action; falls back to the id when the rig is missing. */
export function describeRigAction(action: RigRunAction, rig?: RigPreset): string {
  const name = rig?.name ?? action.presetId
  return `Run rig "${name}"`
}
