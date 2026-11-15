import { useEffect, useRef, useState } from 'react'
import type { StreamerBotAction } from '@phonedek/shared'
import {
  STREAMERBOT_MAX_ACTION_NAME,
  STREAMERBOT_MAX_ARGS,
  STREAMERBOT_MAX_ARG_KEY,
  STREAMERBOT_MAX_ARG_VALUE,
} from '@phonedek/shared'
import type {
  ServerInfoView,
  StreamerBotActionView,
} from '../../../shared/api'
import {
  appendStreamerbotArg,
  filterStreamerbotActions,
  findStreamerbotAction,
  groupStreamerbotActions,
  removeStreamerbotArg,
  streamerbotActiveArgCount,
  streamerbotArgError,
  streamerbotArgRowError,
  streamerbotArgRows,
  streamerbotArgsFromRows,
  streamerbotNameError,
  streamerbotPickerAvailability,
  updateStreamerbotArg,
  type StreamerBotArgRow,
} from '../lib/streamerbot'
import { Icon } from './Icons'

interface TestState {
  status: 'idle' | 'busy' | 'ok' | 'error'
  message?: string
}

function optionLabel(action: StreamerBotActionView): string {
  return action.enabled ? action.name : `${action.name} (disabled)`
}

/**
 * Streamer.bot action fields: pick from the live GetActions list, or type the
 * exact name when the list is unavailable. Arguments are plain, visible strings
 * because Streamer.bot exposes them to the action as `%name%` variables.
 */
