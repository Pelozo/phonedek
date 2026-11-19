import { describe, expect, it } from 'vitest'
import type { AudioDeviceKind, AudioDeviceRef } from '@phonedek/shared'
import {
  AUDIO_DEVICE_CURRENT_TIMEOUT_MS,
  AUDIO_DEVICE_CURRENT_TTL_MS,
  AUDIO_DEVICE_LIST_TIMEOUT_MS,
  AUDIO_DEVICE_LIST_TTL_MS,
  CachedAudioDeviceController,
  WindowsAudioDeviceBackend,
  audioDeviceUnsupportedReason,
  createAudioDeviceController,
  normalizeDeviceName,
  parseAudioDeviceListPayload,
  sanitizeAudioDeviceName,
  type AudioDeviceBackend,
  type AudioDeviceEntry,
  type AudioDeviceTransport,
} from '../src/main/audio-device-source'

function entry(
  id: string,
  name: string,
  kind: AudioDeviceKind,
  extra: Partial<AudioDeviceEntry> = {},
): AudioDeviceEntry {
  return {
    id,
    name,
    deviceKind: kind,
    current: false,
    available: true,
    ...extra,
  }
}

const headphones = entry('aaaaaaaaaaaaaaaa', 'Headphones (HyperX Cloud II)', 'output', {
  form: 'headphones',
})
const speakers = entry('bbbbbbbbbbbbbbbb', 'Speakers (Realtek(R) Audio)', 'output', {
  form: 'speakers',
})
const hdmi = entry('cccccccccccccccc', 'HDMI (NVIDIA High Definition Audio)', 'output', {
  form: 'hdmi',
})
const usbMic = entry('dddddddddddddddd', 'Shure MV7', 'input', { form: 'usb' })

class FakeBackend implements AudioDeviceBackend {
  output: AudioDeviceEntry[] = [headphones, speakers]
  input: AudioDeviceEntry[] = [usbMic]
  currentOutputId: string | undefined = headphones.id
  currentInputId: string | undefined = usbMic.id
  listCalls = 0
  currentCalls: AudioDeviceKind[] = []
  setCalls: Array<{ kind: AudioDeviceKind; id: string; allRoles: boolean }> = []
  failList: Error | null = null
  failCurrent: Error | null = null
  failSet: Error | null = null
  gate: Promise<void> | null = null
  disposed = false
  listGate: Promise<void> | null = null

  async list() {
    this.listCalls += 1
    if (this.listGate) await this.listGate
    if (this.failList) throw this.failList
    return {
      output: this.output.map((item) => ({ ...item })),
      input: this.input.map((item) => ({ ...item })),
      ...(this.currentOutputId ? { currentOutputId: this.currentOutputId } : {}),
      ...(this.currentInputId ? { currentInputId: this.currentInputId } : {}),
    }
  }

  async current(kind: AudioDeviceKind) {
    this.currentCalls.push(kind)
    if (this.failCurrent) throw this.failCurrent
    const id = kind === 'output' ? this.currentOutputId : this.currentInputId
    const found = (kind === 'output' ? this.output : this.input).find((item) => item.id === id)
    if (!found) throw new Error(`No default ${kind} device is active.`)
    return { ...found, deviceKind: kind, current: true }
  }

  async setDefault(kind: AudioDeviceKind, id: string, allRoles: boolean) {
    this.setCalls.push({ kind, id, allRoles })
    if (this.gate) await this.gate
    if (this.failSet) throw this.failSet
    const found = (kind === 'output' ? this.output : this.input).find((item) => item.id === id)
    if (!found) throw new Error(`Device not found: ${id}`)
    if (kind === 'output') this.currentOutputId = id
    else this.currentInputId = id
    return { ...found, deviceKind: kind, current: true }
  }

  dispose() {
    this.disposed = true
  }
}

class FakeTransport implements AudioDeviceTransport {
  requests: Array<{ payload: Record<string, unknown>; timeoutMs: number }> = []
  response: unknown = { ok: true, output: [], input: [] }
  disposed = false

  async request(payload: Record<string, unknown>, timeoutMs: number) {
    this.requests.push({ payload, timeoutMs })
    return this.response
  }

