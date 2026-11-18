import type { DeckConfig } from './types'

/** Reference removals performed by {@link repairDanglingReferences}. */
export interface RepairCounts {
  /** Button actions with `type: 'rig'` whose rig no longer exists. */
  rigActions: number
  /** Rig status bindings whose rig no longer exists. */
  rigStates: number
  /** Rule actions whose rig/profile/page target no longer exists. */
  ruleActions: number
  /** Rules dropped because every action was removed. */
  rules: number
}

export interface RepairResult {
  config: DeckConfig
  repaired: boolean
  removed: RepairCounts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A config must at least have profiles with page lists. Anything else is
 * treated as malformed and handed back untouched, so the caller can keep using
 * its normal corrupt-file path.
 */
function hasPlausibleConfigShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.profiles) || value.profiles.length === 0) return false
  return value.profiles.some((profile) => isRecord(profile) && Array.isArray(profile.pages))
}

function cloneConfig(value: Record<string, unknown>): Record<string, unknown> | null {
  try {
    return structuredClone(value)
  } catch {
    return null
  }
}

function idSet(value: unknown, key: 'id'): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(value)) return ids
  for (const entry of value) {
    if (isRecord(entry) && typeof entry[key] === 'string') ids.add(entry[key])
  }
  return ids
}

function profilePageIds(profiles: unknown[]): {
  profileIds: Set<string>
  pagesByProfile: Map<string, Set<string>>
} {
  const profileIds = new Set<string>()
  const pagesByProfile = new Map<string, Set<string>>()
  for (const profile of profiles) {
    if (!isRecord(profile) || typeof profile.id !== 'string') continue
    profileIds.add(profile.id)
    const pageIds = new Set<string>()
    if (Array.isArray(profile.pages)) {
      for (const page of profile.pages) {
        if (isRecord(page) && typeof page.id === 'string') pageIds.add(page.id)
      }
    }
    pagesByProfile.set(profile.id, pageIds)
  }
  return { profileIds, pagesByProfile }
}

/**
 * Remove only references that cannot resolve inside this config:
 *
 * - button rig actions and rig status bindings pointing at a missing rig,
 * - rule `runRig`/`showProfile`/`showPage` actions pointing at a missing
 *   rig/profile/page, plus rules left with no actions,
 * - empty `rigs`/`rules` arrays.
 *
 * Everything else is preserved as-is. The function is defensive: malformed
 * input returns `repaired: false` with an untouched config.
 */
export function repairDanglingReferences(input: unknown): RepairResult {
  const removed: RepairCounts = { rigActions: 0, rigStates: 0, ruleActions: 0, rules: 0 }
  if (!hasPlausibleConfigShape(input)) {
    return { config: input as DeckConfig, repaired: false, removed }
  }

  const cloned = cloneConfig(input)
  if (!cloned) return { config: input as unknown as DeckConfig, repaired: false, removed }

  const config = cloned as Record<string, unknown>
  const rigs = Array.isArray(config.rigs) ? config.rigs : []
  const rigIds = idSet(rigs, 'id')
  const profiles = Array.isArray(config.profiles) ? config.profiles : []
  const { profileIds, pagesByProfile } = profilePageIds(profiles)

  for (const profile of profiles) {
    if (!isRecord(profile) || !Array.isArray(profile.pages)) continue
    for (const page of profile.pages) {
      if (!isRecord(page) || !Array.isArray(page.buttons)) continue
      for (const button of page.buttons) {
        if (!isRecord(button)) continue

        if (Array.isArray(button.actions)) {
          const actions = button.actions.filter((action) => {
            if (!isRecord(action) || action.type !== 'rig') return true
            if (typeof action.presetId === 'string' && rigIds.has(action.presetId)) return true
            removed.rigActions += 1
            return false
          })
          if (actions.length !== button.actions.length) button.actions = actions
        }

        const state = button.state
        if (isRecord(state) && state.type === 'rig') {
          const valid = typeof state.presetId === 'string' && rigIds.has(state.presetId)
          if (!valid) {
            delete button.state
            removed.rigStates += 1
          }
        }
      }
    }
  }

  const isDanglingRuleAction = (action: unknown): boolean => {
    if (!isRecord(action)) return false
    switch (action.kind) {
      case 'runRig':
        return !(typeof action.presetId === 'string' && rigIds.has(action.presetId))
      case 'showProfile':
        return !(typeof action.profileId === 'string' && profileIds.has(action.profileId))
      case 'showPage': {
        if (typeof action.profileId !== 'string') return true
        const pageIds = pagesByProfile.get(action.profileId)
        if (!pageIds) return true
        return !(typeof action.pageId === 'string' && pageIds.has(action.pageId))
      }
      default:
        return false
    }
  }

  if (Array.isArray(config.rules)) {
    const rules: unknown[] = []
    for (const rule of config.rules) {
      if (!isRecord(rule) || !Array.isArray(rule.actions)) {
        rules.push(rule)
        continue
      }
      const actions = rule.actions.filter((action) => !isDanglingRuleAction(action))
      const removedHere = rule.actions.length - actions.length
      if (removedHere === 0) {
        rules.push(rule)
        continue
      }
      removed.ruleActions += removedHere
      if (actions.length === 0) {
        removed.rules += 1
        continue
      }
      rule.actions = actions
      rules.push(rule)
    }
    config.rules = rules
  }

  const repaired = removed.rigActions + removed.rigStates + removed.ruleActions + removed.rules > 0
  if (repaired) {
    if (Array.isArray(config.rigs) && config.rigs.length === 0) delete config.rigs
    if (Array.isArray(config.rules) && config.rules.length === 0) delete config.rules
  }

  return { config: config as unknown as DeckConfig, repaired, removed }}
