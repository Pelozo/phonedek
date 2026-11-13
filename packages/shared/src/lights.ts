import {
  ELGATO_TEMPERATURE_MAX,
  ELGATO_TEMPERATURE_MIN,
  type LightTarget,
} from './types'

/** Sensible slider/dial defaults for each local-light target. */
export interface LightControlDefaults {
  min: number
  max: number
  step: number
  initial: number
  /** Display unit. Temperature is shown in mireds, not Kelvin. */
  unit: string
}

/**
 * Display defaults for a light value control.
 *
 * Elgato's API expresses white balance in **mireds** (micro reciprocal
 * degrees): `143` is the coolest (≈6993 K) and `344` the warmest (≈2907 K).
 * Higher mired = warmer. Use {@link miredToKelvin} when a Kelvin label is
 * wanted; do not silently send Kelvin to the device.
 */
export function lightControlDefaults(target: LightTarget): LightControlDefaults {
  switch (target) {
    case 'brightness':
      return { min: 0, max: 100, step: 1, initial: 50, unit: '%' }
    case 'temperature':
      return {
        min: ELGATO_TEMPERATURE_MIN,
        max: ELGATO_TEMPERATURE_MAX,
        step: 1,
        initial: 250,
        unit: 'mired',
      }
    case 'power':
      return { min: 0, max: 100, step: 100, initial: 100, unit: '%' }
  }
}

/** Elgato mired → Kelvin (rounded). Clamped to the device range. */
export function miredToKelvin(mired: number): number {
  if (!Number.isFinite(mired)) throw new Error('Mired value must be finite')
  const clamped = Math.max(ELGATO_TEMPERATURE_MIN, Math.min(ELGATO_TEMPERATURE_MAX, mired))
  return Math.round(1_000_000 / clamped)
}

/** Kelvin → Elgato mired (rounded, clamped to 143..344). */
export function kelvinToMired(kelvin: number): number {
  if (!Number.isFinite(kelvin) || kelvin <= 0) throw new Error('Kelvin value must be positive')
  return Math.max(
    ELGATO_TEMPERATURE_MIN,
    Math.min(ELGATO_TEMPERATURE_MAX, Math.round(1_000_000 / kelvin)),
  )
}

/** Clamp a raw device value to the target's default range. */
export function clampLightValue(target: LightTarget, value: number): number {
  const defaults = lightControlDefaults(target)
  if (!Number.isFinite(value)) throw new Error('Light value must be finite')
  return Math.max(defaults.min, Math.min(defaults.max, value))
}

/** Raw device value → normalized 0..1 (the value control's wire value). */
export function normalizeLightValue(target: LightTarget, value: number): number {
  const defaults = lightControlDefaults(target)
  const clamped = clampLightValue(target, value)
  if (defaults.max <= defaults.min) return 0
  return (clamped - defaults.min) / (defaults.max - defaults.min)
}

/**
 * Normalized 0..1 wire value → raw device value. `power` snaps to 0/100 at
 * the midpoint so a power value control cannot leave a light half-on.
 */
export function denormalizeLightValue(target: LightTarget, normalized: number): number {
  const defaults = lightControlDefaults(target)
  const ratio = Math.max(0, Math.min(1, normalized))
  if (target === 'power') return ratio >= 0.5 ? defaults.max : defaults.min
  const raw = defaults.min + ratio * (defaults.max - defaults.min)
  return target === 'temperature' ? Math.round(raw) : Math.round(raw)
}
