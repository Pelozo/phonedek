import type { AppVolumeAction } from '@phonedek/shared'
import {
  appProcessKey,
  appVolumeActionMode,
  appVolumeActionSummary,
  appVolumeActionWithMode,
  appVolumeActionWithProcess,
  mixerProcessOptions,
} from '../lib/appVolume'
import { useMixerSnapshot } from '../lib/useMixerSnapshot'
import { MixerSessionSelect } from './MixerSessionSelect'
import { Icon } from './Icons'

const MODES = [
  { value: 'toggle', label: 'Toggle mute' },
  { value: 'mute', label: 'Mute' },
  { value: 'unmute', label: 'Unmute' },
] as const

/**
 * Per-app mute action. `match.process` is resolved by the desktop at press
 * time, so the action keeps working when a browser restarts and gets a new
 * session id. The picker only supplies a valid process name.
 */
export function AppVolumeActionEditor({
  action,
  onUpdate,
}: {
  action: AppVolumeAction
  onUpdate: (action: AppVolumeAction) => void
}) {
  const mixer = useMixerSnapshot(true)
  const selected = action.match.process?.trim() ?? ''
  const option = mixerProcessOptions(mixer.snapshot).find(
    (item) => appProcessKey(item.process) === appProcessKey(selected),
  )

  return (
    <div className="stack">
      <label className="field">
        <span>Operation</span>
        <select
          value={appVolumeActionMode(action)}
          onChange={(event) =>
            onUpdate(appVolumeActionWithMode(action, event.target.value as 'toggle' | 'mute' | 'unmute'))
          }
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>

      <MixerSessionSelect
        selected={selected}
        state={mixer}
        onSelect={(process) => onUpdate(appVolumeActionWithProcess(action, process))}
        hint="Matching is by app/process, case-insensitive and .exe-insensitive. Browser tabs often share one process."
      />

      {option && (
        <div className="preview-strip">
          <Icon name="sliders" size={15} />
          <span>
            <strong>{option.name}</strong> · {option.muted ? 'currently MUTED' : `${Math.round(option.volume)}%`}
            {option.count > 1 ? ` · ${option.count} sessions` : ''}
          </span>
        </div>
      )}

      <p className="hint">
        {appVolumeActionSummary(action)}. Use the test button above to run it on this PC.
      </p>
    </div>
  )
}
