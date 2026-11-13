import {
  ELGATO_TEMPERATURE_MAX,
  ELGATO_TEMPERATURE_MIN,
  LIGHT_DEFAULT_PORT,
  lightControlDefaults,
  miredToKelvin,
  normalizeLightValue,
} from '@phonedek/shared'
import type {
  LightAction,
  LightStateBinding,
  LightTarget,
  SliderOrDialControlSpec,
} from '@phonedek/shared'
import type { LightDeviceView, LightStatusView } from '../../../shared/api'

export type LightTone = 'ok' | 'warn' | 'error' | 'muted'

export interface LightSummary {
  label: string
  detail: string
  tone: LightTone
}

export interface LightAvailability {
  label: string
  detail: string
  tone: LightTone
}

export interface LightTargetInfo {
  value: LightTarget
  /** Inspector / select label. */
  label: string
  /** Short static editor badge, without the LIGHT prefix. */
  badge: string
  /** Add-control menu label. */
  menuLabel: string
  menuDescription: string
  /** Inspector explanation for a value control. */
  hint: string
  /** Inspector explanation for a read-only status tile. */
  statusHint: string
}

/** Elgato Key Light family HTTP port. Shared with the main process. */
export { LIGHT_DEFAULT_PORT }

const TARGET_INFO: Record<LightTarget, LightTargetInfo> = {
  power: {
    value: 'power',
    label: 'Power',
    badge: 'POWER',
    menuLabel: 'Light power status',
    menuDescription: '1 × 1 · ON/OFF tile for the selected light',
    hint: 'The phone shows ON or OFF from the light itself and sends a power toggle when tapped.',
    statusHint: 'The phone shows ON while the light is on and OFF while it is off.',
  },
  brightness: {
    value: 'brightness',
    label: 'Brightness',
    badge: 'BRIGHT',
    menuLabel: 'Light brightness status',
    menuDescription: '1 × 1 · 0–100% readout for the selected light',
    hint: 'The phone sends 0–100% brightness to the light. A powered-off light reads OFF.',
    statusHint: 'The phone shows the brightness percentage, or OFF while the light is off.',
  },
  temperature: {
    value: 'temperature',
    label: 'Temperature',
    badge: 'TEMP',
    menuLabel: 'Light temperature status',
    menuDescription: '1 × 1 · mired readout (warm–cool)',
    hint: 'The phone sends 143–344 mired. Higher is warmer; the Kelvin equivalent is shown here as a hint.',
    statusHint: 'The phone shows the white balance in mireds, or OFF while the light is off.',
  },
}

/** Stable picker order for status tiles and Inspector target selects. */
export const LIGHT_TARGETS: readonly LightTargetInfo[] = [
  TARGET_INFO.power,
  TARGET_INFO.brightness,
  TARGET_INFO.temperature,
]

/** Value controls only get brightness and temperature from Add control. */
export const LIGHT_VALUE_TARGETS: readonly LightTargetInfo[] = [
  TARGET_INFO.brightness,
  TARGET_INFO.temperature,
]

export function lightTargetInfo(target: LightTarget): LightTargetInfo {
  return TARGET_INFO[target]
}

/** IPv4/IPv6-safe endpoint label. */
export function lightEndpoint(device: { host: string; port: number }): string {
  const host =
    device.host.includes(':') && !device.host.startsWith('[') ? `[${device.host}]` : device.host
  return `${host}:${device.port}`
}

export function lightDeviceName(
  lights: readonly LightDeviceView[] | undefined,
  lightId: string | undefined,
): string {
  const id = lightId?.trim()
  if (!id) return 'First light'
  return lights?.find((light) => light.id === id)?.name ?? `Missing light (${id})`
}

