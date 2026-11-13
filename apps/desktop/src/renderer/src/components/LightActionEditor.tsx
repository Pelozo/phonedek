import type { LightAction } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  lightActionOperation,
  lightActionWithLight,
  lightActionWithOperation,
  lightAvailability,
  lightEndpoint,
  type LightActionOperation,
} from '../lib/lights'

const OPERATIONS: Array<{ value: LightActionOperation; label: string }> = [
  { value: 'on', label: 'Set power on' },
  { value: 'off', label: 'Set power off' },
  { value: 'toggle', label: 'Toggle power' },
]

/**
 * Local-light action fields. Actions run through the desktop's Elgato HTTP
 * client; the phone only sends the press.
 */
export function LightActionEditor({
  action,
  server,
  onUpdate,
}: {
  action: LightAction
  server: ServerInfoView | null
  onUpdate: (action: LightAction) => void
}) {
  const lights = server?.settings.lights ?? []
  const enabled = server?.settings.lightsEnabled ?? false
  const availability = lightAvailability({ enabled, lights, selected: action.light })
  const selected = action.light?.trim() ?? ''
  const selectedIsMissing =
    selected.length > 0 && !lights.some((light) => light.id === selected)

  return (
    <div className="stack">
      <div className={`obs-availability ${availability.tone}`}>
        <strong>{availability.label}</strong>
        <small>{availability.detail}</small>
      </div>

      <label className="field">
        <span>Light operation</span>
        <select
          value={lightActionOperation(action)}
          onChange={(event) =>
            onUpdate(lightActionWithOperation(action, event.target.value as LightActionOperation))
          }
        >
          {OPERATIONS.map((operation) => (
            <option key={operation.value} value={operation.value}>
              {operation.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Light</span>
        <select
          value={selected}
          onChange={(event) => onUpdate(lightActionWithLight(action, event.target.value || undefined))}
          disabled={!enabled || lights.length === 0}
        >
          <option value="">First configured light</option>
          {selectedIsMissing && <option value={selected}>{selected} (missing — pick again)</option>}
          {lights.map((light) => (
            <option key={light.id} value={light.id}>
              {light.name} · {lightEndpoint(light)}
            </option>
          ))}
        </select>
      </label>

      <p className="hint">
        {enabled && lights.length > 0
          ? 'Talks to the light over local HTTP. No Elgato account or cloud login is used. Tapping the tile presses every action in order.'
          : 'Add an Elgato light in Settings → Lights, then enable local light control. The action stays saved until a light is available.'}
      </p>
    </div>
  )
}
