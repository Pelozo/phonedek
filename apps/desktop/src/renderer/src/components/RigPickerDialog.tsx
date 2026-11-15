import type { DeckConfig, RigPreset } from '@phonedek/shared'
import { estimateRigMs } from '@phonedek/shared'
import { formatRigDuration, rigsOf } from '../lib/rigs'
import { Icon } from './Icons'
import { Modal } from './Primitives'

/**
 * Rig picker used by Inspector → Add action → Automation → Run rig.
 * Selecting a rig replaces the button's actions with one rig action.
 */
export function RigPickerDialog({
  config,
  onPick,
  onClose,
  onOpenLibrary,
}: {
  config: DeckConfig
  onPick: (rig: RigPreset) => void
  onClose: () => void
  onOpenLibrary: () => void
}) {
  const rigs = rigsOf(config)
  return (
    <Modal
      title="Run a rig"
      subtitle="A rig button is tap-only and runs its guarded step list on this PC."
      onClose={onClose}
      className="rig-picker-modal"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onOpenLibrary}>
            <Icon name="bolt" size={15} /> Manage rigs
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {rigs.length === 0 ? (
        <div className="empty-state small rig-picker-empty">
          <Icon name="bolt" size={24} />
          <p>No rigs yet. Build a guarded sequence in the rig library first.</p>
          <button type="button" className="button primary" onClick={onOpenLibrary}>
            Open rig library
          </button>
        </div>
      ) : (
        <div className="rig-picker-list">
          {rigs.map((rig) => (
            <button
              key={rig.id}
              type="button"
              className="rig-picker-item"
              onClick={() => onPick(rig)}
            >
              <span className="rig-picker-icon">{rig.icon || '⚡'}</span>
              <span className="rig-picker-text">
                <strong>{rig.name}</strong>
                <small>
                  {rig.steps.length} step{rig.steps.length === 1 ? '' : 's'} ·{' '}
                  {rig.guards?.length ?? 0} guard{(rig.guards?.length ?? 0) === 1 ? '' : 's'} · ~
                  {formatRigDuration(estimateRigMs(rig))}
                </small>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