/** Human-readable live status for one device row. */
export function lightStatusSummary(
  status: LightStatusView | null | undefined,
): LightSummary {
  if (!status) {
    return {
      label: 'Status unavailable',
      detail: 'The desktop did not report light status.',
      tone: 'muted',
    }
  }
  if (!status.available) {
    return {
      label: 'OFFLINE',
      detail: status.error?.trim() || `No response from ${lightEndpoint(status)}.`,
      tone: 'error',
    }
  }

  const readings: string[] = []
  if (typeof status.brightness === 'number') readings.push(`${Math.round(status.brightness)}%`)
  if (typeof status.temperature === 'number') {
    readings.push(formatMired(status.temperature))
  }
  return {
    label: status.on ? 'ON' : 'OFF',
    detail: [lightEndpoint(status), ...readings].join(' · '),
    tone: status.on ? 'ok' : 'muted',
  }
}

/** Short availability badge for a light picker or action editor. */
export function lightAvailability({
  enabled,
  lights,
  selected,
}: {
  enabled: boolean
  lights: readonly LightDeviceView[]
  selected?: string
}): LightAvailability {
  if (!enabled) {
    return {
      label: 'LIGHTS OFF',
      detail: 'Enable local lights in Settings → Lights before using this tile.',
      tone: 'muted',
    }
  }
  if (lights.length === 0) {
    return {
      label: 'NO LIGHT',
      detail: 'Add an Elgato Key Light in Settings → Lights.',
      tone: 'muted',
    }
  }

  const id = selected?.trim()
  if (id) {
    const device = lights.find((light) => light.id === id)
    if (device) {
      return {
        label: 'READY',
        detail: `${device.name} · ${lightEndpoint(device)}`,
        tone: 'ok',
      }
    }
    return {
      label: 'NO LIGHT',
      detail: `“${id}” is no longer configured. Pick a light again.`,
      tone: 'error',
    }
  }

  const first = lights[0]!
  return {
    label: 'FIRST LIGHT',
    detail: `Uses ${first.name} · ${lightEndpoint(first)}`,
    tone: 'ok',
  }
}

/* ------------------------------------------------------------------ */
/* Display formatting                                                  */
/* ------------------------------------------------------------------ */

export function formatMired(mired: number): string {
  if (!Number.isFinite(mired)) return '—'
  const value = Math.round(mired)
  return `${value} mired · ${miredToKelvin(value)} K`
}

/** Raw device value as a compact human label. */
export function formatLightValue(target: LightTarget, raw: number): string {
  if (target === 'power') return raw >= 50 ? 'ON' : 'OFF'
  if (target === 'temperature') return formatMired(raw)
  return `${Math.round(raw)}%`
}

/** Editor-only static badge. Live values only exist on the phone. */
export function lightStateBadge(target: LightTarget): string {
  return `LIGHT · ${lightTargetInfo(target).badge}`
}

/** One-line inspector summary; deliberately avoids pretending to be live. */
export function lightStateBindingSummary(
  binding: LightStateBinding | null | undefined,
  lights?: readonly LightDeviceView[],
): string | null {
  if (!binding) return null
  return `${lightTargetInfo(binding.target).label} · ${lightDeviceName(lights, binding.light)}`
}

/* ------------------------------------------------------------------ */
/* Control/action construction                                         */
/* ------------------------------------------------------------------ */

export function lightControlSpec(target: LightTarget, light?: string): SliderOrDialControlSpec {
  const defaults = lightControlDefaults(target)
  return {
    kind: 'slider',
    axis: 'horizontal',
    emit: 'value',
    binding: { type: 'light', target, ...(light ? { light } : {}) },
    ...defaults,
    haptics: true,
  }
}

/** Portion of a control patch that changes with the selected target. */
export function lightTargetControlPatch(
  target: LightTarget,
): Pick<SliderOrDialControlSpec, 'min' | 'max' | 'step' | 'initial' | 'unit'> {
  return { ...lightControlDefaults(target) }
}

