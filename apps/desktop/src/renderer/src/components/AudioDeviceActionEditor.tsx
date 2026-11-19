import { useState } from 'react'
import type { AudioDeviceAction, AudioDeviceKind, AudioDeviceRef } from '@phonedek/shared'
import {
  audioDeviceActionSummary,
  audioDeviceCurrent,
  audioDeviceCycleError,
  audioDeviceFormLabel,
  audioDeviceKindTitle,
  audioDeviceList,
  audioDeviceRefLabel,
  audioDeviceStatusText,
  moveAudioDeviceRef,
  nextAudioDeviceInCycle,
  normalizeAudioDeviceRef,
  removeAudioDeviceRef,
  resolveAudioDeviceRef,
} from '../lib/audioDevices'
import { useAudioDevices } from '../lib/useAudioDevices'
import { useHostPlatform } from '../lib/platform'
import { AudioDeviceDialog } from './AudioDeviceDialog'
import { Icon } from './Icons'
import { Toggle } from './Primitives'

interface TestReport {
  ok: boolean
  message: string
}

/**
 * Set/cycle audio-device action card.
 *
 * The card reads the live endpoint list for status and testing, but saves only
 * the host's opaque id plus the friendly name. Test uses `setAudioDevice`
 * directly (never a macro/executor run), so a card test cannot trigger any
 * other action on the button.
 */
