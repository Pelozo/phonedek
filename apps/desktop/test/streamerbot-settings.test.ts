import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SettingsStore,
  defaultSettings,
  sanitizeStreamerBotHost,
  sanitizeStreamerBotPort,
} from '../src/main/settings-store'
import { SecretStore } from '../src/main/secret-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-streamerbot-test-'))
}

describe('Streamer.bot settings', () => {
  it('starts disabled on localhost:8080', () => {
    const settings = defaultSettings()
    expect(settings.streamerbotEnabled).toBe(false)
    expect(settings.streamerbotHost).toBe('127.0.0.1')
    expect(settings.streamerbotPort).toBe(8080)
    expect('streamerbotPassword' in settings).toBe(false)
  })

  it('keeps old settings files valid and persists new fields', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49010, discovery: false }))
    const old = new SettingsStore(dir)
    expect(old.get().streamerbotEnabled).toBe(false)
    expect(old.get().streamerbotHost).toBe('127.0.0.1')
    expect(old.get().streamerbotPort).toBe(8080)

    old.update({ streamerbotEnabled: true, streamerbotHost: '192.168.1.20', streamerbotPort: 8081 })
    const reloaded = new SettingsStore(dir)
    expect(reloaded.get()).toMatchObject({
      streamerbotEnabled: true,
      streamerbotHost: '192.168.1.20',
      streamerbotPort: 8081,
    })
  })

  it('sanitizes hosts and ports like the OBS client', () => {
    expect(sanitizeStreamerBotHost('localhost')).toBe('localhost')
    expect(sanitizeStreamerBotHost('192.168.1.20')).toBe('192.168.1.20')
    expect(sanitizeStreamerBotHost('[::1]')).toBe('[::1]')
    expect(sanitizeStreamerBotHost('http://streamer.bot')).toBe('127.0.0.1')
    expect(sanitizeStreamerBotHost('host/path')).toBe('127.0.0.1')
    expect(sanitizeStreamerBotHost('::1')).toBe('127.0.0.1')
    expect(sanitizeStreamerBotHost(42)).toBe('127.0.0.1')

    expect(sanitizeStreamerBotPort(8080)).toBe(8080)
    expect(sanitizeStreamerBotPort(1)).toBe(1)
    expect(sanitizeStreamerBotPort(0)).toBe(8080)
    expect(sanitizeStreamerBotPort(65536)).toBe(8080)
    expect(sanitizeStreamerBotPort(8080.5)).toBe(8080)
    expect(sanitizeStreamerBotPort('8080')).toBe(8080)
  })

  it('never writes the password into settings.json', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    const secrets = new SecretStore({ dir })
    secrets.set('streamerbot.password', 'super-secret')

    settings.update({ streamerbotEnabled: true })
    const raw = readFileSync(join(dir, 'settings.json'), 'utf8')
    expect(raw).not.toContain('super-secret')
    expect(raw).not.toContain('streamerbotPassword')

    expect(secrets.has('streamerbot.password')).toBe(true)
    const reloaded = new SecretStore({ dir })
    expect(reloaded.get('streamerbot.password')).toBe('super-secret')
  })
})
