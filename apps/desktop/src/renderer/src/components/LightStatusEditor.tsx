import type { LightStateBinding, LightTarget } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  LIGHT_TARGETS,
  lightAvailability,
  lightStateBadge,
  lightTargetInfo,
} from '../lib/lights'

/**
 * Read-only local-light status binding for a normal button. It only drives
 * control-state-v1 readback and never adds a tap action.
 */
export function LightStatusEditor({
  binding,
  server,
  onUpdate,
}: {
  binding: LightStateBinding
  server: ServerInfoView | null
  onUpdate: (binding: LightStateBinding) => void
}) {
  const info = lightTargetInfo(binding.target)
  const lights = server?.settings.lights ?? []
  const enabled = server?.settings.lightsEnabled ?? false
  const availability = lightAvailability({ enabled, lights, selected: binding.light })
  const selected = binding.light?.trim() ?? ''
  const selectedIsMissing = selected.length > 0 && !lights.some((light) => light.id === selected)

  return (
    <div className="stack">
      <div className="two-col">
        <label className="field">
          <span>Light readout</span>
          <select
            value={binding.target}
            onChange={(event) =>
              onUpdate({ ...binding, target: event.target.value as LightTarget })
            }
          >
            {LIGHT_TARGETS.map((target) => (
              <option key={target.value} value={target.value}>
                {target.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Light</span>
          <select
            value={selected}
            onChange={(event) =>
              onUpdate({
                type: 'light',
                target: binding.target,
                ...(event.target.value ? { light: event.target.value } : {}),
              })
            }
            disabled={!enabled || lights.length === 0}
          >
            <option value="">First configured light</option>
            {selectedIsMissing && <option value={selected}>{selected} (missing — pick again)</option>}
            {lights.map((light) => (
              <option key={light.id} value={light.id}>
                {light.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`obs-availability ${availability.tone}`}>
        <strong>{availability.label}</strong>
        <small>{availability.detail}</small>
      </div>

      <div className="twitch-state-hint light-state-hint">
        <span className="twitch-state-pill">{lightStateBadge(binding.target)}</span>
        <p>{info.statusHint}</p>
      </div>
      <p className="hint">
        The editor badge is static ({lightStateBadge(binding.target)}); the phone shows the live
        light value. This tile is read-only — tapping it sends nothing.
      </p>
    </div>
  )
}
