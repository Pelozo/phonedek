import {
  appProcessKey,
  mixerAvailability,
  mixerProcessOptions,
} from '../lib/appVolume'
import type { MixerSnapshotState } from '../lib/useMixerSnapshot'
import { Icon } from './Icons'

/**
 * Process picker shared by the Inspector, app-mute action editor and status
 * editor. The saved process is always preserved as a missing option so opening
 * a config offline never silently retargets the control.
 */
export function MixerSessionSelect({
  label = 'Application',
  selected,
  state,
  onSelect,
  disabled = false,
  hint,
}: {
  label?: string
  selected?: string
  state: MixerSnapshotState
  onSelect: (process: string | undefined) => void
  disabled?: boolean
  hint?: string
}) {
  const options = mixerProcessOptions(state.snapshot)
  const availability = mixerAvailability(state.snapshot, selected, state.error)
  const clean = selected?.trim() ?? ''
  const selectedIsMissing =
    clean.length > 0 && !options.some((option) => appProcessKey(option.process) === appProcessKey(clean))
  const parserUnavailable = state.snapshot?.available === false
  const noPickableApps =
    state.snapshot?.available === true && state.snapshot.sessions.length === 0 && !selectedIsMissing

  return (
    <div className="stack mixer-session-field">
      <label className="field">
        <span>{label}</span>
        <div className="row gap">
          <select
            value={clean}
            disabled={disabled || parserUnavailable || noPickableApps || (!state.loaded && state.loading)}
            onChange={(event) => onSelect(event.target.value || undefined)}
          >
            {!clean && <option value="">Pick an app…</option>}
            {selectedIsMissing && (
              <option value={clean}>{clean} (missing — pick again)</option>
            )}
            {options.map((option) => (
              <option key={option.process} value={option.process}>
                {option.name === option.process ? option.process : `${option.name} · ${option.process}`}
                {option.count > 1 ? ` · ${option.count} sessions` : ''}
                {option.muted ? ' · muted' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button ghost small mixer-refresh"
            title="Refresh the live app list"
            onClick={() => void state.refresh()}
            disabled={state.loading}
          >
            <Icon name="refresh" size={14} />
            {state.loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </label>

      <div className={`obs-availability ${availability.tone}`}>
        <strong>{availability.label}</strong>
        <small>{availability.detail}</small>
      </div>

      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}
