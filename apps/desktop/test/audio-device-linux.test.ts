import { describe, expect, it } from 'vitest'
import {
  CachedAudioDeviceController,
  LinuxAudioDeviceBackend,
  createAudioDeviceController,
  linuxAudioDeviceId,
  parsePactlDeviceJson,
  parsePactlInfo,
  parsePactlShortDevices,
} from '../src/main/audio-device-source'
import type { CommandResult, CommandRunner } from '../src/main/volume-source'

const sinkName = 'alsa_output.pci-0000_00_1f.3.analog-stereo'
const sourceName = 'alsa_input.usb-Shure_MV7-00.mono-fallback'
const headsetName = 'bluez_output.00_11_22_33_44_55.1'

const sinkJson = JSON.stringify([
  {
    name: sinkName,
    description: 'Built-in Audio Analog Stereo',
    state: 'RUNNING',
  },
  {
    name: headsetName,
    description: 'WH-1000XM4',
    state: 'SUSPENDED',
  },
])
const sourceJson = JSON.stringify([
  {
    name: sourceName,
    description: 'Shure MV7 Mono',
    state: 'IDLE',
  },
])

interface FakePactl {
  run: CommandRunner
  calls: string[][]
  set currentSink(value: string)
  set currentSource(value: string)
}

function fakePactl(): FakePactl {
  let currentSink = sinkName
  let currentSource = sourceName
  const calls: string[][] = []
  const run: CommandRunner = async (command, args): Promise<CommandResult> => {
    calls.push([command, ...args])
    const key = args.join(' ')
    if (key === 'info') {
      return {
        stdout: `Server Name: PulseAudio\nDefault Sink: ${currentSink}\nDefault Source: ${currentSource}\n`,
        stderr: '',
        code: 0,
      }
    }
    if (key === '-f json list sinks') return { stdout: sinkJson, stderr: '', code: 0 }
    if (key === '-f json list sources') return { stdout: sourceJson, stderr: '', code: 0 }
    if (key === 'list short sinks') {
      return {
        stdout: `0\t${sinkName}\tmodule-alsa-card.c\ts16le 2ch 48000Hz\tRUNNING\n`,
        stderr: '',
        code: 0,
      }
    }
    if (key === 'list short sources') {
      return {
        stdout: `1\t${sourceName}\tmodule-alsa-card.c\ts16le 1ch 48000Hz\tIDLE\n`,
        stderr: '',
        code: 0,
      }
    }
    if (key === `set-default-sink ${headsetName}`) {
      currentSink = headsetName
      return { stdout: '', stderr: '', code: 0 }
    }
    if (key === `set-default-source ${sourceName}`) {
      currentSource = sourceName
      return { stdout: '', stderr: '', code: 0 }
    }
    return { stdout: '', stderr: `unexpected pactl ${key}`, code: 1 }
  }
  return {
    run,
    calls,
    set currentSink(value: string) {
      currentSink = value
    },
    set currentSource(value: string) {
      currentSource = value
    },
  }
}

describe('Linux pactl parsing', () => {
  it('reads defaults and tolerates missing defaults', () => {
    expect(parsePactlInfo('Default Sink: speakers\nDefault Source: mic\n')).toEqual({
      sink: 'speakers',
      source: 'mic',
    })
    expect(parsePactlInfo('Server Name: PulseAudio\n')).toEqual({})
  })

  it('parses JSON and short device lists', () => {
    expect(parsePactlDeviceJson(sinkJson)).toEqual([
      { name: sinkName, description: 'Built-in Audio Analog Stereo', state: 'RUNNING' },
      { name: headsetName, description: 'WH-1000XM4', state: 'SUSPENDED' },
    ])
    expect(parsePactlShortDevices(`0\t${sinkName}\tdriver\tspec\tRUNNING\r\n`)).toEqual([
      { name: sinkName, state: 'RUNNING' },
    ])
    expect(() => parsePactlDeviceJson('{}')).toThrow()
  })

  it('uses an opaque stable id', () => {
    const id = linuxAudioDeviceId(sinkName)
    expect(id).toMatch(/^[a-f0-9]{16}$/)
    expect(linuxAudioDeviceId(sinkName)).toBe(id)
    expect(linuxAudioDeviceId(sourceName)).not.toBe(id)
  })
})

describe('LinuxAudioDeviceBackend', () => {
  it('lists outputs/inputs with forms and the current defaults', async () => {
    const fake = fakePactl()
    const backend = new LinuxAudioDeviceBackend({ runCommand: fake.run })
    const snapshot = await backend.list()

    expect(snapshot.output).toHaveLength(2)
    expect(snapshot.input).toHaveLength(1)
    expect(snapshot.currentOutputId).toBe(linuxAudioDeviceId(sinkName))
    expect(snapshot.currentInputId).toBe(linuxAudioDeviceId(sourceName))
    expect(snapshot.output[0]).toMatchObject({
      id: linuxAudioDeviceId(sinkName),
      name: 'Built-in Audio Analog Stereo',
      deviceKind: 'output',
      form: 'speakers',
      current: true,
      available: true,
    })
    expect(snapshot.output[1]).toMatchObject({ form: 'bluetooth', current: false })
    expect(snapshot.input[0]).toMatchObject({ name: 'Shure MV7 Mono', form: 'usb' })
  })

  it('falls back to short lists when JSON is unavailable', async () => {
    const fake = fakePactl()
    const run: CommandRunner = async (command, args) => {
      if (args.join(' ') === '-f json list sinks') {
        return { stdout: '', stderr: 'invalid option', code: 1 }
      }
      if (args.join(' ') === '-f json list sources') {
        return { stdout: '', stderr: 'invalid option', code: 1 }
      }
      return fake.run(command, args)
    }
    const backend = new LinuxAudioDeviceBackend({ runCommand: run })
    const snapshot = await backend.list()
    expect(snapshot.output[0]?.name).toBe(sinkName)
    expect(snapshot.input[0]?.name).toBe(sourceName)
  })

  it('sets the default sink and returns the new current device', async () => {
    const fake = fakePactl()
    const backend = new LinuxAudioDeviceBackend({ runCommand: fake.run })
    await backend.list()

    const next = await backend.setDefault('output', linuxAudioDeviceId(headsetName), true)
    expect(next).toMatchObject({
      id: linuxAudioDeviceId(headsetName),
      name: 'WH-1000XM4',
      current: true,
    })
    expect(fake.calls).toContainEqual(['pactl', 'set-default-sink', headsetName])
  })

  it('refreshes before resolving an unknown id and rejects it clearly', async () => {
    const fake = fakePactl()
    const backend = new LinuxAudioDeviceBackend({ runCommand: fake.run })
    await expect(backend.setDefault('output', 'deadbeefdeadbeef', false)).rejects.toThrow(
      'Unknown output device',
    )
    await expect(backend.setDefault('input', linuxAudioDeviceId('missing'), false)).rejects.toThrow(
      'Unknown input device',
    )
  })
})

describe('Linux platform wiring', () => {
  it('builds a Linux controller when a backend is supplied', () => {
    const fake = fakePactl()
    const backend = new LinuxAudioDeviceBackend({ runCommand: fake.run })
    expect(createAudioDeviceController('linux', { backend })).toBeInstanceOf(
      CachedAudioDeviceController,
    )
    expect(createAudioDeviceController('darwin', { backend })).toBeInstanceOf(
      CachedAudioDeviceController,
    )
  })
})
