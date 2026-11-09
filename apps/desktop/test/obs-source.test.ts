import { afterEach, describe, expect, it } from 'vitest'
import { ObsRequestError } from '../src/main/obs-client'
import {
  ObsStateSource,
  isAudioInputKind,
  obsControlPercent,
  obsMulToPercent,
  obsPercentToMul,
} from '../src/main/obs-source'
import type { ObsClientLike, ObsStateSourceOptions } from '../src/main/obs-source'

type Handler = (type: string, data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>

class FakeObsClient implements ObsClientLike {
  connected = true
  paused = false
  requests: Array<{ type: string; data: Record<string, unknown> | undefined }> = []
  handler: Handler = () => ({})
  private listeners = new Set<(type: string, data: Record<string, unknown>) => void>()

  async request<T = Record<string, unknown>>(type: string, data?: object): Promise<T> {
    this.requests.push({ type, data: data as Record<string, unknown> | undefined })
    const result = await this.handler(type, (data ?? {}) as Record<string, unknown>)
    return result as T
  }

  onEvent(listener: (type: string, data: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: string, data: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(type, data)
  }

  count(type: string): number {
    return this.requests.filter((request) => request.type === type).length
  }
}

const sources: ObsStateSource[] = []

function source(client: FakeObsClient, options: ObsStateSourceOptions = {}): ObsStateSource {
  const created = new ObsStateSource(client, options)
  sources.push(created)
  return created
}

afterEach(() => {
  for (const created of sources.splice(0)) created.dispose()
})

describe('OBS volume math', () => {
  it('maps normalized slider values to 0..200% with 100% = unity', () => {
    expect(obsControlPercent(0)).toBe(0)
    expect(obsControlPercent(0.5)).toBe(100)
    expect(obsControlPercent(0.75)).toBe(150)
    expect(obsControlPercent(1)).toBe(200)
    expect(obsControlPercent(1.5)).toBe(200)
    expect(obsControlPercent(-1)).toBe(0)
    expect(obsControlPercent(1, 100)).toBe(100)
    expect(obsControlPercent(0.42, 2000)).toBe(840)
    expect(() => obsControlPercent(Number.NaN)).toThrow(/finite/)
  })

  it('converts percent to the linear OBS multiplier', () => {
    expect(obsPercentToMul(0)).toBe(0)
    expect(obsPercentToMul(50)).toBe(0.5)
    expect(obsPercentToMul(100)).toBe(1)
    expect(obsPercentToMul(200)).toBe(2)
    expect(obsPercentToMul(2000)).toBe(20)
    expect(obsPercentToMul(5000)).toBe(20)
    expect(() => obsPercentToMul(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })

  it('converts multipliers back to percentages and clamps', () => {
    expect(obsMulToPercent(0)).toBe(0)
    expect(obsMulToPercent(0.5)).toBe(50)
    expect(obsMulToPercent(1)).toBe(100)
    expect(obsMulToPercent(2)).toBe(200)
    expect(obsMulToPercent(-1)).toBe(0)
    expect(obsMulToPercent(50)).toBe(2000)
  })

  it('recognises the common audio input kinds', () => {
    expect(isAudioInputKind('wasapi_input_capture')).toBe(true)
    expect(isAudioInputKind('coreaudio_output_capture')).toBe(true)
    expect(isAudioInputKind('alsa_input_capture')).toBe(true)
    expect(isAudioInputKind('ndi_source')).toBe(true)
    expect(isAudioInputKind('image_source')).toBe(false)
  })
})

describe('ObsStateSource reads', () => {
  it('caches per input for the TTL, single-flights and invalidates', async () => {
    let now = 1000
    const client = new FakeObsClient()
    client.handler = (type) =>
      type === 'GetInputVolume' ? { inputVolumeMul: 1.5 } : { inputMuted: false }
    const state = source(client, { ttlMs: 900, now: () => now })

    const [first, second] = await Promise.all([state.read('Mic'), state.read('Mic')])
    expect(first).toEqual({ level: 150, muted: false })
    expect(second).toEqual(first)
    expect(client.count('GetInputVolume')).toBe(1)
    expect(client.count('GetInputMute')).toBe(1)

    now += 899
    await state.read('Mic')
    expect(client.count('GetInputVolume')).toBe(1)

    now += 2
    await state.read('Mic')
    expect(client.count('GetInputVolume')).toBe(2)

    state.invalidate('Mic')
    await state.read('Mic')
    expect(client.count('GetInputVolume')).toBe(3)

    state.setKnown('Mic', { level: 42, muted: true })
    await expect(state.read('Mic')).resolves.toEqual({ level: 42, muted: true })
    expect(client.count('GetInputVolume')).toBe(3)
  })

  it('reads different inputs independently', async () => {
    const client = new FakeObsClient()
    client.handler = (type, data) =>
      type === 'GetInputVolume'
        ? { inputVolumeMul: data['inputName'] === 'A' ? 1 : 2 }
        : { inputMuted: false }
    const state = source(client)

    await expect(state.read('A')).resolves.toEqual({ level: 100, muted: false })
    await expect(state.read('B')).resolves.toEqual({ level: 200, muted: false })
    expect(client.count('GetInputVolume')).toBe(2)
    const names = client.requests
      .filter((request) => request.type === 'GetInputVolume')
      .map((request) => request.data?.['inputName'])
    expect(names).toEqual(['A', 'B'])
  })

  it('maps missing and non-audio requests to readable errors', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    client.handler = () => {
      throw new ObsRequestError('GetInputVolume', 600, 'Parameter: inputName')
    }
    await expect(state.read('Gone')).rejects.toThrow('OBS input "Gone" was not found')

    client.handler = () => {
      throw new ObsRequestError('GetInputVolume', 605, 'Not audio')
    }
    await expect(state.read('Image')).rejects.toThrow('"Image" is not an audio input')

    client.connected = false
    await expect(state.read('Mic')).rejects.toThrow('OBS is not connected')
    await expect(state.listInputs()).rejects.toThrow('OBS is not connected')
  })

  it('resolves an omitted input to the first audio-like input', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => {
      if (type === 'GetInputList') {
        return {
          inputs: [
            { inputName: 'Logo', inputKind: 'image_source', unversionedInputKind: 'image_source' },
            { inputName: 'Desk', inputKind: 'wasapi_output_capture', unversionedInputKind: 'wasapi_output_capture' },
            { inputName: 'Mic', inputKind: 'wasapi_input_capture', unversionedInputKind: 'wasapi_input_capture' },
          ],
        }
      }
      if (type === 'GetInputVolume') return { inputVolumeMul: 0.5 }
      return { inputMuted: true }
    }
    const state = source(client)

    await expect(state.read()).resolves.toEqual({ level: 50, muted: true })
    expect(client.count('GetInputList')).toBe(1)
    await state.read()
    expect(client.count('GetInputList')).toBe(1)

    const volumeNames = client.requests
      .filter((request) => request.type === 'GetInputVolume')
      .map((request) => request.data?.['inputName'])
    expect(volumeNames).toEqual(['Desk'])
  })

  it('fails clearly when OBS has no inputs', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => (type === 'GetInputList' ? { inputs: [] } : {})
    const state = source(client)
    await expect(state.read()).rejects.toThrow('OBS has no inputs')
  })
})

describe('ObsStateSource events', () => {
  it('applies volume and mute events to cached inputs and notifies once', async () => {
    const client = new FakeObsClient()
    client.handler = (type) =>
      type === 'GetInputVolume' ? { inputVolumeMul: 1 } : { inputMuted: false }
    const state = source(client, { notifyDebounceMs: 0 })
    const changes: Array<string | undefined> = []
    state.onChange((input) => changes.push(input))

    await state.read('Mic')
    client.emit('InputVolumeChanged', { inputName: 'Mic', inputVolumeMul: 2, inputVolumeDb: 6 })
    client.emit('InputMuteStateChanged', { inputName: 'Mic', inputMuted: true })
    await expect(state.read('Mic')).resolves.toEqual({ level: 200, muted: true })
    expect(client.count('GetInputVolume')).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(changes).toEqual(['Mic'])
  })

  it('keeps an old name working after InputNameChanged', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => (type === 'GetInputVolume' ? { inputVolumeMul: 1 } : { inputMuted: false })
    const state = source(client, { ttlMs: 0 })

    await state.read('Old name')
    client.emit('InputNameChanged', { oldInputName: 'Old name', inputName: 'New name' })
    await state.read('Old name')

    const names = client.requests
      .filter((request) => request.type === 'GetInputVolume')
      .map((request) => request.data?.['inputName'])
    expect(names).toEqual(['Old name', 'New name'])
  })

  it('invalidates the input list when inputs are created or removed', async () => {
    const client = new FakeObsClient()
    client.handler = (type) =>
      type === 'GetInputList'
        ? { inputs: [{ inputName: 'Mic', inputKind: 'wasapi_input_capture', unversionedInputKind: 'wasapi_input_capture' }] }
        : type === 'GetInputVolume'
          ? { inputVolumeMul: 1 }
          : { inputMuted: false }
    const state = source(client)

    await state.listInputs()
    await state.listInputs()
    expect(client.count('GetInputList')).toBe(1)
    client.emit('InputCreated', { inputName: 'Cam' })
    await state.listInputs()
    expect(client.count('GetInputList')).toBe(2)
    client.emit('InputRemoved', { inputName: 'Cam' })
    await state.listInputs()
    expect(client.count('GetInputList')).toBe(3)
  })

  it('pauses reads while the scene collection changes and clears caches after', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => (type === 'GetInputVolume' ? { inputVolumeMul: 1 } : { inputMuted: false })
    const state = source(client)

    await state.read('Mic')
    client.emit('CurrentSceneCollectionChanging', {})
    await expect(state.read('Mic')).rejects.toThrow('switching scene collections')
    client.emit('CurrentSceneCollectionChanged', {})
    await state.read('Mic')
    expect(client.count('GetInputVolume')).toBe(2)
  })
})

