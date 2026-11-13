import type { TwitchAction, TwitchStateBinding, TwitchStateTarget } from '@phonedek/shared'
import type { TwitchStateView, TwitchStatusView } from '../../../shared/api'

export type TwitchTone = 'ok' | 'warn' | 'error' | 'muted'

export interface TwitchStatusSummary {
  label: string
  detail: string
  tone: TwitchTone
}

export interface TwitchAvailability {
  label: string
  detail: string
  tone: TwitchTone
}

const STATE_LABELS: Record<TwitchStateView, string> = {
  disabled: 'Disabled',
  unauthorized: 'Not connected',
  authorizing: 'Waiting for authorization…',
  authorized: 'Connected',
  error: 'Connection error',
}

export function twitchVerificationUrl(uri: string): string {
  const value = uri.trim()
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  return `https://${value.replace(/^\/+/, '')}`
}

export function twitchVerificationHost(uri: string): string {
  return twitchVerificationUrl(uri).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/** Local time for a token or device-code expiry. Null when unusable. */
export function formatTwitchExpiry(expiresAt: number | null | undefined): string | null {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Human-readable connection state for Settings and the editor. */
export function twitchStatusSummary(
  status: TwitchStatusView | null | undefined,
): TwitchStatusSummary {
  if (!status) {
    return {
      label: 'Status unavailable',
      detail: 'The desktop did not report Twitch state.',
      tone: 'muted',
    }
  }

  switch (status.state) {
    case 'authorized': {
      const who = status.account?.trim() || status.login?.trim()
      const scopes = status.scopes.length
      return {
        label: STATE_LABELS.authorized,
        detail: [
          who ? `Signed in as ${who}` : 'Twitch account connected',
          scopes > 0 ? `${scopes} scope${scopes === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'ok',
      }
    }
    case 'authorizing': {
      const device = status.device
      return {
        label: STATE_LABELS.authorizing,
        detail: device
          ? `Enter ${device.userCode} at ${twitchVerificationHost(device.verificationUri)}.`
          : 'Finish the Twitch activation in your browser.',
        tone: 'warn',
      }
    }
    case 'unauthorized':
      return {
        label: STATE_LABELS.unauthorized,
        detail:
          status.lastError?.trim() ||
          (status.enabled
            ? 'Connect your Twitch account to enable actions and status tiles.'
            : 'Turn on Twitch control first.'),
        tone: status.enabled ? 'warn' : 'muted',
      }
    case 'error':
      return {
        label: STATE_LABELS.error,
        detail: status.lastError?.trim() || 'Check Settings → Twitch and try connecting again.',
        tone: 'error',
      }
    case 'disabled':
    default:
      return {
        label: STATE_LABELS.disabled,
        detail: 'Twitch control is off. Turn it on to connect your account.',
        tone: 'muted',
      }
  }
}

/** Short badge for action editors: can this action run right now? */
export function twitchAvailability(
  status: TwitchStatusView | null | undefined,
): TwitchAvailability {
  if (!status) {
    return {
      label: 'STATUS UNKNOWN',
      detail: 'The desktop did not report Twitch state.',
      tone: 'muted',
    }
  }

  switch (status.state) {
    case 'authorized':
      return {
        label: 'CONNECTED',
        detail: status.account?.trim()
          ? `Signed in as ${status.account.trim()}. Actions run through Twitch Helix.`
          : 'Twitch account connected. Actions run through Twitch Helix.',
        tone: 'ok',
      }
    case 'authorizing':
      return {
        label: 'AUTH PENDING',
        detail: 'Finish Twitch authorization before this action can run.',
        tone: 'warn',
      }
    case 'error':
      return {
        label: 'TWITCH ERROR',
        detail: status.lastError?.trim() || 'Check Settings → Twitch.',
        tone: 'error',
      }
    case 'disabled':
      return {
        label: 'TWITCH OFF',
        detail: 'Enable Twitch in Settings → Twitch before using this action.',
        tone: 'muted',
      }
    case 'unauthorized':
    default:
      return {
        label: 'NOT CONNECTED',
        detail: 'Connect your Twitch account in Settings → Twitch. The action stays saved and fails clearly until then.',
        tone: 'warn',
      }
  }
}

/* ------------------------------------------------------------------ */
/* Client ID                                                           */
/* ------------------------------------------------------------------ */

/** Public Client ID: empty is allowed; otherwise 1..64 alphanumerics. */
export function twitchClientIdError(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 64) return 'Use 64 characters or fewer.'
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
    return 'Use only letters and digits — no spaces, dashes, or underscores.'
  }
  return null
}

export function twitchClientIdOrEmpty(value: string): string {
  return value.trim()
}

/* ------------------------------------------------------------------ */
/* Status bindings                                                     */
/* ------------------------------------------------------------------ */

export interface TwitchStateTargetInfo {
  value: TwitchStateTarget
  label: string
  /** Short editor badge, without the TWITCH prefix. */
  badge: string
  hint: string
}

const STATE_TARGET_INFO: Record<TwitchStateTarget, TwitchStateTargetInfo> = {
  live: {
    value: 'live',
    label: 'Live status',
    badge: 'LIVE',
    hint: 'The phone shows LIVE while the channel is live, OFF otherwise. No Twitch badge appears when the connection is unavailable.',
  },
  viewers: {
    value: 'viewers',
    label: 'Viewer count',
    badge: 'VIEWERS',
    hint: 'The phone shows the current viewer count while live; offline tiles show OFF.',
  },
  uptime: {
    value: 'uptime',
    label: 'Stream uptime',
    badge: 'UPTIME',
    hint: 'The phone shows the elapsed stream time (h:mm:ss); offline tiles show OFF.',
  },
  title: {
    value: 'title',
    label: 'Stream title',
    badge: 'TITLE',
    hint: 'The phone shows the current channel title. Long titles are truncated on the tile.',
  },
  game: {
    value: 'game',
    label: 'Category / game',
    badge: 'GAME',
    hint: 'The phone shows the current category name. Long names are truncated on the tile.',
  },
}

/** Stable order for the Inspector status target picker. */
export const TWITCH_STATE_TARGETS: readonly TwitchStateTargetInfo[] = [
  STATE_TARGET_INFO.live,
  STATE_TARGET_INFO.viewers,
  STATE_TARGET_INFO.uptime,
  STATE_TARGET_INFO.title,
  STATE_TARGET_INFO.game,
]

export function twitchStateTargetInfo(target: TwitchStateTarget): TwitchStateTargetInfo {
  return STATE_TARGET_INFO[target]
}

/** Editor-only static badge. Live values only exist on the phone. */
export function twitchStateBadge(target: TwitchStateTarget): string {
  return `TWITCH · ${twitchStateTargetInfo(target).badge}`
}

/** One-line inspector summary; deliberately avoids pretending to be live. */
export function twitchStateBindingSummary(
  binding: TwitchStateBinding | null | undefined,
): string | null {
  if (!binding) return null
  return twitchStateTargetInfo(binding.target).label
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const TWITCH_ACTION_TITLES: Record<TwitchAction['action'], string> = {
  sendChat: 'Twitch chat',
  createMarker: 'Twitch marker',
  setTitle: 'Twitch title',
  setGame: 'Twitch category',
}

export function twitchActionTitle(action: TwitchAction): string {
  return TWITCH_ACTION_TITLES[action.action]
}

export const TWITCH_ACTION_OPTIONS: ReadonlyArray<{
  value: TwitchAction['action']
  label: string
}> = [
  { value: 'sendChat', label: 'Send chat message' },
  { value: 'createMarker', label: 'Create stream marker' },
  { value: 'setTitle', label: 'Set stream title' },
  { value: 'setGame', label: 'Set game / category' },
]

/**
 * Change a Twitch operation while keeping text that still applies. Required
 * fields may stay empty while the user fills the form; the config schema
 * rejects the action on save and the field shows a REQUIRED state.
 */
export function twitchActionVariant(
  action: TwitchAction,
  next: TwitchAction['action'],
): TwitchAction {
  const message = action.action === 'sendChat' ? action.message : ''
  const description = action.action === 'createMarker' ? action.description : undefined
  const title = action.action === 'setTitle' ? action.title : ''
  const game = action.action === 'setGame' ? action.game : ''

  switch (next) {
    case 'sendChat':
      return { type: 'twitch', action: 'sendChat', message }
    case 'createMarker':
      return {
        type: 'twitch',
        action: 'createMarker',
        ...(description?.trim() ? { description } : {}),
      }
    case 'setTitle':
      return { type: 'twitch', action: 'setTitle', title }
    case 'setGame':
      return { type: 'twitch', action: 'setGame', game }
  }
}

/** Required text is 1..limit after trimming; optional text only honours max. */
export function twitchTextError(
  value: string | undefined,
  limit: number,
  required: boolean,
): string | null {
  const text = value ?? ''
  if (text.length > limit) return `Use ${limit} characters or fewer.`
  if (required && text.trim().length === 0) {
    return `Required — 1 to ${limit} characters.`
  }
  return null
}

export function twitchOptionalText(value: string): string | undefined {
  const text = value.trim()
  return text.length > 0 ? text : undefined
}
