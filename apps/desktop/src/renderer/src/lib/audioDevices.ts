/**
 * Renderer-side audio-device helpers.
 *
 * `ConfigAction`/`StateBinding` deliberately stay narrow while the desktop
 * schema already accepts `{ type:'audioDevice' }`. Everything here inspects
 * those staged values structurally so the editor can consume them without
 * widening shared types.
 */

import type {
  AudioDeviceAction,
  AudioDeviceForm,
  AudioDeviceKind,
  AudioDeviceRef,
  AudioDeviceStateBinding,
} from '@phonedek/shared'
import type { AudioDevicesResult, AudioDeviceView } from '../../../shared/api'

export const AUDIO_DEVICE_MIN_CYCLE = 2
export const AUDIO_DEVICE_MAX_CYCLE = 8

export type AudioDeviceTone = 'ok' | 'warn' | 'error' | 'muted'

export interface AudioDeviceStatusText {
  /** Short tile label: current device name, `NO AUDIO`, `NO DEVICE`. */
  label: string
  /** Human readout for the Inspector card, never the tile token. */
  detail: string
  tone: AudioDeviceTone
  /** True only when a specific saved target is the current device. */
  active: boolean
  /** Resolved live row for the saved target, when connected. */
  target?: AudioDeviceView
}

/** Action shape consumed by the renderer (staged union, not `ConfigAction`). */
export type AudioEditorAction = AudioDeviceAction

const KIND_TITLE: Record<AudioDeviceKind, string> = { output: 'Output', input: 'Input' }
const KIND_LOWER: Record<AudioDeviceKind, string> = { output: 'output', input: 'input' }

const FORM_LABEL: Record<AudioDeviceForm, string | null> = {
  speakers: 'SPEAKERS',
  headphones: 'HEADPHONES',
  headset: 'HEADSET',
  microphone: 'MIC',
  usb: 'USB',
  bluetooth: 'BLUETOOTH',
  hdmi: 'HDMI',
  virtual: 'VIRTUAL',
  other: null,
}

export function audioDeviceKindTitle(kind: AudioDeviceKind): string {
  return KIND_TITLE[kind]
}

export function audioDeviceKindLower(kind: AudioDeviceKind): string {
  return KIND_LOWER[kind]
}

/** Structural check for the staged `{ type:'audioDevice' }` action. */
export function isAudioDeviceAction(value: unknown): value is AudioDeviceAction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    type?: unknown
    action?: unknown
    kind?: unknown
    device?: unknown
    devices?: unknown
  }
  if (candidate.type !== 'audioDevice') return false
  if (candidate.kind !== 'output' && candidate.kind !== 'input') return false
  if (candidate.action === 'set') return Boolean(candidate.device && typeof candidate.device === 'object')
  if (candidate.action === 'cycle') return Array.isArray(candidate.devices)
  return false
}

/** First audio-device action in a button's staged action list. */
export function audioDeviceActionOf(
  actions: readonly unknown[] | undefined,
): AudioDeviceAction | undefined {
  return actions?.find(isAudioDeviceAction)
}

export function hasAudioDeviceAction(actions: readonly unknown[] | undefined): boolean {
  return audioDeviceActionOf(actions) !== undefined
}

/** Structural check for the staged `{ type:'audioDevice', target }` state. */
export function isAudioDeviceStateBinding(value: unknown): value is AudioDeviceStateBinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; target?: unknown }
  return (
    candidate.type === 'audioDevice' &&
    (candidate.target === 'output' || candidate.target === 'input')
  )
}

/** Typed view of a staged audio-device status binding. */
export function audioDeviceStateBindingOf(value: unknown): AudioDeviceStateBinding | null {
  return isAudioDeviceStateBinding(value) ? value : null
}

/** Cosmetic picker tag. Unknown/`other` gets no tag. */
export function audioDeviceFormLabel(form?: AudioDeviceForm | null): string | null {
  if (!form) return null
  return FORM_LABEL[form] ?? null
}

/** Strip control characters/newlines and collapse whitespace. */
export function sanitizeAudioDeviceName(value: string | undefined, max = 120): string {
  if (!value) return ''
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean
}

/** Comparison key; mirrors the desktop controller (NFKC + case-folded). */
export function normalizeDeviceName(value: string | undefined): string {
  return sanitizeAudioDeviceName(value, 240).normalize('NFKC').toLowerCase()
}

/**
 * Short display name for cards/badges. A trailing parenthetical qualifier
 * ("Headphones (HyperX Cloud II)") is dropped for the compact label; the saved
 * `{ id, name }` keeps the full friendly name for fallback resolution.
 */
export function audioDeviceShortName(name: string | undefined, max = 40): string {
  let value = sanitizeAudioDeviceName(name, 240)
  // Endpoint names often repeat the interface in parentheses (sometimes
  // nested, e.g. "Speakers (Realtek(R) Audio)"). Strip only a trailing group.
  const stripped = value.replace(/\s*\(.*\)\s*$/, '').trim()
  if (stripped) value = stripped
  if (value.length > max) value = `${value.slice(0, Math.max(1, max - 1))}…`
  return value
}

