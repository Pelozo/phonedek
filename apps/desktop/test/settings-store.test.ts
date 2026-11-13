import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, normalizeProcessName, sanitizeAutoProfileRules, SettingsStore } from '../src/main/settings-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-test-'))
}

describe('SettingsStore tray preference', () => {
  it('defaults minimizeToTray to false without changing existing defaults', () => {
    const settings = new SettingsStore(tempDir())
    expect(settings.get().minimizeToTray).toBe(false)
    expect(settings.get().discovery).toBe(true)
    expect(settings.get().launchAtLogin).toBe(false)
    expect(settings.get().pairHost).toBe('')
    expect(defaultSettings().minimizeToTray).toBe(false)
  })

  it('persists the tray preference and keeps unrelated settings intact', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({ minimizeToTray: true })
    settings.update({ port: 49000 })

    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().minimizeToTray).toBe(true)
    expect(reloaded.get().port).toBe(49000)
    expect(reloaded.get().token).toBe(settings.get().token)
    expect(reloaded.get().discovery).toBe(true)

    reloaded.update({ minimizeToTray: false })
    expect(new SettingsStore(dir).get().minimizeToTray).toBe(false)
  })

  it('falls back to false when the persisted value is not a boolean', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ minimizeToTray: 'yes', port: 49001 }))
    const settings = new SettingsStore(dir)
    expect(settings.get().minimizeToTray).toBe(false)
    expect(settings.get().port).toBe(49001)
  })
})

describe('SettingsStore OBS settings', () => {
  it('defaults OBS to disabled on localhost:4455 with no password', () => {
    const settings = new SettingsStore(tempDir())
    expect(settings.get().obsEnabled).toBe(false)
    expect(settings.get().obsHost).toBe('127.0.0.1')
    expect(settings.get().obsPort).toBe(4455)
    expect(settings.get().obsPassword).toBe('')
    expect(defaultSettings().obsEnabled).toBe(false)
    expect(defaultSettings().obsHost).toBe('127.0.0.1')
    expect(defaultSettings().obsPort).toBe(4455)
  })

  it('keeps old settings files valid and defaults missing OBS fields', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49004, discovery: false }))
    const settings = new SettingsStore(dir)
    expect(settings.get().port).toBe(49004)
    expect(settings.get().obsEnabled).toBe(false)
    expect(settings.get().obsHost).toBe('127.0.0.1')
    expect(settings.get().obsPort).toBe(4455)
    expect(settings.get().obsPassword).toBe('')
  })

  it('persists host, port and password and preserves spaces in the secret', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({
      obsEnabled: true,
      obsHost: 'obs.local',
      obsPort: 4460,
      obsPassword: '  secret pass  ',
    })
    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().obsEnabled).toBe(true)
    expect(reloaded.get().obsHost).toBe('obs.local')
    expect(reloaded.get().obsPort).toBe(4460)
    expect(reloaded.get().obsPassword).toBe('  secret pass  ')
  })

  it('accepts localhost, IPv4, bracketed IPv6 and hostnames; rejects unsafe values', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    for (const host of ['localhost', '192.168.1.20', '[::1]', 'obs-box.local']) {
      settings.update({ obsHost: host })
      expect(settings.get().obsHost).toBe(host)
    }
    for (const host of ['ws://evil', 'http://x', 'a/b', 'a b', '::1', '.bad', 'bad..host', '']) {
      settings.update({ obsHost: host })
      expect(settings.get().obsHost).toBe('127.0.0.1')
    }
  })

  it('falls back on invalid ports and truncates an overlong password', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    for (const port of [0, 65536, 4455.5, -1, '4455']) {
      settings.update({ obsPort: port as unknown as number })
      expect(settings.get().obsPort).toBe(4455)
    }
    settings.update({ obsPort: 1 })
    expect(settings.get().obsPort).toBe(1)
    settings.update({ obsPort: 65535 })
    expect(settings.get().obsPort).toBe(65535)

    settings.update({ obsPassword: 'x'.repeat(300) })
    expect(settings.get().obsPassword).toHaveLength(256)
  })
})

describe('SettingsStore pointer control switch', () => {
  it('defaults allowPointerControl to true', () => {
    const settings = new SettingsStore(tempDir())
    expect(settings.get().allowPointerControl).toBe(true)
    expect(defaultSettings().allowPointerControl).toBe(true)
  })

  it('keeps old settings files valid and defaults a missing field to true', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49002, discovery: false }))
    const settings = new SettingsStore(dir)
    expect(settings.get().allowPointerControl).toBe(true)
    expect(settings.get().discovery).toBe(false)
    expect(settings.get().port).toBe(49002)
  })

  it('falls back to true when the persisted value is not a boolean', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ allowPointerControl: 'no' }))
    expect(new SettingsStore(dir).get().allowPointerControl).toBe(true)
  })

  it('persists false and keeps unrelated settings intact', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({ allowPointerControl: false })
    settings.update({ port: 49003 })

    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().allowPointerControl).toBe(false)
    expect(reloaded.get().port).toBe(49003)

    reloaded.update({ allowPointerControl: true })
    expect(new SettingsStore(dir).get().allowPointerControl).toBe(true)
  })
})

