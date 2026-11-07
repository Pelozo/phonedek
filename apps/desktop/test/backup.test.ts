import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { createDefaultConfig } from '@phonedek/shared'
import { readBackupFile, writeBackupFile } from '../src/main/backup'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-backup-'))
}

describe('backup archives', () => {
  it('round-trips config and assets through a ZIP', () => {
    const dir = tempDir()
    const assetsDir = join(dir, 'assets')
    mkdirSync(assetsDir)
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    writeFileSync(join(assetsDir, 'wallpaper.png'), image)

    const config = createDefaultConfig()
    config.serverName = 'Backup test'
    const target = join(dir, 'backup.zip')
    const written = writeBackupFile(target, config, assetsDir)
    expect(written.assets).toBe(1)
    expect(written.warnings).toEqual([])

    const read = readBackupFile(target)
    expect(read.config.serverName).toBe('Backup test')
    expect(read.assets.get('wallpaper.png')).toEqual(image)
    expect(read.warnings).toEqual([])
  })

  it('still accepts a legacy JSON config export', () => {
    const dir = tempDir()
    const config = createDefaultConfig()
    config.serverName = 'Legacy'
    const file = join(dir, 'config.json')
    writeFileSync(file, JSON.stringify(config))

    const read = readBackupFile(file)
    expect(read.config.serverName).toBe('Legacy')
    expect(read.assets.size).toBe(0)
  })

  it('ignores unsafe asset entries inside a ZIP', () => {
    const dir = tempDir()
    const config = createDefaultConfig()
    const zip = new AdmZip()
    zip.addFile('phonedek-config.json', Buffer.from(JSON.stringify(config)))
    zip.addFile('assets/../evil.png', Buffer.from('nope'))
    zip.addFile('../outside.png', Buffer.from('nope'))
    zip.addFile('assets/safe.png', Buffer.from('safe'))
    const file = join(dir, 'evil.zip')
    zip.writeZip(file)

    const read = readBackupFile(file)
    expect(read.assets.has('safe.png')).toBe(true)
    expect(read.assets.size).toBe(1)
    expect([...read.assets.keys()]).toEqual(['safe.png'])
  })

  it('rejects a ZIP without a config and an invalid config', () => {
    const dir = tempDir()
    const empty = new AdmZip()
    empty.addFile('assets/a.png', Buffer.from('x'))
    const noConfig = join(dir, 'no-config.zip')
    empty.writeZip(noConfig)
    expect(() => readBackupFile(noConfig)).toThrow(/does not contain/)

    const invalid = join(dir, 'invalid.zip')
    const zip = new AdmZip()
    zip.addFile('phonedek-config.json', Buffer.from('{ bad json'))
    zip.writeZip(invalid)
    expect(() => readBackupFile(invalid)).toThrow(/not valid JSON/)
  })

  it('keeps the source JSON when writing if no assets exist', () => {
    const dir = tempDir()
    const assetsDir = join(dir, 'assets')
    mkdirSync(assetsDir)
    const config = createDefaultConfig()
    const target = join(dir, 'empty.zip')
    const written = writeBackupFile(target, config, assetsDir)
    expect(written.assets).toBe(0)
    const raw = readFileSync(target)
    expect(raw.length).toBeGreaterThan(100)
    expect(readBackupFile(target).config.profiles.length).toBe(config.profiles.length)
  })
})