export function StreamerbotActionEditor({
  action,
  server,
  onUpdate,
}: {
  action: StreamerBotAction
  server: ServerInfoView | null
  onUpdate: (action: StreamerBotAction) => void
}) {
  const [actions, setActions] = useState<StreamerBotActionView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const [rows, setRows] = useState<StreamerBotArgRow[]>(() => streamerbotArgRows(action.args))
  const [testState, setTestState] = useState<TestState>({ status: 'idle' })
  const wasConnected = useRef(false)

  const status = server?.streamerbotStatus ?? null
  const connected = status?.state === 'connected'
  const selected = action.actionName.trim()
  const selectedView = findStreamerbotAction(actions, selected)
  const availability = streamerbotPickerAvailability({
    status,
    selected,
    actions,
    loaded,
    error: listError,
  })
  const filtered = filterStreamerbotActions(actions, query)
  const groups = groupStreamerbotActions(filtered)
  const canPickFromList = loaded && listError === null && actions.length > 0
  const showManual = manual || !canPickFromList
  const nameError = streamerbotNameError(action.actionName)
  const argError = streamerbotArgError(rows)
  const activeArgs = streamerbotActiveArgCount(rows)

  const argsSignature = (args?: Record<string, string>): string =>
    JSON.stringify(Object.entries(args ?? {}))
  const signatureRef = useRef(argsSignature(action.args))

  // Switching between buttons (or an external import) replaces the draft rows,
  // while typing an argument keeps the current rows, including blank scratch rows.
  useEffect(() => {
    const next = argsSignature(action.args)
    if (next === signatureRef.current) return
    signatureRef.current = next
    setRows(streamerbotArgRows(action.args))
    setTestState({ status: 'idle' })
  }, [action.args])

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setListError(null)
    try {
      const result = await window.phonedek.listStreamerbotActions()
      setActions(result.actions ?? [])
      setLoaded(true)
      if (!result.ok) {
        setListError(result.error ?? 'Could not list Streamer.bot actions.')
      }
    } catch (error) {
      setActions([])
      setLoaded(true)
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  // Fetch once when the editor opens on a live connection, and again after a
  // reconnect. A failed attempt stays available through the manual field.
  useEffect(() => {
    if (connected && !wasConnected.current) void refresh()
    wasConnected.current = connected
  }, [connected])

  // Do not leave a stale "not connected" test result under a reconnected badge.
  useEffect(() => {
    setTestState({ status: 'idle' })
  }, [status?.state])

  const applyAction = (next: StreamerBotAction): void => {
    signatureRef.current = argsSignature(next.args)
    setTestState({ status: 'idle' })
    onUpdate(next)
  }

  const applyRows = (nextRows: StreamerBotArgRow[]): void => {
    setRows(nextRows)
    const args = streamerbotArgsFromRows(nextRows)
    const { args: _previous, ...rest } = action
    applyAction(args ? { ...rest, args } : rest)
  }

  const setName = (value: string): void => {
    applyAction({ ...action, actionName: value })
  }

  const runTest = async (): Promise<void> => {
    if (nameError || argError) return
    const name = action.actionName.trim()
    const args = streamerbotArgsFromRows(rows)
    setTestState({ status: 'busy' })
    try {
      const result = await window.phonedek.testStreamerbotAction(name, args)
      if (result.ok) {
        const count = args ? Object.keys(args).length : 0
        setTestState({
          status: 'ok',
          message:
            result.message ??
            `Sent “${name}” to Streamer.bot${count > 0 ? ` with ${count} argument${count === 1 ? '' : 's'}` : ''}.`,
        })
      } else {
        setTestState({
          status: 'error',
          message: result.error ?? 'Streamer.bot rejected the action.',
        })
      }
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const testBusy = testState.status === 'busy'

  return (
    <div className="stack streamerbot-editor">
      <div className={`streamerbot-status ${availability.tone}`}>
        <span
          className={`dot ${
            availability.tone === 'ok'
              ? 'online'
              : availability.tone === 'error'
                ? 'error'
                : 'offline'
          }`}
          aria-hidden="true"
        />
        <div>
          <strong>{availability.label}</strong>
          <small>{availability.detail}</small>
        </div>
      </div>

      <div className="streamerbot-toolbar">
        <span className="streamerbot-toolbar-label mono">ACTION</span>
        {!showManual && (
          <input
            type="search"
            className="streamerbot-filter"
            value={query}
            placeholder="Filter by name or group…"
            aria-label="Filter Streamer.bot actions"
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <button
          type="button"
          className="button ghost small"
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh the action list from Streamer.bot"
        >
          <Icon name="refresh" size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {showManual ? (
        <>
          <label className="field">
            <span>Action name</span>
            <input
              value={action.actionName}
              maxLength={STREAMERBOT_MAX_ACTION_NAME}
              spellCheck={false}
              placeholder="Exact Streamer.bot action name"
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {listError ? (
            <p className="hint error-text">
              The live list is unavailable ({listError}). Type the exact action name instead.
            </p>
          ) : loaded && actions.length === 0 ? (
            <p className="hint">
              Streamer.bot reported no actions. Create one in its Actions tab, then refresh.
            </p>
          ) : (
            <p className="hint">
              Type the exact action name. Names are matched by Streamer.bot when the button is
              pressed.
            </p>
          )}
          {canPickFromList && (
            <div>
              <button
                type="button"
                className="button ghost small"
                onClick={() => setManual(false)}
              >
                Pick from list
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="field">
            <span>Action</span>
            <select
              value={selected}
              onChange={(event) => setName(event.target.value)}
              disabled={loading}
            >
              <option value="">Choose an action…</option>
              {selected.length > 0 && !filtered.some((item) => item.name === selected) && (
                <option value={selected}>
                  {selected}
                  {selectedView ? '' : ' — not in list'}
                </option>
              )}
              {groups.map((group, index) =>
                group.group === null ? (
                  <optgroup key={`ungrouped-${index}`} label="Ungrouped">
                    {group.actions.map((item) => (
                      <option key={item.id || item.name} value={item.name}>
                        {optionLabel(item)}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <optgroup key={group.group} label={group.group}>
                    {group.actions.map((item) => (
                      <option key={item.id || item.name} value={item.name}>
                        {optionLabel(item)}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
          {filtered.length === 0 && (
            <p className="hint">
              No actions match “{query.trim()}”. Clear the filter or type the name manually.
            </p>
          )}
          {selected.length > 0 && !selectedView && (
            <p className="hint">
              “{selected}” is not in the live list. It is still sent to Streamer.bot by name — use
              Type name manually to correct it.
            </p>
          )}
          <div>
            <button type="button" className="button ghost small" onClick={() => setManual(true)}>
              Type name manually
            </button>
          </div>
        </>
      )}

      {nameError && <p className="hint error-text">{nameError}</p>}

      <div className="streamerbot-args">
        <div className="row between">
          <span className="streamerbot-args-title mono">
            ARGUMENTS <span className="muted">{activeArgs}/{STREAMERBOT_MAX_ARGS}</span>
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => applyRows(appendStreamerbotArg(rows))}
            disabled={rows.length >= STREAMERBOT_MAX_ARGS}
          >
            <Icon name="plus" size={13} /> Add argument
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="hint">
            No arguments. Streamer.bot exposes each name to the action as a <code>%name%</code>{' '}
            variable.
          </p>
        ) : (
          <div className="streamerbot-arg-list">
            {rows.map((row, index) => {
              const rowError = streamerbotArgRowError(rows, row.id)
              return (
                <div className="streamerbot-arg-entry" key={row.id}>
                  <div className="streamerbot-arg-row">
                    <input
                      value={row.key}
                      maxLength={STREAMERBOT_MAX_ARG_KEY}
                      spellCheck={false}
                      placeholder="name"
                      aria-label={`Argument ${index + 1} name`}
                      aria-invalid={rowError ? true : undefined}
                      onChange={(event) =>
                        applyRows(updateStreamerbotArg(rows, row.id, { key: event.target.value }))
                      }
                    />
                    <input
                      value={row.value}
                      maxLength={STREAMERBOT_MAX_ARG_VALUE}
                      spellCheck={false}
                      placeholder="value"
                      aria-label={`Argument ${index + 1} value`}
                      onChange={(event) =>
                        applyRows(updateStreamerbotArg(rows, row.id, { value: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="icon-button tiny danger"
                      aria-label={`Remove argument ${index + 1}`}
                      onClick={() => applyRows(removeStreamerbotArg(rows, row.id))}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {rowError && <p className="hint error-text">{rowError}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="streamerbot-test-row">
        <button
          type="button"
          className="button secondary small"
          onClick={() => void runTest()}
          disabled={testBusy || nameError !== null || argError !== null}
          title={nameError ?? argError ?? 'Send this action to Streamer.bot now'}
        >
          <Icon name="play" size={14} /> {testBusy ? 'Testing…' : 'Test action'}
        </button>
        <span className="hint">Runs the action once in Streamer.bot; nothing is sent to the phone.</span>
      </div>

      {testState.status !== 'idle' && testState.message && (
        <p
          className={`streamerbot-test-result ${
            testState.status === 'ok' ? 'ok' : testState.status === 'error' ? 'error' : 'busy'
          }`}
          aria-live="polite"
        >
          {testState.message}
        </p>
      )}

      <p className="hint">
        The phone sends a press to this PC; the desktop triggers the action over Streamer.bot&apos;s
        local WebSocket API. Arguments are visible here and are not secrets.
      </p>
    </div>
  )
}
