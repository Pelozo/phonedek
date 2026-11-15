/**
 * Event-rule helpers shared by the desktop engine (P1), wiring (P2) and the
 * editor (P3).
 *
 * Everything here is pure data: no sockets, timers, processes or Electron. The
 * runtime and the renderer can import the same labels and keys, so a history
 * row, a log line and a rail subtitle cannot drift apart.
 */

import type {
  DeckConfig,
  DeckProfile,
  EventRule,
  EventTrigger,
  EventTriggerKind,
  RigPreset,
  RuleAction,
  RuleHistoryEntry,
} from './types'
import { RULE_HISTORY_MAX, RULE_MAX_ACTIONS, RULE_MAX_CONDITIONS } from './types'

/**
 * Config-shaped lookup used to turn reference-only actions into human labels.
 * Missing targets fall back to the raw id, so a dangling rule is still
 * describable (and visibly red) in the editor.
 */
export interface RuleActionLookup {
  rigs?: readonly RigPreset[]
  profiles?: readonly DeckProfile[]
}

/**
 * One normalized observation fed to `ruleMatchesTrigger`.
 *
 * Level sources (OBS/Twitch/phone) supply `active`; discrete edges (scene,
 * process) supply `scene`/`process`. The engine already proved the transition.
 */
export interface RuleTriggerObservation {
  kind: EventTriggerKind
  active?: boolean
  scene?: string
  process?: string
}

/**
 * Canonical process match name: basename, lowercase, without `.exe`.
 *
 * Kept intentionally local to rules (and re-exported by the desktop settings
 * store) so trigger keys and process snapshots use one spelling.
 */
export function normalizeRuleProcess(name: string): string {
  const trimmed = name.trim()
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed
  return base.toLowerCase().replace(/\.exe$/i, '')
}

/**
 * Edge key for a trigger: the identity of the *thing* that changes, not the
 * desired value. Two rules watching `obs.streaming` true and false share one
 * baseline; phone connect/disconnect share `phone.present`.
 */
export function ruleTriggerKey(trigger: EventTrigger): string {
  switch (trigger.kind) {
    case 'obs.scene':
      return `${trigger.kind}:${trigger.scene.trim()}`
    case 'process.started':
    case 'process.stopped':
      return `${trigger.kind}:${normalizeRuleProcess(trigger.process)}`
    case 'phone.connected':
    case 'phone.disconnected':
      return 'phone.present'
    default:
      return trigger.kind
  }
}

/**
 * True when an observed transition satisfies a rule trigger.
 *
 * Boolean kinds require the observed value to equal `trigger.active`; scene and
 * process edges compare their normalized values. Phone triggers may be matched
 * by explicit `phone.connected`/`phone.disconnected` observations or by the
 * presence level (`active`).
 */
export function ruleMatchesTrigger(trigger: EventTrigger, event: RuleTriggerObservation): boolean {
  switch (trigger.kind) {
    case 'phone.connected':
    case 'phone.disconnected': {
      const present =
        event.active ??
        (event.kind === 'phone.connected'
          ? true
          : event.kind === 'phone.disconnected'
            ? false
            : undefined)
      if (present === undefined) return false
      return trigger.kind === 'phone.connected' ? present : !present
    }
    case 'obs.scene':
      return event.kind === 'obs.scene' && event.scene !== undefined && event.scene.trim() === trigger.scene.trim()
    case 'process.started':
    case 'process.stopped':
      return (
        event.kind === trigger.kind &&
        event.process !== undefined &&
        normalizeRuleProcess(event.process) === normalizeRuleProcess(trigger.process)
      )
    default:
      return event.kind === trigger.kind && event.active === trigger.active
  }
}

/** One-line trigger label, e.g. `OBS stream started` or `Process started (game)`. */
export function describeTrigger(trigger: EventTrigger): string {
  switch (trigger.kind) {
    case 'obs.streaming':
      return trigger.active ? 'OBS stream started' : 'OBS stream stopped'
    case 'obs.recording':
      return trigger.active ? 'OBS recording started' : 'OBS recording stopped'
    case 'obs.replay':
      return trigger.active ? 'OBS replay buffer started' : 'OBS replay buffer stopped'
    case 'twitch.live':
      return trigger.active ? 'Twitch went live' : 'Twitch went offline'
    case 'obs.scene':
      return `OBS scene "${trigger.scene}"`
    case 'process.started':
      return `Process started (${trigger.process})`
    case 'process.stopped':
      return `Process stopped (${trigger.process})`
    case 'phone.connected':
      return 'Phone connected'
    case 'phone.disconnected':
      return 'Phone disconnected'
  }
}

