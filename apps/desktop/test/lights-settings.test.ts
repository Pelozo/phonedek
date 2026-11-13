import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_LIGHT_PORT,
  MAX_LIGHT_DEVICES,
  SettingsStore,
  defaultSettings,
  sanitizeLightDevices,
  sanitizeLightHost,
  sanitizeLightPort,
} from '../src/main/settings-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-lights-test-'))
}

describe('light settings defaults', () => {
  it('starts with lights disabled and no devices', () => {
    const settings = defaultSettings()
    expect(settings.lightsEnabled).toBe(false)
    expect(settings.lights).toEqual([])
    expect(DEFAULT_LIGHT_PORT).toBe(9123)
  })

  it('keeps old settings files valid', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49010, discovery: false }))
    const settings = new SettingsStore(dir)
    expect(settings.get().port).toBe(49010)
    expect(settings.get().lightsEnabled).toBe(false)
    expect(settings.get().lights).toEqual([])
  })

  it('enables lights by default once devices are configured', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({
      lights: [
        { id: 'key-1', name: 'Key Light', type: 'elgato', host: '192.168.1.50', port: 9123 },
      ],
    })
    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().lightsEnabled).toBe(true)
    expect(reloaded.get().lights).toEqual([
      { id: 'key-1', name: 'Key Light', type: 'elgato', host: '192.168.1.50', port: 9123 },
    ])
  })

  it('respects an explicit disable even with devices configured', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({
      lightsEnabled: false,
      lights: [{ id: 'key-1', name: 'Key Light', type: 'elgato', host: 'key.local', port: 9123 }],
    })
    expect(new SettingsStore(dir).get().lightsEnabled).toBe(false)
  })

  it('returns a defensive copy of the device list', () => {
    const settings = new SettingsStore(tempDir())
    settings.update({
      lights: [{ id: 'key-1', name: 'Key Light', type: 'elgato', host: 'key.local', port: 9123 }],
    })
    settings.get().lights[0]!.host = 'evil.local'
    expect(settings.get().lights[0]!.host).toBe('key.local')
  })
})

describe('light settings sanitization', () => {
  it('accepts bare hostnames, IPv4 and bracketed IPv6 and rejects URLs/paths', () => {
    expect(sanitizeLightHost('key.local')).toBe('key.local')
    expect(sanitizeLightHost('192.168.1.50')).toBe('192.168.1.50')
    expect(sanitizeLightHost('[fe80::1]')).toBe('[fe80::1]')
    expect(sanitizeLightHost('http://key.local')).toBeNull()
    expect(sanitizeLightHost('key.local/elgato')).toBeNull()
    expect(sanitizeLightHost('key local')).toBeNull()
    expect(sanitizeLightHost('fe80::1')).toBeNull()
    expect(sanitizeLightHost('')).toBeNull()
  })

  it('defaults ports and rejects out-of-range values', () => {
    expect(sanitizeLightPort(undefined)).toBe(9123)
    expect(sanitizeLightPort(9124)).toBe(9124)
    expect(sanitizeLightPort(0)).toBe(9123)
    expect(sanitizeLightPort(70000)).toBe(9123)
    expect(sanitizeLightPort(9123.5)).toBe(9123)
  })

  it('drops invalid devices, derives ids, and caps the list at 8', () => {
    const devices = sanitizeLightDevices([
      { id: 'key-1', name: 'Key', type: 'elgato', host: 'key.local', port: 9123 },
      { id: 'bad id!', name: 'Second', type: 'elgato', host: '10.0.0.2' },
      { type: 'elgato', host: 'http://nope' },
      { type: 'hue', host: '10.0.0.3' },
      { id: 'key-1', name: 'Duplicate id', type: 'elgato', host: '10.0.0.4' },
    ])
    expect(devices).toEqual([
      { id: 'key-1', name: 'Key', type: 'elgato', host: 'key.local', port: 9123 },
      { id: 'light-2', name: 'Second', type: 'elgato', host: '10.0.0.2', port: 9123 },
      { id: 'key-1-2', name: 'Duplicate id', type: 'elgato', host: '10.0.0.4', port: 9123 },
    ])

    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `light-${index}`,
      name: `Light ${index}`,
      type: 'elgato',
      host: `10.0.0.${index + 1}`,
    }))
    expect(sanitizeLightDevices(many)).toHaveLength(MAX_LIGHT_DEVICES)
  })

  it('repairs a hand-edited settings file without losing other fields', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        port: 49012,
        obsEnabled: true,
        lightsEnabled: 'yes',
        lights: [
          { id: '', name: '', type: 'elgato', host: '10.0.0.9', port: 'nope' },
          { id: 'x', name: 'Broken', type: 'elgato', host: 'https://bad' },
        ],
      }),
    )
    const settings = new SettingsStore(dir)
    expect(settings.get().port).toBe(49012)
    expect(settings.get().obsEnabled).toBe(true)
    expect(settings.get().lightsEnabled).toBe(true)
    expect(settings.get().lights).toEqual([
      { id: 'light-1', name: 'Light 1', type: 'elgato', host: '10.0.0.9', port: 9123 },
    ])
    expect(JSON.parse(readFileSync(settings.file, 'utf8')).lights).toHaveLength(1)
  })
})
