import { afterEach, describe, expect, it } from 'vitest'
import type { ObsPlanStep } from '@phonedek/shared'
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

describe('ObsStateSource actions', () => {
  it('switches to a named scene and falls back to the first scene', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => {
      if (type === 'GetSceneList') {
        return {
          currentProgramSceneName: 'Main',
          scenes: [
            { sceneName: 'Main', sceneIndex: 0 },
            { sceneName: 'Gaming', sceneIndex: 1 },
          ],
        }
      }
      return {}
    }
    const state = source(client)

    await expect(state.setScene('Gaming')).resolves.toEqual({ scene: 'Gaming' })
    await expect(state.setScene('   ')).resolves.toEqual({ scene: 'Main' })
    expect(
      client.requests
        .filter((request) => request.type === 'SetCurrentProgramScene')
        .map((request) => request.data?.['sceneName']),
    ).toEqual(['Gaming', 'Main'])
  })

  it('maps every output transition to its obs-websocket request', async () => {
    const client = new FakeObsClient()
    const state = source(client)
    const steps: ObsPlanStep[] = [
      { kind: 'obs', action: 'startStream' },
      { kind: 'obs', action: 'stopStream' },
      { kind: 'obs', action: 'toggleStream' },
      { kind: 'obs', action: 'startRecord' },
      { kind: 'obs', action: 'stopRecord' },
      { kind: 'obs', action: 'toggleRecord' },
      { kind: 'obs', action: 'startReplay' },
      { kind: 'obs', action: 'stopReplay' },
      { kind: 'obs', action: 'toggleVirtualCam' },
    ]

    for (const step of steps) await state.execute(step)

    expect(client.requests.map((request) => request.type)).toEqual([
      'StartStream',
      'StopStream',
      'ToggleStream',
      'StartRecord',
      'StopRecord',
      'ToggleRecord',
      'StartReplayBuffer',
      'StopReplayBuffer',
      'ToggleVirtualCam',
    ])
  })

  it('saves the replay buffer and adds chapter markers', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    await state.execute({ kind: 'obs', action: 'saveReplay' })
    await state.execute({ kind: 'obs', action: 'addMarker', name: 'Boss' })
    await state.execute({ kind: 'obs', action: 'addMarker' })

    expect(client.requests).toEqual([
      { type: 'SaveReplayBuffer', data: undefined },
      { type: 'CreateRecordChapter', data: { chapterName: 'Boss' } },
      { type: 'CreateRecordChapter', data: {} },
    ])
  })

  it('sets and toggles a source in an explicit scene', async () => {
    const client = new FakeObsClient()
    let enabled = false
    client.handler = (type, data) => {
      if (type === 'GetSceneItemList') {
        return { sceneItems: [{ sceneItemId: 7, sourceName: 'Webcam', sceneItemEnabled: enabled }] }
      }
      if (type === 'SetSceneItemEnabled') {
        enabled = data['sceneItemEnabled'] === true
        return {}
      }
      return {}
    }
    const state = source(client)

    await expect(
      state.execute({
        kind: 'obs',
        action: 'setSourceVisibility',
        scene: 'Main',
        source: 'Webcam',
        visible: true,
      }),
    ).resolves.toBeUndefined()
    expect(
      client.requests.find((request) => request.type === 'SetSceneItemEnabled')?.data,
    ).toEqual({ sceneName: 'Main', sceneItemId: 7, sceneItemEnabled: true })

    await expect(
      state.execute({ kind: 'obs', action: 'toggleSourceVisibility', scene: 'Main', source: 'Webcam' }),
    ).resolves.toBeUndefined()
    const writes = client.requests.filter((request) => request.type === 'SetSceneItemEnabled')
    expect(writes.at(-1)?.data).toEqual({
      sceneName: 'Main',
      sceneItemId: 7,
      sceneItemEnabled: false,
    })
    expect(client.count('GetSceneItemList')).toBe(1)
  })

  it('resolves an omitted source scene to the current program scene', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => {
      if (type === 'GetSceneList') {
        return { currentProgramSceneName: 'Live', scenes: [{ sceneName: 'Live', sceneIndex: 0 }] }
      }
      if (type === 'GetSceneItemList') {
        return { sceneItems: [{ sceneItemId: 3, sourceName: 'Overlay', sceneItemEnabled: false }] }
      }
      return {}
    }
    const state = source(client)

    await expect(
      state.execute({ kind: 'obs', action: 'toggleSourceVisibility', source: 'Overlay' }),
    ).resolves.toBeUndefined()

    expect(client.requests.map((request) => request.type)).toEqual([
      'GetSceneList',
      'GetSceneItemList',
      'SetSceneItemEnabled',
    ])
    expect(
      client.requests.find((request) => request.type === 'SetSceneItemEnabled')?.data,
    ).toEqual({ sceneName: 'Live', sceneItemId: 3, sceneItemEnabled: true })
  })

  it('rejects a missing source after one forced refresh', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => (type === 'GetSceneItemList' ? { sceneItems: [] } : {})
    const state = source(client)

    await expect(
      state.execute({
        kind: 'obs',
        action: 'setSourceVisibility',
        scene: 'Main',
        source: 'Ghost',
        visible: true,
      }),
    ).rejects.toThrow('OBS source "Ghost" was not found in scene "Main"')
    expect(client.count('GetSceneItemList')).toBe(2)
    expect(client.count('SetSceneItemEnabled')).toBe(0)
  })

  it('turns OBS request errors into clear rejections', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    client.handler = () => {
      throw new ObsRequestError('SetCurrentProgramScene', 600)
    }
    await expect(state.setScene('Nope')).rejects.toThrow('OBS scene "Nope" was not found')

    client.handler = () => {
      throw new Error('OBS request timed out: StartStream')
    }
    await expect(state.execute({ kind: 'obs', action: 'startStream' })).rejects.toThrow(
      'OBS request timed out: StartStream',
    )

    client.handler = () => {
      throw new ObsRequestError('ToggleVirtualCam', 204)
    }
    await expect(state.execute({ kind: 'obs', action: 'toggleVirtualCam' })).rejects.toThrow(
      'OBS does not support ToggleVirtualCam',
    )

    client.handler = () => {
      throw new ObsRequestError('SaveReplayBuffer', 204)
    }
    await expect(state.saveReplay()).rejects.toThrow(
      'OBS does not support saving the replay buffer',
    )

    client.handler = () => {
      throw new ObsRequestError('CreateRecordChapter', 702)
    }
    await expect(state.addMarker('Boss')).rejects.toThrow('Hybrid MP4')
  })

  it('rejects actions while OBS is disconnected or switching scene collections', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    client.connected = false
    await expect(state.setScene('Main')).rejects.toThrow('OBS is not connected')
    await expect(state.execute({ kind: 'obs', action: 'startStream' })).rejects.toThrow(
      'OBS is not connected',
    )

    client.connected = true
    client.paused = true
    await expect(state.execute({ kind: 'obs', action: 'toggleRecord' })).rejects.toThrow(
      'switching scene collections',
    )
    await expect(state.readStatus('streaming')).rejects.toThrow('switching scene collections')
    expect(client.requests).toEqual([])
  })
})