describe('ObsStateSource writes', () => {
  it('coalesces rapid writes per input and sends the newest value', async () => {
    const client = new FakeObsClient()
    let releaseFirst: (() => void) | null = null
    let writes = 0
    client.handler = (type) => {
      if (type !== 'SetInputVolume') return {}
      writes += 1
      if (writes === 1) {
        return new Promise<Record<string, unknown>>((resolve) => {
          releaseFirst = () => resolve({})
        })
      }
      return {}
    }
    const state = source(client)

    const calls: Array<Promise<string>> = []
    for (let index = 1; index <= 10; index += 1) {
      calls.push(state.setVolume('Mic', index * 20))
    }
    await Promise.resolve()
    expect(writes).toBe(1)
    releaseFirst!()
    await Promise.all(calls)

    expect(writes).toBe(2)
    const muls = client.requests
      .filter((request) => request.type === 'SetInputVolume')
      .map((request) => request.data?.['inputVolumeMul'])
    expect(muls).toEqual([0.2, 2])
    await expect(state.read('Mic')).resolves.toEqual({ level: 200, muted: false })
  })

  it('uses ToggleInputMute and updates the cached mute state', async () => {
    const client = new FakeObsClient()
    client.handler = (type) =>
      type === 'GetInputVolume'
        ? { inputVolumeMul: 1.5 }
        : type === 'GetInputMute'
          ? { inputMuted: false }
          : { inputMuted: true }
    const state = source(client)

    await state.read('Mic')
    await expect(state.toggleMute('Mic')).resolves.toEqual({ input: 'Mic', muted: true })
    expect(client.count('ToggleInputMute')).toBe(1)
    await expect(state.read('Mic')).resolves.toEqual({ level: 150, muted: true })
    expect(client.count('GetInputVolume')).toBe(1)
  })

  it('rejects writes while OBS is disconnected', async () => {
    const client = new FakeObsClient()
    client.connected = false
    const state = source(client)
    await expect(state.setVolume('Mic', 100)).rejects.toThrow('OBS is not connected')
    await expect(state.toggleMute('Mic')).rejects.toThrow('OBS is not connected')
  })
})