/** One-line action label, resolving ids to names when a config lookup is given. */
export function describeRuleAction(action: RuleAction, lookup?: RuleActionLookup): string {
  switch (action.kind) {
    case 'runRig': {
      const rig = lookup?.rigs?.find((candidate) => candidate.id === action.presetId)
      return `Run rig "${rig?.name ?? action.presetId}"`
    }
    case 'showProfile': {
      const profile = lookup?.profiles?.find((candidate) => candidate.id === action.profileId)
      return `Show profile "${profile?.name ?? action.profileId}"`
    }
    case 'showPage': {
      const profile = lookup?.profiles?.find((candidate) => candidate.id === action.profileId)
      const page = profile?.pages.find((candidate) => candidate.id === action.pageId)
      if (!profile) return `Show page "${action.profileId} / ${action.pageId}"`
      return `Show page "${page?.name ?? action.pageId}" (${profile.name})`
    }
    case 'notice':
      return `Notify "${action.text}"`
  }
}

/**
 * Compact duration for a history row: `850ms`, `3.2s`, `2m 05s`, `1h 12m`.
 * Invalid or negative values clamp to `0ms`.
 */
export function formatRuleDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1).replace(/\.0$/, '')}s`
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.floor((ms % 60_000) / 1_000)
    return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${minutes}m`
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

/** Find a rule by id; tolerates a config without rules. */
export function ruleById(rules: readonly EventRule[] | undefined, ruleId: string): EventRule | undefined {
  return rules?.find((rule) => rule.id === ruleId)
}

/** Rules in config order; always returns an array. */
export function rulesOf(config: Pick<DeckConfig, 'rules'> | undefined): readonly EventRule[] {
  return config?.rules ?? []
}

/** Rules that reference a rig through `runRig`. */
export function rulesUsingRig(rules: readonly EventRule[] | undefined, rigId: string): EventRule[] {
  return (rules ?? []).filter((rule) =>
    rule.actions.some((action) => action.kind === 'runRig' && action.presetId === rigId),
  )
}

/** Rules that reference a profile through `showProfile` or `showPage`. */
export function rulesUsingProfile(rules: readonly EventRule[] | undefined, profileId: string): EventRule[] {
  return (rules ?? []).filter((rule) =>
    rule.actions.some(
      (action) =>
        (action.kind === 'showProfile' || action.kind === 'showPage') && action.profileId === profileId,
    ),
  )
}

/** Rules that reference one page of one profile through `showPage`. */
export function rulesUsingPage(
  rules: readonly EventRule[] | undefined,
  profileId: string,
  pageId: string,
): EventRule[] {
  return (rules ?? []).filter((rule) =>
    rule.actions.some(
      (action) => action.kind === 'showPage' && action.profileId === profileId && action.pageId === pageId,
    ),
  )
}

export type RuleReference =
  | { kind: 'rig'; rigId: string }
  | { kind: 'profile'; profileId: string }
  | { kind: 'page'; profileId: string; pageId: string }

/** True when one rule carries a specific reference (used by delete flows). */
export function hasRuleReference(rule: EventRule, reference: RuleReference): boolean {
  return rule.actions.some((action) => {
    switch (reference.kind) {
      case 'rig':
        return action.kind === 'runRig' && action.presetId === reference.rigId
      case 'profile':
        return (
          (action.kind === 'showProfile' || action.kind === 'showPage') &&
          action.profileId === reference.profileId
        )
      case 'page':
        return (
          action.kind === 'showPage' &&
          action.profileId === reference.profileId &&
          action.pageId === reference.pageId
        )
    }
  })
}

/**
 * Prepend a history row, newest first, and cap the list. The engine owns the
 * `seq` counter; this helper only orders and trims.
 */
export function appendRuleHistory(
  history: readonly RuleHistoryEntry[],
  entry: RuleHistoryEntry,
  max: number = RULE_HISTORY_MAX,
): RuleHistoryEntry[] {
  const safeMax = Math.max(0, Math.floor(max))
  if (safeMax === 0) return []
  return [entry, ...history].slice(0, safeMax)
}

/** True when a rule may hold at most `RULE_MAX_ACTIONS` actions. */
export function ruleHasRoomForAction(rule: EventRule): boolean {
  return rule.actions.length < RULE_MAX_ACTIONS
}

/** True when a rule may hold at most `RULE_MAX_CONDITIONS` conditions. */
export function ruleHasRoomForCondition(rule: EventRule): boolean {
  return (rule.conditions?.length ?? 0) < RULE_MAX_CONDITIONS
}
