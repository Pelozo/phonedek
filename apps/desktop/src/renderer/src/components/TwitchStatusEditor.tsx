import type { TwitchStateBinding, TwitchStateTarget } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  TWITCH_STATE_TARGETS,
  twitchStateBadge,
  twitchStateTargetInfo,
  twitchStatusSummary,
} from '../lib/twitch'

/**
 * Read-only Twitch status binding for a normal button. This only drives
 * control-state-v1 readback and never adds a tap action.
 */
export function TwitchStatusEditor({
  binding,
  server,
  onUpdate,
}: {
  binding: TwitchStateBinding
  server: ServerInfoView | null
  onUpdate: (binding: TwitchStateBinding) => void
}) {
  const info = twitchStateTargetInfo(binding.target)
  const summary = twitchStatusSummary(server?.twitchStatus)

  return (
    <div className="stack">
      <label className="field">
        <span>Twitch readout</span>
        <select
          value={binding.target}
          onChange={(event) =>
            onUpdate({ type: 'twitch', target: event.target.value as TwitchStateTarget })
          }
        >
          {TWITCH_STATE_TARGETS.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
        </select>
      </label>

      <div className={`twitch-status ${summary.tone}`}>
        <span
          className={`dot ${
            summary.tone === 'ok' ? 'online' : summary.tone === 'error' ? 'error' : 'offline'
          }`}
          aria-hidden="true"
        />
        <div>
          <strong>{summary.label}</strong>
          <small>{summary.detail}</small>
        </div>
      </div>

      <div className="twitch-state-hint">
        <span className="twitch-state-pill">{twitchStateBadge(binding.target)}</span>
        <p>{info.hint}</p>
      </div>
      <p className="hint">
        The editor badge is static ({twitchStateBadge(binding.target)}); the phone shows the live
        Twitch value. This tile is read-only — tapping it sends nothing.
      </p>
    </div>
  )
}
