/**
 * Renderer-side event-rule helpers.
 *
 * Rules are config-owned and reference rigs/profiles/pages by id. Everything
 * here is pure data: labels, picker ids, draft validation, templates, reference
 * checks and history formatting. The same vocabulary is used by the rail, the
 * editor, the preview block and the tests.
 */

import {
  describeRuleAction,
  describeTrigger,
  eventRuleSchema,
  formatRigRunAge,
  normalizeRuleProcess,
  ruleActionSchema,
  RULE_COOLDOWN_DEFAULT_MS,
  RULE_COOLDOWN_MAX_MS,
  RULE_DEBOUNCE_DEFAULT_MS,
  RULE_DEBOUNCE_MAX_MS,
  RULE_MAX_ACTIONS,
  RULE_MAX_CONDITIONS,
  RULE_MAX_NAME,
  RULE_MAX_PROCESS,
  RULE_MAX_SCENE,
  RULES_MAX_RULES,
  ruleTriggerKey,
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
} from '@phonedek/shared'
import type { RulePreviewView, RuleSourceView, RuleStatusView } from '../../../shared/api'
import type { RigTone } from './rigs'

export type RuleTone = RigTone

export interface RuleStatusText {
  /** Exact token shown in the rail/editor: `READY`, `ARMED`, `PAUSED`, … */
  label: string
  detail: string
  tone: RuleTone
  /** Compact age of the last run (`NOW`, `12m`, `3h`, `NEVER`). */
  age: string
  at?: number
}

export interface RuleReferenceIssue {
  actionIndex: number
  kind: 'rig' | 'profile' | 'page'
  message: string
}

export type RuleTemplateId = 'stream-started' | 'stream-ended' | 'game-launched' | 'phone-connected'

/* ------------------------------------------------------------------ */
/* Trigger picker                                                      */
/* ------------------------------------------------------------------ */

export type RuleTriggerOptionId =
  | 'obs.streaming:on'
  | 'obs.streaming:off'
  | 'obs.recording:on'
  | 'obs.recording:off'
  | 'obs.replay:on'
  | 'obs.replay:off'
  | 'obs.scene'
  | 'twitch.live:on'
  | 'twitch.live:off'
  | 'process.started'
  | 'process.stopped'
  | 'phone.connected'
  | 'phone.disconnected'

export interface RuleTriggerOption {
  id: RuleTriggerOptionId
  group: 'OBS' | 'TWITCH' | 'PROCESS' | 'PHONE'
  label: string
  kind: EventTriggerKind
  /** Boolean arms only. */
  active?: boolean
  needs?: 'scene' | 'process'
}

export const RULE_TRIGGER_OPTIONS: readonly RuleTriggerOption[] = [
  {
    id: 'obs.streaming:on',
    group: 'OBS',
    label: 'Stream started',
    kind: 'obs.streaming',
    active: true,
  },
  {
    id: 'obs.streaming:off',
    group: 'OBS',
    label: 'Stream stopped',
    kind: 'obs.streaming',
    active: false,
  },
  {
    id: 'obs.recording:on',
    group: 'OBS',
    label: 'Recording started',
    kind: 'obs.recording',
    active: true,
  },
  {
    id: 'obs.recording:off',
    group: 'OBS',
    label: 'Recording stopped',
    kind: 'obs.recording',
    active: false,
  },
  {
    id: 'obs.replay:on',
    group: 'OBS',
    label: 'Replay buffer started',
    kind: 'obs.replay',
    active: true,
  },
  {
    id: 'obs.replay:off',
    group: 'OBS',
    label: 'Replay buffer stopped',
    kind: 'obs.replay',
    active: false,
  },
  {
    id: 'obs.scene',
    group: 'OBS',
    label: 'Scene became active',
    kind: 'obs.scene',
    needs: 'scene',
  },
  {
    id: 'twitch.live:on',
    group: 'TWITCH',
    label: 'Went live',
    kind: 'twitch.live',
    active: true,
  },
  {
    id: 'twitch.live:off',
    group: 'TWITCH',
    label: 'Went offline',
    kind: 'twitch.live',
    active: false,
  },
  {
    id: 'process.started',
    group: 'PROCESS',
    label: 'Process started',
    kind: 'process.started',
    needs: 'process',
  },
  {
    id: 'process.stopped',
    group: 'PROCESS',
    label: 'Process stopped',
    kind: 'process.stopped',
    needs: 'process',
  },
  {
    id: 'phone.connected',
    group: 'PHONE',
    label: 'Phone connected',
    kind: 'phone.connected',
  },
  {
    id: 'phone.disconnected',
    group: 'PHONE',
    label: 'Phone disconnected',
    kind: 'phone.disconnected',
  },
]

