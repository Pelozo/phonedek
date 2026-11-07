import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../src/main/assets'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-assets-'))
}

describe('AssetStore media', () => {
  it('imports videos and serves their MIME types', () => {
    const dir = tempDir()
    const source = join(dir, 'clip.MP4')
    writeFileSync(source, Buffer.from([0, 1, 2, 3]))
    const assets = new AssetStore(join(dir, 'assets'))

    const name = assets.importFile(source, 'video')
    expect(name.endsWith('.mp4')).toBe(true)
    expect(assets.contentType(name)).toBe('video/mp4')
    expect(assets.pathFor(name)).toBeTruthy()

    const mov = join(dir, 'clip.mov')
    writeFileSync(mov, Buffer.from([4, 5]))
    const movName = assets.importFile(mov, 'video')
    expect(assets.contentType(movName)).toBe('video/quicktime')
  })

  it('infers the kind for backup buffers so existing imports keep videos', () => {
    const dir = tempDir()
    const assets = new AssetStore(join(dir, 'assets'))
    expect(assets.importBuffer('clip.webm', Buffer.from([1, 2]))).toBe(true)
    expect(assets.contentType('clip.webm')).toBe('video/webm')
    expect(assets.importBuffer('icon.gif', Buffer.from([3, 4]))).toBe(true)
    expect(assets.contentType('icon.gif')).toBe('image/gif')
  })

  it('rejects the wrong kind and unsupported extensions', () => {
    const dir = tempDir()
    const assets = new AssetStore(join(dir, 'assets'))

    const video = join(dir, 'clip.mp4')
    writeFileSync(video, Buffer.from([1]))
    expect(() => assets.importFile(video, 'image')).toThrow(/Only PNG/)

    const image = join(dir, 'still.png')
    writeFileSync(image, Buffer.from([1]))
    expect(() => assets.importFile(image, 'video')).toThrow(/Only MP4/)

    expect(assets.importBuffer('clip.mp4', Buffer.from([1]), 'image')).toBe(false)
    expect(assets.importBuffer('still.png', Buffer.from([1]), 'video')).toBe(false)
    expect(assets.importBuffer('notes.txt', Buffer.from([1]))).toBe(false)
    expect(assets.importBuffer('../evil.png', Buffer.from([1]))).toBe(false)
  })

  it('enforces per-kind size limits', () => {
    const dir = tempDir()
    const assets = new AssetStore(join(dir, 'assets'))

    const bigImage = join(dir, 'big.png')
    writeFileSync(bigImage, '')
    truncateSync(bigImage, 25 * 1024 * 1024 + 1)
    expect(() => assets.importFile(bigImage, 'image')).toThrow(/larger than 25 MB/)

    // The old 25 MB ceiling would reject this; videos may be up to 100 MB.
    const longVideo = join(dir, 'long.mp4')
    writeFileSync(longVideo, '')
    truncateSync(longVideo, 26 * 1024 * 1024)
    const name = assets.importFile(longVideo, 'video')
    expect(statSync(join(assets.dir, name)).size).toBe(26 * 1024 * 1024)

    const hugeVideo = join(dir, 'huge.mp4')
    writeFileSync(hugeVideo, '')
    truncateSync(hugeVideo, 100 * 1024 * 1024 + 1)
    expect(() => assets.importFile(hugeVideo, 'video')).toThrow(/larger than 100 MB/)
  })

  it('rejects path traversal in resolved names', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'assets'))
    const assets = new AssetStore(join(dir, 'assets'))
    expect(assets.pathFor('../config.json')).toBeNull()
    expect(assets.pathFor('..\\config.json')).toBeNull()
  })
})
