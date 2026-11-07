import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHostActions,
  MAC_SCREENSHOT_ARGS,
  MAC_SCREENSHOT_COMMAND,
  macApplicationOpenArgs,
  macScreenshotArgs,
  macScreenshotPath,
} from '../src/main/host-actions'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('macApplicationOpenArgs', () => {
  it('opens an app bundle without arguments', () => {
    expect(macApplicationOpenArgs('/Applications/TextEdit.app', [])).toEqual([
      '-a',
      '/Applications/TextEdit.app',
    ])
  })

  it('forwards arguments after --args', () => {
    expect(macApplicationOpenArgs('/Applications/Visual Studio Code.app', ['notes.txt', '--new-window'])).toEqual([
      '-a',
      '/Applications/Visual Studio Code.app',
      '--args',
      'notes.txt',
      '--new-window',
    ])
  })
})

describe('macScreenshotPath', () => {
  it('builds a Finder-friendly path under the Desktop', () => {
    const path = macScreenshotPath(new Date(2026, 10, 7, 12, 34, 56), '/Users/ada')
    expect(path).toBe(join('/Users/ada', 'Desktop', 'PhoneDeck Screenshot 2026-11-07 at 12.34.56.png'))
    expect(basename(path)).not.toContain(':')
    expect(path.endsWith('.png')).toBe(true)
  })

  it('produces a unique path for different times', () => {
    const home = '/Users/ada'
    const first = macScreenshotPath(new Date(2026, 10, 7, 12, 34, 56), home)
    const second = macScreenshotPath(new Date(2026, 10, 7, 12, 34, 57), home)
    expect(first).not.toBe(second)
    expect(first).toMatch(/\d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
    expect(second).toMatch(/\d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
  })
})

describe('macScreenshotArgs', () => {
  it('passes the destination file to screencapture', () => {
    expect(MAC_SCREENSHOT_ARGS).toEqual(['-x', '-t', 'png'])
    expect(macScreenshotArgs('/Users/ada/Desktop/PhoneDeck Screenshot 2026-11-07 at 12.34.56.png')).toEqual([
      '-x',
      '-t',
      'png',
      '/Users/ada/Desktop/PhoneDeck Screenshot 2026-11-07 at 12.34.56.png',
    ])
  })
})

describe('macOS screenshot', () => {
  it('captures a silent full-screen PNG into the Desktop folder', async () => {
    expect(MAC_SCREENSHOT_COMMAND).toBe('/usr/sbin/screencapture')

    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    const captured: string[] = []
    const host = createHostActions({
      platform: 'darwin',
      homeDir: home,
      captureScreen: async (path) => {
        captured.push(path)
      },
    })
    const savedPath = await host.screenshot()
    expect(captured).toEqual([savedPath])
    expect(existsSync(join(home, 'Desktop'))).toBe(true)
    expect(dirname(savedPath)).toBe(join(home, 'Desktop'))
    expect(basename(savedPath)).toMatch(/^PhoneDeck Screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
  })

  it('does not overwrite an existing capture', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 10, 7, 12, 34, 56))
      const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
      tempDirs.push(home)
      mkdirSync(join(home, 'Desktop'), { recursive: true })
      writeFileSync(join(home, 'Desktop', 'PhoneDeck Screenshot 2026-11-07 at 12.34.56.png'), '')

      const captured: string[] = []
      const host = createHostActions({
        platform: 'darwin',
        homeDir: home,
        captureScreen: async (path) => {
          captured.push(path)
        },
      })
      await host.screenshot()
      expect(captured).toHaveLength(1)
      expect(basename(captured[0] ?? '')).toBe('PhoneDeck Screenshot 2026-11-07 at 12.34.56 2.png')
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns capture failures into an actionable error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    const host = createHostActions({
      platform: 'darwin',
      homeDir: home,
      captureScreen: async () => {
        throw new Error('xpc connection interrupted')
      },
    })
    await expect(host.screenshot()).rejects.toThrow(
      /macOS screenshot failed: xpc connection interrupted.*Destination: .*PhoneDeck Screenshot.*Screen Recording/s,
    )
  })

  it('rejects on non-macOS hosts', async () => {
    const host = createHostActions({ platform: 'win32' })
    await expect(host.screenshot()).rejects.toThrow(/only implemented on macOS/)
  })
})
