import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultConfig } from '@phonedek/shared'
import { ConfigStore } from '../src/main/config-store'
import { AssetStore } from '../src/main/assets'
import { SettingsStore } from '../src/main/settings-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-test-'))
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
})
