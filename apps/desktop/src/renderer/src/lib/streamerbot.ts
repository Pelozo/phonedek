import {
  STREAMERBOT_MAX_ACTION_NAME,
  STREAMERBOT_MAX_ARGS,
  STREAMERBOT_MAX_ARG_KEY,
  STREAMERBOT_MAX_ARG_VALUE,
} from '@phonedek/shared'
import type { StreamerBotAction } from '@phonedek/shared'
import type {
  StreamerBotActionView,
  StreamerBotStatus,
} from '../../../shared/api'

export type StreamerBotTone = 'ok' | 'warn' | 'error' | 'muted'

export interface StreamerBotStatusSummary {
  label: string
  detail: string
  tone: StreamerBotTone
}

export interface StreamerBotAvailability {
  label: string
  detail: string
  tone: StreamerBotTone
}

export interface StreamerBotActionGroup {
  /** `null` for actions that are not in a Streamer.bot group. */
  group: string | null
  actions: StreamerBotActionView[]
}

/** One editable key/value argument row with a stable React key. */
export interface StreamerBotArgRow {
  id: string
  key: string
  value: string
}

let argSequence = 0

function nextArgId(): string {
  argSequence += 1
  return `sb-arg-${argSequence}`
}

function formatEndpoint(host: string, port: number): string {
  const clean = host.trim() || '127.0.0.1'
  const wrapped = clean.includes(':') && !clean.startsWith('[') ? `[${clean}]` : clean
  return `${wrapped}:${port}`
}

export function streamerbotEndpoint(
  status: Pick<StreamerBotStatus, 'host' | 'port'> | null | undefined,
): string {
  if (!status) return 'Streamer.bot WebSocket'
  return formatEndpoint(status.host, status.port)
}

/**
 * Human-readable status for Settings and the action editor. Errors carry the
 * next step (password, host/port, WebSocket server) instead of only the code.
 */
export function streamerbotStatusSummary(
  status: StreamerBotStatus | null | undefined,
): StreamerBotStatusSummary {
  if (!status) {
    return {
      label: 'Status unavailable',
      detail: 'The desktop did not report Streamer.bot state.',
      tone: 'muted',
    }
  }
  const endpoint = streamerbotEndpoint(status)
  const error = status.lastError?.trim()

  switch (status.state) {
    case 'connected': {
      const parts: string[] = []
      if (status.instanceName?.trim()) parts.push(status.instanceName.trim())
      if (status.version?.trim()) parts.push(`Streamer.bot ${status.version.trim()}`)
      if (typeof status.actionCount === 'number') {
        parts.push(`${status.actionCount} action${status.actionCount === 1 ? '' : 's'}`)
      }
      return {
        label: 'Connected',
        detail: parts.length > 0 ? parts.join(' · ') : `WebSocket at ${endpoint}`,
        tone: 'ok',
      }
    }
    case 'connecting':
      return { label: 'Connecting…', detail: `Opening ${endpoint}`, tone: 'warn' }
    case 'auth-failed':
      return {
        label: 'Authentication failed',
        detail:
          error && !/auth/i.test(error)
            ? `${error} — check the WebSocket password in Streamer.bot → Servers/Clients → HTTP Server.`
            : 'Wrong WebSocket password — check Servers/Clients → HTTP Server in Streamer.bot.',
        tone: 'error',
      }
    case 'reconnecting': {
      const retry =
        typeof status.nextRetryMs === 'number'
          ? `Retrying in ${Math.max(1, Math.round(status.nextRetryMs / 1000))}s`
          : 'Waiting to retry'
      return {
        label: 'Reconnecting…',
        detail: `${retry} · ${error || endpoint}`,
        tone: 'warn',
      }
    }
    case 'disconnected':
      return {
        label: 'Offline',
        detail: error || `Waiting for Streamer.bot at ${endpoint}.`,
        tone: 'warn',
      }
    case 'error':
      return {
        label: 'Connection error',
        detail: `${error || `Could not reach ${endpoint}`} — check the host, port and WebSocket server.`,
        tone: 'error',
      }
    case 'disabled':
    default:
      return {
        label: 'Disabled',
        detail: 'Turn on Streamer.bot control to trigger actions from the deck.',
        tone: 'muted',
      }
  }
}

/** Short state used by the action picker header. */
export function streamerbotAvailability(
  status: StreamerBotStatus | null | undefined,
): StreamerBotAvailability {
  if (!status) {
    return {
      label: 'STATUS UNKNOWN',
      detail: 'The desktop did not report Streamer.bot state.',
      tone: 'muted',
    }
  }
  const summary = streamerbotStatusSummary(status)
  switch (status.state) {
    case 'connected':
      return { label: 'CONNECTED', detail: summary.detail, tone: 'ok' }
    case 'connecting':
      return { label: 'CONNECTING', detail: summary.detail, tone: 'warn' }
    case 'reconnecting':
      return { label: 'RECONNECTING', detail: summary.detail, tone: 'warn' }
    case 'auth-failed':
      return { label: 'AUTH FAILED', detail: summary.detail, tone: 'error' }
    case 'error':
      return { label: 'ERROR', detail: summary.detail, tone: 'error' }
    case 'disconnected':
      return { label: 'OFFLINE', detail: summary.detail, tone: 'warn' }
    case 'disabled':
    default:
      return {
        label: 'STREAMER.BOT OFF',
        detail: 'Enable Streamer.bot in Settings → Integrations.',
        tone: 'muted',
      }
  }
}

