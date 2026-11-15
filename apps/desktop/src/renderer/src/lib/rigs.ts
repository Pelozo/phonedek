/**
 * Renderer-side rig helpers.
 *
 * `ConfigAction`/`StateBinding` deliberately stay the pre-rig unions while the
 * desktop schema already accepts `{ type:'rig' }`. Everything here inspects
 * those staged values structurally so the editor can consume them without
 * widening shared types.
 */

import {
  describeAction,
  describeRigGuard,
  estimateRigMs,
  formatRigRunAge,
  isRigRunAction,
  rigById,
  rigStepSchema,
  RIG_DEFAULT_DEADLINE_MS,
  RIG_MAX_DEADLINE_MS,
  RIG_MAX_GUARDS,
  RIG_MAX_PRESETS,
  RIG_MAX_STEP_DELAY_MS,
  RIG_MAX_STEPS,
} from '@phonedek/shared'
import type {
  DeckConfig,
  RigGuard,
  RigPreset,
  RigRunAction,
  RigRunStatus,
  RigStateBinding,
  RigStep,
  RigStepAction,
} from '@phonedek/shared'
import type { RigStatusView } from '../../../shared/api'

export type RigTone = 'ok' | 'warn' | 'error' | 'muted' | 'live'

export interface RigStatusText {
  /** Exact tile token: `READY`, `3/9`, `RUN 2m`, `PARTIAL`, `FAILED`, … */
  label: string
  /** Human detail from the last run/error, never used as the tile token. */
  detail: string
  tone: RigTone
  /** Compact age of the last run (`NOW`, `12m`, `3h`, `2d`, `NEVER`). */
  age: string
  at?: number
}

export interface RigStepSummary {
  label: string
  detail: string
}

export interface RigReference {
  profileId: string
  profileName: string
  pageId: string
  pageName: string
  buttonId: string
  buttonLabel: string
  via: 'action' | 'state'
}

export type RigTemplateId = 'go-live' | 'brb' | 'wrap'

const RIG_ACTION_TYPES = new Set<string>([
  'hotkey',
  'text',
  'macro',
  'launch',
  'url',
  'command',
  'media',
  'delay',
  'mic',
  'obs',
  'twitch',
  'light',
  'appVolume',
  'streamerbot',
])

/** Configured rigs, tolerating older configs that predate the field. */
export function rigsOf(config: Pick<DeckConfig, 'rigs'> | null | undefined): RigPreset[] {
  return config?.rigs ?? []
}

/** Find a configured rig by id; safe on missing/blank ids. */
export function findRig(
  rigs: readonly RigPreset[] | undefined,
  id: string | null | undefined,
): RigPreset | undefined {
  if (!id) return undefined
  return rigById(rigs, id)
}

/** First rig run action in a button's action list (structural, staged-union safe). */
export function rigActionOf(actions: readonly unknown[] | undefined): RigRunAction | undefined {
  return actions?.find(isRigRunAction)
}

/** True when any action starts a rig. */
export function hasRigAction(actions: readonly unknown[] | undefined): boolean {
  return rigActionOf(actions) !== undefined
}

/** Structural check for the staged `{ type:'rig', presetId }` status binding. */
export function isRigStateBinding(value: unknown): value is RigStateBinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; presetId?: unknown }
  return candidate.type === 'rig' && typeof candidate.presetId === 'string'
}

/** Typed view of a staged rig status binding, without widening `StateBinding`. */
export function rigStateOf(value: unknown): RigStateBinding | null {
  return isRigStateBinding(value) ? value : null
}

/** One step's row label plus the action/delay detail shown under it. */
export function rigStepSummary(step: RigStep): RigStepSummary {
  const action = describeAction(step.action).slice(0, 60)
  const label = step.label?.trim() || action
  const delay = step.delayMs && step.delayMs > 0 ? ` · +${step.delayMs}ms` : ''
  const carry = step.continueOnError ? ' · continue' : ''
  return { label: label.slice(0, 60), detail: `${action}${delay}${carry}` }
}

