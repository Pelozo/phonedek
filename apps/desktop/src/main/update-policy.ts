import { spawnSync } from 'node:child_process'
import type { UpdateDisabledReason } from '../shared/update-status'

/**
 * Signature-aware auto-update policy.
 *
 * Windows NSIS updates work without Authenticode. macOS uses Squirrel.Mac,
 * which requires the running app to be signed with a Developer ID Application
 * certificate (and notarized for distribution). Linux has no packaged
 * AppImage yet. Development builds never update themselves.
 */

export interface UpdatePolicyInput {
  isPackaged: boolean
  platform: NodeJS.Platform
  /**
   * Result of the macOS signature probe. Only meaningful on darwin; ignored
   * everywhere else so the policy stays a pure function in tests.
   */
  developerIdSigned?: boolean
}

export interface UpdatePolicy {
  enabled: boolean
  /** Null when enabled. */
  reason: UpdateDisabledReason | null
  developerIdSigned: boolean
}

/** Pure policy matrix used by the app and unit tests. */
export function resolveUpdatePolicy(input: UpdatePolicyInput): UpdatePolicy {
  const signed = input.platform === 'darwin' && input.developerIdSigned === true

  if (!input.isPackaged) {
    return { enabled: false, reason: 'development', developerIdSigned: signed }
  }
  if (input.platform === 'win32') {
    return { enabled: true, reason: null, developerIdSigned: false }
  }
  if (input.platform === 'darwin') {
    return signed
      ? { enabled: true, reason: null, developerIdSigned: true }
      : { enabled: false, reason: 'unsigned-macos', developerIdSigned: false }
  }
  return { enabled: false, reason: 'unsupported-platform', developerIdSigned: false }
}

/* ------------------------------------------------------------------ */
/* macOS Developer ID signature detection                              */
/* ------------------------------------------------------------------ */

export interface CodesignProbe {
  stdout?: string | null
  stderr?: string | null
  status?: number | null
  error?: string | null
}

export type CodesignRunner = (command: string, args: readonly string[]) => CodesignProbe

const DEVELOPER_ID_AUTHORITY = /^\s*Authority=Developer ID Application:/m

/** Whether any codesign output line names a Developer ID Application authority. */
export function hasDeveloperIdAuthority(output: string): boolean {
  return DEVELOPER_ID_AUTHORITY.test(output)
}

/**
 * Interpret a codesign probe. `-dv --verbose=2` writes the authority chain to
 * stderr; inspect stdout too for robustness. Missing/failed codesign (non-zero
 * status or spawn error) is treated as unsigned.
 */
export function isDeveloperIdSignature(probe: CodesignProbe): boolean {
  if (probe.error) return false
  if (probe.status !== 0) return false
  return hasDeveloperIdAuthority(`${probe.stdout ?? ''}\n${probe.stderr ?? ''}`)
}

function runCodesign(command: string, args: readonly string[]): CodesignProbe {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    error: result.error ? result.error.message : undefined,
  }
}

/**
 * Probe the running executable's code signature. Never throws: a missing
 * codesign binary, permission problem or malformed output means unsigned.
 */
export function detectDeveloperIdSignature(
  execPath: string,
  run: CodesignRunner = runCodesign,
): boolean {
  try {
    return isDeveloperIdSignature(run('/usr/bin/codesign', ['-dv', '--verbose=2', execPath]))
  } catch {
    return false
  }
}

/**
 * Cached probe factory. The policy must not pay for codesign on every status
 * read, and a failed probe must stay cached (not retried in a loop).
 */
export function createDeveloperIdProbe(
  run: CodesignRunner = runCodesign,
): (execPath: string) => boolean {
  const cache = new Map<string, boolean>()
  return (execPath: string): boolean => {
    const cached = cache.get(execPath)
    if (cached !== undefined) return cached
    const signed = detectDeveloperIdSignature(execPath, run)
    cache.set(execPath, signed)
    return signed
  }
}

/** Cached probe for the current packaged executable. */
export const isRunningAppSigned = createDeveloperIdProbe()
