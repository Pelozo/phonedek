import {
  ELGATO_TEMPERATURE_MAX,
  ELGATO_TEMPERATURE_MIN,
  HUE_COLOR_TEMPERATURE_MAX,
  HUE_COLOR_TEMPERATURE_MIN,
  NANOLEAF_TEMPERATURE_MAX_KELVIN,
  NANOLEAF_TEMPERATURE_MIN_KELVIN,
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

/**
 * App brightness (0..100) → Hue CLIP v1 `bri` (1..254).
 *
 * Hue has no zero-brightness value; 0% is sent as the dimmest legal step and
 * power is turned off through `on` instead.
 */
export function hueBrightnessFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) throw new Error('Brightness must be finite')
  const clamped = Math.max(0, Math.min(100, percent))
  return Math.max(1, Math.min(254, Math.round((clamped / 100) * 254)))
}

/** Hue `bri` (1..254) → app brightness (0..100). */
export function percentFromHueBrightness(bri: number): number {
  if (!Number.isFinite(bri)) throw new Error('Hue brightness must be finite')
  const clamped = Math.max(1, Math.min(254, bri))
  return Math.round((clamped / 254) * 100)
}

/** App mireds → Hue `ct` (153..500 mireds). */
export function hueColorTemperatureFromMired(mired: number): number {
  if (!Number.isFinite(mired)) throw new Error('Mired value must be finite')
  return Math.max(
    HUE_COLOR_TEMPERATURE_MIN,
    Math.min(HUE_COLOR_TEMPERATURE_MAX, Math.round(mired)),
  )
}

/** Hue `ct` → app mireds, clamped to the Elgato slider range. */
export function miredFromHueColorTemperature(ct: number): number {
  if (!Number.isFinite(ct)) throw new Error('Hue color temperature must be finite')
  return Math.max(
    ELGATO_TEMPERATURE_MIN,
    Math.min(ELGATO_TEMPERATURE_MAX, Math.round(ct)),
  )
}

/** App mireds → Nanoleaf `ct` in Kelvin (1200..6500 K). */
export function nanoleafKelvinFromMired(mired: number): number {
  if (!Number.isFinite(mired) || mired <= 0) throw new Error('Mired value must be positive')
  const kelvin = 1_000_000 / mired
  return Math.max(
    NANOLEAF_TEMPERATURE_MIN_KELVIN,
    Math.min(NANOLEAF_TEMPERATURE_MAX_KELVIN, Math.round(kelvin)),
  )
}

/** Nanoleaf Kelvin → app mireds in the Elgato slider range. */
export function miredFromNanoleafKelvin(kelvin: number): number {
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