/** Guard description including the expectation and probe argument. */
export function rigGuardLabel(guard: RigGuard): string {
  return describeRigGuard(guard.arg?.trim() ? guard : { ...guard, arg: undefined })
}

/** Tone for a run status; `active` wins because the tile is live. */
export function rigRunTone(
  status?: RigRunStatus | null,
  active: boolean = false,
): RigTone {
  if (active || status === 'busy') return 'live'
  switch (status) {
    case 'ok':
      return 'ok'
    case 'partial':
    case 'blocked':
      return 'warn'
    case 'failed':
    case 'timeout':
      return 'error'
    case 'cancelled':
      return 'muted'
    default:
      return 'muted'
  }
}

/** Status rail/detail reading for one rig; missing rows read as READY. */
export function rigStatusText(
  status?: RigStatusView | null,
  now: number = Date.now(),
): RigStatusText {
  if (!status) {
    return { label: 'READY', detail: 'No runs yet.', tone: 'muted', age: 'NEVER' }
  }
  const age = formatRigRunAge(status.at, now)
  if (!status.available) {
    return {
      label: status.detail?.trim() || 'NO RIG',
      detail: status.error?.trim() || 'This rig no longer exists.',
      tone: 'muted',
      age: 'NEVER',
    }
  }
  const tone = rigRunTone(status.status, status.active)
  const label = status.detail?.trim() || (status.active ? 'RUN' : 'READY')
  let detail = status.message?.trim()
  if (!detail) {
    if (status.active) detail = `Running · step ${status.detail}`
    else if (!status.status) detail = 'No runs yet.'
    else if (status.error?.trim()) detail = status.error.trim()
    else if (status.status === 'ok') detail = 'Last run completed.'
    else if (status.status === 'partial') detail = 'Last run stopped after a failed step.'
    else if (status.status === 'blocked') detail = 'Guards blocked the last run.'
    else if (status.status === 'cancelled') detail = 'Last run was stopped.'
    else if (status.status === 'timeout') detail = 'Last run hit its deadline.'
    else detail = `Last run ${status.status}.`
  }
  return {
    label,
    detail,
    tone,
    age,
    ...(status.at !== undefined ? { at: status.at } : {}),
  }
}

/** Editor-side validation mirroring the schema's rig rules. */
export function rigDraftErrors(
  rig: RigPreset,
  allRigs: readonly RigPreset[] = [],
): string[] {
  const errors: string[] = []
  const name = rig.name.trim()
  if (name.length < 1) errors.push('Name is required.')
  else if (name.length > 60) errors.push('Name must be 60 characters or fewer.')
  if ((rig.description?.length ?? 0) > 140) errors.push('Description must be 140 characters or fewer.')
  if ((rig.icon?.length ?? 0) > 32) errors.push('Icon must be 32 characters or fewer.')

  if (rig.steps.length < 1) errors.push('A rig needs at least one step.')
  if (rig.steps.length > RIG_MAX_STEPS) {
    errors.push(`A rig accepts at most ${RIG_MAX_STEPS} steps.`)
  }
  if ((rig.guards?.length ?? 0) > RIG_MAX_GUARDS) {
    errors.push(`A rig accepts at most ${RIG_MAX_GUARDS} guards.`)
  }
  if (rig.deadlineMs !== undefined) {
    if (!Number.isInteger(rig.deadlineMs) || rig.deadlineMs < 1000 || rig.deadlineMs > RIG_MAX_DEADLINE_MS) {
      errors.push('Deadline must be between 1 and 600 seconds.')
    }
  }

  const stepIds = new Set<string>()
  rig.steps.forEach((step, index) => {
    const stepName = `Step ${index + 1}`
    if (!RIG_ACTION_TYPES.has(step.action.type)) {
      errors.push(`${stepName} uses an action type that rigs cannot run.`)
    } else {
      const actionCheck = rigStepSchema.shape.action.safeParse(step.action)
      if (!actionCheck.success) {
        const issue = actionCheck.error.issues[0]
        const where = issue?.path.length ? ` (${issue.path.join('.')})` : ''
        errors.push(`${stepName} action${where}: ${issue?.message ?? 'invalid action'}`)
      }
    }
    if (step.label !== undefined) {
      if (step.label.trim().length < 1) errors.push(`${stepName} label cannot be blank.`)
      if (step.label.length > 60) errors.push(`${stepName} label must be 60 characters or fewer.`)
    }
    if (step.delayMs !== undefined) {
      if (
        !Number.isInteger(step.delayMs) ||
        step.delayMs < 0 ||
        step.delayMs > RIG_MAX_STEP_DELAY_MS
      ) {
        errors.push(`${stepName} delay must be 0–${RIG_MAX_STEP_DELAY_MS} ms.`)
      }
    }
    if (step.id) {
      if (stepIds.has(step.id)) errors.push(`${stepName} reuses step id “${step.id}”.`)
      stepIds.add(step.id)
    }
  })

  ;(rig.guards ?? []).forEach((guard, index) => {
    const guardName = `Guard ${index + 1}`
    if (guard.label !== undefined && (guard.label.trim().length < 1 || guard.label.length > 60)) {
      errors.push(`${guardName} label must be 1–60 characters.`)
    }
    if (guard.probe === 'appRunning') {
      if (!guard.arg?.trim()) errors.push(`${guardName} needs an application name.`)
      return
    }
    if (guard.arg === undefined) return
    if (guard.probe !== 'lightOn') {
      errors.push(`${guardName} cannot take an argument.`)
      return
    }
    if (guard.arg.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(guard.arg)) {
      errors.push(`${guardName} light id may only use letters, digits, “-” and “_”.`)
    }
  })

  if (allRigs.some((item) => item.id === rig.id && item !== rig)) {
    errors.push('Another rig already uses this id.')
  }
  return errors
}

