import { describe, expect, it } from 'vitest'
import {
  CachedMediaReader,
  MAC_MEDIA_COMMAND,
  formatMediaDetail,
  formatMediaTime,
  linuxMediaReadArgs,
  linuxMediaSeekArgs,
  macMediaReadArgs,
  macMediaSeekArgs,
  mediaSeekTargetMs,
  parseMacMediaOutput,
  parsePlayerctlOutput,
  parseWindowsMediaPayload,
  createMediaController,
  WINDOWS_MEDIA_HELPER_SCRIPT,
  type MediaBackend,
} from '../src/main/media-source'
import type { CommandResult, CommandRunner } from '../src/main/volume-source'

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', code: 0 }
}

function fail(stderr: string): CommandResult {
  return { stdout: '', stderr, code: 1 }
}

describe('playerctl media parsing', () => {
  it('parses status, position, duration, title and artist', () => {
    const sample = 'Playing\t83456000\t213000000\tSong title\tArtist name\n'
    expect(parsePlayerctlOutput(sample)).toEqual({
      playing: true,
      positionMs: 83_456,
      durationMs: 213_000,
      title: 'Song title',
      artist: 'Artist name',
    })
    expect(parsePlayerctlOutput('Paused\t0\t0\tLive stream\t')).toEqual({
      playing: false,
      positionMs: 0,
      durationMs: 0,
      title: 'Live stream',
    })
  })

  it('treats no/stopped players as no session and rejects malformed positions', () => {
    expect(parsePlayerctlOutput('')).toBeNull()
    expect(parsePlayerctlOutput('No players found')).toBeNull()
    expect(parsePlayerctlOutput('Stopped\t1\t2\tSong\tArtist')).toBeNull()
    expect(() => parsePlayerctlOutput('Playing\tnope\t1000\tSong\tArtist')).toThrow(/playerctl position/)
    expect(() => parsePlayerctlOutput('Playing')).toThrow(/parse playerctl/)
  })

  it('builds read and seek commands in the expected units', () => {
    expect(linuxMediaReadArgs()[0]).toBe('metadata')
    expect(linuxMediaReadArgs()[1]).toBe('--format')
    expect(linuxMediaReadArgs()[2]).toContain('{{mpris:length}}')
    expect(linuxMediaSeekArgs(106_500)).toEqual(['position', '106.500'])
    expect(linuxMediaSeekArgs(-5)).toEqual(['position', '0.000'])
  })
})

describe('macOS media parsing', () => {
  it('parses Spotify seconds/ms and Music seconds/seconds', () => {
    expect(parseMacMediaOutput('83.5\t225000\tplaying\tSong\tArtist\n', 'spotify')).toEqual({
      playing: true,
      positionMs: 83_500,
      durationMs: 225_000,
      title: 'Song',
      artist: 'Artist',
    })
    expect(parseMacMediaOutput('83.5\t225.4\tpaused\tSong\tArtist', 'music')).toMatchObject({
      playing: false,
      positionMs: 83_500,
      durationMs: 225_400,
    })
  })

  it('returns null when nothing is playing and rejects bad output', () => {
    expect(parseMacMediaOutput('', 'spotify')).toBeNull()
    expect(parseMacMediaOutput('missing value', 'music')).toBeNull()
    expect(parseMacMediaOutput('0\t100\tstopped\tSong\tArtist', 'music')).toBeNull()
    expect(() => parseMacMediaOutput('nope\t100\tplaying\tSong\tArtist', 'music')).toThrow(
      /player position/,
    )
    expect(() => parseMacMediaOutput('1', 'music')).toThrow(/parse music/)
  })

  it('builds Spotify and Music seek commands in seconds', () => {
    expect(macMediaSeekArgs('spotify', 106_500)).toEqual([
      '-e',
      'tell application "Spotify" to set player position to 106.500',
    ])
    expect(macMediaSeekArgs('music', 106_500)[1]).toContain('application "Music"')
    expect(macMediaReadArgs('spotify')[1]).toContain('application "Spotify" is running')
  })
})