export function streamerbotNameError(name: string | undefined): string | null {
  const clean = name?.trim() ?? ''
  if (clean.length === 0) {
    return 'Required — choose or type a Streamer.bot action name.'
  }
  if (clean.length > STREAMERBOT_MAX_ACTION_NAME) {
    return `Use ${STREAMERBOT_MAX_ACTION_NAME} characters or fewer.`
  }
  return null
}

/** Match a configured name against the live list; names are case-sensitive. */
export function findStreamerbotAction(
  actions: readonly StreamerBotActionView[],
  name: string | undefined,
): StreamerBotActionView | undefined {
  const clean = name?.trim()
  if (!clean) return undefined
  return actions.find((action) => action.name === clean)
}

/** Case-insensitive, every-token match against action name and group. */
export function filterStreamerbotActions(
  actions: readonly StreamerBotActionView[],
  query: string,
): StreamerBotActionView[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return [...actions]
  return actions.filter((action) => {
    const haystack = `${action.name} ${action.group ?? ''}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

/**
 * Group a (usually filtered) list for `<optgroup>` rendering. Ungrouped
 * actions come first, followed by named groups in alphabetical order.
 */
export function groupStreamerbotActions(
  actions: readonly StreamerBotActionView[],
): StreamerBotActionGroup[] {
  const groups = new Map<string, StreamerBotActionGroup>()
  for (const action of actions) {
    const group = action.group?.trim() || null
    const key = group ?? ''
    const existing = groups.get(key)
    if (existing) {
      existing.actions.push(action)
      continue
    }
    groups.set(key, { group, actions: [action] })
  }
  return [...groups.values()].sort((a, b) => {
    if (a.group === null) return b.group === null ? 0 : -1
    if (b.group === null) return 1
    return a.group.localeCompare(b.group)
  })
}

/** Action-picker state, combining connection, list and selection health. */
export function streamerbotPickerAvailability({
  status,
  selected,
  actions,
  loaded,
  error,
}: {
  status: StreamerBotStatus | null | undefined
  selected?: string
  actions: readonly StreamerBotActionView[]
  loaded: boolean
  error?: string | null
}): StreamerBotAvailability {
  if (!status || status.state !== 'connected') return streamerbotAvailability(status)
  if (!loaded) {
    return { label: 'CHECKING', detail: 'Loading Streamer.bot actions…', tone: 'warn' }
  }
  if (error) {
    return { label: 'LIST UNAVAILABLE', detail: error, tone: 'error' }
  }
  if (actions.length === 0) {
    return {
      label: 'NO ACTIONS',
      detail: 'Streamer.bot has no actions yet. Create one in its Actions tab.',
      tone: 'warn',
    }
  }

  const name = selected?.trim() ?? ''
  if (!name) {
    return {
      label: 'PICK ACTION',
      detail: 'Choose an action from the list, or type its exact name.',
      tone: 'muted',
    }
  }
  const match = findStreamerbotAction(actions, name)
  if (!match) {
    return {
      label: 'NOT IN LIST',
      detail: `“${name}” is not in this action list. It is still sent by name.`,
      tone: 'warn',
    }
  }
  const parts: string[] = []
  if (match.group) parts.push(match.group)
  parts.push(`${match.subactionCount} subaction${match.subactionCount === 1 ? '' : 's'}`)
  if (match.triggerCount > 0) {
    parts.push(`${match.triggerCount} trigger${match.triggerCount === 1 ? '' : 's'}`)
  }
  if (!match.enabled) parts.push('disabled in Streamer.bot')
  return { label: 'READY', detail: parts.join(' · '), tone: match.enabled ? 'ok' : 'warn' }
}

export function streamerbotActionTitle(): string {
  return 'Streamer.bot'
}

/**
 * Collapsed action-card line: `STREAMER.BOT · <action>` plus a short argument
 * count. Names are flattened to one line and clipped like other summaries.
 */
export function streamerbotActionSummary(action: StreamerBotAction): string {
  const oneLine = action.actionName.replace(/\s+/g, ' ').trim()
  const label = oneLine.length > 0
    ? oneLine.length > 48
      ? `${oneLine.slice(0, 45)}…`
      : oneLine
    : 'No action selected'
  const count = action.args ? Object.keys(action.args).length : 0
  return `STREAMER.BOT · ${label}${count > 0 ? ` · ${count} arg${count === 1 ? '' : 's'}` : ''}`
}

/* ------------------------------------------------------------------ */
/* Settings validation                                                 */
/* ------------------------------------------------------------------ */

/** Mirrors the main process host rules so Save can fail before an IPC trip. */
export function streamerbotHostError(host: string): string | null {
  const value = host.trim()
  if (!value) return 'Enter a host.'
  if (value.length > 253) return 'Use 253 characters or fewer.'
  if (value.includes('://') || /[/\\?#@\s]/.test(value)) {
    return 'Enter a hostname or IP address — no scheme or path.'
  }
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]$/.exec(value)
  if (ipv6) {
    return ipv6[1]!.includes(':') ? null : 'Enter a valid bracketed IPv6 address.'
  }
  if (value.includes(':')) return 'Enter the port separately.'
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value)) {
    return 'Use letters, digits, dots or dashes.'
  }
  if (value.includes('..') || value.startsWith('.') || value.endsWith('.')) {
    return 'Enter a valid hostname.'
  }
  return null
}

export function streamerbotPortError(port: number | string): string | null {
  const value = typeof port === 'string' ? Number(port) : port
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return 'Port must be between 1 and 65535.'
  }
  return null
}

export function isLoopbackStreamerbotHost(host: string): boolean {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(host.trim())
}

/* ------------------------------------------------------------------ */
/* Argument rows                                                       */
/* ------------------------------------------------------------------ */

export function streamerbotArgRows(
  args?: Record<string, string> | null,
): StreamerBotArgRow[] {
  if (!args) return []
  return Object.entries(args).map(([key, value]) => ({
    id: nextArgId(),
    key,
    value,
  }))
}

/** Append one blank row, capped at the shared 16-argument limit. */
export function appendStreamerbotArg(rows: readonly StreamerBotArgRow[]): StreamerBotArgRow[] {
  if (rows.length >= STREAMERBOT_MAX_ARGS) return [...rows]
  return [...rows, { id: nextArgId(), key: '', value: '' }]
}

export function removeStreamerbotArg(
  rows: readonly StreamerBotArgRow[],
  id: string,
): StreamerBotArgRow[] {
  return rows.filter((row) => row.id !== id)
}

export function updateStreamerbotArg(
  rows: readonly StreamerBotArgRow[],
  id: string,
  patch: Partial<Pick<StreamerBotArgRow, 'key' | 'value'>>,
): StreamerBotArgRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

/** Rows with a non-blank name; blank scratch rows are ignored. */
export function streamerbotActiveArgCount(rows: readonly StreamerBotArgRow[]): number {
  return rows.filter((row) => row.key.trim().length > 0).length
}

function normalizedArgKey(key: string): string {
  return key.trim().toLowerCase()
}

/**
 * Row-level problem. Duplicate names are compared case-insensitively and are
 * reported on the later row. A completely blank row is an inert scratch row.
 */
export function streamerbotArgRowError(
  rows: readonly StreamerBotArgRow[],
  id: string,
): string | null {
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return null
  const row = rows[index]!
  const key = row.key.trim()
  if (key.length > STREAMERBOT_MAX_ARG_KEY) {
    return `Use ${STREAMERBOT_MAX_ARG_KEY} characters or fewer.`
  }
  if (row.value.length > STREAMERBOT_MAX_ARG_VALUE) {
    return `Use ${STREAMERBOT_MAX_ARG_VALUE} characters or fewer.`
  }
  if (key.length === 0) {
    return row.value.trim().length > 0 ? 'Name required.' : null
  }
  const duplicate = rows
    .slice(0, index)
    .some((candidate) => normalizedArgKey(candidate.key) === normalizedArgKey(key))
  return duplicate ? 'Duplicate name — the first value wins.' : null
}

/** First problem in the argument table, prefixed with its row number. */
export function streamerbotArgError(rows: readonly StreamerBotArgRow[]): string | null {
  if (streamerbotActiveArgCount(rows) > STREAMERBOT_MAX_ARGS) {
    return `At most ${STREAMERBOT_MAX_ARGS} arguments.`
  }
  for (let index = 0; index < rows.length; index += 1) {
    const error = streamerbotArgRowError(rows, rows[index]!.id)
    if (error) {
      return `Argument ${index + 1}: ${error}`
    }
  }
  return null
}

/**
 * Build the action's argument map. Keys are trimmed, blank and duplicate keys
 * are skipped (the first row wins), and an empty result is omitted entirely.
 */
export function streamerbotArgsFromRows(
  rows: readonly StreamerBotArgRow[],
): Record<string, string> | undefined {
  const args: Record<string, string> = {}
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    const normalized = normalizedArgKey(key)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    args[key] = row.value
    if (seen.size >= STREAMERBOT_MAX_ARGS) break
  }
  return seen.size > 0 ? args : undefined
}
