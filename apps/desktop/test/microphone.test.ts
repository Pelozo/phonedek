import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CachedMicrophone,
  LINUX_INPUT_COMMAND,
  MAC_INPUT_COMMAND,
  clampMicLevel,
  createMicrophone,
  linuxInputGainArgs,
  linuxInputMuteArgs,
  macInputGainArgs,
  macInputReadArgs,
  parseMacInputOutput,
  parsePactlSourceMuteOutput,
  parsePactlSourceVolumeOutput,
  parseWindowsInputPayload,
} from '../src/main/microphone-source'
import { createHostActions } from '../src/main/host-actions'
import type { CommandRunner, CommandResult } from '../src/main/volume-source'

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', code: 0 }
}

describe('microphone command builders and parsers', () => {
  it('builds macOS and pactl commands', () => {
    expect(MAC_INPUT_COMMAND).toBe('/usr/bin/osascript')
    expect(macInputGainArgs(42)).toEqual(['-e', 'set volume input volume 42'])
    expect(macInputReadArgs()).toEqual(['-e', 'input volume of (get volume settings)'])
    expect(LINUX_INPUT_COMMAND).toBe('pactl')
    expect(linuxInputGainArgs(42)).toEqual(['set-source-volume', '@DEFAULT_SOURCE@', '42%'])
    expect(linuxInputMuteArgs(true)).toEqual(['set-source-mute', '@DEFAULT_SOURCE@', '1'])
    expect(linuxInputMuteArgs(false)).toEqual(['set-source-mute', '@DEFAULT_SOURCE@', '0'])
  })

  it('parses macOS, pactl and Windows readings', () => {
    expect(parseMacInputOutput(' 64\n')).toBe(64)
    expect(parseMacInputOutput('100')).toBe(100)
    expect(() => parseMacInputOutput('loud')).toThrow(/macOS input volume/)

    expect(
      parsePactlSourceVolumeOutput('Volume: mono: 36045 /  55% / -15.00 dB\n        balance 0.00'),
    ).toBe(55)
    expect(() => parsePactlSourceVolumeOutput('Volume: mono: no percent')).toThrow(/source volume/)
    expect(parsePactlSourceMuteOutput('Mute: yes')).toBe(true)
    expect(parsePactlSourceMuteOutput('Mute: no')).toBe(false)
    expect(() => parsePactlSourceMuteOutput('unknown')).toThrow(/source mute/)

    expect(parseWindowsInputPayload({ value: 0.42, muted: false })).toEqual({
      level: 42,
      muted: false,
    })
    expect(parseWindowsInputPayload({ value: 4 })).toEqual({ level: 100 })
    expect(() => parseWindowsInputPayload({})).toThrow(/no gain/)
  })

  it('clamps gain levels and rejects non-finite input', () => {
    expect(clampMicLevel(55.6)).toBe(56)
    expect(clampMicLevel(120)).toBe(100)
    expect(clampMicLevel(-5)).toBe(0)
    expect(() => clampMicLevel(Number.NaN)).toThrow(/finite/)
  })
})