/** Raw + normalized values used by the Inspector Test − / Test + path. */
export function lightTestValue(
  target: LightTarget,
  direction: -1 | 1,
): { raw: number; value: number; label: string } {
  const raw =
    target === 'brightness'
      ? direction < 0
        ? 45
        : 55
      : target === 'temperature'
        ? direction < 0
          ? 200
          : 300
        : direction < 0
          ? 0
          : 100
  return {
    raw,
    value: normalizeLightValue(target, raw),
    label: formatLightValue(target, raw),
  }
}

export type LightActionOperation = 'on' | 'off' | 'toggle'

export function lightActionOperation(action: LightAction): LightActionOperation {
  if (action.action === 'togglePower') return 'toggle'
  return action.on ? 'on' : 'off'
}

export function lightActionWithOperation(
  action: LightAction,
  operation: LightActionOperation,
): LightAction {
  const light = action.light
  if (operation === 'toggle') {
    return { type: 'light', action: 'togglePower', ...(light ? { light } : {}) }
  }
  return { type: 'light', action: 'setPower', ...(light ? { light } : {}), on: operation === 'on' }
}

export function lightActionWithLight(action: LightAction, light: string | undefined): LightAction {
  const id = light?.trim()
  if (action.action === 'togglePower') {
    return { type: 'light', action: 'togglePower', ...(id ? { light: id } : {}) }
  }
  return { type: 'light', action: 'setPower', ...(id ? { light: id } : {}), on: action.on }
}

export function lightActionTitle(action: LightAction): string {
  return action.action === 'togglePower' ? 'Light switch' : 'Light power'
}

/** Short operation label used in the action card and menus. */
export function lightActionSummary(action: LightAction): string {
  const operation = lightActionOperation(action)
  return operation === 'toggle' ? 'Toggle power' : operation === 'on' ? 'Turn on' : 'Turn off'
}

/* ------------------------------------------------------------------ */
/* Settings draft validation                                           */
/* ------------------------------------------------------------------ */

export const MAX_LIGHT_DEVICES = 8

export function lightNameError(value: string): string | null {
  const name = value.trim()
  if (name.length === 0) return 'Required — 1 to 40 characters.'
  if (name.length > 40) return 'Use 40 characters or fewer.'
  return null
}

/**
 * Mirrors the main process host sanitizer: bare hostname, IPv4 or bracketed
 * IPv6 only. No scheme, path, port or whitespace.
 */
export function lightHostError(value: string): string | null {
  const host = value.trim()
  if (!host) return 'Required — enter the light’s IP address or hostname.'
  if (host.length > 253) return 'Host is too long.'
  if (host.includes('://') || /[/\\?#@\s]/.test(host)) {
    return 'Use a bare hostname or IP address — no scheme, path or spaces.'
  }
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]$/.exec(host)
  if (ipv6) {
    return ipv6[1]!.includes(':') ? null : 'Use a full IPv6 address in brackets.'
  }
  if (host.includes(':')) return 'Enter the host without a port; use the Port field.'
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) {
    return 'Use letters, digits, dots and dashes only.'
  }
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    return 'Check the dots in this hostname.'
  }
  return null
}

export function lightPortError(value: string): string | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return 'Use a whole number from 1 to 65535.'
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Use a whole number from 1 to 65535.'
  }
  return null
}

/** Next stable `light-N` id that does not collide with the current draft. */
export function nextLightId(lights: ReadonlyArray<{ id: string }>): string {
  const used = new Set(lights.map((light) => light.id))
  let index = 1
  while (used.has(`light-${index}`)) index += 1
  return `light-${index}`
}

/**
 * Elgato's white-balance range as a short hint. Mired values are inverted:
 * 143 mired is the coolest, 344 the warmest.
 */
export const LIGHT_TEMPERATURE_HINT = `${ELGATO_TEMPERATURE_MIN} mired ≈ ${miredToKelvin(
  ELGATO_TEMPERATURE_MIN,
)} K · ${ELGATO_TEMPERATURE_MAX} mired ≈ ${miredToKelvin(ELGATO_TEMPERATURE_MAX)} K`
