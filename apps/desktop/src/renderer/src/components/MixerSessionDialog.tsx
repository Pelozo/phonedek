import type { MixerSession } from '@phonedek/shared'
import {
  appProcessKey,
  mixerAvailability,
  mixerProcessOptions,
  mixerSessionDetail,
} from '../lib/appVolume'
import { useMixerSnapshot } from '../lib/useMixerSnapshot'
import { Icon } from './Icons'
import { Modal } from './Primitives'

/**
 * Add-control/action session picker. It always asks the deterministic mixer
 * snapshot for the live list; sessions are grouped visually by process but a
 * click keeps the process match because browser tabs may share one process.
 */
export function MixerSessionDialog({
  title,
  description,
  selectedProcess,
  onPick,
  onClose,
}: {
  title: string
  description?: string
  selectedProcess?: string
  onPick: (session: MixerSession) => void
  onClose: () => void
}) {
  const mixer = useMixerSnapshot(true)
  const availability = mixerAvailability(mixer.snapshot, undefined, mixer.error)
  const options = mixerProcessOptions(mixer.snapshot)
  const ambiguous = new Set(
    options.filter((option) => option.ambiguous || option.count > 1).map((option) => appProcessKey(option.process)),
  )

  return (
    <Modal
      title={title}
      subtitle={description ?? 'Choose the app whose audio this will control. You can change it later in the Inspector.'}
      onClose={onClose}
      compact
      footer={
        <>
          <span className="hint mixer-dialog-hint">
            Browser tabs often share one audio process — the control follows the app, not a tab.
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => void mixer.refresh()}
            disabled={mixer.loading}
          >
            <Icon name="refresh" size={14} /> {mixer.loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className={`obs-availability ${availability.tone} mixer-dialog-status`}>
        <strong>{availability.label}</strong>
        <small>{availability.detail}</small>
      </div>

      {!mixer.loaded && mixer.loading ? (
        <p className="hint">Reading desktop audio sessions…</p>
      ) : mixer.snapshot && !mixer.snapshot.available ? (
        <div className="mixer-picker-empty">
          <Icon name="sliders" size={26} />
          <strong>Per-app audio is unavailable</strong>
          <p>{mixer.snapshot.reason?.trim() || 'This desktop cannot expose per-app audio sessions.'}</p>
          <p className="hint">
            Per-app volume is supported on Windows and Linux. macOS has no public per-app
            volume API.
          </p>
        </div>
      ) : !mixer.snapshot || mixer.snapshot.sessions.length === 0 ? (
        <div className="mixer-picker-empty">
          <Icon name="music" size={26} />
          <strong>No app is playing audio</strong>
          <p>Start playback in the app you want to control, then press Refresh.</p>
        </div>
      ) : (
        <div className="mixer-session-list">
          {mixer.snapshot.sessions.map((session) => {
            const key = appProcessKey(session.process)
            const selected = selectedProcess
              ? appProcessKey(selectedProcess) === key
              : false
            return (
              <button
                key={session.id}
                type="button"
                className={`mixer-session-option${selected ? ' selected' : ''}`}
                onClick={() => onPick(session)}
              >
                <span className="mixer-session-icon">
                  <Icon name="sliders" size={17} />
                </span>
                <span className="mixer-session-copy">
                  <strong>{session.name || session.process}</strong>
                  <small className="mono">
                    {session.process}
                    {ambiguous.has(key) ? ' · SHARED PROCESS' : ''}
                    {session.available === false ? ' · OFFLINE' : ''}
                  </small>
                </span>
                <span className="mixer-session-level">
                  <span className={`mono${session.muted ? ' muted' : ''}`}>
                    {mixerSessionDetail(session)}
                  </span>
                  <span className="mixer-session-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(100, session.volume))}%` }} />
                  </span>
                </span>
                {selected && <Icon name="check" size={15} />}
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
