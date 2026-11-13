import { describe, expect, it } from 'vitest'
import type { LightDeviceView, LightStatusView } from '../src/shared/api'
import {
  LIGHT_TARGETS,
  LIGHT_TEMPERATURE_HINT,
  LIGHT_VALUE_TARGETS,
  formatLightValue,
  formatMired,
  lightActionOperation,
  lightActionSummary,
  lightActionTitle,
  lightActionWithLight,
  lightActionWithOperation,
  lightAvailability,
  lightControlSpec,
  lightDeviceName,
  lightEndpoint,
  lightHostError,
  lightNameError,
  lightPortError,
  lightStateBadge,
  lightStateBindingSummary,
  lightStatusSummary,
  lightTargetControlPatch,
  lightTargetInfo,
  lightTestValue,
  nextLightId,
} from '../src/renderer/src/lib/lights'
import {
  LIGHT_STATUS_TILES,
  createLightStatusButton,
} from '../src/renderer/src/lib/lightStatus'

const lights: LightDeviceView[] = [
  { id: 'key-1', name: 'Key Light', type: 'elgato', host: '192.168.1.42', port: 9123 },
  { id: 'key-2', name: 'Fill', type: 'elgato', host: 'light.local', port: 9123 },
]

function status(patch: Partial<LightStatusView> = {}): LightStatusView {
  return {
    id: 'key-1',
    name: 'Key Light',
    host: '192.168.1.42',
    port: 9123,
    available: true,
    on: true,
    brightness: 42,
    temperature: 250,
    ...patch,
  }
}

describe('light status summaries', () => {
  it('shows power, brightness, mired and Kelvin for a reachable light', () => {
    const summary = lightStatusSummary(status())
    expect(summary.label).toBe('ON')
    expect(summary.tone).toBe('ok')
    expect(summary.detail).toContain('192.168.1.42:9123')
    expect(summary.detail).toContain('42%')
    expect(summary.detail).toContain('250 mired')
    expect(summary.detail).toContain('4000 K')
  })

  it('shows OFF and surfaces an unavailable light error', () => {
    expect(lightStatusSummary(status({ on: false }))).toMatchObject({
      label: 'OFF',
      tone: 'muted',
    })
    const offline = lightStatusSummary(
      status({ available: false, error: 'Elgato light at 192.168.1.42:9123 timed out' }),
    )
    expect(offline.label).toBe('OFFLINE')
    expect(offline.tone).toBe('error')
    expect(offline.detail).toContain('timed out')
    expect(lightStatusSummary(null).label).toBe('Status unavailable')
  })

  it('formats mireds with the Kelvin equivalent', () => {
    expect(formatMired(250)).toBe('250 mired · 4000 K')
    expect(formatLightValue('brightness', 42)).toBe('42%')
    expect(formatLightValue('temperature', 200)).toBe('200 mired · 5000 K')
    expect(formatLightValue('power', 100)).toBe('ON')
    expect(formatLightValue('power', 0)).toBe('OFF')
  })
})

describe('light availability for pickers', () => {
  it('distinguishes off, empty, default, selected and missing devices', () => {
    expect(lightAvailability({ enabled: false, lights }).label).toBe('LIGHTS OFF')
    expect(lightAvailability({ enabled: true, lights: [] }).label).toBe('NO LIGHT')
    expect(lightAvailability({ enabled: true, lights }).label).toBe('FIRST LIGHT')
    expect(lightAvailability({ enabled: true, lights, selected: 'key-2' })).toMatchObject({
      label: 'READY',
      tone: 'ok',
    })
    expect(lightAvailability({ enabled: true, lights, selected: 'gone' }).label).toBe('NO LIGHT')
  })

  it('labels endpoints and missing devices', () => {
    expect(lightEndpoint({ host: '192.168.1.42', port: 9123 })).toBe('192.168.1.42:9123')
    expect(lightEndpoint({ host: 'fe80::1', port: 9123 })).toBe('[fe80::1]:9123')
    expect(lightDeviceName(lights, 'key-2')).toBe('Fill')
    expect(lightDeviceName(lights, undefined)).toBe('First light')
    expect(lightDeviceName(lights, 'gone')).toContain('Missing light')
  })
})

describe('light badges and bindings', () => {
  it('uses the short LIGHT badges required by the deck preview', () => {
    expect(lightStateBadge('power')).toBe('LIGHT · POWER')
    expect(lightStateBadge('brightness')).toBe('LIGHT · BRIGHT')
    expect(lightStateBadge('temperature')).toBe('LIGHT · TEMP')
  })

  it('summarizes status bindings with the selected device', () => {
    expect(lightStateBindingSummary({ type: 'light', target: 'brightness' }, lights)).toBe(
      'Brightness · First light',
    )
    expect(
      lightStateBindingSummary({ type: 'light', target: 'temperature', light: 'key-2' }, lights),
    ).toBe('Temperature · Fill')
    expect(lightStateBindingSummary(undefined)).toBeNull()
  })

  it('keeps a stable target order and explains mireds', () => {
    expect(LIGHT_TARGETS.map((target) => target.value)).toEqual([
      'power',
      'brightness',
      'temperature',
    ])
    expect(LIGHT_VALUE_TARGETS.map((target) => target.value)).toEqual([
      'brightness',
      'temperature',
    ])
    expect(lightTargetInfo('temperature').hint).toContain('143–344 mired')
    expect(LIGHT_TEMPERATURE_HINT).toContain('143 mired')
    expect(LIGHT_TEMPERATURE_HINT).toContain('344 mired')
    expect(LIGHT_TEMPERATURE_HINT).toContain('K')
  })
})