  dispose() {
    this.disposed = true
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('audio device parsing and sanitizing', () => {
  it('sanitizes control characters and clamps names', () => {
    expect(sanitizeAudioDeviceName('  HyperX\n\tCloud   II  ')).toBe('HyperX Cloud II')
    expect(sanitizeAudioDeviceName('x'.repeat(140))).toHaveLength(120)
    expect(sanitizeAudioDeviceName(undefined)).toBe('')
  })

  it('normalizes names with NFKC, whitespace and case', () => {
    expect(normalizeDeviceName('  Ｈeadphones\u00a0(HyperX)  ')).toBe('headphones (hyperx)')
    expect(normalizeDeviceName(undefined)).toBe('')
  })

  it('parses list payloads, drops invalid ids and derives current ids', () => {
    const snapshot = parseAudioDeviceListPayload(
      {
        ok: true,
        output: [
          {
            id: 'aaaaaaaaaaaaaaaa',
            name: 'Headphones\n(HyperX)',
            form: 'headphones',
          },
          { id: 'not a hash', name: 'Bad' },
          { id: 'cccccccccccccccc', name: 'HDMI', form: 'nonsense' },
        ],
        input: [{ id: 'dddddddddddddddd', name: 'Shure MV7', form: 'usb', current: true }],
        currentOutputId: 'aaaaaaaaaaaaaaaa',
      },
      1234,
    )

    expect(snapshot.available).toBe(true)
    expect(snapshot.updatedAt).toBe(1234)
    expect(snapshot.output).toHaveLength(2)
    expect(snapshot.output[0]).toMatchObject({
      id: 'aaaaaaaaaaaaaaaa',
      name: 'Headphones (HyperX)',
      deviceKind: 'output',
      form: 'headphones',
      current: true,
      available: true,
    })
    expect(snapshot.output[1]?.form).toBeUndefined()
    expect(snapshot.currentOutputId).toBe('aaaaaaaaaaaaaaaa')
    expect(snapshot.currentInputId).toBe('dddddddddddddddd')
  })

  it('accepts a single object for an array field on old PowerShell builds', () => {
    const snapshot = parseAudioDeviceListPayload(
      {
        ok: true,
        output: { id: 'aaaaaaaaaaaaaaaa', name: 'Speakers', current: true },
        input: [],
      },
      1,
    )
    expect(snapshot.output).toHaveLength(1)
    expect(snapshot.output[0]?.name).toBe('Speakers')
  })

  it('rejects helper errors and malformed list responses loudly', () => {
    expect(() =>
      parseAudioDeviceListPayload({ ok: false, error: 'Core Audio failed' }, 1),
    ).toThrow('Core Audio failed')
    expect(() => parseAudioDeviceListPayload({ ok: true }, 1)).toThrow(
      'returned no device lists',
    )
    expect(() => parseAudioDeviceListPayload('nope', 1)).toThrow('invalid response')
  })
})

describe('WindowsAudioDeviceBackend', () => {
  it('sends the documented commands and parses responses', async () => {
    const transport = new FakeTransport()
    const backend = new WindowsAudioDeviceBackend({
      helperPath: '/unused',
      transport,
    })

    transport.response = {
      ok: true,
      output: [{ id: 'aaaaaaaaaaaaaaaa', name: 'Speakers', current: true }],
      input: [],
      currentOutputId: 'aaaaaaaaaaaaaaaa',
    }
    await expect(backend.list()).resolves.toMatchObject({
      currentOutputId: 'aaaaaaaaaaaaaaaa',
    })
    expect(transport.requests[0]).toEqual({
      payload: { command: 'list' },
      timeoutMs: AUDIO_DEVICE_LIST_TIMEOUT_MS,
    })

    transport.response = {
      ok: true,
      kind: 'input',
      device: { id: 'dddddddddddddddd', name: 'Shure MV7' },
    }
    await expect(backend.current('input')).resolves.toMatchObject({
      id: 'dddddddddddddddd',
      deviceKind: 'input',
    })
    expect(transport.requests[1]).toEqual({
      payload: { command: 'default', kind: 'input' },
      timeoutMs: AUDIO_DEVICE_CURRENT_TIMEOUT_MS,
    })

    transport.response = {
      ok: true,
      kind: 'output',
      device: { id: 'bbbbbbbbbbbbbbbb', name: 'Speakers (Realtek(R) Audio)' },
    }
    await expect(backend.setDefault('output', 'bbbbbbbbbbbbbbbb', false)).resolves.toMatchObject({
      id: 'bbbbbbbbbbbbbbbb',
      current: true,
    })
    expect(transport.requests[2]).toEqual({
      payload: {
        command: 'set',
        kind: 'output',
        deviceId: 'bbbbbbbbbbbbbbbb',
        allRoles: false,
      },
      timeoutMs: AUDIO_DEVICE_LIST_TIMEOUT_MS,
    })
  })

  it('turns helper JSON errors into clear errors', async () => {
    const transport = new FakeTransport()
    const backend = new WindowsAudioDeviceBackend({ helperPath: '/unused', transport })

    transport.response = { ok: false, error: 'Device not found: nope' }
    await expect(backend.list()).rejects.toThrow('Device not found: nope')

    transport.response = { ok: false, error: 'No default output device is active.' }
    await expect(backend.current('output')).rejects.toThrow('No default output device is active.')

    transport.response = { ok: false, error: 'Windows did not switch the default output device.' }
    await expect(backend.setDefault('output', 'aaaaaaaaaaaaaaaa', true)).rejects.toThrow(
      'Windows did not switch the default output device.',
    )

    transport.response = { ok: true, output: [] }
    await expect(backend.current('output')).rejects.toThrow('returned no device')
  })

  it('disposes the transport', () => {
    const transport = new FakeTransport()
    const backend = new WindowsAudioDeviceBackend({ helperPath: '/unused', transport })
    backend.dispose()
    backend.dispose()
    expect(transport.disposed).toBe(true)
  })
})

describe('CachedAudioDeviceController', () => {
  function makeController(backend = new FakeBackend()) {
    let now = 1000
    const controller = new CachedAudioDeviceController(backend, {
      now: () => now,
      listTtlMs: AUDIO_DEVICE_LIST_TTL_MS,
      currentTtlMs: AUDIO_DEVICE_CURRENT_TTL_MS,
    })
    return {
      backend,
      controller,
      advance(ms: number) {
        now += ms
      },
    }
  }

  it('caches lists for the TTL and supports force', async () => {
    const { backend, controller, advance } = makeController()
    await controller.list()
    await controller.list()
    expect(backend.listCalls).toBe(1)

    advance(AUDIO_DEVICE_LIST_TTL_MS - 1)
    await controller.list()
    expect(backend.listCalls).toBe(1)

    advance(2)
    await controller.list()
    expect(backend.listCalls).toBe(2)

    await controller.list({ force: true })
    expect(backend.listCalls).toBe(3)
  })

  it('single-flights list and current reads', async () => {
    const backend = new FakeBackend()
    let releaseList: (() => void) | undefined
    backend.listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    const { controller, advance } = makeController(backend)

    const first = controller.list()
    const second = controller.list()
    await flush()
    expect(backend.listCalls).toBe(1)
    releaseList?.()
    await expect(first).resolves.toMatchObject({ available: true })
    await expect(second).resolves.toMatchObject({ available: true })

    // The list seeds the current cache; expire it before testing single-flight.
    advance(AUDIO_DEVICE_CURRENT_TTL_MS + 1)
    const currentA = controller.current('output')
    const currentB = controller.current('output')
    await expect(currentA).resolves.toMatchObject({ id: headphones.id })
    await expect(currentB).resolves.toMatchObject({ id: headphones.id })
    expect(backend.currentCalls).toEqual(['output'])
  })

  it('caches current readings for 900 ms per kind', async () => {
    const { backend, controller, advance } = makeController()
    await controller.current('output')
    await controller.current('output')
    expect(backend.currentCalls).toEqual(['output'])

    advance(AUDIO_DEVICE_CURRENT_TTL_MS + 1)
    await controller.current('output')
    expect(backend.currentCalls).toEqual(['output', 'output'])

    await controller.current('input')
    expect(backend.currentCalls).toEqual(['output', 'output', 'input'])
  })

  it('reports a missing helper as an unavailable snapshot with a reason', async () => {
    const backend = new FakeBackend()
    backend.failList = new Error('Audio device helper not found at C:\\x.ps1')
    const { controller } = makeController(backend)

    await expect(controller.list()).resolves.toMatchObject({
      available: false,
      reason: 'Audio device helper not found at C:\\x.ps1',
      output: [],
      input: [],
    })
    await expect(controller.setDefault('output', headphones)).rejects.toThrow(
      'Audio device helper not found',
    )
  })

  it('resolves a ref by id first, then by normalized name', async () => {
    const { backend, controller } = makeController()

    await expect(controller.setDefault('output', { id: speakers.id })).resolves.toMatchObject({
      id: speakers.id,
      current: true,
    })
    expect(backend.setCalls).toEqual([
      { kind: 'output', id: speakers.id, allRoles: true },
    ])

    await expect(
      controller.setDefault('output', {
        id: 'ffffffffffffffff',
        name: '  HEADPHONES   (hyperx cloud ii) ',
      }),
    ).resolves.toMatchObject({ id: headphones.id })
    expect(backend.setCalls[1]).toEqual({
      kind: 'output',
      id: headphones.id,
      allRoles: true,
    })
  })

  it('passes wide allRoles through and invalidates the list cache after a set', async () => {
    const { backend, controller } = makeController()
    await controller.list()
    expect(backend.listCalls).toBe(1)

    await controller.setDefault('input', { id: usbMic.id }, false)
    expect(backend.setCalls).toEqual([{ kind: 'input', id: usbMic.id, allRoles: false }])

    await controller.list()
    expect(backend.listCalls).toBe(3)
    await controller.list()
    expect(backend.listCalls).toBe(3)
    await expect(controller.current('input')).resolves.toMatchObject({ id: usbMic.id })
    expect(backend.currentCalls).toEqual([])
  })

  it('fails loudly for an unresolved or unavailable target', async () => {
    const { backend, controller } = makeController()
    await expect(
      controller.setDefault('output', { name: 'Speakers (Realtek(R) Audio)' }),
    ).resolves.toMatchObject({ id: speakers.id })

    await expect(
      controller.setDefault('output', { name: 'Not Connected Headset' }),
    ).rejects.toThrow('Device not found: Not Connected Headset')

    backend.output = [
      ...backend.output,
      { ...hdmi, available: false },
    ]
    await expect(controller.setDefault('output', { id: hdmi.id })).rejects.toThrow(
      'Device is not available: HDMI',
    )
  })

  it('rejects ambiguous duplicate friendly names', async () => {
    const backend = new FakeBackend()
    const duplicate = entry('eeeeeeeeeeeeeeee', 'Speakers (Realtek(R) Audio)', 'output')
    backend.output = [speakers, duplicate]
    const { controller } = makeController(backend)

    await expect(
      controller.setDefault('output', { name: 'speakers (realtek(r) audio)' }),
    ).rejects.toThrow('Device name is ambiguous')
  })

  it('cycles forward with wrap and starts at the first when the current is missing', async () => {
    const backend = new FakeBackend()
    backend.output = [headphones, speakers, hdmi]
    backend.currentOutputId = speakers.id
    const { controller } = makeController(backend)

    await expect(
      controller.cycle('output', [{ id: headphones.id }, { id: speakers.id }, { id: hdmi.id }]),
    ).resolves.toMatchObject({ id: hdmi.id })
    expect(backend.setCalls).toEqual([
      { kind: 'output', id: hdmi.id, allRoles: true },
    ])

    backend.currentOutputId = hdmi.id
    await expect(
      controller.cycle('output', [{ id: headphones.id }, { id: speakers.id }, { id: hdmi.id }]),
    ).resolves.toMatchObject({ id: headphones.id })

    backend.currentOutputId = 'ffffffffffffffff'
    await expect(
      controller.cycle('output', [{ id: speakers.id }, { id: hdmi.id }]),
    ).resolves.toMatchObject({ id: speakers.id })
  })

  it('skips unavailable targets and treats one available target as a no-op', async () => {
    const backend = new FakeBackend()
    backend.output = [
      headphones,
      { ...speakers, available: false },
      { ...hdmi, available: false },
    ]
    backend.currentOutputId = headphones.id
    const { controller } = makeController(backend)

    await expect(
      controller.cycle('output', [{ id: speakers.id }, { id: headphones.id }, { id: hdmi.id }]),
    ).resolves.toMatchObject({ id: headphones.id })
    expect(backend.setCalls).toEqual([])

    backend.output = [headphones, speakers, hdmi]
    backend.currentOutputId = headphones.id
    await expect(
      controller.cycle('output', [{ id: speakers.id }, { id: hdmi.id }]),
    ).resolves.toMatchObject({ id: speakers.id })
    expect(backend.setCalls).toEqual([{ kind: 'output', id: speakers.id, allRoles: true }])
  })

  it('fails loudly when no cycle target resolves', async () => {
    const { controller } = makeController()
    await expect(
      controller.cycle('output', [{ name: 'Ghost Headset' }, { id: 'ffffffffffffffff' }]),
    ).rejects.toThrow('Device not found: Ghost Headset')
  })

  it('serializes writes and keeps only the latest queued tap', async () => {
    const backend = new FakeBackend()
    backend.output = [headphones, speakers, hdmi]
    let release: (() => void) | undefined
    backend.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { controller } = makeController(backend)

    const first = controller.setDefault('output', { id: headphones.id })
    await flush()
    expect(backend.setCalls).toHaveLength(1)

    const second = controller.setDefault('output', { id: speakers.id })
    const third = controller.setDefault('output', { id: hdmi.id })
    await flush()
    expect(backend.setCalls).toHaveLength(1)

    release?.()
    const [a, b, c] = await Promise.all([first, second, third])
    expect(a.id).toBe(headphones.id)
    expect(b.id).toBe(hdmi.id)
    expect(c.id).toBe(hdmi.id)
    // The middle tap was superseded before it reached the backend.
    expect(backend.setCalls).toEqual([
      { kind: 'output', id: headphones.id, allRoles: true },
      { kind: 'output', id: hdmi.id, allRoles: true },
    ])
  })

  it('keeps output and input write queues independent', async () => {
    const backend = new FakeBackend()
    const { controller } = makeController(backend)
    const [output, input] = await Promise.all([
      controller.setDefault('output', { id: speakers.id }),
      controller.setDefault('input', { id: usbMic.id }),
    ])
    expect(output.id).toBe(speakers.id)
    expect(input.id).toBe(usbMic.id)
    expect(backend.setCalls).toHaveLength(2)
  })

  it('rewrites a race-time helper miss with the friendly name', async () => {
    const backend = new FakeBackend()
    backend.output = [headphones, hdmi]
    const { controller } = makeController(backend)
    backend.failSet = new Error(`Device not found: ${hdmi.id}`)
    await expect(controller.setDefault('output', { id: hdmi.id })).rejects.toThrow(
      'Device not found: HDMI (NVIDIA High Definition Audio)',
    )
  })

  it('turns backend set failures into short errors and keeps the queue alive', async () => {
    const backend = new FakeBackend()
    const { controller } = makeController(backend)
    backend.failSet = new Error('Windows rejected the device change')
    await expect(controller.setDefault('output', { id: speakers.id })).rejects.toThrow(
      'Windows rejected the device change',
    )

    backend.failSet = null
    await expect(controller.setDefault('output', { id: speakers.id })).resolves.toMatchObject({
      id: speakers.id,
    })
  })

  it('does not cache a failed current read', async () => {
    const backend = new FakeBackend()
    backend.failCurrent = new Error('No default output device is active.')
    const { controller } = makeController(backend)
    await expect(controller.current('output')).rejects.toThrow(
      'No default output device is active.',
    )

    backend.failCurrent = null
    await expect(controller.current('output')).resolves.toMatchObject({ id: headphones.id })
    expect(backend.currentCalls).toEqual(['output', 'output'])
  })

  it('disposes the backend and drops caches', async () => {
    const { backend, controller } = makeController()
    await controller.list()
    controller.dispose()
    expect(backend.disposed).toBe(true)
    await controller.list()
    expect(backend.listCalls).toBe(2)
  })
})

describe('platform support', () => {
  it('builds a controller only on Windows', () => {
    const backend = new FakeBackend()
    expect(createAudioDeviceController('darwin')).toBeNull()
    expect(createAudioDeviceController('linux')).toBeNull()
    expect(createAudioDeviceController('win32', { backend })).toBeInstanceOf(
      CachedAudioDeviceController,
    )
  })

  it('returns a clear non-Windows reason', () => {
    expect(audioDeviceUnsupportedReason('win32')).toBeNull()
    expect(audioDeviceUnsupportedReason('linux')).toContain('Windows')
    expect(audioDeviceUnsupportedReason('darwin')).toContain('Windows')
  })
})

describe('AudioDeviceRef typing helper', () => {
  it('accepts an id-only, name-only or both ref', () => {
    const refs: AudioDeviceRef[] = [{ id: headphones.id }, { name: headphones.name }, headphones]
    expect(refs).toHaveLength(3)
  })
})