const TRIGGER_OPTION_BY_ID = new Map(RULE_TRIGGER_OPTIONS.map((option) => [option.id, option]))

/** Options for the WHEN picker. The parameter keeps the API future-proof. */
export function ruleTriggerOptionsFor(
  _trigger?: EventTrigger,
): readonly RuleTriggerOption[] {
  return RULE_TRIGGER_OPTIONS
}

/** Picker id for a stored trigger. */
export function triggerOptionId(trigger: EventTrigger): RuleTriggerOptionId {
  switch (trigger.kind) {
    case 'obs.scene':
      return 'obs.scene'
    case 'process.started':
      return 'process.started'
    case 'process.stopped':
      return 'process.stopped'
    case 'phone.connected':
      return 'phone.connected'
    case 'phone.disconnected':
      return 'phone.disconnected'
    default:
      return `${trigger.kind}:${trigger.active ? 'on' : 'off'}` as RuleTriggerOptionId
  }
}

/**
 * Build a complete trigger from a picker id.
 *
 * A scene or process name is never blank: switching arms keeps the previous
 * value when it is still relevant, otherwise a generic placeholder is used, so
 * every committed rule stays schema-valid while the user edits.
 */
export function triggerFromOption(
  id: RuleTriggerOptionId,
  previous?: EventTrigger,
): EventTrigger {
  const option = TRIGGER_OPTION_BY_ID.get(id)
  if (!option) return { kind: 'obs.streaming', active: true }
  switch (option.id) {
    case 'obs.scene':
      return {
        kind: 'obs.scene',
        scene: previous?.kind === 'obs.scene' && previous.scene.trim() ? previous.scene : 'Gameplay',
      }
    case 'process.started':
    case 'process.stopped':
      return {
        kind: option.kind as 'process.started' | 'process.stopped',
        process:
          previous?.kind === 'process.started' || previous?.kind === 'process.stopped'
            ? previous.process
            : 'game',
      }
    case 'phone.connected':
    case 'phone.disconnected':
      return { kind: option.id }
    default:
      return { kind: option.kind as 'obs.streaming', active: option.active === true }
  }
}

/** One-line trigger label (`OBS stream started`, `OBS scene "Gameplay"`). */
export function ruleTriggerLabel(trigger: EventTrigger): string {
  return describeTrigger(trigger)
}

/** Short source name for the trigger row. */
export function triggerSourceName(trigger: EventTrigger): string {
  if (trigger.kind.startsWith('obs.')) return 'OBS'
  if (trigger.kind.startsWith('twitch.')) return 'TWITCH'
  if (trigger.kind.startsWith('process.')) return 'PROCESS'
  return 'PHONE'
}

/** Normalized process name; safe on empty input. */
export function ruleProcessName(input: string): string {
  return normalizeRuleProcess(input)
}

/**
 * Hint under a process trigger field. The engine matches basenames,
 * case-insensitively and without `.exe`; tell the user exactly what is saved.
 */
export function processMatchHint(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'Enter an executable or app name, e.g. game.exe.'
  const normalized = normalizeRuleProcess(trimmed)
  if (!normalized) return 'Enter an executable or app name.'
  return trimmed === normalized
    ? `Matches “${normalized}” (case-insensitive).`
    : `Saved as “${normalized}” · .exe and case are ignored.`
}

/* ------------------------------------------------------------------ */
/* Live status / sources / preview                                     */
/* ------------------------------------------------------------------ */

const BOOLEAN_TRIGGER_KINDS = new Set<EventTriggerKind>([
  'obs.streaming',
  'obs.recording',
  'obs.replay',
  'twitch.live',
])

/** True for triggers whose "value" is on/off rather than a name. */
export function isBooleanTrigger(
  trigger: EventTrigger,
): trigger is Extract<EventTrigger, { active: boolean }> {
  return BOOLEAN_TRIGGER_KINDS.has(trigger.kind)
}

