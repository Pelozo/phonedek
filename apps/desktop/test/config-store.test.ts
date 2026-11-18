import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultConfig, parseConfig } from '@phonedek/shared'
import type { DeckButton } from '@phonedek/shared'
import { ConfigStore } from '../src/main/config-store'
import { AssetStore } from '../src/main/assets'
import { SettingsStore } from '../src/main/settings-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-test-'))
}

function patchButton(button: DeckButton, patch: Record<string, unknown>): void {
  Object.assign(button as unknown as Record<string, unknown>, patch)
}

describe('ConfigStore', () => {
  it('creates a starter config and persists replacements', () => {
    const dir = tempDir()
    const store = new ConfigStore({ dir, now: () => new Date('2026-01-01T00:00:00.000Z') })
    expect(store.get().serverName).toBe('PhoneDeck')
    expect(existsSync(store.file)).toBe(true)

    const next = createDefaultConfig()
    next.serverName = 'Gaming rig'
    next.profiles[0]!.name = 'Gaming'
    const saved = store.replace(next)
    expect(saved.updatedAt).toBe('2026-01-01T00:00:00.000Z')

    const reloaded = new ConfigStore({ dir })
    expect(reloaded.get().serverName).toBe('Gaming rig')
    expect(reloaded.get().profiles[0]!.name).toBe('Gaming')
  })

  it('updates through a mutator and notifies listeners', () => {
    const dir = tempDir()
    const store = new ConfigStore({ dir })
    const seen: string[] = []
    const off = store.onChange((config) => seen.push(config.serverName))
    store.update((draft) => {
      draft.serverName = 'Desk'
    })
    expect(seen).toEqual(['Desk'])
    off()
    store.update((draft) => {
      draft.serverName = 'Desk 2'
    })
    expect(seen).toEqual(['Desk'])
  })

  it('rejects invalid updates', () => {
    const store = new ConfigStore({ dir: tempDir() })
    expect(() =>
      store.update((draft) => {
        draft.profiles[0]!.grid.columns = 99
      }),
    ).toThrow(/Invalid deck config/)
  })

  it('backs up a corrupt config and restores the starter deck', () => {
    const dir = tempDir()
    const store = new ConfigStore({ dir })
    writeFileSync(store.file, '{ not json', 'utf8')
    const recovered = new ConfigStore({ dir })
    expect(recovered.get().serverName).toBe('PhoneDeck')
    const backups = readdirSync(dir).filter((name) => name.startsWith('config.corrupt-'))
    expect(backups.length).toBe(1)
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe('{ not json')
  })

  it('repairs dangling rig/rule references without resetting the deck', () => {
    const dir = tempDir()
    const store = new ConfigStore({ dir })

    const config = createDefaultConfig()
    config.serverName = 'Studio'
    config.updatedAt = '2026-02-02T02:02:02.000Z'
    config.rigs = [
      { id: 'rig-live', name: 'Go live', steps: [{ id: 'step-1', action: { type: 'hotkey', keys: ['F1'] } }] },
    ]

    // Keep a second profile so the repair proves it is not a reset.
    const second = structuredClone(config.profiles[0]!)
    second.id = 'profile-second'
    second.name = 'Second'
    config.profiles.push(second)

    const page = config.profiles[0]!.pages[0]!
    patchButton(page.buttons[0]!, {
      actions: [{ type: 'rig', action: 'run', presetId: 'rig-live' }],
      state: { type: 'rig', presetId: 'rig-live' },
    })
    patchButton(page.buttons[1]!, {
      actions: [{ type: 'rig', action: 'run', presetId: 'rig-missing' }],
      state: { type: 'rig', presetId: 'rig-missing' },
    })
    config.rules = [
      {
        id: 'rule-keep',
        name: 'Keep',
        trigger: { kind: 'obs.streaming', active: true },
        actions: [
          { kind: 'runRig', presetId: 'rig-live' },
          { kind: 'showProfile', profileId: 'profile-gone' },
          { kind: 'showPage', profileId: 'profile-second', pageId: 'page-main' },
          { kind: 'showPage', profileId: 'profile-desktop', pageId: 'page-gone' },
          { kind: 'notice', text: 'Live' },
        ],
      },
      {
        id: 'rule-drop',
        name: 'Drop',
        trigger: { kind: 'phone.connected' },
        actions: [{ kind: 'runRig', presetId: 'rig-missing' }],
      },
    ]

    const raw = JSON.stringify(config, null, 2)
    writeFileSync(store.file, raw, 'utf8')

    const repaired = new ConfigStore({ dir })
    const out = repaired.get()

    // Nothing was reset: settings, profiles, pages, buttons and timestamps survive.
    expect(out.serverName).toBe('Studio')
    expect(out.updatedAt).toBe('2026-02-02T02:02:02.000Z')
    expect(out.profiles).toHaveLength(2)
    expect(out.profiles[1]!.name).toBe('Second')
    expect(out.profiles[0]!.theme).toEqual(config.profiles[0]!.theme)
    expect(out.profiles[0]!.pages.map((entry) => entry.name)).toEqual(
      config.profiles[0]!.pages.map((entry) => entry.name),
    )
    expect(out.profiles[0]!.pages[0]!.buttons).toHaveLength(page.buttons.length)

    // Valid references survive; dangling ones are gone.
    expect(out.profiles[0]!.pages[0]!.buttons[0]!.actions).toEqual([
      { type: 'rig', action: 'run', presetId: 'rig-live' },
    ])
    expect(out.profiles[0]!.pages[0]!.buttons[0]!.state).toEqual({ type: 'rig', presetId: 'rig-live' })
    expect(out.profiles[0]!.pages[0]!.buttons[1]!.actions).toEqual([])
    expect(out.profiles[0]!.pages[0]!.buttons[1]!.state).toBeUndefined()
    expect(out.rules).toHaveLength(1)
    expect(out.rules![0]!.id).toBe('rule-keep')
    expect(out.rules![0]!.actions).toEqual([
      { kind: 'runRig', presetId: 'rig-live' },
      { kind: 'showPage', profileId: 'profile-second', pageId: 'page-main' },
      { kind: 'notice', text: 'Live' },
    ])

    const message = repaired.getLastError() ?? ''
    expect(message).toMatch(/1 rig action\(s\)/)
    expect(message).toMatch(/1 rig state\(s\)/)
    expect(message).toMatch(/3 rule action\(s\)/)
    expect(message).toMatch(/1 empty rule\(s\)/)
    expect(message).toContain('config.repaired-')

    const repairedBackups = readdirSync(dir).filter((name) => name.startsWith('config.repaired-'))
    expect(repairedBackups).toHaveLength(1)
    expect(readdirSync(dir).filter((name) => name.startsWith('config.corrupt-'))).toHaveLength(0)
    expect(readFileSync(join(dir, repairedBackups[0]!), 'utf8')).toBe(raw)

    // The rewritten file validates and reloads without another backup.
    const saved = parseConfig(JSON.parse(readFileSync(repaired.file, 'utf8')))
    expect(saved.serverName).toBe('Studio')
    expect(saved.profiles).toHaveLength(2)
    expect(saved.rules).toHaveLength(1)

    const reloaded = new ConfigStore({ dir })
    expect(reloaded.get().serverName).toBe('Studio')
    expect(reloaded.get().rigs).toHaveLength(1)
    expect(reloaded.getLastError()).toBeNull()
    expect(readdirSync(dir).filter((name) => name.startsWith('config.repaired-'))).toHaveLength(1)
    expect(readdirSync(dir).filter((name) => name.startsWith('config.corrupt-'))).toHaveLength(0)
  })

  it('still backs up structurally corrupt configs and restores the starter deck', () => {
    const dir = tempDir()
    const store = new ConfigStore({ dir })
    const corrupt = JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      serverName: 'Broken',
      defaultProfileId: 'profile-missing',
      profiles: [],
    })
    writeFileSync(store.file, corrupt, 'utf8')

    const recovered = new ConfigStore({ dir })
    expect(recovered.get().serverName).toBe('PhoneDeck')
    expect(recovered.getLastError()).toBeTruthy()
    const corruptBackups = readdirSync(dir).filter((name) => name.startsWith('config.corrupt-'))
    expect(corruptBackups).toHaveLength(1)
    expect(readFileSync(join(dir, corruptBackups[0]!), 'utf8')).toBe(corrupt)
    expect(readdirSync(dir).filter((name) => name.startsWith('config.repaired-'))).toHaveLength(0)
  })
})

