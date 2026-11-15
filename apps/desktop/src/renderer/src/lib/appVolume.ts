import { createEmptyButton } from '@phonedek/shared'
import type {
  Action,
  AppVolumeAction,
  AppVolumeMatch,
  AppVolumeStateBinding,
  AppVolumeStateTarget,
  ConfigAction,
  DeckButton,
  MixerSession,
  MixerSnapshot,
  SliderOrDialControlSpec,
  StreamerBotAction,
} from '@phonedek/shared'
import type { IconName } from '../components/Icons'

export const APP_VOLUME_BADGE = 'APP · VOL'
export const APP_MUTE_BADGE = 'APP · MUTE'

/**
 * Editor action union until `ConfigAction` itself includes app-volume and
 * Streamer.bot actions (both are already accepted by the schema, planner and
 * desktop executor).
 */
export type EditorAction = ConfigAction | AppVolumeAction | StreamerBotAction

export type MixerTone = 'ok' | 'warn' | 'error' | 'muted'

export interface MixerAvailability {
  label: string
  detail: string
  tone: MixerTone
}

/** One deduplicated app process from a mixer snapshot. */
export interface MixerProcessOption {
  process: string
  name: string
  volume: number
  muted: boolean
  /** Number of live audio sessions for this process. */
  count: number
  ambiguous: boolean
}

export interface AppVolumeStatusTilePreset {
  id: string
  label: string
  icon: string
  menuIcon: IconName
  target: AppVolumeStateTarget
  /** Mute status is tappable; volume status stays read-only. */
  action: boolean
  menuLabel: string
  menuDescription: string
}

const EMPTY_MATCH: AppVolumeMatch = {}

/** Case/path/suffix-insensitive key shared by pickers and session lookup. */
export function appProcessKey(process: string | undefined): string {
  return (process ?? '')
    .trim()
    .toLowerCase()
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/, '')
}

export function appVolumeMatch(process: string | undefined): AppVolumeMatch {
  const clean = process?.trim()
  return clean ? { process: clean } : { ...EMPTY_MATCH }
}

/** Deduplicate sessions by process while preserving snapshot order. */
export function mixerProcessOptions(
  snapshot: MixerSnapshot | null | undefined,
): MixerProcessOption[] {
  if (!snapshot?.sessions?.length) return []
  const options = new Map<string, MixerProcessOption>()
  for (const session of snapshot.sessions) {
    const process = session.process?.trim() || session.name?.trim() || 'unknown'
    const key = appProcessKey(process)
    const existing = options.get(key)
    if (existing) {
      existing.count += 1
      existing.ambiguous = true
      continue
    }
    options.set(key, {
      process,
      name: session.name?.trim() || process,
      volume: session.volume,
      muted: session.muted,
      count: 1,
      ambiguous: snapshot.ambiguous?.some((item) => appProcessKey(item) === key) ?? false,
    })
  }
  return [...options.values()]
}

/** Find the first live session a process match resolves to. */
export function findMixerSession(
  snapshot: MixerSnapshot | null | undefined,
  process: string | undefined,
): MixerSession | null {
  const key = appProcessKey(process)
  if (!key || !snapshot?.sessions?.length) return null
  return (
    snapshot.sessions.find((session) => {
      const processKey = appProcessKey(session.process)
      const nameKey = appProcessKey(session.name)
      return processKey === key || nameKey === key
    }) ?? null
  )
}

export function mixerSessionDetail(session: MixerSession): string {
  if (session.available === false) return 'OFFLINE'
  return session.muted ? 'MUTED' : `${Math.round(session.volume)}%`
}

/** Picker/Inspector status for the mixer snapshot and one selected process. */
export function mixerAvailability(
  snapshot: MixerSnapshot | null | undefined,
  selected?: string,
  error?: string | null,
): MixerAvailability {
  if (error) {
    return { label: 'MIXER ERROR', detail: error, tone: 'error' }
  }
  if (!snapshot) {
    return { label: 'CHECKING', detail: 'Reading desktop audio sessions…', tone: 'muted' }
  }
  if (!snapshot.available) {
    return {
      label: 'NO MIXER',
      detail: snapshot.reason?.trim() || 'Per-app audio is not available on this desktop.',
      tone: 'warn',
    }
  }
  if (!snapshot.sessions.length) {
    return {
      label: 'NO SESSION',
      detail: 'No app is playing audio right now. Start playback, then refresh.',
      tone: 'muted',
    }
  }
  const clean = selected?.trim()
  if (!clean) {
    return {
      label: 'PICK APP',
      detail: `${snapshot.sessions.length} live audio session${snapshot.sessions.length === 1 ? '' : 's'} available.`,
      tone: 'warn',
    }
  }
  const session = findMixerSession(snapshot, clean)
  if (!session) {
    return {
      label: 'NO SESSION',
      detail: `“${clean}” is not playing audio right now. Pick it again or refresh.`,
      tone: 'warn',
    }
  }
  const options = mixerProcessOptions(snapshot)
  const option = options.find((item) => appProcessKey(item.process) === appProcessKey(clean))
  const shared = option?.ambiguous || option && option.count > 1
  return {
    label: session.available === false ? 'OFFLINE' : session.muted ? 'MUTED' : 'READY',
    detail: `${session.name || session.process} · ${mixerSessionDetail(session)}${
      shared ? ' · browser/app tabs may share this process' : ''
    }`,
    tone: session.available === false ? 'warn' : 'ok',
  }
}