describe('createMicrophone', () => {
  it('emulates macOS input mute by saving and restoring the gain', async () => {
    let gain = 42
    const calls: string[][] = []
    const run: CommandRunner = async (_command, args) => {
      calls.push(args)
      if (args[1] === 'input volume of (get volume settings)') return ok(`${gain}\n`)
      const match = /set volume input volume (\d+)/.exec(args[1] ?? '')
      if (match) {
        gain = Number(match[1])
        return ok()
      }
      return { stdout: '', stderr: 'unexpected', code: 1 }
    }
    const mic = createMicrophone('darwin', { runCommand: run, ttlMs: 0 })
    expect(mic).not.toBeNull()

    await expect(mic!.read()).resolves.toEqual({ level: 42, muted: false })
    await mic!.setGain(63.6)
    expect(gain).toBe(64)

    await expect(mic!.toggleMute()).resolves.toEqual({ level: 0, muted: true })
    expect(gain).toBe(0)

    await expect(mic!.toggleMute()).resolves.toEqual({ level: 64, muted: false })
    expect(gain).toBe(64)
    expect(calls.some((args) => args[1] === 'set volume input volume 0')).toBe(true)
  })

  it('reads and writes the default PulseAudio source', async () => {
    let gain = 55
    let muted = false
    const run: CommandRunner = async (_command, args) => {
      if (args[0] === 'get-source-volume') return ok(`Volume: mono: 36045 / ${gain}%\n`)
      if (args[0] === 'get-source-mute') return ok(`Mute: ${muted ? 'yes' : 'no'}\n`)
      if (args[0] === 'set-source-volume') {
        gain = Number((args[2] ?? '0%').replace('%', ''))
        return ok()
      }
      if (args[0] === 'set-source-mute') {
        muted = args[2] === '1'
        return ok()
      }
      return { stdout: '', stderr: 'unexpected', code: 1 }
    }
    const mic = createMicrophone('linux', {
      runCommand: run,
      isCommandAvailable: () => true,
      ttlMs: 0,
    })
    expect(mic).not.toBeNull()

    await expect(mic!.read()).resolves.toEqual({ level: 55, muted: false })
    await mic!.setGain(30.4)
    expect(gain).toBe(30)
    await expect(mic!.toggleMute()).resolves.toEqual({ level: 30, muted: true })
    expect(muted).toBe(true)
  })

  it('returns clear errors when the capture backend is missing', async () => {
    const run: CommandRunner = async () => ({ stdout: '', stderr: 'no source', code: 1 })
    const mic = createMicrophone('linux', {
      runCommand: run,
      isCommandAvailable: () => true,
      ttlMs: 0,
    })
    await expect(mic!.read()).rejects.toThrow(/Could not read the default microphone/)
    await expect(mic!.setGain(50)).rejects.toThrow(/Could not set microphone gain with pactl/)

    const mac = createMicrophone('darwin', { runCommand: run, ttlMs: 0 })
    await expect(mac!.read()).rejects.toThrow(/osascript exited with 1/)
  })

  it('caches and single-flights reads', async () => {
    let reads = 0
    let release: ((reading: { level: number; muted: boolean }) => void) | null = null
    const mic = new CachedMicrophone(
      {
        async read() {
          reads += 1
          return { level: 20, muted: false }
        },
        async setGain() {},
        async setMute() {},
      },
      { ttlMs: 900, now: () => 1000 },
    )

    await expect(mic.read()).resolves.toEqual({ level: 20, muted: false })
    await mic.read()
    expect(reads).toBe(1)

    const shared = new CachedMicrophone(
      {
        read: () =>
          new Promise((resolve) => {
            release = resolve
          }),
        async setGain() {},
        async setMute() {},
      },
      { ttlMs: 0 },
    )
    const first = shared.read()
    const second = shared.read()
    expect(release).toBeTypeOf('function')
    release!({ level: 33, muted: true })
    await expect(first).resolves.toEqual({ level: 33, muted: true })
    await expect(second).resolves.toEqual({ level: 33, muted: true })
  })

  it('returns null when the platform has no capture backend', () => {
    expect(createMicrophone('win32')).toBeNull()
    expect(createMicrophone('sunos')).toBeNull()
    expect(createMicrophone('linux', { isCommandAvailable: () => false })).toBeNull()
  })
})

describe('microphone host actions', () => {
  it('clamps values and uses the injected microphone controller', async () => {
    const log: string[] = []
    const host = createHostActions({
      platform: 'darwin',
      setSystemInputGain: async (level) => {
        log.push(`gain:${level}`)
      },
      toggleSystemInputMute: async () => {
        log.push('mute')
      },
    })
    await host.setInputGain(55.6)
    await host.setInputGain(120)
    await host.toggleInputMute()
    expect(log).toEqual(['gain:56', 'gain:100', 'mute'])
  })

  it('returns clear errors when Windows has no helper seam', async () => {
    const host = createHostActions({ platform: 'win32' })
    await expect(host.setInputGain(50)).rejects.toThrow(/not available on Windows/)
    await expect(host.toggleInputMute()).rejects.toThrow(/not available on Windows/)
  })
})

describe('Windows helper capture endpoint', () => {
  it('declares the capture endpoint and IAudioEndpointVolume vtable in order', () => {
    const path = fileURLToPath(new URL('../resources/keyboard-helper.ps1', import.meta.url))
    const script = readFileSync(path, 'utf8')

    expect(script).toContain('GetDefaultAudioEndpoint(1, 1')
    for (const step of ['set-input-gain', 'get-input', 'set-input-mute', 'toggle-input-mute']) {
      expect(script).toContain(step)
    }

    const vtable = [
      'RegisterControlChangeNotify',
      'UnregisterControlChangeNotify',
      'GetChannelCount',
      'SetMasterVolumeLevel(',
      'SetMasterVolumeLevelScalar',
      'GetMasterVolumeLevel(',
      'GetMasterVolumeLevelScalar',
      'SetChannelVolumeLevel(',
      'SetChannelVolumeLevelScalar',
      'GetChannelVolumeLevel(',
      'GetChannelVolumeLevelScalar',
      'SetMute(',
      'GetMute(',
    ]
    let last = -1
    for (const method of vtable) {
      const index = script.indexOf(method, last + 1)
      expect(index, `missing or out of order: ${method}`).toBeGreaterThan(last)
      last = index
    }
  })
})
