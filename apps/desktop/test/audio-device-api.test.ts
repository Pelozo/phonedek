import { describe, expect, it } from 'vitest'
import { IPC, parseAudioDeviceSetInput } from '../src/shared/api'
import {
  audioDeviceUnsupportedReason,
  createAudioDeviceController,
} from '../src/main/audio-device-source'

describe('audio device API validation', () => {
  it('accepts only an output/input kind and an opaque host id', () => {
    expect(parseAudioDeviceSetInput('output', 'a1b2c3d4e5f6')).toEqual({
      kind: 'output',
      id: 'a1b2c3d4e5f6',
    })
    expect(parseAudioDeviceSetInput('input', ' 9f8e7d6c5b4a ')).toEqual({
      kind: 'input',
      id: '9f8e7d6c5b4a',
    })
  })

  it('rejects unknown kinds, names, paths and short/overlong ids', () => {
    expect(parseAudioDeviceSetInput('speaker', 'a1b2c3d4e5f6')).toBeNull()
    expect(parseAudioDeviceSetInput('output', 'Headphones (HyperX)')).toBeNull()
    expect(parseAudioDeviceSetInput('output', '\\\\?\\SWD\\MMDEVAPI\\{0.0.0.1}')).toBeNull()
    expect(parseAudioDeviceSetInput('output', 'abc')).toBeNull()
    expect(parseAudioDeviceSetInput('output', 'a'.repeat(65))).toBeNull()
    expect(parseAudioDeviceSetInput('output', '../a1b2c3d4e5f6')).toBeNull()
    expect(parseAudioDeviceSetInput('output', undefined)).toBeNull()
    expect(parseAudioDeviceSetInput('output', 42)).toBeNull()
  })

  it('exposes dedicated IPC channels instead of overloading mixer ones', () => {
    expect(IPC.getAudioDevices).toBe('phonedek:audio-devices-get')
    expect(IPC.setAudioDevice).toBe('phonedek:audio-devices-set')
    expect(IPC.getAudioDevices).not.toBe(IPC.getMixerSnapshot)
    expect(IPC.setAudioDevice).not.toBe(IPC.setMixerVolume)
    expect(Object.values(IPC).filter((value) => value === IPC.getAudioDevices)).toHaveLength(1)
    expect(Object.values(IPC).filter((value) => value === IPC.setAudioDevice)).toHaveLength(1)
  })
})

describe('audio device unsupported hosts', () => {
  it('reports a reason and builds no controller outside Windows', () => {
    expect(audioDeviceUnsupportedReason('linux')).toContain('Windows')
    expect(audioDeviceUnsupportedReason('darwin')).toContain('Windows')
    expect(audioDeviceUnsupportedReason('win32')).toBeNull()

    expect(createAudioDeviceController('linux')).toBeNull()
    expect(createAudioDeviceController('darwin')).toBeNull()
  })
})
