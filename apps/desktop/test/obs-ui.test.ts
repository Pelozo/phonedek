import { describe, expect, it } from 'vitest'
import type { ObsStatusView } from '../src/shared/api'
import { obsInputAvailability, obsStatusSummary } from '../src/renderer/src/lib/obs'

function status(patch: Partial<ObsStatusView> = {}): ObsStatusView {
  return { state: 'connected', host: '127.0.0.1', port: 4455, ...patch }
}

describe('obsStatusSummary', () => {
  it('describes a connected OBS with versions', () => {
    const summary = obsStatusSummary(
      status({ obsVersion: '30.2.2', websocketVersion: '5.5.2' }),
    )
    expect(summary).toMatchObject({ label: 'Connected', tone: 'ok' })
    expect(summary.detail).toContain('OBS 30.2.2')
    expect(summary.detail).toContain('obs-websocket 5.5.2')
  })

  it('labels disabled, auth failure and reconnect states', () => {
    expect(obsStatusSummary(status({ state: 'disabled' })).label).toBe('Disabled')
    expect(obsStatusSummary(status({ state: 'disabled' })).tone).toBe('muted')
    expect(obsStatusSummary(status({ state: 'auth-failed' })).tone).toBe('error')
    const reconnecting = obsStatusSummary(status({ state: 'reconnecting', nextRetryMs: 4000 }))
    expect(reconnecting.label).toBe('Reconnecting…')
    expect(reconnecting.detail).toContain('4s')
  })

  it('surfaces the last error for disconnected and error states', () => {
    expect(obsStatusSummary(status({ state: 'disconnected', lastError: 'ECONNREFUSED' })).detail).toBe(
      'ECONNREFUSED',
    )
    expect(obsStatusSummary(status({ state: 'error', lastError: 'boom' })).tone).toBe('error')
  })
})

describe('obsInputAvailability', () => {
  const inputs = [
    { name: 'Desktop Audio', kind: 'pulse_output_capture', audio: true },
    { name: 'Camera', kind: 'v4l2_input_capture', audio: false },
  ]

  it('shows NO OBS while disconnected', () => {
    expect(
      obsInputAvailability({ status: status({ state: 'disconnected' }), inputs, loaded: true }).label,
    ).toBe('NO OBS')
  })

  it('shows NO INPUT for a missing selected input', () => {
    expect(
      obsInputAvailability({ status: status(), selected: 'Gone', inputs, loaded: true }).label,
    ).toBe('NO INPUT')
  })

  it('shows LIVE for a present input and DEFAULT with the audio fallback', () => {
    expect(
      obsInputAvailability({ status: status(), selected: 'Camera', inputs, loaded: true }).label,
    ).toBe('LIVE')
    const fallback = obsInputAvailability({ status: status(), inputs, loaded: true })
    expect(fallback.label).toBe('DEFAULT')
    expect(fallback.detail).toContain('Desktop Audio')
  })

  it('explains an empty input list', () => {
    expect(obsInputAvailability({ status: status(), inputs: [], loaded: true }).label).toBe(
      'NO INPUTS',
    )
  })
})

import {
  obsActionTitle,
  obsActionVariant,
  obsNameError,
  obsNameOrUndefined,
  obsStateBadge,
  obsStateBindingSummary,
  obsStateTargetInfo,
} from '../src/renderer/src/lib/obs'
import {
  OBS_STATUS_TILES,
  createObsStatusButton,
} from '../src/renderer/src/lib/obsStatus'

