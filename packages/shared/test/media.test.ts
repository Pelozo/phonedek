import { describe, expect, it } from 'vitest'
import {
  IMAGE_ASSET_MAX_BYTES,
  VIDEO_ASSET_MAX_BYTES,
  assetContentType,
  assetKindFromName,
  isImageAssetName,
  isVideoAssetName,
} from '../src/media'

describe('media asset metadata', () => {
  it('classifies image and video extensions case-insensitively', () => {
    expect(assetKindFromName('still.PNG')).toBe('image')
    expect(assetKindFromName('loop.gif')).toBe('image')
    expect(assetKindFromName('clip.MP4')).toBe('video')
    expect(assetKindFromName('clip.webm')).toBe('video')
    expect(assetKindFromName('clip.m4v')).toBe('video')
    expect(assetKindFromName('clip.mov')).toBe('video')
    expect(assetKindFromName('clip.avi')).toBeNull()
    expect(assetKindFromName('no-extension')).toBeNull()
    expect(isImageAssetName('icon.jpeg')).toBe(true)
    expect(isVideoAssetName('icon.jpeg')).toBe(false)
  })

  it('maps MIME types for every supported extension', () => {
    expect(assetContentType('a.png')).toBe('image/png')
    expect(assetContentType('a.jpg')).toBe('image/jpeg')
    expect(assetContentType('a.gif')).toBe('image/gif')
    expect(assetContentType('a.mp4')).toBe('video/mp4')
    expect(assetContentType('a.m4v')).toBe('video/mp4')
    expect(assetContentType('a.webm')).toBe('video/webm')
    expect(assetContentType('a.mov')).toBe('video/quicktime')
    expect(assetContentType('a.txt')).toBe('application/octet-stream')
  })

  it('exposes the agreed per-kind limits', () => {
    expect(IMAGE_ASSET_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(VIDEO_ASSET_MAX_BYTES).toBe(100 * 1024 * 1024)
  })
})