export function AudioDeviceActionEditor({
  action,
  onUpdate,
}: {
  action: AudioDeviceAction
  onUpdate: (action: AudioDeviceAction) => void
}) {
  const platform = useHostPlatform()
  const audio = useAudioDevices(true)
  const [picker, setPicker] = useState<
    { mode: 'set' | 'cycle'; kind: AudioDeviceKind } | null
  >(null)
  const [testing, setTesting] = useState(false)
  const [report, setReport] = useState<TestReport | null>(null)

  const devices = audioDeviceList(audio.result, action.kind)
  const current = audioDeviceCurrent(audio.result, action.kind)
  const devicesReady = Boolean(audio.result?.ok)
  const kindTitle = audioDeviceKindTitle(action.kind)
  const allRoles = action.allRoles !== false

  const status = audioDeviceStatusText(
    {
      type: 'audioDevice',
      target: action.kind,
      ...(action.action === 'set' ? { device: action.device } : {}),
    },
    audio.result,
  )

  const setTarget =
    action.action === 'set' ? resolveAudioDeviceRef(action.device, devices) : undefined
  const setTargetMissing = action.action === 'set' && devicesReady && !setTarget
  const cycleRows =
    action.action === 'cycle'
      ? action.devices.map((ref) => ({ ref, view: resolveAudioDeviceRef(ref, devices) }))
      : []
  const missingCycle = cycleRows.filter((row) => row.view === undefined).length
  const cycleError = action.action === 'cycle' ? audioDeviceCycleError(action.devices) : null

  const openPicker = (mode: 'set' | 'cycle', nextKind: AudioDeviceKind = action.kind): void => {
    setPicker({ mode, kind: nextKind })
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setReport(null)
    try {
      const fresh = (await audio.refresh(true)) ?? audio.result
      if (!fresh || !fresh.ok) {
        setReport({
          ok: false,
          message: fresh?.error?.trim() || 'Audio device switching is unavailable on this PC.',
        })
        return
      }
      const list = audioDeviceList(fresh, action.kind)
      if (action.action === 'set') {
        const target = resolveAudioDeviceRef(action.device, list)
        if (!target) {
          setReport({
            ok: false,
            message: `${audioDeviceRefLabel(action.device)} is not connected. Pick another device.`,
          })
          return
        }
        const result = await window.phonedek.setAudioDevice(action.kind, target.id)
        setReport({
          ok: result.ok,
          message: result.ok
            ? `Set ${action.kind} to ${target.name}`
            : (result.error ?? `Could not set the ${action.kind} device`),
        })
        if (result.ok) await audio.refresh(false)
        return
      }

      const currentDevice = audioDeviceCurrent(fresh, action.kind)
      const next = nextAudioDeviceInCycle(action.devices, list, currentDevice?.id)
      if (!next) {
        setReport({ ok: false, message: 'No device in this cycle is connected.' })
        return
      }
      const result = await window.phonedek.setAudioDevice(action.kind, next.id)
      setReport({
        ok: result.ok,
        message: result.ok
          ? `Cycled ${action.kind} to ${next.name}`
          : (result.error ?? `Could not cycle the ${action.kind} device`),
      })
      if (result.ok) await audio.refresh(false)
    } catch (cause) {
      setReport({
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setTesting(false)
    }
  }

  const pickerInitial: AudioDeviceRef[] =
    picker?.mode === 'set'
      ? action.action === 'set' && picker.kind === action.kind
        ? [action.device]
        : []
      : action.action === 'cycle' && picker?.kind === action.kind
        ? action.devices
        : []

  return (
    <div className="stack audio-device-editor">
      <div className="two-col">
        <label className="field">
          <span>Direction</span>
          <select
            value={action.kind}
            onChange={(event) => {
              const nextKind = event.target.value as AudioDeviceKind
              if (nextKind === action.kind) return
              // A target belongs to one endpoint direction; re-pick instead of
              // writing a device id that cannot exist for the new kind.
              openPicker(action.action, nextKind)
            }}
          >
            <option value="output">Output (playback)</option>
            <option value="input">Input (capture)</option>
          </select>
        </label>
        <div className="field">
          <span>Mode</span>
          <div className="audio-device-mode">
            <span className="mono">{action.action === 'set' ? 'FIXED TARGET' : 'CYCLE'}</span>
            <span className="hint">
              {action.action === 'set'
                ? audioDeviceActionSummary(action)
                : `${action.devices.length} device${action.devices.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>
      </div>

      <div className={`audio-device-live ${status.tone}`}>
        <span className={`audio-device-led${current ? ' lit' : ''}`} aria-hidden="true" />
        <span className="audio-device-live-copy">
          <strong className="mono">
            {audio.loading && !audio.loaded ? 'READING…' : status.label}
          </strong>
          <small>{status.detail}</small>
        </span>
        <button
          type="button"
          className="icon-button tiny"
          aria-label="Refresh audio devices"
          title="Refresh the live endpoint list"
          onClick={() => void audio.refresh(true)}
          disabled={audio.loading}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>

      {action.action === 'set' ? (
        <div className={`audio-device-target${setTargetMissing ? ' missing' : ''}`}>
          <span className="mono audio-device-target-kicker">
            {kindTitle.toUpperCase()} TARGET
          </span>
          <strong>{audioDeviceRefLabel(action.device)}</strong>
          <small className="mono">
            {audioDeviceFormLabel(setTarget?.form) ?? kindTitle.toUpperCase()}
            {setTarget ? (setTarget.current ? ' · CURRENT' : ' · NOT CURRENT') : devicesReady ? ' · NOT CONNECTED' : ''}
          </small>
          <div className="row gap audio-device-target-actions">
            <button
              type="button"
              className="button secondary small"
              onClick={() => openPicker('set')}
            >
              <Icon name="search" size={14} /> Change device
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={() => void runTest()}
              disabled={testing || !devicesReady}
            >
              <Icon name="play" size={14} /> {testing ? 'Setting…' : 'Test'}
            </button>
          </div>
        </div>
      ) : (
        <div className="audio-device-cycle">
          <div className="audio-device-tray-head">
            <span className="mono">CYCLE ORDER</span>
            <span className="mono">{action.devices.length}/8</span>
          </div>
          <ol className="audio-device-chips">
            {cycleRows.map(({ ref, view }, index) => (
              <li key={`${ref.id ?? ref.name}-${index}`} className="audio-device-chip">
                <span className="audio-device-chip-index mono">{index + 1}</span>
                <span className="audio-device-chip-copy">
                  <strong>{view?.name ?? audioDeviceRefLabel(ref)}</strong>
                  <small className="mono">
                    {view ? (audioDeviceFormLabel(view.form) ?? kindTitle.toUpperCase()) : 'NOT CONNECTED'}
                    {view?.current ? ' · CURRENT' : ''}
                  </small>
                </span>
                <span className="audio-device-chip-tools">
                  <button
                    type="button"
                    className="icon-button tiny"
                    aria-label={`Move ${audioDeviceRefLabel(ref)} up`}
                    disabled={index === 0}
                    onClick={() => onUpdate({ ...action, devices: moveAudioDeviceRef(action.devices, index, -1) })}
                  >
                    <Icon name="arrow-up" size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button tiny"
                    aria-label={`Move ${audioDeviceRefLabel(ref)} down`}
                    disabled={index === cycleRows.length - 1}
                    onClick={() => onUpdate({ ...action, devices: moveAudioDeviceRef(action.devices, index, 1) })}
                  >
                    <Icon name="arrow-down" size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button tiny danger"
                    aria-label={`Remove ${audioDeviceRefLabel(ref)}`}
                    disabled={action.devices.length <= 2}
                    onClick={() => onUpdate({ ...action, devices: removeAudioDeviceRef(action.devices, index) })}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          {cycleError && <p className="hint error-text">{cycleError}</p>}
          {missingCycle > 0 && (
            <div className="warning audio-device-warning">
              <Icon name="music" size={15} />
              {missingCycle} saved device{missingCycle === 1 ? ' is' : 's are'} not connected. Cycle
              skips {missingCycle === 1 ? 'it' : 'them'} and falls back to the saved name.
            </div>
          )}
          <div className="row gap">
            <button type="button" className="button secondary small" onClick={() => openPicker('cycle')}>
              <Icon name="sliders" size={14} /> Edit devices
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={() => void runTest()}
              disabled={testing || !devicesReady || cycleError !== null}
            >
              <Icon name="play" size={14} /> {testing ? 'Cycling…' : 'Test cycle'}
            </button>
          </div>
        </div>
      )}

      {setTargetMissing && (
        <div className="warning audio-device-warning">
          <Icon name="music" size={15} />
          Saved device is not connected; resolution falls back to the name “{audioDeviceRefLabel(action.device)}”.
          <button type="button" className="button secondary small" onClick={() => openPicker('set')}>
            Pick another device
          </button>
        </div>
      )}

      {report && (
        <p
          className={`audio-device-report ${report.ok ? 'ok' : 'error'}${testing ? ' busy' : ''}`}
          role="status"
        >
          <Icon name={report.ok ? 'check' : 'x'} size={14} /> {report.message}
        </p>
      )}

      {platform === 'win32' ? (
        <Toggle
          label="Set all Windows roles"
          description="Console, multimedia and communications. Discord and Teams follow the communications role."
          checked={allRoles}
          onChange={(checked) => onUpdate({ ...action, allRoles: checked })}
        />
      ) : (
        <p className="hint">This OS has one system-wide default per direction; allRoles is ignored.</p>
      )}

      <p className="hint audio-device-hint">
        OBS keeps its own audio device; change it in OBS. Existing audio streams may stay on the old
        device until the app reopens audio.
      </p>

      {picker && (
        <AudioDeviceDialog
          key={`${picker.mode}-${picker.kind}`}
          kind={picker.kind}
          mode={picker.mode}
          initial={pickerInitial}
          title={
            picker.mode === 'set'
              ? `Choose an ${picker.kind} device`
              : `Cycle ${picker.kind} devices`
          }
          onPick={(refs) => {
            const first = refs[0] ? normalizeAudioDeviceRef(refs[0]) : null
            if (!first) return
            if (picker.mode === 'set') {
              onUpdate({ type: 'audioDevice', action: 'set', kind: picker.kind, device: first, allRoles: action.allRoles })
            } else {
              onUpdate({
                type: 'audioDevice',
                action: 'cycle',
                kind: picker.kind,
                devices: refs,
                allRoles: action.allRoles,
              })
            }
            setPicker(null)
            setReport(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