/** Next free `rig-N` id (gaps are reused). */
export function nextRigId(rigs: readonly RigPreset[] | undefined): string {
  const used = new Set((rigs ?? []).map((rig) => rig.id))
  for (let index = 1; index <= RIG_MAX_PRESETS + 1; index += 1) {
    const id = `rig-${index}`
    if (!used.has(id)) return id
  }
  return `rig-${Date.now()}`
}

/** Next free `step-N` id inside one rig. */
export function nextRigStepId(rig: Pick<RigPreset, 'steps'> | undefined): string {
  const used = new Set((rig?.steps ?? []).map((step) => step.id).filter(Boolean))
  for (let index = 1; index <= RIG_MAX_STEPS + 1; index += 1) {
    const id = `step-${index}`
    if (!used.has(id)) return id
  }
  return `step-${Date.now()}`
}

/** Fresh step with a stable id and the chosen host action. */
export function rigStepDefaults(
  rig: Pick<RigPreset, 'steps'> | undefined,
  action: RigStepAction = { type: 'delay', ms: 250 },
): RigStep {
  return { id: nextRigStepId(rig), action }
}

/** Actions that make a run worth a confirmation before it starts. */
export function rigHasDestructiveSteps(rig: RigPreset): boolean {
  return rig.steps.some((step) => {
    const action = step.action
    if (action.type === 'command' || action.type === 'launch') return true
    return (
      action.type === 'obs' &&
      (action.action === 'stopStream' || action.action === 'stopRecord')
    )
  })
}

/** Buttons that point at one rig, through a run action or a last-run status. */
export function rigReferences(config: DeckConfig, presetId: string): RigReference[] {
  const references: RigReference[] = []
  for (const profile of config.profiles) {
    for (const page of profile.pages) {
      for (const button of page.buttons) {
        const action = rigActionOf(button.actions)
        if (action?.presetId === presetId) {
          references.push({
            profileId: profile.id,
            profileName: profile.name,
            pageId: page.id,
            pageName: page.name,
            buttonId: button.id,
            buttonLabel: button.label || 'Untitled',
            via: 'action',
          })
        }
        const state = (button as unknown as { state?: unknown }).state
        if (isRigStateBinding(state) && state.presetId === presetId) {
          references.push({
            profileId: profile.id,
            profileName: profile.name,
            pageId: page.id,
            pageName: page.name,
            buttonId: button.id,
            buttonLabel: button.label || 'Untitled',
            via: 'state',
          })
        }
      }
    }
  }
  return references
}

