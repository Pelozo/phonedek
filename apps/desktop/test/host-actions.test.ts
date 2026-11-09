import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampVolumeLevel,
  createHostActions,
  LINUX_VOLUME_COMMAND,
  linuxVolumeArgs,
  MAC_SCREENSHOT_ARGS,
  MAC_SCREENSHOT_COMMAND,
  MAC_VOLUME_COMMAND,
  macApplicationOpenArgs,
  macScreenshotArgs,
  macScreenshotPath,
  macVolumeArgs,
  WINDOWS_SCREENSHOT_COMMAND,
  windowsScreenshotArgs,
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

  it('creates and uses a configured screenshot folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    const folder = join(home, 'captures', 'nested')
    const captured: string[] = []
    const host = createHostActions({
      platform: 'darwin',
      homeDir: home,
      screenshotDirectory: ` ${folder} `,
      captureScreen: async (path) => {
        captured.push(path)
      },
    })

    const saved = await host.screenshot()
    expect(saved).toBe(captured[0])
    expect(dirname(saved)).toBe(folder)
    expect(existsSync(folder)).toBe(true)
    expect(basename(saved)).toMatch(/^PhoneDeck Screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
  })

  it('reads the screenshot folder at capture time', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    let folder = join(home, 'first')
    const captured: string[] = []
    const host = createHostActions({
      platform: 'darwin',
      homeDir: home,
      getScreenshotDirectory: () => folder,
      captureScreen: async (path) => {
        captured.push(path)
      },
    })

    const first = await host.screenshot()
    folder = join(home, 'second')
    const second = await host.screenshot()
    expect(dirname(first)).toBe(join(home, 'first'))
    expect(dirname(second)).toBe(join(home, 'second'))
    expect(captured).toEqual([first, second])
  })

  it('includes the destination folder when a configured capture fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    const folder = join(home, 'captures')
    const host = createHostActions({
      platform: 'darwin',
      homeDir: home,
      screenshotDirectory: folder,
      captureScreen: async () => {
        throw new Error('xpc connection interrupted')
      },
    })

    const error = await host.screenshot().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(folder)
    expect((error as Error).message).toMatch(/Screen Recording/)
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

  it('captures directly on Windows', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phonedek-shot-'))
    tempDirs.push(home)
    const captured: string[] = []
    const host = createHostActions({
      platform: 'win32',
      homeDir: home,
      captureScreen: async (path) => {
        captured.push(path)
        writeFileSync(path, 'png')
      },
    })

    const saved = await host.screenshot()
    expect(captured).toEqual([saved])
    expect(existsSync(saved)).toBe(true)
    expect(basename(saved)).toMatch(/^PhoneDeck Screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
  })

  it('builds an encoded PowerShell capture command', () => {
    expect(WINDOWS_SCREENSHOT_COMMAND).toBe('powershell.exe')
    const args = windowsScreenshotArgs("C:\\Users\\A B\\shot's.png")
    const index = args.indexOf('-EncodedCommand')
    expect(index).toBeGreaterThanOrEqual(0)
    const script = Buffer.from(args[index + 1] ?? '', 'base64').toString('utf16le')
    expect(script).toContain("C:\\Users\\A B\\shot''s.png")
    expect(script).toContain('CopyFromScreen')
  })

  it('rejects on other hosts', async () => {
    const host = createHostActions({ platform: 'linux' })
    await expect(host.screenshot()).rejects.toThrow(/only implemented on macOS and Windows/)
  })
})

describe('absolute volume', () => {
  it('builds the platform commands', () => {
    expect(MAC_VOLUME_COMMAND).toBe('/usr/bin/osascript')
    expect(macVolumeArgs(55)).toEqual(['-e', 'set volume output volume 55'])
    expect(LINUX_VOLUME_COMMAND).toBe('pactl')
    expect(linuxVolumeArgs(42)).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '42%'])
  })

  it('clamps levels and uses the injected seam', async () => {
    expect(clampVolumeLevel(55.6)).toBe(56)
    expect(clampVolumeLevel(120)).toBe(100)
    expect(clampVolumeLevel(-5)).toBe(0)
    expect(() => clampVolumeLevel(Number.NaN)).toThrow(/finite/)

    const seen: number[] = []
    const host = createHostActions({
      platform: 'darwin',
      setSystemVolume: async (level) => {
        seen.push(level)
      },
    })
    await host.setVolume(55.6)
    await host.setVolume(120)
    await host.setVolume(-5)
    expect(seen).toEqual([56, 100, 0])
  })

  it('returns clear errors for unsupported hosts', async () => {
    const windows = createHostActions({ platform: 'win32' })
    await expect(windows.setVolume(50)).rejects.toThrow(/not implemented on Windows/)
    const other = createHostActions({ platform: 'sunos' })
    await expect(other.setVolume(50)).rejects.toThrow(/not implemented on sunos/)
  })
})