describe('Windows SMTC payload and seek math', () => {
  it('parses and clamps the probe payload', () => {
    expect(
      parseWindowsMediaPayload({
        positionMs: 84_000,
        durationMs: 213_000,
        playing: true,
        title: ' Song ',
        artist: 'Artist',
      }),
    ).toEqual({
      positionMs: 84_000,
      durationMs: 213_000,
      playing: true,
      title: 'Song',
      artist: 'Artist',
    })
    expect(parseWindowsMediaPayload(null)).toBeNull()
    expect(parseWindowsMediaPayload({ positionMs: 500_000, durationMs: 213_000 })).toMatchObject({
      positionMs: 213_000,
    })
    expect(() => parseWindowsMediaPayload({ positionMs: 1 })).toThrow(/no position/)
  })

  it('maps a normalized value to a clamped position', () => {
    expect(mediaSeekTargetMs(0.42, 213_000)).toBe(89_460)
    expect(mediaSeekTargetMs(-1, 213_000)).toBe(0)
    expect(mediaSeekTargetMs(2, 213_000)).toBe(213_000)
    expect(() => mediaSeekTargetMs(0.5, 0)).toThrow(/not supported/)
    expect(() => mediaSeekTargetMs(Number.NaN, 1000)).toThrow(/finite/)
  })

  it('ships a persistent SMTC helper with the expected WinRT calls', () => {
    expect(WINDOWS_MEDIA_HELPER_SCRIPT).toContain(
      'GlobalSystemMediaTransportControlsSessionManager',
    )
    expect(WINDOWS_MEDIA_HELPER_SCRIPT).toContain('TryChangePlaybackPositionAsync')
    expect(WINDOWS_MEDIA_HELPER_SCRIPT).toContain('TryGetMediaPropertiesAsync')
    expect(WINDOWS_MEDIA_HELPER_SCRIPT).toContain('ready = $true')
    // A JS template interpolation would corrupt the PowerShell script.
    expect(WINDOWS_MEDIA_HELPER_SCRIPT).not.toContain('${')
  })
})

describe('CachedMediaReader', () => {
  function backend(overrides: Partial<MediaBackend> = {}): MediaBackend & {
    reads: number
    seeks: number[]
  } {
    const state = {
      reads: 0,
      seeks: [] as number[],
      async read() {
        state.reads += 1
        return { positionMs: 20_000, durationMs: 200_000, playing: true, title: 'Song' }
      },
      async seekMs(positionMs: number) {
        state.seeks.push(positionMs)
      },
      ...overrides,
    }
    return state
  }

  it('caches, single-flights and accepts a known seek target', async () => {
    let reads = 0
    let release: (() => void) | null = null
    const reader = new CachedMediaReader(
      {
        read: async () => {
          reads += 1
          if (reads > 1) return { positionMs: 99_000, durationMs: 200_000, playing: true }
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return { positionMs: 20_000, durationMs: 200_000, playing: true }
        },
      },
      { ttlMs: 900, now: () => 1000 },
    )

    const first = reader.read()
    const second = reader.read()
    expect(reads).toBe(1)
    release!()
    await expect(first).resolves.toMatchObject({ positionMs: 20_000 })
    await expect(second).resolves.toMatchObject({ positionMs: 20_000 })

    reader.setKnown({ positionMs: 50_000, durationMs: 200_000, playing: true })
    await expect(reader.read()).resolves.toMatchObject({ positionMs: 50_000 })
    expect(reads).toBe(1)
  })

  it('seeks by fraction, clamps, and returns the applied position', async () => {
    const source = backend()
    const reader = new CachedMediaReader(source, { ttlMs: 900, now: () => 1000 })

    await expect(reader.seekFraction(0.5)).resolves.toBe(100_000)
    expect(source.seeks).toEqual([100_000])
    await expect(reader.seekFraction(2)).resolves.toBe(200_000)
    expect(source.seeks).toEqual([100_000, 200_000])
    // The optimistic target is what state reads until the player is polled.
    await expect(reader.read()).resolves.toMatchObject({ positionMs: 200_000 })
  })

  it('reports no player and unsupported seek instead of pretending', async () => {
    const none = new CachedMediaReader({ read: async () => null }, { ttlMs: 0 })
    await expect(none.read()).resolves.toBeNull()
    await expect(none.seekFraction(0.5)).rejects.toThrow(/No active media player/)

    const live = backend({
      read: async () => ({ positionMs: 1000, durationMs: 0, playing: true }),
    })
    const reader = new CachedMediaReader(live, { ttlMs: 0 })
    await expect(reader.seekFraction(0.5)).rejects.toThrow(/not supported/)

    const noSeek = new CachedMediaReader(
      {
        read: async () => ({ positionMs: 1000, durationMs: 2000, playing: true }),
      },
      { ttlMs: 0 },
    )
    await expect(noSeek.seekFraction(0.5)).rejects.toThrow(/not supported/)
  })

  it('drops the optimistic cache when the backend rejects a seek', async () => {
    const reader = new CachedMediaReader(
      {
        read: async () => ({ positionMs: 1000, durationMs: 10_000, playing: true }),
        seekMs: async () => {
          throw new Error('seek rejected')
        },
      },
      { ttlMs: 900, now: () => 1000 },
    )
    await expect(reader.seekMs(5000)).rejects.toThrow(/seek rejected/)
    await expect(reader.read()).resolves.toMatchObject({ positionMs: 1000 })
  })
})