describe('OBS phase 2 action helpers', () => {
  it('titles every action variant', () => {
    expect(obsActionTitle({ type: 'obs', action: 'setScene' })).toBe('OBS scene')
    expect(obsActionTitle({ type: 'obs', action: 'startStream' })).toBe('OBS stream')
    expect(obsActionTitle({ type: 'obs', action: 'saveReplay' })).toBe('OBS replay')
    expect(obsActionTitle({ type: 'obs', action: 'toggleSourceVisibility', source: 'Cam' })).toBe(
      'OBS source',
    )
    expect(obsActionTitle({ type: 'obs', action: 'addMarker' })).toBe('OBS marker')
  })

  it('changes operation while keeping still-applicable fields', () => {
    expect(
      obsActionVariant({ type: 'obs', action: 'setScene', scene: 'Gaming' }, 'toggleStream'),
    ).toEqual({ type: 'obs', action: 'toggleStream' })
    expect(
      obsActionVariant(
        { type: 'obs', action: 'toggleSourceVisibility', scene: 'Main', source: 'Alerts' },
        'setSourceVisibility',
      ),
    ).toEqual({
      type: 'obs',
      action: 'setSourceVisibility',
      scene: 'Main',
      source: 'Alerts',
      visible: true,
    })
    expect(
      obsActionVariant({ type: 'obs', action: 'toggleMute', input: 'Mic/Aux' }, 'startRecord'),
    ).toEqual({ type: 'obs', action: 'startRecord' })
    expect(
      obsActionVariant(
        { type: 'obs', action: 'toggleSourceVisibility', source: '' },
        'setSourceVisibility',
      ),
    ).toEqual({
      type: 'obs',
      action: 'setSourceVisibility',
      source: 'Camera',
      visible: true,
    })
  })

  it('validates required names at 1..128 characters', () => {
    expect(obsNameError('', true)).toContain('Required')
    expect(obsNameError('  ', true)).toContain('Required')
    expect(obsNameError('', false)).toBeNull()
    expect(obsNameError('x'.repeat(128), true)).toBeNull()
    expect(obsNameError('x'.repeat(129), true)).toContain('128')
    expect(obsNameOrUndefined('  Camera  ')).toBe('Camera')
    expect(obsNameOrUndefined('   ')).toBeUndefined()
  })
})

describe('OBS status helpers', () => {
  it('renders static editor badges without pretending to be live', () => {
    expect(obsStateBadge('streaming')).toBe('OBS · LIVE')
    expect(obsStateBadge('recording')).toBe('OBS · REC')
    expect(obsStateBadge('replay')).toBe('OBS · REPLAY')
    expect(obsStateBadge('virtualCam')).toBe('OBS · VCAM')
    expect(obsStateBadge('scene')).toBe('OBS · SCENE')
    expect(obsStateBadge('inputMute')).toBe('OBS · MUTE')
    expect(obsStateBadge('inputVolume')).toBe('OBS · VOL')
  })

  it('summarizes scene and input bindings', () => {
    expect(obsStateBindingSummary({ type: 'obs', target: 'scene', scene: 'Gaming' })).toBe(
      'Scene status · Gaming',
    )
    expect(obsStateBindingSummary({ type: 'obs', target: 'scene' })).toContain('current program')
    expect(
      obsStateBindingSummary({ type: 'obs', target: 'inputMute', input: 'Mic/Aux' }),
    ).toBe('Input mute status · Mic/Aux')
    expect(obsStateBindingSummary(undefined)).toBeNull()
  })

  it('marks which targets need extra fields', () => {
    expect(obsStateTargetInfo('scene').needsScene).toBe(true)
    expect(obsStateTargetInfo('inputVolume').needsInput).toBe(true)
    expect(obsStateTargetInfo('streaming').needsInput).toBe(false)
    expect(obsStateTargetInfo('streaming').needsScene).toBe(false)
  })

  it('creates 1x1 status tiles with state plus a matching tap action', () => {
    expect(OBS_STATUS_TILES.map((tile) => tile.target)).toEqual([
      'streaming',
      'recording',
      'replay',
      'virtualCam',
    ])
    const stream = OBS_STATUS_TILES[0]!
    const button = createObsStatusButton(stream, 4)
    expect(button.slot).toBe(4)
    expect(button.label).toBe('Stream')
    expect(button.icon).toBe('📡')
    expect(button.state).toEqual({ type: 'obs', target: 'streaming' })
    expect(button.actions).toEqual([{ type: 'obs', action: 'toggleStream' }])
    expect(button.span).toBeUndefined()
  })

  it('replay status saves the buffer and VCam toggles the camera', () => {
    const replay = createObsStatusButton(OBS_STATUS_TILES[2]!, 0)
    expect(replay.state?.target).toBe('replay')
    expect(replay.actions).toEqual([{ type: 'obs', action: 'saveReplay' }])
    const vcam = createObsStatusButton(OBS_STATUS_TILES[3]!, 1)
    expect(vcam.actions).toEqual([{ type: 'obs', action: 'toggleVirtualCam' }])
  })
})