export function appVolumeStateBadge(target: AppVolumeStateTarget): string {
  return target === 'mute' ? APP_MUTE_BADGE : APP_VOLUME_BADGE
}

export function appVolumeStateBindingSummary(
  state: AppVolumeStateBinding | null | undefined,
): string | null {
  if (!state) return null
  const app = state.match.process?.trim()
  return `${state.target === 'mute' ? 'Mute' : 'Volume'} · ${app || 'No app selected'}`
}

/** Add-control slider seed. `volume` is 0..100 from the mixer snapshot. */
export function appVolumeControlSpec(session: MixerSession): SliderOrDialControlSpec {
  const initial = Math.max(0, Math.min(100, Math.round(session.volume)))
  return {
    kind: 'slider',
    axis: 'horizontal',
    emit: 'value',
    binding: {
      type: 'appVolume',
      target: 'volume',
      match: appVolumeMatch(session.process || session.name),
    },
    min: 0,
    max: 100,
    step: 1,
    initial,
    unit: '%',
    haptics: true,
  }
}

/**
 * Create the matching 3×1 app-volume control: value slider plus a tap-to-mute
 * action so the phone label behaves like the other value controls.
 */
export function createAppVolumeButton(
  session: MixerSession,
  slot: number,
  span?: { columns: number; rows: number },
): DeckButton {
  const process = session.process || session.name
  const action: AppVolumeAction = {
    type: 'appVolume',
    action: 'toggleMute',
    match: appVolumeMatch(process),
  }
  const label = (session.name || process).slice(0, 60)
  return {
    ...createEmptyButton(slot, label),
    icon: '🎚️',
    ...(span ? { span } : {}),
    control: appVolumeControlSpec(session),
    actions: [action as unknown as Action],
  }
}

/**
 * One-tap app status tiles. The volume readout stays read-only; the mute tile
 * is also a mute toggle, matching OBS/Light status behavior.
 */
export const APP_VOLUME_STATUS_TILES: readonly AppVolumeStatusTilePreset[] = [
  {
    id: 'app-volume-status-volume',
    label: 'App vol',
    icon: '🔊',
    menuIcon: 'sliders',
    target: 'volume',
    action: false,
    menuLabel: 'App volume status',
    menuDescription: '1 × 1 · live percentage readout · no tap action',
  },
  {
    id: 'app-volume-status-mute',
    label: 'App mute',
    icon: '🔇',
    menuIcon: 'microphone',
    target: 'mute',
    action: true,
    menuLabel: 'App mute status',
    menuDescription: '1 × 1 · MUTE readout, tap toggles mute',
  },
]

export function createAppVolumeStatusButton(
  preset: AppVolumeStatusTilePreset,
  slot: number,
  session: MixerSession,
): DeckButton {
  const process = session.process || session.name
  const match = appVolumeMatch(process)
  const action: AppVolumeAction = { type: 'appVolume', action: 'toggleMute', match }
  return {
    ...createEmptyButton(slot, preset.label),
    icon: preset.icon,
    state: { type: 'appVolume', target: preset.target, match },
    actions: preset.action ? [action as unknown as Action] : [],
  }
}

export function appVolumeActionTitle(_action: AppVolumeAction): string {
  return 'App audio mute'
}

export function appVolumeActionSummary(action: AppVolumeAction): string {
  const app = action.match.process?.trim() || 'No app selected'
  if (action.action === 'toggleMute') return `Toggle mute · ${app}`
  return `${action.muted ? 'Mute' : 'Unmute'} · ${app}`
}

export type AppVolumeActionMode = 'toggle' | 'mute' | 'unmute'

export function appVolumeActionMode(action: AppVolumeAction): AppVolumeActionMode {
  if (action.action === 'toggleMute') return 'toggle'
  return action.muted ? 'mute' : 'unmute'
}

export function appVolumeActionWithMode(
  action: AppVolumeAction,
  mode: AppVolumeActionMode,
): AppVolumeAction {
  if (mode === 'toggle') return { type: 'appVolume', action: 'toggleMute', match: action.match }
  return { type: 'appVolume', action: 'setMute', match: action.match, muted: mode === 'mute' }
}

export function appVolumeActionWithProcess(
  action: AppVolumeAction,
  process: string | undefined,
): AppVolumeAction {
  switch (action.action) {
    case 'toggleMute':
      return { type: 'appVolume', action: 'toggleMute', match: appVolumeMatch(process) }
    case 'setMute':
      return {
        type: 'appVolume',
        action: 'setMute',
        match: appVolumeMatch(process),
        muted: action.muted,
      }
  }
}
