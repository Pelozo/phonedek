import { useEffect, useState } from 'react'
import type { AudioDeviceKind, AudioDeviceRef, AudioDeviceStateBinding } from '@phonedek/shared'
import {
  audioDeviceKindTitle,
  audioDeviceList,
  audioDeviceRefFromView,
  audioDeviceRefLabel,
  audioDeviceStateBadge,
  audioDeviceStatusText,
  normalizeAudioDeviceRef,
  resolveAudioDeviceRef,
} from '../lib/audioDevices'
import { useAudioDevices } from '../lib/useAudioDevices'
import { Icon } from './Icons'

/**
 * Status-only audio tile editor: output/input direction plus an optional
 * specific target. The tile reads the OS default through control-state-v1;
 * without a target it is a generic direction readout and never lights.
 */
export function AudioDeviceStatusEditor({
  binding,
  onUpdate,
}: {
  binding: AudioDeviceStateBinding
  onUpdate: (binding: AudioDeviceStateBinding) => void
}) {
  const audio = useAudioDevices(true)
  const [stale, setStale] = useState(false)
  const devices = audioDeviceList(audio.result, binding.target)
  const saved = normalizeAudioDeviceRef(binding.device)
  const resolved = resolveAudioDeviceRef(saved, devices)
  const missing = Boolean(saved) && Boolean(audio.result?.ok) && !resolved
  const status = audioDeviceStatusText(binding, audio.result)
  const kindTitle = audioDeviceKindTitle(binding.target)

  useEffect(() => {
    if (!audio.loadedAt) {
      setStale(false)
      return
    }
    setStale(false)
    const timer = window.setTimeout(() => setStale(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [audio.loadedAt])

  const selectedValue = saved ? (resolved?.id ?? 'saved') : ''

  const chooseTarget = (value: string): void => {
    if (!value) {
      onUpdate({ type: 'audioDevice', target: binding.target })
      return
    }
    if (value === 'saved') return
    const view = devices.find((device) => device.id === value)
    if (!view) return
    const ref: AudioDeviceRef = audioDeviceRefFromView(view)
    onUpdate({ type: 'audioDevice', target: binding.target, device: ref })
  }

  return (
    <div className="stack audio-device-status-editor">
      <div className="two-col">
        <label className="field">
          <span>Direction</span>
          <select
            value={binding.target}
            onChange={(event) => {
              const target = event.target.value as AudioDeviceKind
              // Refs are direction-specific; a generic target is better than a
              // saved id that cannot exist on the new endpoint list.
              onUpdate({ type: 'audioDevice', target })
            }}
          >
            <option value="output">Output</option>
            <option value="input">Input</option>
          </select>
        </label>
        <div className="field">
          <span>Badge</span>
          <div className="audio-device-badge-preview">
            <span className="mono deck-status-badge audio">{audioDeviceStateBadge(binding.target)}</span>
            <span className="hint">{kindTitle} default</span>
          </div>
        </div>
      </div>

      <label className="field">
        <span>Follow</span>
        <select value={selectedValue} onChange={(event) => chooseTarget(event.target.value)}>
          <option value="">Any {binding.target} device (generic readout)</option>
          {missing && saved && (
            <option value="saved">
              {audioDeviceRefLabel(saved)} — saved, not connected
            </option>
          )}
          {devices.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
              {view.current ? ' · CURRENT' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className={`audio-device-live ${status.tone}`}>
        <span className={`audio-device-led${status.active ? ' lit' : ''}`} aria-hidden="true" />
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
          title="Read the current OS default again"
          onClick={() => void audio.refresh(true)}
          disabled={audio.loading}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>

      {saved && (
        <div className={`audio-device-state-row${status.active ? ' active' : ''}`}>
          <span className="mono">{kindTitle.toUpperCase()} TARGET</span>
          <strong>{audioDeviceRefLabel(saved)}</strong>
          <span className={`audio-device-state-pill${status.active ? ' active' : ''}`}>
            {status.active ? 'CURRENT' : missing ? 'NOT CONNECTED' : 'NOT CURRENT'}
          </span>
        </div>
      )}

      {missing && (
        <div className="warning audio-device-warning">
          <Icon name="music" size={15} />
          Saved device is not connected. The tile reports the OS default; select “Any {binding.target}
          device”, or reconnect it and press Refresh.
        </div>
      )}

      <p className="hint">
        {saved
          ? `Active only while “${audioDeviceRefLabel(saved)}” is the current ${binding.target}. The phone shows the live default even when it is a different device.`
          : `Generic ${binding.target} readout: shows the live default but never lights an active chip.`}
        {audio.result && !audio.result.ok ? ' Audio device switching is unavailable on this PC.' : ''}
      </p>

      {stale && !audio.loading && (
        <p className="hint">Reading is over 10 s old. Press Refresh if the default just changed.</p>
      )}
    </div>
  )
}
