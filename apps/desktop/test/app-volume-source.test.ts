import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AppVolumeSource,
  appMatchKey,
  createAppVolumeSource,
  createLinuxAppVolumeBackend,
  createWindowsAppVolumeBackend,
  matchAppSessions,
  normalizeAppName,
  parsePactlSinkInputs,
  parseWindowsAudioSessions,
  type AppSession,
  type AppVolumeBackend,
} from '../src/main/app-volume-source'
import type { CommandResult, CommandRunner } from '../src/main/volume-source'

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', code: 0 }
}

const PACTL_SAMPLE = `Sink Input #42
\tDriver: protocol-native.c
\tOwner Module: 9
\tClient: 12
\tSink: 0
\tProperties:
\t\tmedia.name = "Playback Stream"
\t\tapplication.name = "Google Chrome"
\t\tapplication.process.binary = "chrome"
\t\tapplication.language = "en"
\tVolume: front-left: 42000 /  64% / -11.00 dB,   front-right: 42000 /  64% / -11.00 dB
\t        balance 0.00
\tMute: no
Sink Input #43
\tDriver: protocol-native.c
\tOwner Module: 9
\tClient: 13
\tSink: 0
\tProperties:
\t\tmedia.name = "Music"
\t\tapplication.name = "Spotify"
\tVolume: mono: 65536 / 100% / 0.00 dB
\t        balance 0.00
\tMute: yes
`

describe('app volume parsers and matching', () => {
  it('parses pactl sink inputs with binary, display name, volume and mute', () => {
    const sessions = parsePactlSinkInputs(PACTL_SAMPLE)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      id: '42',
      process: 'chrome',
      name: 'Google Chrome',
      volume: 64,
      muted: false,
      available: true,
    })
    expect(sessions[1]).toMatchObject({
      id: '43',
      process: 'spotify',
      name: 'Spotify',
      volume: 100,
      muted: true,
    })
    expect(parsePactlSinkInputs('nothing here')).toEqual([])
  })

  it('parses the Windows helper payload and clamps scalar volume', () => {
    const sessions = parseWindowsAudioSessions({
      sessions: [
        { id: 's1', pid: 120, process: 'Discord', name: 'Discord', volume: 0.42, muted: false },
        { id: 's2', pid: 220, process: 'chrome', name: 'Google Chrome', volume: 64, muted: true },
      ],
    })
    expect(sessions).toEqual([
      { id: 's1', process: 'Discord', name: 'Discord', volume: 42, muted: false, available: true },
      { id: 's2', process: 'chrome', name: 'Google Chrome', volume: 64, muted: true, available: true },
    ])
    expect(() => parseWindowsAudioSessions({})).toThrow(/no session list/)
  })

  it('normalizes process names and matches case, path and .exe', () => {
    expect(normalizeAppName('C:\\Program Files\\Discord\\Discord.exe')).toBe('discord')
    expect(normalizeAppName('/usr/lib/firefox/firefox')).toBe('firefox')
    expect(normalizeAppName(' Google Chrome ')).toBe('google chrome')
    expect(appMatchKey({ process: 'DISCORD.EXE' })).toBe('discord')

    const sessions: AppSession[] = [
      { id: '1', process: 'chrome', name: 'Google Chrome', volume: 40, muted: false },
      { id: '2', process: 'chrome', name: 'Chrome (media)', volume: 80, muted: true },
      { id: '3', process: 'discord', name: 'Discord', volume: 30, muted: false },
    ]
    expect(matchAppSessions(sessions, { process: 'chrome' })).toMatchObject({
      session: { id: '1' },
      count: 2,
      ambiguous: true,
    })
    expect(matchAppSessions(sessions, { process: 'C:\\Games\\Discord.exe' })).toMatchObject({
      session: { id: '3' },
      count: 1,
      ambiguous: false,
    })
    expect(matchAppSessions(sessions, { process: 'Google Chrome' })).toMatchObject({
      session: { id: '1' },
      count: 1,
    })
    expect(matchAppSessions(sessions, {})).toEqual({ session: null, count: 0, ambiguous: false })
  })
})

