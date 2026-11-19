import { describe, expect, it } from 'vitest'
import { ActionSchema } from '@phonedek/shared'
import type { AudioDeviceAction, AudioDeviceStateBinding } from '@phonedek/shared'
import type { AudioDevicesResult, AudioDeviceView } from '../src/shared/api'
import {
  AUDIO_DEVICE_MAX_CYCLE,
  audioDeviceActionOf,
  audioDeviceActionSummary,
  audioDeviceActionTitle,
  audioDeviceCurrent,
  audioDeviceCycleError,
  audioDeviceFormLabel,
  audioDeviceRefFromView,
  audioDeviceRefLabel,
  audioDeviceShortName,
  audioDeviceStateBadge,
  audioDeviceStateSummary,
  audioDeviceStatusText,
  filterAudioDevices,
  isAudioDeviceAction,
  isAudioDeviceStateBinding,
  moveAudioDeviceRef,
  nextAudioDeviceInCycle,
  normalizeAudioDeviceRef,
  normalizeDeviceName,
  removeAudioDeviceRef,
  resolveAudioDeviceRef,
} from '../src/renderer/src/lib/audioDevices'

const OUTPUT_ID = 'a1b2c3d4e5f6'
const INPUT_ID = '9f8e7d6c5b4a'
const SPEAKERS_ID = '0a1b2c3d4e5f'
const USB_ID = '112233445566'

function view(patch: Partial<AudioDeviceView> = {}): AudioDeviceView {
  return {
    id: OUTPUT_ID,
    name: 'Headphones (HyperX Cloud II)',
    deviceKind: 'output',
    form: 'headphones',
    current: true,
    available: true,
    ...patch,
  }
}

const HEADPHONES = view()
const SPEAKERS = view({
  id: SPEAKERS_ID,
  name: 'Speakers (Realtek(R) Audio)',
  form: 'speakers',
  current: false,
  available: true,
})
const USB_MIC = view({
  id: USB_ID,
  name: 'Shure MV7',
  deviceKind: 'input',
  form: 'usb',
  current: false,
})

function snapshot(patch: Partial<AudioDevicesResult> = {}): AudioDevicesResult {
  return {
    ok: true,
    output: [HEADPHONES, SPEAKERS],
    input: [USB_MIC],
    currentOutputId: HEADPHONES.id,
    currentInputId: INPUT_ID,
    ...patch,
  }
}

function setAction(device = { id: HEADPHONES.id, name: HEADPHONES.name }): AudioDeviceAction {
  return { type: 'audioDevice', action: 'set', kind: 'output', device }
}

function cycleAction(): AudioDeviceAction {
  return {
    type: 'audioDevice',
    action: 'cycle',
    kind: 'output',
    devices: [
      { id: HEADPHONES.id, name: HEADPHONES.name },
      { id: SPEAKERS.id, name: SPEAKERS.name },
    ],
  }
}

describe('structural action helpers', () => {
  it('accepts staged set/cycle actions and rejects malformed shapes', () => {
    expect(isAudioDeviceAction(setAction())).toBe(true)
    expect(isAudioDeviceAction(cycleAction())).toBe(true)
    expect(isAudioDeviceAction({ type: 'audioDevice', action: 'set', kind: 'output' })).toBe(false)
    expect(isAudioDeviceAction({ type: 'audioDevice', action: 'cycle', kind: 'output' })).toBe(false)
    expect(isAudioDeviceAction({ type: 'audioDevice', action: 'cycle', kind: 'speaker', devices: [] })).toBe(false)
    expect(isAudioDeviceAction({ type: 'delay', ms: 1 })).toBe(false)
    expect(isAudioDeviceAction(null)).toBe(false)
  })

  it('finds the first audio action without widening ConfigAction', () => {
    const action = setAction()
    expect(audioDeviceActionOf([{ type: 'delay', ms: 1 }, action])).toEqual(action)
    expect(audioDeviceActionOf([{ type: 'delay', ms: 1 }])).toBeUndefined()
    expect(audioDeviceActionOf(undefined)).toBeUndefined()
    expect(isAudioDeviceStateBinding({ type: 'audioDevice', target: 'input' })).toBe(true)
    expect(isAudioDeviceStateBinding({ type: 'audioDevice', target: 'mic' })).toBe(false)
    expect(isAudioDeviceStateBinding({ type: 'obs', target: 'streaming' })).toBe(false)
    expect(isAudioDeviceStateBinding(null)).toBe(false)
  })
})