describe('light control specs', () => {
  it('uses the shared brightness, temperature and power defaults', () => {
    expect(lightControlSpec('brightness')).toMatchObject({
      kind: 'slider',
      emit: 'value',
      binding: { type: 'light', target: 'brightness' },
      min: 0,
      max: 100,
      initial: 50,
      unit: '%',
      haptics: true,
    })
    expect(lightControlSpec('temperature', 'key-1')).toMatchObject({
      binding: { type: 'light', target: 'temperature', light: 'key-1' },
      min: 143,
      max: 344,
      initial: 250,
      unit: 'mired',
    })
    expect(lightControlSpec('power')).toMatchObject({ min: 0, max: 100, step: 100, initial: 100 })
    expect(lightTargetControlPatch('temperature')).toMatchObject({
      min: 143,
      max: 344,
      unit: 'mired',
    })
  })

  it('maps Inspector test values through the existing normalized path', () => {
    expect(lightTestValue('brightness', -1)).toMatchObject({ raw: 45, value: 0.45, label: '45%' })
    expect(lightTestValue('brightness', 1)).toMatchObject({ raw: 55, value: 0.55, label: '55%' })
    const cool = lightTestValue('temperature', -1)
    expect(cool.raw).toBe(200)
    expect(cool.value).toBeCloseTo((200 - 143) / (344 - 143))
    expect(cool.label).toBe('200 mired · 5000 K')
    expect(lightTestValue('power', -1)).toMatchObject({ raw: 0, value: 0, label: 'OFF' })
    expect(lightTestValue('power', 1)).toMatchObject({ raw: 100, value: 1, label: 'ON' })
  })
})

describe('light actions', () => {
  it('maps operations without losing the selected device', () => {
    const toggle = lightActionWithOperation(
      { type: 'light', action: 'setPower', light: 'key-2', on: true },
      'toggle',
    )
    expect(toggle).toEqual({ type: 'light', action: 'togglePower', light: 'key-2' })
    expect(lightActionOperation(toggle)).toBe('toggle')
    expect(lightActionWithOperation(toggle, 'off')).toEqual({
      type: 'light',
      action: 'setPower',
      light: 'key-2',
      on: false,
    })
    expect(lightActionWithLight(toggle, undefined)).toEqual({ type: 'light', action: 'togglePower' })
    expect(lightActionWithLight(toggle, 'key-1')).toMatchObject({ light: 'key-1' })
  })

  it('titles and summarizes every operation', () => {
    expect(lightActionTitle({ type: 'light', action: 'setPower', on: true })).toBe('Light power')
    expect(lightActionTitle({ type: 'light', action: 'togglePower' })).toBe('Light switch')
    expect(lightActionSummary({ type: 'light', action: 'setPower', on: true })).toBe('Turn on')
    expect(lightActionSummary({ type: 'light', action: 'setPower', on: false })).toBe('Turn off')
    expect(lightActionSummary({ type: 'light', action: 'togglePower' })).toBe('Toggle power')
  })
})

describe('light settings validation', () => {
  it('validates names, hosts and ports like the main process', () => {
    expect(lightNameError('Key Light')).toBeNull()
    expect(lightNameError('')).toContain('Required')
    expect(lightNameError('x'.repeat(41))).toContain('40')
    expect(lightHostError('192.168.1.42')).toBeNull()
    expect(lightHostError('key-light.local')).toBeNull()
    expect(lightHostError('[fe80::1]')).toBeNull()
    expect(lightHostError('http://192.168.1.42')).toContain('bare hostname')
    expect(lightHostError('192.168.1.42:9123')).toContain('Port field')
    expect(lightHostError('key light')).toContain('no scheme')
    expect(lightHostError('')).toContain('Required')
    expect(lightPortError('9123')).toBeNull()
    expect(lightPortError('0')).toContain('1 to 65535')
    expect(lightPortError('65536')).toContain('1 to 65535')
    expect(lightPortError('abc')).toContain('whole number')
  })

  it('allocates non-colliding stable ids', () => {
    expect(nextLightId([])).toBe('light-1')
    expect(nextLightId([{ id: 'light-1' }, { id: 'light-2' }])).toBe('light-3')
    expect(nextLightId([{ id: 'key-1' }])).toBe('light-1')
  })
})

describe('light status tile presets', () => {
  it('creates 1x1 tiles with a static light binding', () => {
    expect(LIGHT_STATUS_TILES.map((tile) => tile.target)).toEqual([
      'power',
      'brightness',
      'temperature',
    ])
    for (const preset of LIGHT_STATUS_TILES) {
      const button = createLightStatusButton(preset, 4, 'key-1')
      expect(button.slot).toBe(4)
      expect(button.label).toBe(preset.label)
      expect(button.state).toEqual({ type: 'light', target: preset.target, light: 'key-1' })
      expect(button.span).toBeUndefined()
      if (preset.target === 'power') {
        expect(button.actions).toEqual([
          { type: 'light', action: 'togglePower', light: 'key-1' },
        ])
      } else {
        expect(button.actions).toEqual([])
      }
    }
  })

  it('omits the light id when the first configured light is selected', () => {
    const power = LIGHT_STATUS_TILES.find((tile) => tile.target === 'power')!
    const button = createLightStatusButton(power, 0)
    expect(button.state).toEqual({ type: 'light', target: 'power' })
    expect(button.actions).toEqual([{ type: 'light', action: 'togglePower' }])
  })
})