/** Best available label for a saved ref; never an endpoint path. */
export function audioDeviceRefLabel(ref: AudioDeviceRef | null | undefined, fallback = 'Saved device'): string {
  const normalized = normalizeAudioDeviceRef(ref)
  if (!normalized) return fallback
  if (normalized.name) return normalized.name
  return normalized.id ?? fallback
}

/**
 * Normalize a saved ref. Empty strings and unknown fields are dropped; a ref
 * with neither a name nor an id is not a device.
 */
export function normalizeAudioDeviceRef(ref: AudioDeviceRef | null | undefined): AudioDeviceRef | null {
  if (!ref || typeof ref !== 'object') return null
  const id = typeof ref.id === 'string' ? ref.id.trim() : ''
  const name = sanitizeAudioDeviceName(typeof ref.name === 'string' ? ref.name : '', 120)
  if (!id && !name) return null
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  }
}

/** Build a stored ref from a live row. Ids are host keys; never synthesized. */
export function audioDeviceRefFromView(view: Pick<AudioDeviceView, 'id' | 'name'>): AudioDeviceRef {
  const id = typeof view.id === 'string' ? view.id.trim() : ''
  const name = sanitizeAudioDeviceName(view.name, 120)
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
  }
}

export function audioDeviceMatchesRef(
  ref: AudioDeviceRef | null | undefined,
  entry: Pick<AudioDeviceView, 'id' | 'name'>,
): boolean {
  const normalized = normalizeAudioDeviceRef(ref)
  if (!normalized) return false
  if (
    normalized.id &&
    normalized.id.toLowerCase() === (entry.id ?? '').trim().toLowerCase()
  ) {
    return true
  }
  if (!normalized.name) return false
  return normalizeDeviceName(normalized.name) === normalizeDeviceName(entry.name)
}

/** Resolve id first, then the normalized friendly-name fallback. */
export function resolveAudioDeviceRef(
  ref: AudioDeviceRef | null | undefined,
  devices: readonly AudioDeviceView[],
): AudioDeviceView | undefined {
  const normalized = normalizeAudioDeviceRef(ref)
  if (!normalized) return undefined
  if (normalized.id) {
    const byId = devices.find(
      (device) => device.id.trim().toLowerCase() === normalized.id!.toLowerCase(),
    )
    if (byId) return byId
  }
  if (!normalized.name) return undefined
  const key = normalizeDeviceName(normalized.name)
  return devices.find((device) => normalizeDeviceName(device.name) === key)
}

/** Devices of one direction from a snapshot; tolerates older/failed results. */
export function audioDeviceList(
  result: AudioDevicesResult | null | undefined,
  kind: AudioDeviceKind,
): AudioDeviceView[] {
  if (!result) return []
  const list = kind === 'output' ? result.output : result.input
  return Array.isArray(list) ? list : []
}

/** Current OS default for one direction. */
export function audioDeviceCurrent(
  result: AudioDevicesResult | null | undefined,
  kind: AudioDeviceKind,
): AudioDeviceView | undefined {
  if (!result) return undefined
  const list = audioDeviceList(result, kind)
  const currentId = (kind === 'output' ? result.currentOutputId : result.currentInputId)?.trim()
  if (currentId) {
    const byId = list.find((device) => device.id === currentId)
    if (byId) return byId
  }
  return list.find((device) => device.current)
}

/** Search by friendly name or form tag (`usb`, `bluetooth`, `headphones`…). */
export function filterAudioDevices(
  devices: readonly AudioDeviceView[],
  query: string,
): AudioDeviceView[] {
  const needle = normalizeDeviceName(query)
  if (!needle) return [...devices]
  return devices.filter((device) => {
    if (normalizeDeviceName(device.name).includes(needle)) return true
    const tag = audioDeviceFormLabel(device.form)
    return Boolean(tag && tag.toLowerCase().includes(needle))
  })
}

/** Action card header title, without the target details. */
export function audioDeviceActionTitle(action: AudioDeviceAction): string {
  const lower = audioDeviceKindLower(action.kind)
  return action.action === 'set' ? `Set ${lower} device` : `Cycle ${lower} devices`
}

/** One-line action summary: `Set output: Headset` / `Cycle output (2)`. */
export function audioDeviceActionSummary(action: AudioDeviceAction): string {
  const lower = audioDeviceKindLower(action.kind)
  if (action.action === 'set') {
    return `Set ${lower}: ${audioDeviceShortName(audioDeviceRefLabel(action.device, 'Device'), 40)}`
  }
  return `Cycle ${lower} (${action.devices.length})`
}

/** Deck/status badge: OUT for output, IN for input. */
export function audioDeviceStateBadge(target: AudioDeviceKind): string {
  return target === 'output' ? 'OUT' : 'IN'
}

/** Static editor summary for a status binding, with no live world read. */
export function audioDeviceStateSummary(binding: AudioDeviceStateBinding): string {
  const title = audioDeviceKindTitle(binding.target)
  const ref = normalizeAudioDeviceRef(binding.device)
  if (!ref) return `${title} · any device`
  return `${title} → “${audioDeviceShortName(audioDeviceRefLabel(ref), 36)}”`
}