describe('AssetStore', () => {
  it('imports images and resolves them safely', () => {
    const dir = tempDir()
    const sourceDir = join(dir, 'source')
    mkdirSync(sourceDir)
    const source = join(sourceDir, 'wallpaper.PNG')
    writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const assets = new AssetStore(join(dir, 'assets'))
    const name = assets.importFile(source)
    expect(name.endsWith('.png')).toBe(true)
    expect(assets.pathFor(name)).toBeTruthy()
    expect(assets.contentType(name)).toBe('image/png')
    expect(assets.pathFor('../config.json')).toBeNull()
    expect(assets.list()).toContain(name)
  })

  it('rejects unsupported extensions and large-ish weird names', () => {
    const dir = tempDir()
    const source = join(dir, 'script.exe')
    writeFileSync(source, 'nope')
    const assets = new AssetStore(join(dir, 'assets'))
    expect(() => assets.importFile(source)).toThrow(/Only PNG/)
    expect(assets.pathFor('..\\config.json')).toBeNull()
  })
})

describe('SettingsStore', () => {
  it('persists a stable token and rotates on demand', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    const token = settings.get().token
    expect(token).toMatch(/^\d{4}$/)
    expect(new SettingsStore(dir).get().token).toBe(token)

    settings.update({ port: 49000, discovery: false, pairHost: '192.168.1.50' })
    expect(new SettingsStore(dir).get().port).toBe(49000)
    expect(new SettingsStore(dir).get().pairHost).toBe('192.168.1.50')

    settings.update({ pairHost: '../not-an-address' })
    expect(settings.get().pairHost).toBe('')

    const rotated = settings.rotateToken()
    expect(rotated).not.toBe(token)
    expect(new SettingsStore(dir).get().token).toBe(rotated)
  })

  it('sanitizes invalid ports and tokens', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ port: 1, token: 'x' }))
    const settings = new SettingsStore(dir)
    expect(settings.get().port).toBe(47654)
    expect(settings.get().token).toMatch(/^\d{4}$/)
  })

  it('persists the screenshot directory and resets to the Desktop default', () => {
    const dir = tempDir()
    const settings = new SettingsStore(dir)
    expect(settings.get().screenshotDirectory).toBe('')

    const folder = join(dir, 'captures')
    settings.update({ screenshotDirectory: `  ${folder}  ` })
    expect(settings.get().screenshotDirectory).toBe(folder)
    expect(new SettingsStore(dir).get().screenshotDirectory).toBe(folder)

    settings.update({ screenshotDirectory: '' })
    expect(settings.get().screenshotDirectory).toBe('')
    expect(new SettingsStore(dir).get().screenshotDirectory).toBe('')
  })

  it('falls back for invalid persisted screenshot directories', () => {
    const dir = tempDir()
    for (const value of [42, 'relative/captures', `/${'x'.repeat(5000)}`, null]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ screenshotDirectory: value }))
      expect(new SettingsStore(dir).get().screenshotDirectory, String(value).slice(0, 30)).toBe('')
    }
  })
})