describe('device names, refs and labels', () => {
  it('maps form values to compact picker tags', () => {
    expect(audioDeviceFormLabel('headphones')).toBe('HEADPHONES')
    expect(audioDeviceFormLabel('speakers')).toBe('SPEAKERS')
    expect(audioDeviceFormLabel('usb')).toBe('USB')
    expect(audioDeviceFormLabel('bluetooth')).toBe('BLUETOOTH')
    expect(audioDeviceFormLabel('hdmi')).toBe('HDMI')
    expect(audioDeviceFormLabel('virtual')).toBe('VIRTUAL')
    expect(audioDeviceFormLabel('microphone')).toBe('MIC')
    expect(audioDeviceFormLabel('other')).toBeNull()
    expect(audioDeviceFormLabel(undefined)).toBeNull()
  })

  it('shortens display names without changing the saved friendly name', () => {
    expect(audioDeviceShortName('Headphones (HyperX Cloud II)')).toBe('Headphones')
    expect(audioDeviceShortName('Speakers (Realtek(R) Audio)')).toBe('Speakers')
    expect(audioDeviceShortName('  USB   Mic  ')).toBe('USB Mic')
    expect(audioDeviceShortName('x'.repeat(60), 12)).toHaveLength(12)
    expect(audioDeviceShortName('')).toBe('')
  })

  it('normalizes comparison names with NFKC, whitespace and case folding', () => {
    expect(normalizeDeviceName('  Headphones\n (HyperX)  ')).toBe('headphones (hyperx)')
    expect(normalizeDeviceName('ＳＰＥＡＫＥＲＳ')).toBe('speakers')
    expect(normalizeDeviceName(undefined)).toBe('')
  })

  it('drops empty ref fields but keeps a name fallback', () => {
    expect(normalizeAudioDeviceRef({ id: '  abc  ', name: '  Mic  ' })).toEqual({
      id: 'abc',
      name: 'Mic',
    })
    expect(normalizeAudioDeviceRef({ id: '', name: 'Mic' })).toEqual({ name: 'Mic' })
    expect(normalizeAudioDeviceRef({ id: '  ' })).toBeNull()
    expect(normalizeAudioDeviceRef(null)).toBeNull()
    expect(audioDeviceRefLabel({ id: 'abc' })).toBe('abc')
    expect(audioDeviceRefLabel({ name: 'Shure MV7' })).toBe('Shure MV7')
    expect(audioDeviceRefLabel(null, 'Device')).toBe('Device')
  })

  it('builds refs only from live rows and falls back to the name', () => {
    expect(audioDeviceRefFromView(HEADPHONES)).toEqual({
      id: HEADPHONES.id,
      name: HEADPHONES.name,
    })
    expect(audioDeviceRefFromView({ id: '', name: 'Legacy Speakers' })).toEqual({
      name: 'Legacy Speakers',
    })
  })

  it('resolves by opaque id first and normalized name second', () => {
    expect(resolveAudioDeviceRef({ id: HEADPHONES.id }, [SPEAKERS, HEADPHONES])?.name).toBe(
      HEADPHONES.name,
    )
    expect(
      resolveAudioDeviceRef({ id: 'stale', name: ' headphones (hyperx cloud ii) ' }, [HEADPHONES])
        ?.id,
    ).toBe(HEADPHONES.id)
    expect(resolveAudioDeviceRef({ id: 'stale', name: 'Nope' }, [HEADPHONES])).toBeUndefined()
    expect(resolveAudioDeviceRef(null, [HEADPHONES])).toBeUndefined()
  })

  it('filters the picker by name or form tag', () => {
    expect(filterAudioDevices([HEADPHONES, SPEAKERS, USB_MIC], 'hyperx')).toEqual([HEADPHONES])
    expect(filterAudioDevices([HEADPHONES, SPEAKERS, USB_MIC], 'USB')).toEqual([USB_MIC])
    expect(filterAudioDevices([HEADPHONES, SPEAKERS], 'speakers')).toEqual([SPEAKERS])
    expect(filterAudioDevices([HEADPHONES, SPEAKERS], '  ')).toEqual([HEADPHONES, SPEAKERS])
    expect(filterAudioDevices([HEADPHONES], 'hdmi')).toEqual([])
  })

  it('uses the endpoint order and the current id when reading a snapshot', () => {
    expect(audioDeviceCurrent(snapshot(), 'output')).toEqual(HEADPHONES)
    expect(audioDeviceCurrent(snapshot({ currentOutputId: SPEAKERS_ID }), 'output')).toEqual(SPEAKERS)
    expect(audioDeviceCurrent(snapshot({ currentOutputId: undefined }), 'output')).toEqual(HEADPHONES)
    expect(audioDeviceCurrent(snapshot({ output: [], currentOutputId: undefined }), 'output')).toBeUndefined()
  })
})