/** Edge identity shared by both arms of one trigger (mostly for tests/debug). */
export function ruleEdgeKey(trigger: EventTrigger): string {
  return ruleTriggerKey(trigger)
}

function statusTone(label: string): RuleTone {
  switch (label) {
    case 'ARMED':
      return 'ok'
    case 'READY':
      return 'ok'
    case 'RUNNING':
      return 'live'
    case 'COOLDOWN':
      return 'warn'
    case 'ERROR':
      return 'error'
    case 'PAUSED':
    case 'DISARMED':
    default:
      return 'muted'
  }
}

/**
 * Rail/editor status token. The service already decides `detail`; this helper
 * only normalizes a missing row and formats the last-run age.
 */
export function ruleStatusText(
  status?: RuleStatusView | null,
  armed: boolean = true,
  now: number = Date.now(),
): RuleStatusText {
  const age = formatRigRunAge(status?.lastAt, now)
  if (!status) {
    return {
      label: armed ? 'READY' : 'DISARMED',
      detail: armed ? 'No live status yet.' : 'Automation is disarmed on this PC.',
      tone: 'muted',
      age,
    }
  }
  const label = status.detail?.trim() || (status.enabled ? 'READY' : 'PAUSED')
  return {
    label,
    detail:
      status.lastDetail?.trim() ||
      (label === 'DISARMED'
        ? 'Automation is disarmed on this PC.'
        : label === 'PAUSED'
          ? 'This rule is switched off.'
          : label === 'RUNNING'
            ? 'Actions are running now.'
            : label === 'COOLDOWN'
              ? 'Waiting out the cooldown window.'
              : label === 'ERROR'
                ? 'The last run failed, was blocked or missed a target.'
                : 'Watching for the trigger edge.'),
    tone: statusTone(label),
    age,
    ...(status.lastAt !== undefined ? { at: status.lastAt } : {}),
  }
}

/** Enabled rules, i.e. the number shown next to `05 Automation`. */
export function enabledRuleCount(rules: readonly EventRule[] | undefined): number {
  return (rules ?? []).filter((rule) => rule.enabled !== false).length
}

/** Sources the dialog can actually watch right now. */
export function liveSourceCount(sources: readonly RuleSourceView[] | undefined): number {
  return (sources ?? []).filter(sourceIsLive).length
}

/**
 * Phone presence is always readable, but "0 PHONES" is not a live source:
 * there is no edge to observe until at least one phone is connected.
 */
function sourceIsLive(source: RuleSourceView): boolean {
  if (!source.available) return false
  if (source.name === 'phone') return !/^0\b/.test(source.detail.trim())
  return true
}

/** `3 rules · 2 live sources` for the sidebar row. */
export function ruleSidebarSummary(
  rules: readonly EventRule[] | undefined,
  sources: readonly RuleSourceView[] | undefined,
): string {
  const total = rules?.length ?? 0
  const live = liveSourceCount(sources)
  return `${total} rule${total === 1 ? '' : 's'} · ${live} live`
}

/** Tone for one source strip cell. */
export function ruleSourceTone(source: RuleSourceView): RuleTone {
  return sourceIsLive(source) ? 'ok' : 'muted'
}

/** Compact preview verdict used above the guard list. */
export function rulePreviewText(preview: RulePreviewView): {
  label: string
  tone: RuleTone
  detail: string
} {
  if (preview.error?.trim()) {
    return { label: 'ERROR', tone: 'error', detail: preview.error.trim() }
  }
  if (preview.missing.length > 0) {
    return {
      label: 'MISSING',
      tone: 'error',
      detail: `Missing ${preview.missing.join(', ')}. The rule stays saved but cannot run.`,
    }
  }
  if (preview.blocked.length > 0) {
    return {
      label: 'BLOCKED',
      tone: 'warn',
      detail: `${preview.blocked.length} condition${preview.blocked.length === 1 ? '' : 's'} did not pass. No action would run.`,
    }
  }
  if (preview.wouldRun) {
    return {
      label: 'WOULD RUN',
      tone: 'ok',
      detail: 'All conditions pass; FIRE NOW would execute the actions.',
    }
  }
  switch (preview.reason) {
    case 'disabled':
      return { label: 'DISABLED', tone: 'muted', detail: 'The rule is switched off. Enable it to run.' }
    case 'cooldown':
      return {
        label: 'WOULD SKIP',
        tone: 'warn',
        detail: 'A live edge would be skipped during cooldown; FIRE NOW bypasses it.',
      }
    case 'suppressed':
      return {
        label: 'WOULD SKIP',
        tone: 'warn',
        detail: 'Suppression is active after a recent run; the event would only update baselines.',
      }
    case 'stale':
      return {
        label: 'WOULD SKIP',
        tone: 'warn',
        detail: 'The candidate edge went stale before the debounce window ended.',
      }
    case 'throttled':
      return {
        label: 'WOULD SKIP',
        tone: 'warn',
        detail: 'The global storm brake is active; the event would be dropped, never queued.',
      }
    default:
      return { label: 'READY', tone: 'muted', detail: 'No blocking condition was reported.' }
  }
}

