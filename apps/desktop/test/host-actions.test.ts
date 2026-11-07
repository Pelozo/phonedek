import { describe, expect, it } from 'vitest'
import {
  createHostActions,
  MAC_SCREENSHOT_ARGS,
  MAC_SCREENSHOT_COMMAND,
  macApplicationOpenArgs,
} from '../src/main/host-actions'

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

describe('macOS screenshot', () => {
  it('uses screencapture -x (silent, full screen)', async () => {
    expect(MAC_SCREENSHOT_COMMAND).toBe('/usr/sbin/screencapture')
    expect(MAC_SCREENSHOT_ARGS).toEqual(['-x'])

    let calls = 0
    const host = createHostActions({
      platform: 'darwin',
      captureScreen: async () => {
        calls += 1
      },
    })
    await expect(host.screenshot()).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })

  it('turns capture failures into an actionable error', async () => {
    const host = createHostActions({
      platform: 'darwin',
      captureScreen: async () => {
        throw new Error('xpc connection interrupted')
      },
    })
    await expect(host.screenshot()).rejects.toThrow(
      /macOS screenshot failed: xpc connection interrupted.*Screen Recording/s,
    )
  })

  it('rejects on non-macOS hosts', async () => {
    const host = createHostActions({ platform: 'win32' })
    await expect(host.screenshot()).rejects.toThrow(/only implemented on macOS/)
  })
})
