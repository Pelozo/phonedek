import { useId } from 'react'
import type { ObsAction } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  obsActionVariant,
  obsInputAvailability,
  obsNameError,
  obsNameOrUndefined,
  obsStatusSummary,
} from '../lib/obs'
import { useObsInputs } from '../lib/useObsInputs'
import { Toggle } from './Primitives'

const OPERATION_GROUPS: Array<{
  label: string
  options: Array<{ value: ObsAction['action']; label: string }>
}> = [
  {
    label: 'Scenes',
    options: [{ value: 'setScene', label: 'Switch program scene' }],
  },
  {
    label: 'Stream',
    options: [
      { value: 'toggleStream', label: 'Toggle streaming' },
      { value: 'startStream', label: 'Start streaming' },
      { value: 'stopStream', label: 'Stop streaming' },
    ],
  },
  {
    label: 'Recording',
    options: [
      { value: 'toggleRecord', label: 'Toggle recording' },
      { value: 'startRecord', label: 'Start recording' },
      { value: 'stopRecord', label: 'Stop recording' },
    ],
  },
  {
    label: 'Replay buffer',
    options: [
      { value: 'startReplay', label: 'Start replay buffer' },
      { value: 'stopReplay', label: 'Stop replay buffer' },
      { value: 'saveReplay', label: 'Save replay buffer' },
    ],
  },
  {
    label: 'Virtual camera',
    options: [{ value: 'toggleVirtualCam', label: 'Toggle virtual camera' }],
  },
  {
    label: 'Sources',
    options: [
      { value: 'toggleSourceVisibility', label: 'Toggle source visibility' },
      { value: 'setSourceVisibility', label: 'Set source visibility' },
    ],
  },
  {
    label: 'Markers & audio',
    options: [
      { value: 'addMarker', label: 'Add chapter marker' },
      { value: 'toggleMute', label: 'Toggle input mute' },
    ],
  },
]

function connectionTone(summary: { tone: string }): string {
  if (summary.tone === 'ok') return 'ok'
  if (summary.tone === 'error') return 'error'
  return 'warn'
}

/**
 * OBS phase 2 action fields. Scene and source lists are not exposed by the
 * current main-process API, so names are typed and resolved by OBS at press
 * time; inputs reuse the existing listObsInputs helper.
 */
export function ObsActionEditor({
  action,
  server,
  onUpdate,
}: {
  action: ObsAction
  server: ServerInfoView | null
  onUpdate: (action: ObsAction) => void
}) {
  const listId = `obs-inputs-${useId().replace(/:/g, '')}`
  const inputAction = action.action === 'toggleMute' ? action : null
  const { inputs, loaded, loading, error, refresh } = useObsInputs(inputAction !== null)
  const summary = obsStatusSummary(server?.obsStatus)
  const inputAvailability = obsInputAvailability({
    status: server?.obsStatus,
    selected: inputAction?.input,
    inputs,
    loaded,
  })
  const sourceError =
    action.action === 'setSourceVisibility' || action.action === 'toggleSourceVisibility'
      ? obsNameError(action.source, true)
      : null
  const sceneError = 'scene' in action ? obsNameError(action.scene, false) : null

  const update = (next: ObsAction): void => onUpdate(next)

  return (
    <div className="stack">
      <div className={`obs-availability ${connectionTone(summary)}`}>
        <strong>{summary.label.toUpperCase()}</strong>
        <small>{summary.detail}</small>
      </div>

      <label className="field">
        <span>OBS operation</span>
        <select
          value={action.action}
          onChange={(event) =>
            update(obsActionVariant(action, event.target.value as ObsAction['action']))
          }
        >
          {OPERATION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {action.action === 'setScene' && (
        <>
          <label className="field">
            <span>Scene name</span>
            <input
              value={action.scene ?? ''}
              maxLength={128}
              spellCheck={false}
              placeholder="Blank — OBS's first scene"
              aria-invalid={sceneError ? true : undefined}
              onChange={(event) =>
                update({ ...action, scene: obsNameOrUndefined(event.target.value) })
              }
            />
          </label>
          {sceneError ? (
            <p className="hint error-text">{sceneError}</p>
          ) : (
            <p className="hint">
              Type the exact OBS scene name. This build cannot load the scene list yet; names are
              scene-collection scoped and matched when the button is pressed.
            </p>
          )}
        </>
      )}

      {(action.action === 'toggleSourceVisibility' ||
        action.action === 'setSourceVisibility') && (
        <>
          <label className="field">
            <span>Scene (optional)</span>
            <input
              value={action.scene ?? ''}
              maxLength={128}
              spellCheck={false}
              placeholder="Blank — current program scene"
              aria-invalid={sceneError ? true : undefined}
              onChange={(event) =>
                update({ ...action, scene: obsNameOrUndefined(event.target.value) })
              }
            />
          </label>
          {sceneError && <p className="hint error-text">{sceneError}</p>}
          <label className="field">
            <span>Source name</span>
            <input
              value={action.source}
              maxLength={128}
              spellCheck={false}
              placeholder="e.g. Camera, Alerts, Overlay"
              aria-invalid={sourceError ? true : undefined}
              onChange={(event) => update({ ...action, source: event.target.value })}
            />
          </label>
          {sourceError ? (
            <p className="hint error-text">{sourceError}</p>
          ) : (
            <p className="hint">
              Source names belong to the selected scene. The desktop resolves them through OBS when
              pressed.
            </p>
          )}
          {action.action === 'setSourceVisibility' && (
            <Toggle
              label="Visible when pressed"
              description="On shows the source; off hides it."
              checked={action.visible}
              onChange={(visible) => update({ ...action, visible })}
            />
          )}
        </>
      )}

      {action.action === 'toggleMute' && (
        <>
          <label className="field">
            <span>OBS input</span>
            <input
              value={inputAction?.input ?? ''}
              maxLength={128}
              spellCheck={false}
              list={listId}
              placeholder="Default — first audio input"
              onChange={(event) =>
                update({ ...action, input: obsNameOrUndefined(event.target.value) })
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
          <div className={`obs-availability ${inputAvailability.tone}`}>
            <strong>{inputAvailability.label}</strong>
            <small>{inputAvailability.detail}</small>
          </div>
          {error && <p className="hint error-text">{error}</p>}
          <div className="row between">
            <p className="hint">
              Leave blank to use the first OBS audio input. Input names are scene-collection scoped.
            </p>
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

      {action.action === 'addMarker' && (
        <>
          <label className="field">
            <span>Marker name (optional)</span>
            <input
              value={action.name ?? ''}
              maxLength={128}
              spellCheck={false}
              placeholder="Chapter marker"
              onChange={(event) =>
                update({ ...action, name: obsNameOrUndefined(event.target.value) })
              }
            />
          </label>
          <p className="hint">
            Adds a chapter marker to the active recording or stream. OBS 30.2+ with Hybrid MP4
            output is required; other formats return an error.
          </p>
        </>
      )}

      {(action.action === 'toggleStream' ||
        action.action === 'startStream' ||
        action.action === 'stopStream' ||
        action.action === 'toggleRecord' ||
        action.action === 'startRecord' ||
        action.action === 'stopRecord' ||
        action.action === 'startReplay' ||
        action.action === 'stopReplay' ||
        action.action === 'saveReplay' ||
        action.action === 'toggleVirtualCam') && (
        <p className="hint">
          Runs directly through OBS WebSocket. No OBS hotkey binding is needed. The action fails
          with a clear error when OBS is unavailable or the output cannot change.
        </p>
      )}
    </div>
  )
}
