import { useId } from 'react'
import type { ObsStateBinding, ObsStateTarget } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  OBS_STATE_TARGETS,
  obsInputAvailability,
  obsNameError,
  obsNameOrUndefined,
  obsStateBadge,
  obsStateTargetInfo,
  obsStatusSummary,
} from '../lib/obs'
import { useObsInputs } from '../lib/useObsInputs'

/**
 * Read-only OBS status binding for a normal button. This only drives
 * control-state-v1 readback; tap actions stay untouched.
 */
export function ObsStatusEditor({
  binding,
  server,
  onUpdate,
}: {
  binding: ObsStateBinding
  server: ServerInfoView | null
  onUpdate: (binding: ObsStateBinding) => void
}) {
  const listId = `obs-status-inputs-${useId().replace(/:/g, '')}`
  const info = obsStateTargetInfo(binding.target)
  const { inputs, loaded, loading, refresh } = useObsInputs(info.needsInput)
  const availability = obsInputAvailability({
    status: server?.obsStatus,
    selected: binding.input,
    inputs,
    loaded,
  })
  const summary = obsStatusSummary(server?.obsStatus)
  const sceneError = obsNameError(binding.scene, false)
  const inputError = obsNameError(binding.input, false)

  const setTarget = (target: ObsStateTarget): void => {
    const nextInfo = obsStateTargetInfo(target)
    onUpdate({
      type: 'obs',
      target,
      ...(target === 'scene' && binding.scene ? { scene: binding.scene } : {}),
      ...(nextInfo.needsInput && binding.input ? { input: binding.input } : {}),
    })
  }

  return (
    <div className="stack">
      <label className="field">
        <span>Target</span>
        <select value={binding.target} onChange={(event) => setTarget(event.target.value as ObsStateTarget)}>
          {OBS_STATE_TARGETS.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
        </select>
      </label>

      {info.needsScene && (
        <>
          <label className="field">
            <span>Active when scene (optional)</span>
            <input
              value={binding.scene ?? ''}
              maxLength={128}
              spellCheck={false}
              placeholder="Blank — show the program scene without an active match"
              aria-invalid={sceneError ? true : undefined}
              onChange={(event) =>
                onUpdate({
                  ...binding,
                  scene: obsNameOrUndefined(event.target.value),
                })
              }
            />
          </label>
          {sceneError && <p className="hint error-text">{sceneError}</p>}
        </>
      )}

      {info.needsInput && (
        <>
          <label className="field">
            <span>OBS input</span>
            <input
              value={binding.input ?? ''}
              maxLength={128}
              spellCheck={false}
              list={listId}
              placeholder="Default — first audio input"
              aria-invalid={inputError ? true : undefined}
              onChange={(event) =>
                onUpdate({
                  ...binding,
                  input: obsNameOrUndefined(event.target.value),
                })
              }
            />
            <datalist id={listId}>
              {inputs.map((input) => (
                <option key={input.name} value={input.name}>
                  {input.audio ? 'Audio input' : input.kind || 'OBS input'}
                </option>
              ))}
            </datalist>
          </label>
          {inputError && <p className="hint error-text">{inputError}</p>}
          <div className={`obs-availability ${availability.tone}`}>
            <strong>{availability.label}</strong>
            <small>{availability.detail}</small>
          </div>
          <div className="row between">
            <span className="hint">Input names are scene-collection scoped.</span>
            <button
              type="button"
              className="button ghost small"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh inputs'}
            </button>
          </div>
        </>
      )}

      <div
        className={`obs-availability ${
          summary.tone === 'ok' ? 'ok' : summary.tone === 'error' ? 'error' : 'warn'
        }`}
      >
        <strong>{summary.label.toUpperCase()}</strong>
        <small>{summary.detail}</small>
      </div>

      <div className="obs-state-hint">
        <span className="obs-state-pill">{obsStateBadge(binding.target)}</span>
        <p>{info.hint}</p>
      </div>
      <p className="hint">
        The editor badge is static ({obsStateBadge(binding.target)}); the phone shows the live OBS
        value. Tapping this button still runs its actions.
      </p>
    </div>
  )
}
