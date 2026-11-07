import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
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

  it('round-trips video assets alongside images', () => {
    const dir = tempDir()
    const assetsDir = join(dir, 'assets')
    mkdirSync(assetsDir)
    writeFileSync(join(assetsDir, 'wallpaper.png'), Buffer.from([1, 2]))
    writeFileSync(join(assetsDir, 'intro.mp4'), Buffer.from([3, 4, 5]))
    writeFileSync(join(assetsDir, 'icon.webm'), Buffer.from([6]))

    const target = join(dir, 'media.zip')
    const written = writeBackupFile(target, createDefaultConfig(), assetsDir)
    expect(written.assets).toBe(3)
    expect(written.warnings).toEqual([])

    const read = readBackupFile(target)
    expect(read.assets.get('intro.mp4')).toEqual(Buffer.from([3, 4, 5]))
    expect(read.assets.get('icon.webm')).toEqual(Buffer.from([6]))
    expect(read.warnings).toEqual([])
  })

  it('uses the video limit and skips unsupported or oversized files', () => {
    const dir = tempDir()
    const assetsDir = join(dir, 'assets')
    mkdirSync(assetsDir)
    writeFileSync(join(assetsDir, 'still.png'), Buffer.from([1]))

    // A 26 MB video is valid now; the old shared 25 MB limit would drop it.
    const longVideo = join(assetsDir, 'long.mp4')
    writeFileSync(longVideo, '')
    truncateSync(longVideo, 26 * 1024 * 1024)

    const hugeVideo = join(assetsDir, 'huge.webm')
    writeFileSync(hugeVideo, '')
    truncateSync(hugeVideo, 100 * 1024 * 1024 + 1)

    writeFileSync(join(assetsDir, 'notes.txt'), Buffer.from('nope'))

    const written = writeBackupFile(join(dir, 'limits.zip'), createDefaultConfig(), assetsDir)
    expect(written.assets).toBe(2)
    expect(written.warnings.join(' ')).toMatch(/unsupported asset: notes\.txt/)
    expect(written.warnings.join(' ')).toMatch(/oversized asset: huge\.webm/)
  })

  it('reads videos from a ZIP and warns about unsupported entries', () => {
    const dir = tempDir()
    const zip = new AdmZip()
    zip.addFile('phonedek-config.json', Buffer.from(JSON.stringify(createDefaultConfig())))
    zip.addFile('assets/clip.mp4', Buffer.from([9, 8, 7]))
    zip.addFile('assets/readme.txt', Buffer.from('nope'))
    const file = join(dir, 'media-in.zip')
    zip.writeZip(file)

    const read = readBackupFile(file)
    expect(read.assets.get('clip.mp4')).toEqual(Buffer.from([9, 8, 7]))
    expect(read.warnings.join(' ')).toMatch(/unsupported asset: readme\.txt/)
  })
})
