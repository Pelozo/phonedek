import type { AutoProfileRuleView } from '../../../shared/api'

/** Mirrors the main-process limit; the Settings list shows the same counter. */
export const MAX_AUTO_PROFILE_RULES = 16

/** Keep in sync with `DEFAULT_REVERT_DEBOUNCE_MS` in the game watcher. */
export const AUTO_PROFILE_REVERT_DELAY_SECONDS = 5

/** One editable rule; the process field keeps the user's raw text. */
export interface AutoProfileDraft {
  id: string
  process: string
  profileId: string
}

/**
 * Reduce an executable field to the process-snapshot form used by the game
 * watcher: basename, lowercase, no trailing `.exe`. Accepts full paths so a
 * pasted `C:\Games\Game.exe` and `game` compare the same.
 *
 * Kept in sync with `normalizeProcessName` in the main process. Returns null
 * for an empty, over-long or malformed value.
 */
export function normalizeAutoProfileProcess(value: string): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 4096) return null
  const slash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  let name = (slash >= 0 ? raw.slice(slash + 1) : raw).trim().toLowerCase()
  if (name.endsWith('.exe')) name = name.slice(0, -4)
  if (!name || name.length > 160) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** Inline validation for one rule's process field. */
export function autoProfileProcessError(value: string): string | null {
  const raw = value.trim()
  if (!raw) return 'Enter a process or executable name.'
  if (raw.length > 4096) return 'This path is too long.'
  if (normalizeAutoProfileProcess(raw) === null) {
    return 'Use a file name or path, without control characters.'
  }
  return null
}

/** Inline validation for one rule's profile picker. */
export function autoProfileProfileError(
  profileId: string,
  profiles: ReadonlyArray<{ id: string }>,
): string | null {
  if (!profileId) return 'Choose a profile.'
  if (!profiles.some((profile) => profile.id === profileId)) {
    return 'This profile no longer exists. Choose another.'
  }
  return null
}

/** Inline validation for the optional return profile. */
export function autoProfileRevertProfileError(
  profileId: string,
  profiles: ReadonlyArray<{ id: string }>,
): string | null {
  if (!profileId) return 'Choose a profile to return to.'
  if (!profiles.some((profile) => profile.id === profileId)) {
    return 'This profile no longer exists. Choose another.'
  }
  return null
}

/** Plain-language summary shown under the return toggle. */
export function autoProfileRevertHint(
  enabled: boolean,
  profileId: string,
  profiles: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (!enabled) return 'Off. Phones stay on the game profile after it closes.'
  if (!profileId) return 'Choose the profile phones should return to when the game closes.'
  const name = autoProfileProfileName(profileId, profiles)
  return (
    `About ${AUTO_PROFILE_REVERT_DELAY_SECONDS} seconds after the game closes, phones ` +
    `return to ${name}. Starting another mapped game cancels the return.`
  )
}

export interface AutoProfileRuleErrors {
  process: string | null
  profile: string | null
}

export function autoProfileRuleErrors(
  draft: AutoProfileDraft,
  profiles: ReadonlyArray<{ id: string }>,
): AutoProfileRuleErrors {
  return {
    process: autoProfileProcessError(draft.process),
    profile: autoProfileProfileError(draft.profileId, profiles),
  }
}

/** Stable draft ids; the main process would repair a collision, but avoid one. */
export function nextAutoProfileRuleId(rules: ReadonlyArray<{ id: string }>): string {
  const used = new Set(rules.map((rule) => rule.id))
  let index = 1
  while (used.has(`rule-${index}`)) index += 1
  return `rule-${index}`
}

export function toAutoProfileDrafts(
  rules: readonly AutoProfileRuleView[],
): AutoProfileDraft[] {
  return rules.map((rule) => ({
    id: rule.id,
    process: rule.process,
    profileId: rule.profileId,
  }))
}

function draftSignature(drafts: readonly AutoProfileDraft[]): string {
  return JSON.stringify(
    drafts.map((draft) => ({
      id: draft.id,
      process: draft.process.trim(),
      profileId: draft.profileId,
    })),
  )
}

function savedSignature(rules: readonly AutoProfileRuleView[]): string {
  return JSON.stringify(
    rules.map((rule) => ({
      id: rule.id,
      process: rule.process,
      profileId: rule.profileId,
    })),
  )
}

/** True when the draft text differs from the last saved rule list. */
export function autoProfileDraftsDirty(
  drafts: readonly AutoProfileDraft[],
  rules: readonly AutoProfileRuleView[],
): boolean {
  return draftSignature(drafts) !== savedSignature(rules)
}

/** Serialize a draft for the API; the main process normalizes the process. */
export function autoProfileRulesFromDrafts(
  drafts: readonly AutoProfileDraft[],
): AutoProfileRuleView[] {
  return drafts.map((draft) => ({
    id: draft.id,
    process: draft.process.trim(),
    profileId: draft.profileId.trim(),
  }))
}

/** Display name for a profile id, with a readable fallback for stale rules. */
export function autoProfileProfileName(
  profileId: string,
  profiles: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (!profileId) return 'No profile selected'
  return profiles.find((profile) => profile.id === profileId)?.name || profileId
}
