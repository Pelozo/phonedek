import { useEffect, useMemo, useState } from 'react'
import type { AudioDeviceKind, AudioDeviceRef } from '@phonedek/shared'
import type { AudioDeviceView } from '../../../shared/api'
import {
  AUDIO_DEVICE_MAX_CYCLE,
  audioDeviceCurrent,
  audioDeviceCycleError,
  audioDeviceFormLabel,
  audioDeviceKindTitle,
  audioDeviceList,
  audioDeviceMatchesRef,
  audioDeviceRefFromView,
  audioDeviceRefLabel,
  filterAudioDevices,
  moveAudioDeviceRef,
  normalizeAudioDeviceRef,
  removeAudioDeviceRef,
  resolveAudioDeviceRef,
} from '../lib/audioDevices'
import { useAudioDevices } from '../lib/useAudioDevices'
import { Icon } from './Icons'
import { Modal } from './Primitives'

type PickerMode = 'set' | 'cycle'

function seedSelection(initial: readonly AudioDeviceRef[], mode: PickerMode): AudioDeviceRef[] {
  const next: AudioDeviceRef[] = []
  const seen = new Set<string>()
  for (const value of initial) {
    const ref = normalizeAudioDeviceRef(value)
    if (!ref) continue
    const key = ref.id ? `id:${ref.id.toLowerCase()}` : `name:${ref.name!.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(ref)
    if (mode === 'set') break
  }
  return next
}

/**
 * Live endpoint picker for Add action and the Inspector cards.
 *
 * Set mode chooses one target. Cycle mode builds an ordered 2..8 list in a
 * numbered tray; saved refs that are currently unplugged stay in the tray (so
 * an edit never silently drops a fallback name) but cannot be picked fresh.
 */
export function AudioDeviceDialog({
  kind,
  mode,
  initial = [],
  title,
  description,
  onPick,
  onClose,
}: {
  kind: AudioDeviceKind
  mode: PickerMode
  initial?: readonly AudioDeviceRef[]
  title?: string
  description?: string
  onPick: (refs: AudioDeviceRef[]) => void
  onClose: () => void
}) {
  const audio = useAudioDevices(true)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<AudioDeviceRef[]>(() => seedSelection(initial, mode))
  const [preselected, setPreselected] = useState(() => initial.length > 0)
  const [stale, setStale] = useState(false)

  const devices = useMemo(() => audioDeviceList(audio.result, kind), [audio.result, kind])
  const current = audioDeviceCurrent(audio.result, kind)
  const rows = useMemo(
    () =>
      filterAudioDevices(devices, query)
        .slice()
        .sort((a, b) => Number(b.current) - Number(a.current)),
    [devices, query],
  )
  const cycleError = mode === 'cycle' ? audioDeviceCycleError(selection) : null

  // Preselect the current OS default on first open so "Set output device"
  // starts from the device the PC is already using.
  useEffect(() => {
    if (preselected || mode !== 'set' || !audio.result?.ok) return
    setPreselected(true)
    if (current) setSelection([audioDeviceRefFromView(current)])
  }, [audio.result, current, mode, preselected])

  useEffect(() => {
    if (!audio.loadedAt) {
      setStale(false)
      return
    }
    setStale(false)
    const timer = window.setTimeout(() => setStale(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [audio.loadedAt])

  const kindTitle = audioDeviceKindTitle(kind)
  const selectedCount = selection.length
  const primaryDisabled = mode === 'set' ? selectedCount !== 1 : cycleError !== null
  const primaryLabel =
    mode === 'set'
      ? 'Use device'
      : selectedCount >= 2
        ? `Use ${selectedCount} devices`
        : 'Pick 2–8 devices'

  const isSelected = (view: AudioDeviceView): boolean =>
    selection.some((ref) => audioDeviceMatchesRef(ref, view))

  const selectionIndex = (view: AudioDeviceView): number =>
    selection.findIndex((ref) => audioDeviceMatchesRef(ref, view))

  const toggleRow = (view: AudioDeviceView): void => {
    if (isSelected(view)) {
      setSelection((list) => list.filter((ref) => !audioDeviceMatchesRef(ref, view)))
      return
    }
    const ref = audioDeviceRefFromView(view)
    if (mode === 'set') {
      setSelection([ref])
      return
    }
    setSelection((list) => (list.length >= AUDIO_DEVICE_MAX_CYCLE ? list : [...list, ref]))
  }

  const trayRows = selection.map((ref) => ({
    ref,
    view: resolveAudioDeviceRef(ref, devices),
  }))

  return (
    <Modal
      title={title ?? (mode === 'cycle' ? `Cycle ${kind} devices` : `Choose an ${kind} device`)}
      subtitle={
        description ??
        (mode === 'cycle'
          ? 'Pick 2–8 devices in play order. Cycle skips anything that is not connected.'
          : 'This PC reports only active endpoints. Connect a Bluetooth headset in the OS first.')
      }
      onClose={onClose}
      compact
      footer={
        <>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void audio.refresh(true)}
            disabled={audio.loading}
          >
            <Icon name="refresh" size={14} /> {audio.loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) return
              onPick(selection.map((ref) => normalizeAudioDeviceRef(ref)).filter((ref): ref is AudioDeviceRef => ref !== null))
            }}
          >
            {primaryLabel}
          </button>
        </>
      }
    >
      <div className="audio-device-picker-head">
        <span className="mono">{kindTitle.toUpperCase()}</span>
        <span className="mono audio-device-count">
          {audio.result?.ok ? `${devices.length} reported` : audio.loading ? 'READING' : 'UNAVAILABLE'}
        </span>
      </div>

      <label className="preset-search audio-device-search">
        <span className="preset-search-icon">
          <Icon name="search" size={15} />
        </span>
        <input
          value={query}
          placeholder={`Search ${kind} devices or tags (USB, HDMI…)`}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        {query && (
          <button
            type="button"
            className="preset-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </label>

      {audio.result && !audio.result.ok ? (
        <div className="mixer-picker-empty audio-device-empty">
          <Icon name="music" size={26} />
          <strong>Audio device switching is not available on this PC</strong>
          <p>{audio.result.error?.trim() || 'The desktop audio controller is not running.'}</p>
          <p className="hint">Device targets are still editable, but Test and press need the controller.</p>
        </div>
      ) : !audio.loaded && audio.loading ? (
        <div className="audio-device-skeleton" aria-label="Loading audio devices">
          {[0, 1, 2].map((index) => (
            <span key={index} />
          ))}
        </div>
      ) : audio.error && !audio.result ? (
        <div className="mixer-picker-empty audio-device-empty">
          <Icon name="music" size={26} />
          <strong>Could not read this PC’s audio devices</strong>
          <p>{audio.error}</p>
          <button type="button" className="button secondary small" onClick={() => void audio.refresh(true)}>
            <Icon name="refresh" size={14} /> Try again
          </button>
        </div>
      ) : devices.length === 0 ? (
        <div className="mixer-picker-empty audio-device-empty">
          <Icon name="music" size={26} />
          <strong>No {kind} devices reported by this PC</strong>
          <p>Connect the device in the OS, then press Refresh.</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="hint">No {kind} device matches “{query}”.</p>
      ) : (
        <div className="audio-device-list">
          {rows.map((view) => {
            const tag = audioDeviceFormLabel(view.form)
            const selected = isSelected(view)
            const order = mode === 'cycle' ? selectionIndex(view) : -1
            return (
              <button
                key={view.id}
                type="button"
                className={`audio-device-row${selected ? ' selected' : ''}`}
                onClick={() => toggleRow(view)}
                aria-pressed={selected}
                disabled={view.available === false}
              >
                <span className={`audio-device-led${view.current ? ' lit' : ''}`} aria-hidden="true" />
                <span className="audio-device-row-main">
                  <strong>{view.name}</strong>
                  <small>
                    {tag ?? kindTitle.toUpperCase()}
                    {view.available === false ? ' · OFFLINE' : ''}
                  </small>
                </span>
                {view.current && <span className="audio-device-current">CURRENT</span>}
                {mode === 'cycle' && selected && <span className="audio-device-order">{order + 1}</span>}
                {mode === 'set' && selected && <Icon name="check" size={15} />}
              </button>
            )
          })}
        </div>
      )}

      {mode === 'cycle' && (
        <div className="audio-device-tray">
          <div className="audio-device-tray-head">
            <span className="mono">CYCLE ORDER</span>
            <span className="mono">{selectedCount}/8</span>
          </div>
          {trayRows.length === 0 ? (
            <p className="hint">Pick at least two devices above. Tap again to remove one.</p>
          ) : (
            <ol className="audio-device-chips">
              {trayRows.map(({ ref, view }, index) => {
                const tag = audioDeviceFormLabel(view?.form)
                return (
                  <li key={`${ref.id ?? ref.name}-${index}`} className="audio-device-chip">
                    <span className="audio-device-chip-index mono">{index + 1}</span>
                    <span className="audio-device-chip-copy">
                      <strong>{view?.name ?? audioDeviceRefLabel(ref)}</strong>
                      <small className="mono">
                        {view ? (tag ?? kindTitle.toUpperCase()) : 'NOT CONNECTED'}
                        {view?.current ? ' · CURRENT' : ''}
                      </small>
                    </span>
                    <span className="audio-device-chip-tools">
                      <button
                        type="button"
                        className="icon-button tiny"
                        aria-label={`Move ${audioDeviceRefLabel(ref)} up`}
                        disabled={index === 0}
                        onClick={() =>
                          setSelection((list) => moveAudioDeviceRef(list, index, -1))
                        }
                      >
                        <Icon name="arrow-up" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button tiny"
                        aria-label={`Move ${audioDeviceRefLabel(ref)} down`}
                        disabled={index === trayRows.length - 1}
                        onClick={() =>
                          setSelection((list) => moveAudioDeviceRef(list, index, 1))
                        }
                      >
                        <Icon name="arrow-down" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button tiny danger"
                        aria-label={`Remove ${audioDeviceRefLabel(ref)}`}
                        onClick={() => setSelection((list) => removeAudioDeviceRef(list, index))}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          {cycleError && selection.length > 0 && (
            <p className="hint error-text">{cycleError}</p>
          )}
        </div>
      )}

      <div className="row between audio-device-picker-foot">
        <span className="hint">
          {stale && !audio.loading
            ? 'List is over 10 s old — refresh before saving if a device was just plugged in.'
            : 'Only active endpoints are listed. OBS keeps its own audio device.'}
        </span>
        {audio.result?.ok && current && (
          <span className="mono audio-device-now">
            NOW · {current.name}
          </span>
        )}
      </div>
    </Modal>
  )
}
