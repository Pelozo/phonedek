import type { AppVolumeStateBinding, AppVolumeStateTarget } from '@phonedek/shared'
import {
  APP_MUTE_BADGE,
  APP_VOLUME_BADGE,
  appVolumeMatch,
  appVolumeStateBadge,
} from '../lib/appVolume'
import { useMixerSnapshot } from '../lib/useMixerSnapshot'
import { MixerSessionSelect } from './MixerSessionSelect'

/**
 * Read-only per-app volume/mute status binding for a normal button. It feeds
 * control-state-v1 (42%, MUTED, NO SESSION) and never adds a tap action by
 * itself; the phone status tile stays read-only.
 */
export function AppVolumeStatusEditor({
  binding,
  onUpdate,
}: {
  binding: AppVolumeStateBinding
  onUpdate: (binding: AppVolumeStateBinding) => void
}) {
  const mixer = useMixerSnapshot(true)
  const selected = binding.match.process?.trim() ?? ''

  return (
    <div className="stack">
      <label className="field">
        <span>App readout</span>
        <select
          value={binding.target}
          onChange={(event) =>
            onUpdate({ ...binding, target: event.target.value as AppVolumeStateTarget })
          }
        >
          <option value="volume">Volume · 42%</option>
          <option value="mute">Mute · MUTED</option>
        </select>
      </label>

      <MixerSessionSelect
        selected={selected}
        state={mixer}
        onSelect={(process) =>
          onUpdate({ ...binding, match: appVolumeMatch(process) })
        }
        hint="The phone shows the live app level, MUTED, or NO SESSION while this tile is visible."
      />

      <div className="twitch-state-hint light-state-hint">
        <span className="twitch-state-pill">{appVolumeStateBadge(binding.target)}</span>
        <p>
          {binding.target === 'mute'
            ? `Live mute readout for ${selected || 'the selected app'}.`
            : `Live percentage readout for ${selected || 'the selected app'}.`}
        </p>
      </div>

      <p className="hint mono app-status-badges">
        {APP_VOLUME_BADGE} / {APP_MUTE_BADGE} · editor badge is static; the phone paints the live
        value.
      </p>
      <p className="hint">
        Browser tabs may share one process. The tile follows the process match, so it can show the
        same level for every tab in that browser.
      </p>
    </div>
  )
}