describe('ObsStateSource status', () => {
  it('reports output targets with active state and detail', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => {
      switch (type) {
        case 'GetStreamStatus':
          return { outputActive: true, outputTimecode: '00:12:34.567' }
        case 'GetRecordStatus':
          return { outputActive: true, outputPaused: false, outputTimecode: '01:02:03.999' }
        case 'GetReplayBufferStatus':
          return { outputActive: true }
        case 'GetVirtualCamStatus':
          return { outputActive: false }
        default:
          return {}
      }
    }
    const state = source(client)

    await expect(state.readStatus('streaming')).resolves.toEqual({
      active: true,
      detail: 'LIVE 12:34',
    })
    await expect(state.readStatus('recording')).resolves.toEqual({
      active: true,
      detail: 'REC 01:02:03',
    })
    await expect(state.readStatus('replay')).resolves.toEqual({ active: true, detail: 'REPLAY' })
    await expect(state.readStatus('virtualCam')).resolves.toEqual({ active: false, detail: 'OFF' })
  })

  it('shows OFF and REC PAUSED for inactive or paused outputs', async () => {
    const client = new FakeObsClient()
    client.handler = (type) => {
      if (type === 'GetStreamStatus') return { outputActive: false }
      if (type === 'GetRecordStatus') return { outputActive: true, outputPaused: true }
      return {}
    }
    const state = source(client)

    await expect(state.readStatus('streaming')).resolves.toEqual({ active: false, detail: 'OFF' })
    await expect(state.readStatus('recording')).resolves.toEqual({
      active: true,
      detail: 'REC PAUSED',
    })
  })

  it('reports the current scene and marks a bound scene active', async () => {
    const client = new FakeObsClient()
    client.handler = (type) =>
      type === 'GetSceneList'
        ? {
            currentProgramSceneName: 'Main',
            scenes: [
              { sceneName: 'Main', sceneIndex: 0 },
              { sceneName: 'Gaming', sceneIndex: 1 },
            ],
          }
        : {}
    const state = source(client)

    await expect(state.readStatus('scene')).resolves.toEqual({ active: true, detail: 'Main' })
    await expect(state.readStatus('scene', { scene: 'Main' })).resolves.toEqual({
      active: true,
      detail: 'Main',
    })
    await expect(state.readStatus('scene', { scene: 'Gaming' })).resolves.toEqual({
      active: false,
      detail: 'Main',
    })
    expect(client.count('GetSceneList')).toBe(1)
  })

  it('reports input mute and volume, including MUTED detail', async () => {
    const client = new FakeObsClient()
    client.handler = (type, data) => {
      if (type === 'GetInputVolume') {
        return { inputVolumeMul: data['inputName'] === 'Loud' ? 2 : 1.5 }
      }
      if (type === 'GetInputMute') return { inputMuted: data['inputName'] === 'Muted' }
      return {}
    }
    const state = source(client)

    await expect(state.readStatus('inputMute', { input: 'Mic' })).resolves.toEqual({
      active: false,
      muted: false,
      detail: 'ON',
    })
    await expect(state.readStatus('inputMute', { input: 'Muted' })).resolves.toEqual({
      active: true,
      muted: true,
      detail: 'MUTED',
    })
    await expect(state.readStatus('inputVolume', { input: 'Loud' })).resolves.toEqual({
      value: 1,
      muted: false,
      detail: '200%',
    })
    await expect(state.readStatus('inputVolume', { input: 'Muted' })).resolves.toEqual({
      value: 0.75,
      muted: true,
      detail: 'MUTED',
    })
  })

  it('maps missing inputs to a clear rejection', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    client.handler = () => {
      throw new ObsRequestError('GetInputVolume', 600)
    }
    await expect(state.readStatus('inputMute', { input: 'Gone' })).rejects.toThrow(
      'OBS input "Gone" was not found',
    )

    client.handler = () => {
      throw new ObsRequestError('GetInputVolume', 605)
    }
    await expect(state.readStatus('inputVolume', { input: 'Image' })).rejects.toThrow(
      '"Image" is not an audio input',
    )
  })

  it('caches status per target and shares one in-flight request', async () => {
    let now = 1000
    let calls = 0
    let release: ((value: Record<string, unknown>) => void) | null = null
    const client = new FakeObsClient()
    client.handler = (type) => {
      if (type !== 'GetStreamStatus') return {}
      calls += 1
      return new Promise<Record<string, unknown>>((resolve) => {
        release = resolve
      })
    }
    const state = source(client, { ttlMs: 900, now: () => now })

    const first = state.readStatus('streaming')
    const second = state.readStatus('streaming')
    expect(calls).toBe(1)
    release!({ outputActive: true, outputTimecode: '00:00:05.000' })
    await expect(first).resolves.toEqual({ active: true, detail: 'LIVE 00:05' })
    await expect(second).resolves.toEqual({ active: true, detail: 'LIVE 00:05' })
    expect(calls).toBe(1)

    await state.readStatus('streaming')
    expect(calls).toBe(1)

    now += 901
    const third = state.readStatus('streaming')
    expect(calls).toBe(2)
    release!({ outputActive: false })
    await expect(third).resolves.toEqual({ active: false, detail: 'OFF' })
  })

  it('invalidates status per target and for all targets', async () => {
    const client = new FakeObsClient()
    const state = source(client)

    await state.readStatus('streaming')
    await state.readStatus('replay')
    await state.readStatus('streaming')
    expect(client.count('GetStreamStatus')).toBe(1)
    expect(client.count('GetReplayBufferStatus')).toBe(1)

    state.invalidateStatus('streaming')
    await state.readStatus('streaming')
    await state.readStatus('replay')
    expect(client.count('GetStreamStatus')).toBe(2)
    expect(client.count('GetReplayBufferStatus')).toBe(1)

    state.invalidateStatus()
    await state.readStatus('streaming')
    await state.readStatus('replay')
    expect(client.count('GetStreamStatus')).toBe(3)
    expect(client.count('GetReplayBufferStatus')).toBe(2)
  })

  it('refreshes output status immediately after OBS events', async () => {
    const client = new FakeObsClient()
    let streaming = false
    client.handler = (type) => (type === 'GetStreamStatus' ? { outputActive: streaming } : {})
    const state = source(client)

    await expect(state.readStatus('streaming')).resolves.toEqual({ active: false, detail: 'OFF' })
    streaming = true
    client.emit('StreamStateChanged', { outputActive: true })
    await expect(state.readStatus('streaming')).resolves.toEqual({ active: true, detail: 'LIVE' })
    expect(client.count('GetStreamStatus')).toBe(2)
  })

  it('tracks program scene changes and scene renames', async () => {
    const client = new FakeObsClient()
    let current = 'Main'
    client.handler = (type) =>
      type === 'GetSceneList'
        ? { currentProgramSceneName: current, scenes: [{ sceneName: current, sceneIndex: 0 }] }
        : {}
    const state = source(client)

    await expect(state.readStatus('scene')).resolves.toEqual({ active: true, detail: 'Main' })

    current = 'Gaming'
    client.emit('CurrentProgramSceneChanged', { sceneName: 'Gaming' })
    await expect(state.readStatus('scene')).resolves.toEqual({ active: true, detail: 'Gaming' })
    expect(client.count('GetSceneList')).toBe(1)

    current = 'Renamed'
    client.emit('SceneNameChanged', { sceneName: 'Renamed' })
    await expect(state.readStatus('scene')).resolves.toEqual({ active: true, detail: 'Renamed' })
    expect(client.count('GetSceneList')).toBe(2)
  })

  it('refreshes input status immediately after mute and volume events', async () => {
    const client = new FakeObsClient()
    let mul = 1
    let muted = false
    client.handler = (type) => {
      if (type === 'GetInputVolume') return { inputVolumeMul: mul }
      if (type === 'GetInputMute') return { inputMuted: muted }
      return {}
    }
    const state = source(client)

    await expect(state.readStatus('inputMute', { input: 'Mic' })).resolves.toEqual({
      active: false,
      muted: false,
      detail: 'ON',
    })
    await expect(state.readStatus('inputVolume', { input: 'Mic' })).resolves.toEqual({
      value: 0.5,
      muted: false,
      detail: '100%',
    })

    muted = true
    client.emit('InputMuteStateChanged', { inputName: 'Mic', inputMuted: true })
    await expect(state.readStatus('inputMute', { input: 'Mic' })).resolves.toEqual({
      active: true,
      muted: true,
      detail: 'MUTED',
    })
    await expect(state.readStatus('inputVolume', { input: 'Mic' })).resolves.toEqual({
      value: 0.5,
      muted: true,
      detail: 'MUTED',
    })

    mul = 2
    client.emit('InputVolumeChanged', { inputName: 'Mic', inputVolumeMul: 2 })
    await expect(state.readStatus('inputVolume', { input: 'Mic' })).resolves.toEqual({
      value: 1,
      muted: true,
      detail: 'MUTED',
    })
  })

  it('keeps status working after an input rename', async () => {
    const client = new FakeObsClient()
    const names: string[] = []
    client.handler = (type, data) => {
      if (type === 'GetInputVolume') {
        names.push(String(data['inputName']))
        return { inputVolumeMul: 1 }
      }
      if (type === 'GetInputMute') {
        names.push(String(data['inputName']))
        return { inputMuted: data['inputName'] === 'New' }
      }
      return {}
    }
    const state = source(client)

    await expect(state.readStatus('inputMute', { input: 'Old' })).resolves.toEqual({
      active: false,
      muted: false,
      detail: 'ON',
    })
    expect(names).toEqual(['Old', 'Old'])

    client.emit('InputNameChanged', { oldInputName: 'Old', inputName: 'New' })
    state.invalidate('Old')
    await expect(state.readStatus('inputMute', { input: 'Old' })).resolves.toEqual({
      active: true,
      muted: true,
      detail: 'MUTED',
    })
    expect(names).toEqual(['Old', 'Old', 'New', 'New'])
  })
})
