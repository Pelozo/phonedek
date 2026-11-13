import type { LightDeviceView } from '../../../shared/api'
import { lightEndpoint } from '../lib/lights'
import { Icon } from './Icons'
import { Modal } from './Primitives'

/**
 * Small picker used by Add control and Add action. It lists only configured
 * devices; the empty state points at Settings → Lights instead of pretending
 * there is a default device.
 */
export function LightPickerDialog({
  title,
  description,
  lights,
  onPick,
  onOpenSettings,
  onClose,
}: {
  title: string
  description: string
  lights: readonly LightDeviceView[]
  onPick: (light: string | undefined) => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} subtitle={description} onClose={onClose} compact>
      {lights.length === 0 ? (
        <div className="light-picker-empty">
          <Icon name="light" size={26} />
          <strong>No lights configured</strong>
          <p>
            Add an Elgato Key Light in Settings → Lights. PhoneDeck talks to each light over local
            HTTP — no Elgato account is needed.
          </p>
          <button type="button" className="button primary small" onClick={onOpenSettings}>
            <Icon name="settings" size={14} /> Open Settings → Lights
          </button>
        </div>
      ) : (
        <div className="light-picker-list">
          <button
            type="button"
            className="light-pick"
            onClick={() => onPick(undefined)}
          >
            <span className="light-pick-icon">
              <Icon name="light" size={18} />
            </span>
            <span>
              <strong>First configured light</strong>
              <small>Follows the device order in Settings → Lights ({lights[0]?.name})</small>
            </span>
            <span className="mono light-pick-tag">DEFAULT</span>
          </button>
          {lights.map((light) => (
            <button
              type="button"
              key={light.id}
              className="light-pick"
              onClick={() => onPick(light.id)}
            >
              <span className="light-pick-icon">
                <Icon name="light" size={18} />
              </span>
              <span>
                <strong>{light.name}</strong>
                <small className="mono">
                  {lightEndpoint(light)} · ELGATO
                </small>
              </span>
              <span className="mono light-pick-tag">{light.id}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