describe('platform backends', () => {
  it('reads and writes Linux sink inputs by pactl id', async () => {
    let inputVolume = 64
    let inputMuted = false
    const calls: string[][] = []
    const run: CommandRunner = async (_command, args) => {
      calls.push(args)
      if (args[0] === 'list') return ok(PACTL_SAMPLE)
      if (args[0] === 'set-sink-input-volume') {
        inputVolume = Number((args[2] ?? '0%').replace('%', ''))
        return ok()
      }
      if (args[0] === 'set-sink-input-mute') {
        inputMuted = args[2] === '1'
        return ok()
      }
      return { stdout: '', stderr: 'unexpected', code: 1 }
    }
    const backend = createLinuxAppVolumeBackend({ runCommand: run })
    const sessions = await backend.listSessions()
    expect(sessions[0]!.process).toBe('chrome')

    await backend.setVolume('42', 30)
    expect(calls.at(-1)).toEqual(['set-sink-input-volume', '42', '30%'])
    expect(inputVolume).toBe(30)

    await backend.setMute('42', true)
    expect(calls.at(-1)).toEqual(['set-sink-input-mute', '42', '1'])
    expect(inputMuted).toBe(true)
  })

  it('reports a clear pactl error when enumeration fails', async () => {
    const backend = createLinuxAppVolumeBackend({
      runCommand: async () => ({ stdout: '', stderr: 'no pulse', code: 1 }),
    })
    await expect(backend.listSessions()).rejects.toThrow(/Could not list per-app audio with pactl/)
  })

  it('reads and writes Windows sessions through the helper transport', async () => {
    const sessions = new Map<string, { process: string; name: string; volume: number; muted: boolean }>([
      ['s1', { process: 'discord', name: 'Discord', volume: 42, muted: false }],
    ])
    const calls: string[] = []
    const backend = createWindowsAppVolumeBackend({
      async listAudioSessions() {
        return {
          sessions: [...sessions.entries()].map(([id, session]) => ({
            id,
            process: session.process,
            name: session.name,
            volume: session.volume / 100,
            muted: session.muted,
          })),
        }
      },
      async setAppVolume(id, level) {
        calls.push(`volume:${id}:${level}`)
        const session = sessions.get(id)
        if (session) session.volume = level
      },
      async setAppMute(id, muted) {
        calls.push(`mute:${id}:${muted}`)
        const session = sessions.get(id)
        if (session) session.muted = muted
      },
    })

    await expect(backend.listSessions()).resolves.toMatchObject([{ id: 's1', volume: 42 }])
    await backend.setVolume('s1', 55.4)
    await backend.setMute('s1', true)
    expect(calls).toEqual(['volume:s1:55', 'mute:s1:true'])
  })

  it('creates a source only on Windows and Linux', () => {
    expect(createAppVolumeSource('darwin')).toBeNull()
    expect(createAppVolumeSource('win32')).toBeNull()
    expect(createAppVolumeSource('win32', {
      windowsTransport: {
        async listAudioSessions() {
          return { sessions: [] }
        },
        async setAppVolume() {},
        async setAppMute() {},
      },
    })).not.toBeNull()
    expect(createAppVolumeSource('linux', { isCommandAvailable: () => false })).toBeNull()
    expect(createAppVolumeSource('linux', {
      runCommand: async () => ok(''),
    })).not.toBeNull()
  })
})