/* ------------------------------------------------------------------ */
/* Draft validation / references                                       */
/* ------------------------------------------------------------------ */

const INVALID_PROCESS = /[\\/\u0000-\u001F\u007F]/

/**
 * Editor-side validation mirroring the schema. Missing rig/profile/page ids
 * are *soft* references and are reported separately by
 * `ruleReferenceIssues`, never as save blockers.
 */
export function ruleDraftErrors(
  rule: EventRule,
  allRules: readonly EventRule[] = [],
): string[] {
  const errors: string[] = []
  const name = rule.name.trim()
  if (name.length < 1) errors.push('Name is required.')
  else if (name.length > RULE_MAX_NAME) {
    errors.push(`Name must be ${RULE_MAX_NAME} characters or fewer.`)
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rule.id) || rule.id.length > 64) {
    errors.push('Rule id may only use letters, digits, “-” and “_”.')
  } else if (allRules.some((candidate) => candidate.id === rule.id && candidate !== rule)) {
    errors.push('Another rule already uses this id.')
  }

  if (rule.trigger.kind === 'obs.scene') {
    const scene = rule.trigger.scene.trim()
    if (!scene) errors.push('Scene name is required.')
    else if (rule.trigger.scene.length > RULE_MAX_SCENE) {
      errors.push(`Scene names are limited to ${RULE_MAX_SCENE} characters.`)
    }
  }
  if (rule.trigger.kind === 'process.started' || rule.trigger.kind === 'process.stopped') {
    const process = rule.trigger.process.trim()
    if (!process) errors.push('Process name is required.')
    else if (rule.trigger.process.length > RULE_MAX_PROCESS) {
      errors.push(`Process names are limited to ${RULE_MAX_PROCESS} characters.`)
    } else if (INVALID_PROCESS.test(rule.trigger.process)) {
      errors.push('Process names cannot contain slashes or control characters.')
    }
  }

  const conditions = rule.conditions ?? []
  if (conditions.length > RULE_MAX_CONDITIONS) {
    errors.push(`A rule accepts at most ${RULE_MAX_CONDITIONS} conditions.`)
  }
  conditions.forEach((guard, index) => {
    const label = `Condition ${index + 1}`
    if (guard.label !== undefined && (guard.label.trim().length < 1 || guard.label.length > 60)) {
      errors.push(`${label} label must be 1–60 characters.`)
    }
    if (guard.probe === 'appRunning') {
      if (!guard.arg?.trim()) errors.push(`${label} needs an application name.`)
      return
    }
    if (guard.arg === undefined) return
    if (guard.probe !== 'lightOn') {
      errors.push(`${label} cannot take an argument.`)
      return
    }
    if (guard.arg.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(guard.arg)) {
      errors.push(`${label} light id may only use letters, digits, “-” and “_”.`)
    }
  })

  if (rule.actions.length < 1) errors.push('A rule needs at least one action.')
  if (rule.actions.length > RULE_MAX_ACTIONS) {
    errors.push(`A rule accepts at most ${RULE_MAX_ACTIONS} actions.`)
  }
  rule.actions.forEach((action, index) => {
    const label = `Action ${index + 1}`
    if (!ruleActionSchema.safeParse(action).success) {
      if (action.kind === 'runRig' && !action.presetId) errors.push(`${label} needs a rig.`)
      else if (action.kind === 'showProfile' && !action.profileId) {
        errors.push(`${label} needs a profile.`)
      } else if (action.kind === 'showPage') {
        if (!action.profileId) errors.push(`${label} needs a profile.`)
        else if (!action.pageId) errors.push(`${label} needs a page.`)
      } else {
        errors.push(`${label} is not a valid reference action.`)
      }
    }
  })

  if (rule.debounceMs !== undefined) {
    if (
      !Number.isInteger(rule.debounceMs) ||
      rule.debounceMs < 0 ||
      rule.debounceMs > RULE_DEBOUNCE_MAX_MS
    ) {
      errors.push(`Debounce must be 0–${RULE_DEBOUNCE_MAX_MS} ms.`)
    }
  }
  if (rule.cooldownMs !== undefined) {
    if (
      !Number.isInteger(rule.cooldownMs) ||
      rule.cooldownMs < 0 ||
      rule.cooldownMs > RULE_COOLDOWN_MAX_MS
    ) {
      errors.push(`Cooldown must be 0–${RULE_COOLDOWN_MAX_MS} ms.`)
    }
  }

  return errors
}

