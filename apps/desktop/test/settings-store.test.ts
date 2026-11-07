import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, SettingsStore } from '../src/main/settings-store'

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