describe('AppVolumeSource', () => {
  function source(
    backend: AppVolumeBackend,
    options: { ttlMs?: number; now?: () => number } = {},
  ): AppVolumeSource {
    return new AppVolumeSource(backend, options)
  }

  it('reads a matched session and reports ambiguity and missing sessions', async () => {
    const backend: AppVolumeBackend = {
      async listSessions() {
        return [
          { id: '1', process: 'chrome', name: 'Chrome', volume: 40, muted: false },
          { id: '2', process: 'chrome', name: 'Chrome media', volume: 80, muted: true },
        ]
      },
      async setVolume() {},
      async setMute() {},
    }
    const app = source(backend, { ttlMs: 0 })
    await expect(app.read({ process: 'chrome' })).resolves.toEqual({
      level: 40,
      muted: false,
      sessionId: '1',
      sessionCount: 2,
      ambiguous: true,
    })
    await expect(app.read({ process: 'spotify' })).rejects.toThrow(/No audio session matches/)
    await expect(app.read({})).rejects.toThrow(/No audio session matches/)

    await app.setVolumeById('missing', 20).catch(() => undefined)
    await expect(app.setVolumeById('missing', 20)).rejects.toThrow(/no longer available/)
  })

  it('caches, single-flights and invalidates enumeration', async () => {
    let now = 0
    let lists = 0
    const app = source(
      {
        async listSessions() {
          lists += 1
          return [{ id: '1', process: 'chrome', name: 'Chrome', volume: 40, muted: false }]
        },
        async setVolume() {},
        async setMute() {},
      },
      { ttlMs: 900, now: () => now },
    )

    const [first, second] = await Promise.all([app.listSessions(), app.listSessions()])
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(lists).toBe(1)

    now = 500
    await app.read({ process: 'chrome' })
    expect(lists).toBe(1)

    now = 1000
    await app.read({ process: 'chrome' })
    expect(lists).toBe(2)

    app.invalidate()
    await app.listSessions()
    expect(lists).toBe(3)
  })

  it('collapses rapid volume writes to the newest value', async () => {
    let releaseFirst: (() => void) | null = null
    const applied: number[] = []
    const backend: AppVolumeBackend = {
      async listSessions() {
        return [{ id: '1', process: 'discord', name: 'Discord', volume: 50, muted: false }]
      },
      async setVolume(_id, level) {
        applied.push(level)
        if (applied.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
      },
      async setMute() {},
    }
    const app = source(backend, { ttlMs: 0 })
    const first = app.setVolume({ process: 'discord' }, 10)
    const second = app.setVolume({ process: 'discord' }, 20)
    const third = app.setVolume({ process: 'discord' }, 30)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    releaseFirst!()
    await Promise.all([first, second, third])
    expect(applied).toEqual([10, 30])
  })

  it('coalesces mute writes and toggles from the live state', async () => {
    let muted = false
    const applied: boolean[] = []
    const backend: AppVolumeBackend = {
      async listSessions() {
        return [{ id: '1', process: 'discord', name: 'Discord', volume: 50, muted }]
      },
      async setVolume() {},
      async setMute(_id, value) {
        muted = value
        applied.push(value)
      },
    }
    const app = source(backend, { ttlMs: 0 })
    await app.setMute({ process: 'discord' }, true)
    await app.setMute({ process: 'discord' }, false)
    expect(applied).toEqual([true, false])

    await expect(app.toggleMute({ process: 'discord' })).resolves.toMatchObject({
      level: 50,
      muted: true,
    })
    expect(applied.at(-1)).toBe(true)
  })

  it('returns a mixer snapshot with ambiguous process groups', async () => {
    const app = source({
      async listSessions() {
        return [
          { id: '1', process: 'chrome', name: 'Chrome', volume: 40, muted: false },
          { id: '2', process: 'chrome', name: 'Chrome media', volume: 80, muted: true },
          { id: '3', process: 'discord', name: 'Discord', volume: 30, muted: false },
        ]
      },
      async setVolume() {},
      async setMute() {},
    })
    const snapshot = await app.snapshot()
    expect(snapshot.available).toBe(true)
    expect(snapshot.ambiguous).toEqual(['chrome'])
    expect(snapshot.sessions).toEqual([
      { id: '1', process: 'chrome', name: 'Chrome', volume: 40, muted: false, available: true },
      { id: '2', process: 'chrome', name: 'Chrome media', volume: 80, muted: true, available: true },
      { id: '3', process: 'discord', name: 'Discord', volume: 30, muted: false, available: true },
    ])
    expect(snapshot.updatedAt).toBeTypeOf('number')
  })

  it('reports an unavailable mixer instead of throwing', async () => {
    const app = source({
      async listSessions() {
        throw new Error('helper missing')
      },
      async setVolume() {},
      async setMute() {},
    })
    await expect(app.snapshot()).resolves.toMatchObject({
      available: false,
      sessions: [],
      reason: 'helper missing',
    })
  })
})

describe('Windows helper Core Audio sessions', () => {
  it('declares IAudioSessionManager2, the enumerator and session vtables', () => {
    const path = fileURLToPath(new URL('../resources/keyboard-helper.ps1', import.meta.url))
    const script = readFileSync(path, 'utf8')

    for (const fragment of [
      'IAudioSessionManager2',
      'IAudioSessionEnumerator',
      'IAudioSessionControl2',
      'ISimpleAudioVolume',
      'GetSessionEnumerator',
      'GetSession(',
      'GetProcessId',
      'GetSessionInstanceIdentifier',
      'list-audio-sessions',
      'set-app-volume',
      'set-app-mute',
    ]) {
      expect(script, `missing ${fragment}`).toContain(fragment)
    }

    const control2Methods = [
      'GetState(',
      'GetDisplayName(',
      'SetDisplayName(',
      'GetIconPath(',
      'SetIconPath(',
      'GetGroupingParam(',
      'SetGroupingParam(',
      'RegisterAudioSessionNotification(',
      'UnregisterAudioSessionNotification(',
      'GetSessionIdentifier(',
      'GetSessionInstanceIdentifier(',
      'GetProcessId(',
      'IsSystemSoundsSession(',
      'SetDuckingPreference(',
    ]
    let last = -1
    for (const method of control2Methods) {
      const index = script.indexOf(method, last + 1)
      expect(index, `${method} is missing or out of vtable order`).toBeGreaterThan(last)
      last = index
    }
  })
})
