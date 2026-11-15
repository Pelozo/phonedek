import type { RigPreset, RigStateBinding } from '@phonedek/shared'
import { findRig } from '../lib/rigs'
import { Icon } from './Icons'

/**
 * Read-only rig status source. The status is the last-run result, not a live
 * world read: it changes only when a rig runs, never when OBS/Twitch changes
 * on its own.
 */
export function RigStatusEditor({
  rigs,
  binding,
  onUpdate,
  onOpenRig,
  onOpenLibrary,
}: {
  rigs: readonly RigPreset[]
  binding: RigStateBinding
  onUpdate: (state: RigStateBinding) => void
  onOpenRig: (id: string) => void
  onOpenLibrary: () => void
}) {
  const rig = findRig(rigs, binding.presetId)
  const missing = rig === undefined && rigs.length > 0
  return (
    <div className="stack rig-status-editor">
      <label className="field">
        <span>Rig</span>
        <select
          value={binding.presetId}
          onChange={(event) => onUpdate({ type: 'rig', presetId: event.target.value })}
        >
          {missing && (
            <option value={binding.presetId}>{binding.presetId} (missing — pick again)</option>
          )}
          {rigs.length === 0 && <option value={binding.presetId}>No rigs configured</option>}
          {rigs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.steps.length} step{item.steps.length === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>

      <div className="rig-status-source-note">
        <Icon name="clock" size={15} />
        <span>
          <strong>Last-run truth, not current-world truth.</strong> The tile shows the outcome of the
          last editor/phone run and its age. It never polls OBS, Twitch or the deck state.
        </span>
      </div>

      <div className="row gap">
        {rig ? (
          <button type="button" className="button secondary small" onClick={() => onOpenRig(rig.id)}>
            <Icon name="bolt" size={14} /> Edit rig
          </button>
        ) : (
          <button type="button" className="button secondary small" onClick={onOpenLibrary}>
            <Icon name="bolt" size={14} /> Open rig library
          </button>
        )}
        {missing && <span className="hint error-text">This rig was deleted. Pick another one.</span>}
      </div>
    </div>
  )
}
