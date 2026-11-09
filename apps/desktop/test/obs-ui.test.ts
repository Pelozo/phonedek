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
