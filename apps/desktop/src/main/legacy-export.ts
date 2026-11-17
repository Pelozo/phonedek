import { DeckConfigSchema, stripAutomationForLegacy } from '@phonedek/shared'
import type { DeckConfig, LegacyRemovedCounts } from '@phonedek/shared'

export interface LegacyConfigExport {
  /** Pretty JSON with a trailing newline, already schema-validated. */
  json: string
  removed: LegacyRemovedCounts
  /** Human summary for the log line and the Settings toast. */
  summary: string
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** One-line description of what the downgrade stripped. */
export function describeLegacyRemoval(removed: LegacyRemovedCounts): string {
  const parts = [
    removed.rigs ? plural(removed.rigs, 'rig') : '',
    removed.rules ? plural(removed.rules, 'rule') : '',
    removed.rigActions ? plural(removed.rigActions, 'rig action') : '',
    removed.rigStates ? plural(removed.rigStates, 'rig state') : '',
    removed.buttons ? plural(removed.buttons, 'button') : '',
  ].filter(Boolean)
  if (parts.length === 0) return 'No rigs, rules or rig tiles to remove'
  return `Removed ${parts.join(', ')}`
}

/**
 * Build the JSON body written by "Export for older desktop".
 *
 * Pure so the save handler stays a thin Electron-dialog wrapper; the result is
 * validated with `DeckConfigSchema` before it can reach the filesystem.
 */
export function legacyConfigJson(config: DeckConfig): LegacyConfigExport {
  const { config: stripped, removed } = stripAutomationForLegacy(config)
  const validated = DeckConfigSchema.parse(stripped) as DeckConfig
  return {
    json: `${JSON.stringify(validated, null, 2)}\n`,
    removed,
    summary: describeLegacyRemoval(removed),
  }
}
