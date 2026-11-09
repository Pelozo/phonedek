import type { ObsInputView } from '../../../shared/api'
import { useObsInputs } from '../lib/useObsInputs'
import { Icon } from './Icons'
import { Modal } from './Primitives'

/**
 * Small picker used by Add control. It always asks OBS for the live list, so a
 * control is only created with a real input name from the current scene
 * collection.
 */
export function ObsInputDialog({
  selected,
  onPick,
  onClose,
}: {
  selected?: string
  onPick: (input: ObsInputView) => void
  onClose: () => void
}) {
  const { inputs, loading, loaded, error, refresh } = useObsInputs(true)

  return (
    <Modal
      title="Choose an OBS input"
      subtitle="OBS sources and audio devices from the current scene collection."
      onClose={onClose}
      compact
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
      }
    >
      {error ? (
        <p className="hint error-text">{error}</p>
      ) : !loaded && inputs.length === 0 ? (
        <p className="hint">Loading OBS inputs…</p>
      ) : inputs.length === 0 ? (
        <p className="hint">OBS has no inputs — add a source in OBS first.</p>
      ) : (
        <div className="obs-input-list">
          {inputs.map((input) => (
            <button
              key={input.name}
              type="button"
              className={`obs-input-option${selected === input.name ? ' selected' : ''}`}
              onClick={() => onPick(input)}
            >
              <span className="obs-input-name">
                <strong>{input.name}</strong>
                <small>{input.kind || 'OBS input'}</small>
              </span>
              {input.audio && <span className="obs-input-tag">AUDIO</span>}
              {selected === input.name && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}

      <div className="row between">
        <span className="hint">
          {inputs.length === 0
            ? 'Only inputs in the current OBS scene collection are listed.'
            : `${inputs.length} input${inputs.length === 1 ? '' : 's'} · names are scene-collection scoped.`}
        </span>
        <button type="button" className="button ghost small" onClick={() => void refresh()} disabled={loading}>
          <Icon name="refresh" size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </Modal>
  )
}
