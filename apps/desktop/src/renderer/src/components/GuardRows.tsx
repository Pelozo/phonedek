import type { RigGuard, RigGuardProbe } from '@phonedek/shared'
import { RIG_GUARD_LABELS } from '@phonedek/shared'
import type { LightDeviceView } from '../../../shared/api'
import { rigGuardLabel } from '../lib/rigs'
import { Icon } from './Icons'

/**
 * Shared ONLY IF / guard row UI.
 *
 * The Rig Library and the rule editor use the same probes, argument fields and
 * generated label, so a guard means exactly the same thing in both places. The
 * owner renders the section header and its Add button; this file owns the rows.
 */
export function guardWithProbe(guard: RigGuard, probe: RigGuardProbe): RigGuard {
  const next: RigGuard = { probe }
  if (guard.expect !== undefined) next.expect = guard.expect
  if (guard.label) next.label = guard.label
  if (probe === 'appRunning') next.arg = guard.arg ?? ''
  if (probe === 'lightOn' && guard.arg) next.arg = guard.arg
  return next
}

export function GuardRow({
  guard,
  index,
  lights,
  onChange,
  onRemove,
}: {
  guard: RigGuard
  index: number
  lights: readonly LightDeviceView[]
  onChange: (guard: RigGuard) => void
  onRemove: () => void
}) {
  return (
    <div className="rig-guard-row">
      <span className="rig-row-index mono">{String(index + 1).padStart(2, '0')}</span>
      <div className="rig-guard-main">
        <div className="rig-guard-controls">
          <label className="field">
            <span>Probe</span>
            <select
              value={guard.probe}
              onChange={(event) =>
                onChange(guardWithProbe(guard, event.target.value as RigGuardProbe))
              }
            >
              {(Object.keys(RIG_GUARD_LABELS) as RigGuardProbe[]).map((probe) => (
                <option key={probe} value={probe}>
                  {RIG_GUARD_LABELS[probe]}
                </option>
              ))}
            </select>
          </label>
          {guard.probe === 'appRunning' && (
            <label className="field">
              <span>Application</span>
              <input
                value={guard.arg ?? ''}
                placeholder="discord.exe"
                onChange={(event) => onChange({ ...guard, arg: event.target.value })}
              />
            </label>
          )}
          {guard.probe === 'lightOn' && (
            <label className="field">
              <span>Light</span>
              <select
                value={guard.arg ?? ''}
                onChange={(event) =>
                  onChange({ ...guard, arg: event.target.value || undefined })
                }
              >
                <option value="">First configured light</option>
                {lights.map((light) => (
                  <option key={light.id} value={light.id}>
                    {light.name}
                  </option>
                ))}
                {guard.arg && !lights.some((light) => light.id === guard.arg) && (
                  <option value={guard.arg}>{guard.arg} (missing)</option>
                )}
              </select>
            </label>
          )}
          <label className="field">
            <span>Expect</span>
            <select
              value={guard.expect === false ? 'is-not' : 'is'}
              onChange={(event) => onChange({ ...guard, expect: event.target.value === 'is' })}
            >
              <option value="is">is</option>
              <option value="is-not">is not</option>
            </select>
          </label>
        </div>
        <span className="rig-guard-generated mono">{rigGuardLabel(guard)}</span>
      </div>
      <button
        type="button"
        className="icon-button tiny danger"
        onClick={onRemove}
        aria-label={`Remove guard ${index + 1}`}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  )
}

/** Rows only; the parent owns the “+ add” row and the count. */
export function GuardRows({
  guards,
  lights,
  onChange,
}: {
  guards: readonly RigGuard[]
  lights: readonly LightDeviceView[]
  onChange: (guards: RigGuard[]) => void
}) {
  return (
    <div className="rig-guard-list">
      {guards.map((guard, index) => (
        <GuardRow
          key={`${guard.probe}-${index}`}
          guard={guard}
          index={index}
          lights={lights}
          onChange={(next) =>
            onChange(guards.map((candidate, current) => (current === index ? next : candidate)))
          }
          onRemove={() => onChange(guards.filter((_, current) => current !== index))}
        />
      ))}
    </div>
  )
}