describe('SettingsStore keyboard control switch', () => {
  it('defaults allowKeyboardControl to true', () => {
    const settings = new SettingsStore(tempDir())
    expect(settings.get().allowKeyboardControl).toBe(true)
    expect(defaultSettings().allowKeyboardControl).toBe(true)
  })

  it('keeps old settings files valid and defaults a missing field to true', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49005, discovery: false }))
    const settings = new SettingsStore(dir)
    expect(settings.get().allowKeyboardControl).toBe(true)
    expect(settings.get().discovery).toBe(false)
    expect(settings.get().port).toBe(49005)
  })

  it('falls back to true when the persisted value is not a boolean', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ allowKeyboardControl: 'no' }))
    expect(new SettingsStore(dir).get().allowKeyboardControl).toBe(true)
  })

  it('persists false and keeps unrelated settings intact', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({ allowKeyboardControl: false })
    settings.update({ port: 49006 })

    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().allowKeyboardControl).toBe(false)
    expect(reloaded.get().allowPointerControl).toBe(true)
    expect(reloaded.get().port).toBe(49006)

    reloaded.update({ allowKeyboardControl: true })
    expect(new SettingsStore(dir).get().allowKeyboardControl).toBe(true)
  })
})

describe('SettingsStore Twitch settings', () => {  it('defaults Twitch to disabled with no bundled client ID', () => {
    delete process.env['PHONEDEK_TWITCH_CLIENT_ID']
    const settings = new SettingsStore(tempDir())
    expect(settings.get().twitchEnabled).toBe(false)
    expect(settings.get().twitchClientId).toBe('')
    expect(defaultSettings().twitchEnabled).toBe(false)
  })

  it('keeps old settings files valid and persists the public client ID', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49010 }))
    const settings = new SettingsStore(dir)
    expect(settings.get().twitchEnabled).toBe(false)
    expect(settings.get().twitchClientId).toBe('')

    settings.update({ twitchEnabled: true, twitchClientId: 'abcdef123456' })
    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().twitchEnabled).toBe(true)
    expect(reloaded.get().twitchClientId).toBe('abcdef123456')
  })

  it('sanitizes client IDs and falls back to the bundled default only when absent', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    for (const value of ['bad id', 'x'.repeat(65), 'abc-123', 'abc/def']) {
      settings.update({ twitchClientId: value })
      expect(settings.get().twitchClientId).toBe('')
    }
    settings.update({ twitchClientId: 'ValidClient123' })
    expect(settings.get().twitchClientId).toBe('ValidClient123')

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49011 }))
    process.env['PHONEDEK_TWITCH_CLIENT_ID'] = 'BundledClient123'
    try {
      expect(new SettingsStore(dir).get().twitchClientId).toBe('BundledClient123')
    } finally {
      delete process.env['PHONEDEK_TWITCH_CLIENT_ID']
    }
  })
})

describe('SettingsStore auto-profile settings', () => {
  it('defaults auto-profile off with no rules', () => {
    const settings = new SettingsStore(tempDir())
    expect(settings.get().autoProfileEnabled).toBe(false)
    expect(settings.get().autoProfileRules).toEqual([])
    expect(defaultSettings().autoProfileEnabled).toBe(false)
    expect(defaultSettings().autoProfileRules).toEqual([])
  })

  it('keeps old settings files valid and defaults missing fields', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 49020, discovery: false }))
    const settings = new SettingsStore(dir)
    expect(settings.get().port).toBe(49020)
    expect(settings.get().autoProfileEnabled).toBe(false)
    expect(settings.get().autoProfileRules).toEqual([])

    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ port: 49021, autoProfileEnabled: 'yes', autoProfileRules: 'game' }),
    )
    const repaired = new SettingsStore(dir)
    expect(repaired.get().autoProfileEnabled).toBe(false)
    expect(repaired.get().autoProfileRules).toEqual([])
  })

  it('persists rules and normalizes executable paths, case and .exe', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    settings.update({
      autoProfileEnabled: true,
      autoProfileRules: [
        { id: 'rule-1', process: 'C:\\Games\\Game.EXE', profileId: 'game' },
        { id: 'rule-2', process: '  /usr/bin/Team Fortress 2  ', profileId: 'shooter' },
        { id: 'rule-3', process: 'chrome.exe', profileId: 'browser' },
      ],
    })
    expect(settings.get().autoProfileEnabled).toBe(true)
    expect(settings.get().autoProfileRules).toEqual([
      { id: 'rule-1', process: 'game', profileId: 'game' },
      { id: 'rule-2', process: 'team fortress 2', profileId: 'shooter' },
      { id: 'rule-3', process: 'chrome', profileId: 'browser' },
    ])

    const reloaded = new SettingsStore(dir)
    expect(reloaded.get().autoProfileRules).toEqual(settings.get().autoProfileRules)
  })

  it('caps rules at 16 and makes duplicate or malformed ids unique', () => {
    const input = Array.from({ length: 20 }, (_, index) => ({
      id: index < 2 ? 'same' : '',
      process: `game-${index}.exe`,
      profileId: 'game',
    }))
    const rules = sanitizeAutoProfileRules(input)
    expect(rules).toHaveLength(16)
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(16)
    expect(rules[0]).toMatchObject({ id: 'same', process: 'game-0' })
    expect(rules[1]).toMatchObject({ id: 'same-2', process: 'game-1' })
  })

  it('drops invalid process names and profile ids', () => {
    expect(
      sanitizeAutoProfileRules([
        { id: 'ok', process: 'game.exe', profileId: 'game' },
        { process: '', profileId: 'game' },
        { process: 'game', profileId: '' },
        { process: 'game', profileId: '../escape' },
        { process: 42, profileId: 'game' },
        null,
        'not a rule',
      ]),
    ).toEqual([{ id: 'ok', process: 'game', profileId: 'game' }])

    expect(normalizeProcessName('C:\\Program Files\\Game\\Game.EXE')).toBe('game')
    expect(normalizeProcessName('/Applications/Game.app/Game')).toBe('game')
    expect(normalizeProcessName('  ')).toBeNull()
    expect(normalizeProcessName(7)).toBeNull()
  })
})