/**
 * Current/default reading for a status tile. Mirrors the desktop's
 * `control-state` detail tokens so the editor can preview exactly what the
 * phone will show.
 */
export function audioDeviceStatusText(
  binding: AudioDeviceStateBinding,
  result: AudioDevicesResult | null | undefined,
): AudioDeviceStatusText {
  if (!result) {
    return {
      label: 'NO AUDIO',
      detail: 'Read this PC’s audio devices to see the current default.',
      tone: 'muted',
      active: false,
    }
  }
  if (!result.ok) {
    return {
      label: 'NO AUDIO',
      detail: result.error?.trim() || 'Audio device switching is unavailable on this PC.',
      tone: 'muted',
      active: false,
    }
  }
  const devices = audioDeviceList(result, binding.target)
  const current = audioDeviceCurrent(result, binding.target)
  if (!current) {
    return {
      label: 'NO DEVICE',
      detail: `No ${audioDeviceKindLower(binding.target)} device is active on this PC.`,
      tone: 'muted',
      active: false,
    }
  }

  const ref = normalizeAudioDeviceRef(binding.device)
  if (!ref) {
    return {
      label: audioDeviceShortName(current.name, 36) || 'DEVICE',
      detail: `${audioDeviceKindTitle(binding.target)} · any device`,
      tone: 'muted',
      active: false,
    }
  }

  const target = resolveAudioDeviceRef(ref, devices)
  const active =
    target !== undefined &&
    (target.id === current.id ||
      audioDeviceMatchesRef({ id: target.id, name: target.name }, current))
  const name = audioDeviceShortName(audioDeviceRefLabel(ref), 36)
  return {
    label: audioDeviceShortName(current.name, 36) || 'DEVICE',
    detail: active ? `${name} · CURRENT` : `${name} · not current`,
    tone: active ? 'ok' : 'warn',
    active,
    ...(target ? { target } : {}),
  }
}

/** Cycle list validation mirroring the config schema (2..8, unique refs). */
export function audioDeviceCycleError(refs: readonly AudioDeviceRef[] | undefined): string | null {
  const list = refs ?? []
  if (list.length < AUDIO_DEVICE_MIN_CYCLE) {
    return `A cycle needs at least ${AUDIO_DEVICE_MIN_CYCLE} devices.`
  }
  if (list.length > AUDIO_DEVICE_MAX_CYCLE) {
    return `A cycle accepts at most ${AUDIO_DEVICE_MAX_CYCLE} devices.`
  }
  const seen = new Set<string>()
  for (const ref of list) {
    const normalized = normalizeAudioDeviceRef(ref)
    if (!normalized) return 'Every cycle device needs an id or a name.'
    const key = normalized.id
      ? `id:${normalized.id.toLowerCase()}`
      : `name:${normalizeDeviceName(normalized.name)}`
    if (seen.has(key)) return `Duplicate device: ${audioDeviceRefLabel(normalized)}.`
    seen.add(key)
  }
  return null
}

/** Immutable up/down reorder used by the cycle tray. */
export function moveAudioDeviceRef(
  refs: readonly AudioDeviceRef[],
  index: number,
  direction: -1 | 1,
): AudioDeviceRef[] {
  const next = refs.map((ref) => normalizeAudioDeviceRef(ref)).filter((ref): ref is AudioDeviceRef => ref !== null)
  const target = index + direction
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  const [item] = next.splice(index, 1)
  if (item) next.splice(target, 0, item)
  return next
}

export function removeAudioDeviceRef(refs: readonly AudioDeviceRef[], index: number): AudioDeviceRef[] {
  return refs
    .map((ref) => normalizeAudioDeviceRef(ref))
    .filter((ref): ref is AudioDeviceRef => ref !== null)
    .filter((_, current) => current !== index)
}

/**
 * Next available target in cycle order.
 *
 * Unavailable/unplugged targets are skipped. If the current default is not in
 * the list, the cycle starts at the first available target. One available
 * target is a no-op (the caller can still report success).
 */
export function nextAudioDeviceInCycle(
  refs: readonly AudioDeviceRef[],
  devices: readonly AudioDeviceView[],
  currentId?: string,
): AudioDeviceView | undefined {
  const available = devices.filter((device) => device.available !== false)
  const targets: AudioDeviceView[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const view = resolveAudioDeviceRef(ref, available)
    if (!view) continue
    const key = view.id || normalizeDeviceName(view.name)
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(view)
  }
  if (targets.length === 0) return undefined
  const currentKey = currentId?.trim().toLowerCase()
  const currentIndex = currentKey
    ? targets.findIndex((view) => view.id.toLowerCase() === currentKey)
    : targets.findIndex((view) => view.current)
  // The current default is not part of this cycle: start at the first target.
  if (currentIndex === -1) return targets[0]
  if (targets.length === 1) return targets[0]
  return targets[(currentIndex + 1) % targets.length]
}