describe('createMediaController', () => {
  it('reads and seeks through playerctl', async () => {
    const calls: string[][] = []
    const run: CommandRunner = async (_command, args) => {
      calls.push(args)
      if (args[0] === 'metadata') {
        return ok('Playing\t1000000\t200000000\tSong\tArtist\n')
      }
      if (args[0] === 'position') return ok()
      return fail('unexpected')
    }
    const source = createMediaController('linux', { runCommand: run, ttlMs: 0 })
    expect(source).not.toBeNull()
    await expect(source!.read()).resolves.toMatchObject({ positionMs: 1000, durationMs: 200_000 })
    await expect(source!.seekFraction(0.25)).resolves.toBe(50_000)
    expect(calls.at(-1)).toEqual(['position', '50.000'])
  })

  it('returns no session for a missing player and reports command errors', async () => {
    const noPlayer = createMediaController('linux', {
      runCommand: async () => fail('No players found'),
      ttlMs: 0,
    })
    await expect(noPlayer!.read()).resolves.toBeNull()

    const broken = createMediaController('linux', {
      runCommand: async () => fail('playerctl: command not found'),
      ttlMs: 0,
    })
    await expect(broken!.read()).rejects.toThrow(/Could not read media state/)
  })

  it('prefers Spotify then Music on macOS and seeks the active player', async () => {
    const calls: string[][] = []
    const run: CommandRunner = async (_command, args) => {
      calls.push(args)
      const script = args[1] ?? ''
      if (script.includes('application "Spotify" is running')) return ok('')
      if (script.includes('application "Music" is running')) {
        return ok('60\t180\tplaying\tSong\tArtist')
      }
      if (script.includes('set player position')) return ok()
      return fail(`unexpected ${script}`)
    }
    const source = createMediaController('darwin', { runCommand: run, ttlMs: 0 })
    await expect(source!.read()).resolves.toMatchObject({
      positionMs: 60_000,
      durationMs: 180_000,
      playing: true,
    })
    await expect(source!.seekFraction(0.5)).resolves.toBe(90_000)
    expect(calls.at(-1)?.[1]).toContain('application "Music"')
    expect(calls.at(-1)?.[1]).toContain('set player position to 90.000')
  })

  it('returns null for an unsupported platform or missing Windows probe', () => {
    expect(createMediaController('freebsd')).toBeNull()
    expect(createMediaController('win32')).toBeNull()
    expect(MAC_MEDIA_COMMAND).toBe('/usr/bin/osascript')
  })
})

describe('media time formatting', () => {
  it('formats elapsed and total times', () => {
    expect(formatMediaTime(0)).toBe('0:00')
    expect(formatMediaTime(83_000)).toBe('1:23')
    expect(formatMediaTime(3_723_000)).toBe('1:02:03')
    expect(formatMediaDetail(83_000, 225_000)).toBe('1:23 / 3:45')
    expect(formatMediaDetail(83_000, 0)).toBe('1:23')
  })
})