describe('action and state summaries', () => {
  it('labels set and cycle cards', () => {
    expect(audioDeviceActionTitle(setAction())).toBe('Set output device')
    expect(audioDeviceActionTitle({ ...cycleAction(), kind: 'input' })).toBe('Cycle input devices')
    expect(audioDeviceActionSummary(setAction())).toBe('Set output: Headphones')
    expect(audioDeviceActionSummary(cycleAction())).toBe('Cycle output (2)')
    expect(
      audioDeviceActionSummary({
        type: 'audioDevice',
        action: 'set',
        kind: 'input',
        device: { name: 'Shure MV7' },
      }),
    ).toBe('Set input: Shure MV7')

    expect(audioDeviceStateBadge('output')).toBe('OUT')
    expect(audioDeviceStateBadge('input')).toBe('IN')

    const specific: AudioDeviceStateBinding = {
      type: 'audioDevice',
      target: 'output',
      device: { id: HEADPHONES.id, name: HEADPHONES.name },
    }
    expect(audioDeviceStateSummary(specific)).toBe('Output → “Headphones”')
    expect(audioDeviceStateSummary({ type: 'audioDevice', target: 'input' })).toBe(
      'Input · any device',
    )
  })

  it('keeps editor-built actions acceptable to ActionSchema/testActions', () => {
    expect(ActionSchema.safeParse(setAction()).success).toBe(true)
    expect(ActionSchema.safeParse(cycleAction()).success).toBe(true)
    expect(
      ActionSchema.safeParse({
        type: 'audioDevice',
        action: 'set',
        kind: 'output',
        device: { name: 'Name fallback only' },
      }).success,
    ).toBe(true)
    expect(
      ActionSchema.safeParse({ type: 'audioDevice', action: 'cycle', kind: 'output', devices: [HEADPHONES] })
        .success,
    ).toBe(false)
  })
})

