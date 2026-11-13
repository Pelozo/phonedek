import type { ObsAction, ObsStateBinding, ObsStateTarget } from '@phonedek/shared'
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

/* ------------------------------------------------------------------ */
/* OBS phase 2: action + status helpers (pure, renderer-only)          */
/* ------------------------------------------------------------------ */

export interface ObsStateTargetInfo {
  value: ObsStateTarget
  label: string
  /** Short editor badge, without the OBS prefix. */
  badge: string
  hint: string
  needsInput: boolean
  needsScene: boolean
}

const STATE_TARGET_INFO: Record<ObsStateTarget, ObsStateTargetInfo> = {
  streaming: {
    value: 'streaming',
    label: 'Stream status',
    badge: 'LIVE',
    hint: 'The phone shows LIVE while OBS is streaming, OFF otherwise.',
    needsInput: false,
    needsScene: false,
  },
  recording: {
    value: 'recording',
    label: 'Recording status',
    badge: 'REC',
    hint: 'The phone shows REC while OBS is recording, OFF otherwise.',
    needsInput: false,
    needsScene: false,
  },
  replay: {
    value: 'replay',
    label: 'Replay buffer status',
    badge: 'REPLAY',
    hint: 'The phone shows REPLAY while the replay buffer is active, OFF otherwise.',
    needsInput: false,
    needsScene: false,
  },
  virtualCam: {
    value: 'virtualCam',
    label: 'Virtual camera status',
    badge: 'VCAM',
    hint: 'The phone shows VCAM while the OBS virtual camera is on, OFF otherwise.',
    needsInput: false,
    needsScene: false,
  },
  scene: {
    value: 'scene',
    label: 'Scene status',
    badge: 'SCENE',
    hint: 'The phone shows the current program scene. Set a scene name to mark this tile active only while that scene is live.',
    needsInput: false,
    needsScene: true,
  },
  inputMute: {
    value: 'inputMute',
    label: 'Input mute status',
    badge: 'MUTE',
    hint: 'The phone shows MUTED or ON for the selected OBS input.',
    needsInput: true,
    needsScene: false,
  },
  inputVolume: {
    value: 'inputVolume',
    label: 'Input volume status',
    badge: 'VOL',
    hint: 'The phone shows the selected OBS input level and its mute state.',
    needsInput: true,
    needsScene: false,
  },
}

/** Stable order for the Inspector status target picker. */
export const OBS_STATE_TARGETS: readonly ObsStateTargetInfo[] = [
  STATE_TARGET_INFO.streaming,
  STATE_TARGET_INFO.recording,
  STATE_TARGET_INFO.replay,
  STATE_TARGET_INFO.virtualCam,
  STATE_TARGET_INFO.scene,
  STATE_TARGET_INFO.inputMute,
  STATE_TARGET_INFO.inputVolume,
]

export function obsStateTargetInfo(target: ObsStateTarget): ObsStateTargetInfo {
  return STATE_TARGET_INFO[target]
}

/** Editor-only static badge. Live values only exist on the phone. */
export function obsStateBadge(target: ObsStateTarget): string {
  return `OBS · ${obsStateTargetInfo(target).badge}`
}

/** One-line inspector summary; deliberately avoids pretending to be live. */
export function obsStateBindingSummary(binding: ObsStateBinding | null | undefined): string | null {
  if (!binding) return null
  const info = obsStateTargetInfo(binding.target)
  if (binding.target === 'scene') {
    return binding.scene ? `${info.label} · ${binding.scene}` : `${info.label} · current program scene`
  }
  if (info.needsInput && binding.input) return `${info.label} · ${binding.input}`
  return info.label
}

const OBS_ACTION_TITLES: Record<ObsAction['action'], string> = {
  toggleMute: 'OBS mute',
  setScene: 'OBS scene',
  toggleStream: 'OBS stream',
  startStream: 'OBS stream',
  stopStream: 'OBS stream',
  toggleRecord: 'OBS recording',
  startRecord: 'OBS recording',
  stopRecord: 'OBS recording',
  startReplay: 'OBS replay',
  stopReplay: 'OBS replay',
  saveReplay: 'OBS replay',
  toggleVirtualCam: 'OBS virtual cam',
  setSourceVisibility: 'OBS source',
  toggleSourceVisibility: 'OBS source',
  addMarker: 'OBS marker',
}

export function obsActionTitle(action: ObsAction): string {
  return OBS_ACTION_TITLES[action.action]
}

/**
 * Change an OBS action's operation while keeping fields that still apply.
 * Required fields (source) may be empty while the user fills the form; the
 * config schema rejects it on save and the field shows a REQUIRED state.
 */
export function obsActionVariant(action: ObsAction, next: ObsAction['action']): ObsAction {
  const scene = 'scene' in action ? action.scene : undefined
  const input = action.action === 'toggleMute' ? action.input : undefined
  const source = 'source' in action ? action.source : ''
  const sourceName = source.trim() || 'Camera'
  const visible = action.action === 'setSourceVisibility' ? action.visible : true
  const marker = action.action === 'addMarker' ? action.name : undefined

  switch (next) {
    case 'toggleMute':
      return { type: 'obs', action: next, ...(input ? { input } : {}) }
    case 'setScene':
      return { type: 'obs', action: next, ...(scene ? { scene } : {}) }
    case 'toggleStream':
    case 'startStream':
    case 'stopStream':
    case 'toggleRecord':
    case 'startRecord':
    case 'stopRecord':
    case 'startReplay':
    case 'stopReplay':
    case 'saveReplay':
    case 'toggleVirtualCam':
      return { type: 'obs', action: next }
    case 'setSourceVisibility':
      return {
        type: 'obs',
        action: next,
        ...(scene ? { scene } : {}),
        source: sourceName,
        visible,
      }
    case 'toggleSourceVisibility':
      return { type: 'obs', action: next, ...(scene ? { scene } : {}), source: sourceName }
    case 'addMarker':
      return { type: 'obs', action: next, ...(marker ? { name: marker } : {}) }
  }
}

/** Required OBS names are 1..128 chars after trimming. */
export function obsNameError(value: string | undefined, required: boolean): string | null {
  const name = value?.trim() ?? ''
  if (name.length === 0) return required ? 'Required — 1 to 128 characters' : null
  if (name.length > 128) return 'Use 128 characters or fewer'
  return null
}

export function obsNameOrUndefined(value: string): string | undefined {
  const name = value.trim()
  return name.length > 0 ? name : undefined
}
