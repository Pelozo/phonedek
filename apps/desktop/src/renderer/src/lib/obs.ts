import type { ObsInputView, ObsStateView, ObsStatusView } from '../../../shared/api'

export type ObsTone = 'ok' | 'warn' | 'error' | 'muted'

export interface ObsStatusSummary {
  label: string
  detail: string
  tone: ObsTone
}

export interface ObsInputAvailability {
  label: string
  detail: string
  tone: ObsTone
}

const STATE_LABELS: Record<ObsStateView, string> = {
  disabled: 'Disabled',
  connecting: 'Connecting…',
  connected: 'Connected',
  'auth-failed': 'Authentication failed',
  disconnected: 'Not connected',
  reconnecting: 'Reconnecting…',
  error: 'Connection error',
}

export function obsEndpoint(status: ObsStatusView | null | undefined): string {
  if (!status) return 'OBS WebSocket'
  const host = status.host.includes(':') && !status.host.startsWith('[') ? `[${status.host}]` : status.host
  return `${host}:${status.port}`
}

/** Human-readable status line for Settings and the editor. */
export function obsStatusSummary(status: ObsStatusView | null | undefined): ObsStatusSummary {
  if (!status) {
    return { label: 'Status unavailable', detail: 'The desktop did not report OBS state.', tone: 'muted' }
  }
  const endpoint = obsEndpoint(status)

  switch (status.state) {
    case 'connected': {
      const versions = [
        status.obsVersion ? `OBS ${status.obsVersion}` : null,
        status.websocketVersion ? `obs-websocket ${status.websocketVersion}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return { label: 'Connected', detail: versions || `WebSocket at ${endpoint}`, tone: 'ok' }
    }
    case 'connecting':
      return { label: STATE_LABELS.connecting, detail: `Opening ${endpoint}`, tone: 'warn' }
    case 'auth-failed':
      return {
        label: STATE_LABELS['auth-failed'],
        detail: 'Check the password in OBS → Tools → WebSocket Server Settings.',
        tone: 'error',
      }
    case 'reconnecting': {
      const retry =
        typeof status.nextRetryMs === 'number'
          ? `Next attempt in ${Math.max(1, Math.round(status.nextRetryMs / 1000))}s`
          : 'Waiting to retry'
      return { label: STATE_LABELS.reconnecting, detail: `${retry} · ${endpoint}`, tone: 'warn' }
    }
    case 'disconnected':
      return {
        label: STATE_LABELS.disconnected,
        detail: status.lastError?.trim() || `Waiting for OBS at ${endpoint}.`,
        tone: 'warn',
      }
    case 'error':
      return {
        label: STATE_LABELS.error,
        detail: status.lastError?.trim() || `Could not reach ${endpoint}.`,
        tone: 'error',
      }
    case 'disabled':
    default:
      return {
        label: STATE_LABELS.disabled,
        detail: 'Turn on OBS control to mix its audio inputs from the deck.',
        tone: 'muted',
      }
  }
}

/** Badge and reason for an OBS input picker. */
export function obsInputAvailability({
  status,
  selected,
  inputs,
  loaded,
}: {
  status: ObsStatusView | null | undefined
  selected?: string
  inputs: ObsInputView[]
  loaded: boolean
}): ObsInputAvailability {
  if (!status || status.state !== 'connected') {
    return { label: 'NO OBS', detail: 'OBS is not connected. Check Settings → OBS Studio.', tone: 'muted' }
  }
  if (!loaded) {
    return { label: 'CHECKING', detail: 'Loading OBS inputs…', tone: 'warn' }
  }
  if (inputs.length === 0) {
    return { label: 'NO INPUTS', detail: 'OBS has no inputs in this scene collection.', tone: 'warn' }
  }

  const name = selected?.trim()
  if (name) {
    if (inputs.some((input) => input.name === name)) {
      return { label: 'LIVE', detail: name, tone: 'ok' }
    }
    return {
      label: 'NO INPUT',
      detail: `“${name}” was not found in this OBS scene collection. Pick it again.`,
      tone: 'error',
    }
  }

  const fallback = inputs.find((input) => input.audio) ?? inputs[0]
  return {
    label: 'DEFAULT',
    detail: fallback ? `Uses ${fallback.name}` : 'Uses the first OBS input.',
    tone: 'ok',
  }
}