describe('cycle validation and order', () => {
  it('enforces 2..8 unique devices with an identity', () => {
    expect(audioDeviceCycleError([{ id: HEADPHONES.id }])).toBe('A cycle needs at least 2 devices.')
    expect(
      audioDeviceCycleError([
        { id: HEADPHONES.id },
        { id: SPEAKERS.id },
      ]),
    ).toBeNull()
    expect(audioDeviceCycleError(Array.from({ length: AUDIO_DEVICE_MAX_CYCLE + 1 }, (_, index) => ({
      id: `device${index}`,
    })))).toBe(`A cycle accepts at most ${AUDIO_DEVICE_MAX_CYCLE} devices.`)
    expect(
      audioDeviceCycleError([{ id: HEADPHONES.id }, { id: HEADPHONES.id.toUpperCase() }]),
    ).toContain('Duplicate device')
    expect(audioDeviceCycleError([{ id: HEADPHONES.id }, { name: '' }])).toBe(
      'Every cycle device needs an id or a name.',
    )
  })

  it('reorders and removes cycle chips immutably', () => {
    const refs = [
      { id: HEADPHONES.id, name: HEADPHONES.name },
      { id: SPEAKERS.id, name: SPEAKERS.name },
    ]
    const moved = moveAudioDeviceRef(refs, 0, 1)
    expect(moved.map((ref) => ref.id)).toEqual([SPEAKERS.id, HEADPHONES.id])
    expect(refs.map((ref) => ref.id)).toEqual([HEADPHONES.id, SPEAKERS.id])
    expect(moveAudioDeviceRef(refs, 0, -1).map((ref) => ref.id)).toEqual([
      HEADPHONES.id,
      SPEAKERS.id,
    ])
    expect(removeAudioDeviceRef(refs, 0).map((ref) => ref.id)).toEqual([SPEAKERS.id])
  })

  it('advances with wrap and starts at the first target when current is outside the list', () => {
    const refs = [
      { id: HEADPHONES.id },
      { id: SPEAKERS.id },
    ]
    const devices = snapshot().output
    expect(nextAudioDeviceInCycle(refs, devices, HEADPHONES.id)?.id).toBe(SPEAKERS.id)
    expect(nextAudioDeviceInCycle(refs, devices, SPEAKERS.id)?.id).toBe(HEADPHONES.id)
    expect(nextAudioDeviceInCycle(refs, devices, 'unknown-device')?.id).toBe(HEADPHONES.id)
    expect(nextAudioDeviceInCycle(refs, devices, undefined)?.id).toBe(SPEAKERS.id)
  })

  it('skips unavailable targets and treats one target as a no-op', () => {
    const offline = { ...SPEAKERS, available: false }
    const refs = [
      { id: HEADPHONES.id },
      { id: SPEAKERS.id },
      { id: USB_ID },
    ]
    const devices = [HEADPHONES, offline, USB_MIC]
    expect(nextAudioDeviceInCycle(refs, devices, HEADPHONES.id)?.id).toBe(USB_ID)
    expect(
      nextAudioDeviceInCycle([{ id: HEADPHONES.id }], [HEADPHONES], HEADPHONES.id)?.id,
    ).toBe(HEADPHONES.id)
    expect(nextAudioDeviceInCycle([{ id: 'missing' }], [HEADPHONES])).toBeUndefined()
  })
})

describe('status tile readout', () => {
  it('shows the current name and lights only for an active target', () => {
    const active = audioDeviceStatusText(
      {
        type: 'audioDevice',
        target: 'output',
        device: { id: HEADPHONES.id, name: HEADPHONES.name },
      },
      snapshot(),
    )
    expect(active).toMatchObject({
      label: 'Headphones',
      detail: 'Headphones · CURRENT',
      active: true,
      tone: 'ok',
    })

    const idle = audioDeviceStatusText(
      {
        type: 'audioDevice',
        target: 'output',
        device: { id: SPEAKERS.id, name: SPEAKERS.name },
      },
      snapshot(),
    )
    expect(idle).toMatchObject({
      label: 'Headphones',
      detail: 'Speakers · not current',
      active: false,
      tone: 'warn',
    })
  })

  it('keeps a generic tile neutral and reports NO DEVICE', () => {
    const generic = audioDeviceStatusText({ type: 'audioDevice', target: 'output' }, snapshot())
    expect(generic).toMatchObject({
      label: 'Headphones',
      detail: 'Output · any device',
      active: false,
      tone: 'muted',
    })

    const empty = audioDeviceStatusText(
      { type: 'audioDevice', target: 'input' },
      snapshot({ input: [], currentInputId: undefined }),
    )
    expect(empty).toMatchObject({ label: 'NO DEVICE', active: false, tone: 'muted' })
  })

  it('reports NO AUDIO for unsupported hosts and keeps the reason', () => {
    expect(audioDeviceStatusText({ type: 'audioDevice', target: 'output' }, null)).toMatchObject({
      label: 'NO AUDIO',
      active: false,
    })
    expect(
      audioDeviceStatusText(
        { type: 'audioDevice', target: 'output' },
        { ok: false, error: 'Audio helper is not running', output: [], input: [] },
      ),
    ).toMatchObject({
      label: 'NO AUDIO',
      detail: 'Audio helper is not running',
      tone: 'muted',
    })
  })

  it('warns when a saved target is no longer connected', () => {
    const reading = audioDeviceStatusText(
      {
        type: 'audioDevice',
        target: 'output',
        device: { id: 'stale-id', name: 'Old Headset' },
      },
      snapshot(),
    )
    expect(reading).toMatchObject({
      label: 'Headphones',
      detail: 'Old Headset · not current',
      active: false,
      tone: 'warn',
    })
    expect(reading.target).toBeUndefined()
  })
})