/** True when the whole rule passes the shared schema (save-safe). */
export function ruleIsSchemaValid(rule: EventRule): boolean {
  return eventRuleSchema.safeParse(rule).success
}

/** Dangling references that make a rule inert at runtime. */
export function ruleReferenceIssues(
  rule: EventRule,
  config: Pick<DeckConfig, 'rigs' | 'profiles'>,
): RuleReferenceIssue[] {
  const issues: RuleReferenceIssue[] = []
  const rigs = config.rigs ?? []
  rule.actions.forEach((action, actionIndex) => {
    if (action.kind === 'runRig') {
      if (!rigs.some((rig) => rig.id === action.presetId)) {
        issues.push({
          actionIndex,
          kind: 'rig',
          message: `Rig “${action.presetId}” no longer exists.`,
        })
      }
      return
    }
    if (action.kind === 'showProfile' || action.kind === 'showPage') {
      const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
      if (!profile) {
        issues.push({
          actionIndex,
          kind: 'profile',
          message: `Profile “${action.profileId}” no longer exists.`,
        })
        return
      }
      if (
        action.kind === 'showPage' &&
        !profile.pages.some((candidate) => candidate.id === action.pageId)
      ) {
        issues.push({
          actionIndex,
          kind: 'page',
          message: `Page “${action.pageId}” no longer exists in ${profile.name}.`,
        })
      }
    }
  })
  return issues
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export const RULE_ACTION_KIND_LABELS: Record<RuleAction['kind'], string> = {
  runRig: 'RUN RIG',
  showProfile: 'SHOW PROFILE',
  showPage: 'SHOW PAGE',
  notice: 'NOTICE',
}

/** Actions the MVP editor may add. Notice stays absent until `notice-v1` ships. */
export type RuleEditableActionKind = 'runRig' | 'showProfile' | 'showPage'

export const RULE_EDITABLE_ACTION_KINDS: readonly RuleEditableActionKind[] = [
  'runRig',
  'showProfile',
  'showPage',
]

/** One-line action label, resolving ids against the current config. */
export function ruleActionLabel(
  action: RuleAction,
  config: Pick<DeckConfig, 'rigs' | 'profiles'>,
): string {
  return describeRuleAction(action, { rigs: config.rigs ?? [], profiles: config.profiles })
}

/** Target text shown on the action row; never blank. */
export function ruleActionTarget(
  action: RuleAction,
  config: Pick<DeckConfig, 'rigs' | 'profiles'>,
): { text: string; missing: boolean } {
  switch (action.kind) {
    case 'runRig': {
      const rig = (config.rigs ?? []).find((candidate) => candidate.id === action.presetId)
      return rig
        ? { text: rig.name, missing: false }
        : { text: `Missing rig “${action.presetId}”`, missing: true }
    }
    case 'showProfile': {
      const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
      return profile
        ? { text: profile.name, missing: false }
        : { text: `Missing profile “${action.profileId}”`, missing: true }
    }
    case 'showPage': {
      const profile = config.profiles.find((candidate) => candidate.id === action.profileId)
      const page = profile?.pages.find((candidate) => candidate.id === action.pageId)
      if (!profile) return { text: `Missing profile “${action.profileId}”`, missing: true }
      if (!page) return { text: `Missing page “${action.pageId}”`, missing: true }
      return { text: `${profile.name} / ${page.name}`, missing: false }
    }
    case 'notice':
      return { text: action.text, missing: false }
  }
}

/** A schema-valid starting action for the “add action” menu. */
export function ruleActionDefaults(
  kind: RuleEditableActionKind,
  config: Pick<DeckConfig, 'rigs' | 'profiles' | 'defaultProfileId'>,
): RuleAction {
  const rig = (config.rigs ?? [])[0]
  const profile =
    config.profiles.find((candidate) => candidate.id === config.defaultProfileId) ??
    config.profiles[0]
  switch (kind) {
    case 'runRig':
      return { kind: 'runRig', presetId: rig?.id ?? 'missing-rig' }
    case 'showProfile':
      return { kind: 'showProfile', profileId: profile?.id ?? 'missing-profile' }
    case 'showPage':
      return {
        kind: 'showPage',
        profileId: profile?.id ?? 'missing-profile',
        pageId: profile?.pages[0]?.id ?? 'missing-page',
      }
  }
}

/** Switch one action's kind while keeping the row position and a valid target. */
export function ruleActionFromKind(
  kind: RuleEditableActionKind,
  previous: RuleAction,
  config: Pick<DeckConfig, 'rigs' | 'profiles' | 'defaultProfileId'>,
): RuleAction {
  if (kind === previous.kind) return previous
  if (previous.kind === 'showPage' && kind === 'showProfile') {
    return { kind: 'showProfile', profileId: previous.profileId }
  }
  if (previous.kind === 'showProfile' && kind === 'showPage') {
    const profile = config.profiles.find((candidate) => candidate.id === previous.profileId)
    return {
      kind: 'showPage',
      profileId: previous.profileId,
      pageId: profile?.pages[0]?.id ?? 'missing-page',
    }
  }
  return ruleActionDefaults(kind, config)
}

/** Reorder helper used by the up/down buttons. */
export function moveRuleAction(
  actions: readonly RuleAction[],
  index: number,
  direction: -1 | 1,
): RuleAction[] {
  const target = index + direction
  if (index < 0 || index >= actions.length || target < 0 || target >= actions.length) {
    return [...actions]
  }
  const next = [...actions]
  const [action] = next.splice(index, 1)
  if (action) next.splice(target, 0, action)
  return next
}

/* ------------------------------------------------------------------ */
/* Config helpers                                                      */
/* ------------------------------------------------------------------ */

/** Configured rules; tolerates configs that predate the field. */
export function rulesOf(config: Pick<DeckConfig, 'rules'> | null | undefined): EventRule[] {
  return config?.rules ?? []
}

/** Next free `rule-N` id (gaps are reused). */
export function nextRuleId(rules: readonly EventRule[] | undefined): string {
  const used = new Set((rules ?? []).map((rule) => rule.id))
  for (let index = 1; index <= RULES_MAX_RULES + 1; index += 1) {
    const id = `rule-${index}`
    if (!used.has(id)) return id
  }
  return `rule-${Date.now()}`
}

/** Replace one rule by id, or append it. */
export function upsertRule(config: DeckConfig, rule: EventRule): DeckConfig {
  const rules = rulesOf(config)
  const exists = rules.some((candidate) => candidate.id === rule.id)
  return {
    ...config,
    rules: exists
      ? rules.map((candidate) => (candidate.id === rule.id ? rule : candidate))
      : [...rules, rule],
  }
}

/** Remove one rule; leaves every other config section untouched. */
export function removeRuleFromConfig(config: DeckConfig, ruleId: string): DeckConfig {
  return { ...config, rules: rulesOf(config).filter((rule) => rule.id !== ruleId) }
}

/** First profile id used by a new rule's default action. */
function defaultProfileId(config: Pick<DeckConfig, 'profiles' | 'defaultProfileId'>): string {
  return config.profiles.find((profile) => profile.id === config.defaultProfileId)?.id
    ?? config.profiles[0]?.id
    ?? 'missing-profile'
}

/** A blank rule that is schema-valid the moment it is created. */
export function defaultRule(
  id: string,
  config: Pick<DeckConfig, 'profiles' | 'defaultProfileId'>,
  name: string = `Rule ${id.replace(/^rule-/, '')}`,
): EventRule {
  return {
    id,
    name,
    enabled: true,
    trigger: { kind: 'obs.streaming', active: true },
    actions: [{ kind: 'showProfile', profileId: defaultProfileId(config) }],
    debounceMs: RULE_DEBOUNCE_DEFAULT_MS,
    cooldownMs: RULE_COOLDOWN_DEFAULT_MS,
    onBusy: 'skip',
  }
}

/**
 * Empty-state templates. They use generic targets only: the default profile,
 * plus a placeholder process name (`game`) that the user replaces.
 */
export function ruleTemplate(
  kind: RuleTemplateId,
  id: string,
  config: Pick<DeckConfig, 'profiles' | 'defaultProfileId'>,
): EventRule {
  const profileId = defaultProfileId(config)
  const action: RuleAction = { kind: 'showProfile', profileId }
  switch (kind) {
    case 'stream-started':
      return {
        id,
        name: 'Stream started',
        enabled: true,
        trigger: { kind: 'obs.streaming', active: true },
        actions: [action],
        debounceMs: RULE_DEBOUNCE_DEFAULT_MS,
        cooldownMs: RULE_COOLDOWN_DEFAULT_MS,
        onBusy: 'skip',
      }
    case 'stream-ended':
      return {
        id,
        name: 'Stream ended',
        enabled: true,
        trigger: { kind: 'obs.streaming', active: false },
        actions: [{ kind: 'showProfile', profileId }],
        debounceMs: RULE_DEBOUNCE_DEFAULT_MS,
        cooldownMs: RULE_COOLDOWN_DEFAULT_MS,
        onBusy: 'skip',
      }
    case 'game-launched':
      return {
        id,
        name: 'Game launched',
        enabled: true,
        trigger: { kind: 'process.started', process: 'game' },
        actions: [{ kind: 'showProfile', profileId }],
        debounceMs: 2_000,
        cooldownMs: RULE_COOLDOWN_DEFAULT_MS,
        onBusy: 'skip',
      }
    case 'phone-connected':
      return {
        id,
        name: 'Phone connected',
        enabled: true,
        trigger: { kind: 'phone.connected' },
        actions: [{ kind: 'showProfile', profileId }],
        debounceMs: 500,
        cooldownMs: RULE_COOLDOWN_DEFAULT_MS,
        onBusy: 'skip',
      }
  }
}

export const RULE_TEMPLATE_ORDER: readonly RuleTemplateId[] = [
  'stream-started',
  'stream-ended',
  'game-launched',
  'phone-connected',
]

/** One-line template blurb for the empty state. */
export function ruleTemplateDescription(kind: RuleTemplateId): string {
  switch (kind) {
    case 'stream-started':
      return 'When OBS starts streaming, switch the deck to a profile.'
    case 'stream-ended':
      return 'When the stream stops, switch the deck to a profile.'
    case 'game-launched':
      return 'When a process starts, switch the deck to a profile. Replace “game” with the app name.'
    case 'phone-connected':
      return 'When a phone reconnects, show a chosen profile.'
  }
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function ruleRunStatusTone(status?: RuleRunStatus | null): RuleTone {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'partial':
    case 'blocked':
    case 'throttled':
      return 'warn'
    case 'failed':
    case 'missing':
      return 'error'
    case 'busy':
      return 'live'
    case 'skipped':
    default:
      return 'muted'
  }
}

export function ruleRunStatusLabel(status?: RuleRunStatus | null): string {
  return (status ?? 'skipped').toUpperCase()
}

/** First failure/skip reason, falling back to the action outcome. */
export function ruleHistoryDetail(entry: RuleHistoryEntry): string {
  if (entry.detail?.trim()) return entry.detail.trim()
  const failure = entry.actions.find((action) => !action.ok)
  if (failure?.message?.trim()) return failure.message.trim()
  if (entry.status === 'ok') {
    return `${entry.actions.length} action${entry.actions.length === 1 ? '' : 's'} completed.`
  }
  return `Ended ${entry.status}.`
}

/** `2 actions · 3.2s` compact history readout. */
export function ruleHistorySummary(entry: RuleHistoryEntry): string {
  const failed = entry.actions.filter((action) => !action.ok).length
  const count = `${entry.actions.length} action${entry.actions.length === 1 ? '' : 's'}`
  const error = failed > 0 ? ` · ${failed} failed` : ''
  return `${count}${error}`
}

/** Per-action outcome line for an expanded history row. */
export function ruleOutcomeLabel(outcome: RuleActionOutcome): string {
  const target = outcome.target?.trim() || outcome.kind
  return `${outcome.ok ? 'OK' : 'FAIL'} · ${target}`
}