/**
 * Delete one rig and either drop or unlink every button that referenced it.
 *
 * `dropButtons: false` keeps the buttons and strips the rig action/status, so
 * the saved config stays schema-valid. `dropButtons: true` removes those
 * buttons (and therefore any of their other actions) as well.
 */
export function removeRigFromConfig(
  config: DeckConfig,
  presetId: string,
  references: readonly RigReference[] = rigReferences(config, presetId),
  dropButtons: boolean = false,
): DeckConfig {
  const ids = new Set(references.map((reference) => reference.buttonId))
  const nextRules = config.rules
    ?.map((rule) => ({
      ...rule,
      actions: rule.actions.filter(
        (action) => !(action.kind === 'runRig' && action.presetId === presetId),
      ),
    }))
    .filter((rule) => rule.actions.length > 0)
  return {
    ...config,
    ...(nextRules !== undefined
      ? { rules: nextRules.length > 0 ? nextRules : undefined }
      : {}),
    rigs: config.rigs?.filter((rig) => rig.id !== presetId),
    profiles: config.profiles.map((profile) => ({
      ...profile,
      pages: profile.pages.map((page) => ({
        ...page,
        buttons: page.buttons.flatMap((button) => {
          if (!ids.has(button.id)) return [button]
          if (dropButtons) return []
          const actions = button.actions.filter(
            (action) => rigActionOf([action])?.presetId !== presetId,
          )
          const rigState = rigStateOf(button.state)
          const state = rigState?.presetId === presetId ? undefined : button.state
          return [{ ...button, actions, state }]
        }),
      })),
    })),
  }
}

/** Compact estimate used in the rail, picker and Inspector card. */
export function formatRigDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

/** `N steps · ~X` estimate line shared by the library and Inspector. */
export function rigEstimateLabel(rig: RigPreset): string {
  const steps = `${rig.steps.length} step${rig.steps.length === 1 ? '' : 's'}`
  return `${steps} · ~${formatRigDuration(estimateRigMs(rig))}`
}

function templateStep(
  label: string,
  action: RigStepAction,
  extra: Pick<RigStep, 'delayMs' | 'continueOnError'> = {},
): RigStep {
  return { label, action, ...extra }
}

/**
 * Empty-state templates. All use generic host actions (no user scene/source
 * names), so they validate against the schema on any machine.
 */
export function rigTemplate(kind: RigTemplateId, id: string = kind): RigPreset {
  switch (kind) {
    case 'go-live':
      return {
        id,
        name: 'Go live',
        icon: '🔴',
        description: 'Start recording, go live, and drop a marker.',
        guards: [{ probe: 'obsStreaming', expect: false }],
        steps: [
          templateStep('Start recording', { type: 'obs', action: 'startRecord' }),
          templateStep('Go live', { type: 'obs', action: 'startStream' }),
          templateStep('Go-live marker', {
            type: 'obs',
            action: 'addMarker',
            name: 'Go live',
          }),
        ],
        onError: 'failFast',
        deadlineMs: RIG_DEFAULT_DEADLINE_MS,
      }
    case 'brb':
      return {
        id,
        name: 'BRB',
        icon: '⏸️',
        description: 'Mute the mic and drop a marker while you are away.',
        guards: [{ probe: 'obsStreaming', expect: true }],
        steps: [
          templateStep('Mute mic', { type: 'mic', action: 'toggleMute' }),
          templateStep('BRB marker', { type: 'obs', action: 'addMarker', name: 'BRB' }),
        ],
        onError: 'continue',
        deadlineMs: 30_000,
      }
    case 'wrap':
      return {
        id,
        name: 'Wrap',
        icon: '🏁',
        description: 'Stop the stream and recording, then save the replay.',
        steps: [
          templateStep('Stop stream', { type: 'obs', action: 'stopStream' }),
          templateStep('Stop recording', { type: 'obs', action: 'stopRecord' }),
          templateStep('Save replay', { type: 'obs', action: 'saveReplay' }),
        ],
        onError: 'continue',
        deadlineMs: RIG_DEFAULT_DEADLINE_MS,
      }
  }
}
