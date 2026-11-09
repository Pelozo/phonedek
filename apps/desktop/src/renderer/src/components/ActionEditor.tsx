import { useEffect, useId, useState } from 'react'
import { describeAction, formatCombo } from '@phonedek/shared'
import type { DeckPage, ExecutableAction, MacroAction, MacroStep, MediaKey } from '@phonedek/shared'
import { Icon, type IconName } from './Icons'
import { NumberField } from './Primitives'
import { Keycaps, ShortcutDialog } from './ShortcutDialog'
import { MacroEditor } from './MacroEditor'
import { useHostPlatform } from '../lib/platform'
import type { ServerInfoView } from '../../../shared/api'

const MEDIA_KEYS: Array<{ value: MediaKey; label: string }> = [
  { value: 'playpause', label: 'Play / pause' },
  { value: 'next', label: 'Next track' },
  { value: 'prev', label: 'Previous track' },
  { value: 'stop', label: 'Stop' },
  { value: 'volumeup', label: 'Volume up' },
  { value: 'volumedown', label: 'Volume down' },
  { value: 'mute', label: 'Mute' },
]

const ACTION_ICONS: Record<ExecutableAction['type'], IconName> = {
  hotkey: 'keyboard',
  text: 'text',
  macro: 'bolt',
  launch: 'app',
  url: 'link',
  command: 'terminal',
  media: 'music',
  delay: 'clock',
  page: 'layers',
  mic: 'microphone',
  obs: 'microphone',
}

const ACTION_TITLES: Record<ExecutableAction['type'], string> = {
  hotkey: 'Shortcut',
  text: 'Type text',
  macro: 'Macro',
  launch: 'Launch app',
  url: 'Open URL',
  command: 'Run command',
  media: 'Media key',
  delay: 'Delay',
  page: 'Change page',
  mic: 'Mic mute',
  obs: 'OBS mute',
}

function argsToString(args: string[] | undefined): string {
  if (!args?.length) return ''
  return args
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(' ')
}

function parseArgs(input: string): string[] {
  const result: string[] = []
  const regex = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g
  for (;;) {
    const match = regex.exec(input)
    if (!match) break
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    result.push(value.replace(/\\"/g, '"'))
  }
  return result
}

/** Rough playback time used for the collapsed macro summary. */
function estimateStepMs(step: MacroStep): number {
  switch (step.type) {
    case 'hotkey':
      return (step.holdMs ?? 35) + 15
    case 'text':
      return step.text.length * Math.max(step.perCharMs ?? 4, 1)
    case 'delay':
      return step.ms
    case 'media':
    case 'mouse':
      return 20
    case 'launch':
      return 350
    case 'url':
    case 'command':
      return 120
  }
}

function estimateMacroMs(action: MacroAction): number {
  const repeat = action.repeat ?? 1
  const base = action.steps.reduce((total, step) => total + estimateStepMs(step), 0)
  const pauses = Math.max(0, repeat - 1) * (action.repeatDelayMs ?? 0)
  return base * repeat + pauses
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const seconds = ms / 1000
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function macroSummary(action: MacroAction): string {
  const repeat = action.repeat ?? 1
  const steps = `${action.steps.length} step${action.steps.length === 1 ? '' : 's'}`
  if (action.steps.length === 0) return `No steps · ${repeat}×`
  return `${steps} · ${repeat}× · ~${formatDuration(estimateMacroMs(action))}`
}

export function ActionEditor({
  action,
  index,
  total,
  pages,
  server: _server,
  onUpdate,
  onDelete,
  onMove,
  onTest,
}: {
  action: ExecutableAction
  index: number
  total: number
  pages: DeckPage[]
  server: ServerInfoView | null
  onUpdate: (action: ExecutableAction) => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
  onTest: (action: ExecutableAction) => void
}) {
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [macroOpen, setMacroOpen] = useState(false)
  const [macroRecording, setMacroRecording] = useState(false)
  const macroBodyId = useId()
  const platform = useHostPlatform()

  useEffect(() => {
    if (macroRecording && !macroOpen) setMacroOpen(true)
  }, [macroRecording, macroOpen])

  const chooseApp = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.phonedek.pickApplication()
      if (path && action.type === 'launch') onUpdate({ ...action, path })
    } finally {
      setBusy(false)
    }
  }

  const openUrl = async (): Promise<void> => {
    if (action.type !== 'url') return
    try {
      await window.phonedek.openExternal(action.url)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={`action-card action-type-${action.type}`}>
      <header className="action-header">
        <span className="action-icon">
          <Icon name={ACTION_ICONS[action.type]} size={16} />
        </span>
        {action.type === 'macro' ? (
          <button
            type="button"
            className="action-toggle"
            aria-expanded={macroOpen}
            aria-controls={macroOpen ? macroBodyId : undefined}
            disabled={macroRecording}
            title={macroRecording ? 'Recording in progress' : macroOpen ? 'Collapse macro' : 'Expand macro'}
            onClick={() => setMacroOpen((value) => !value)}
          >
            <span className="action-title">
              <strong>{ACTION_TITLES[action.type]}</strong>
              <small>{macroRecording ? 'Recording in progress…' : macroSummary(action)}</small>
            </span>
            <Icon name={macroOpen ? 'chevron-down' : 'chevron-right'} size={15} />
          </button>
        ) : (
          <div className="action-title">
            <strong>{ACTION_TITLES[action.type]}</strong>
            <small>{describeAction(action, platform)}</small>
          </div>
        )}
        <div className="action-tools">
          <button
            type="button"
            className="icon-button tiny"
            title="Test this action on this PC"
            onClick={() => onTest(action)}
          >
            <Icon name="play" size={14} />
          </button>
          <button type="button" className="icon-button tiny" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move action up">
            <Icon name="arrow-up" size={14} />
          </button>
          <button type="button" className="icon-button tiny" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move action down">
            <Icon name="arrow-down" size={14} />
          </button>
          <button type="button" className="icon-button tiny danger" onClick={onDelete} aria-label="Delete action">
            <Icon name="trash" size={14} />
          </button>
        </div>
      </header>

      {(action.type !== 'macro' || macroOpen) && (
        <div className="action-body" id={action.type === 'macro' ? macroBodyId : undefined}>
          {action.type === 'hotkey' && (
          <div className="stack">
            <div className="row between">
              <Keycaps keys={action.keys} platform={platform} />
              <button type="button" className="button ghost small" onClick={() => setShortcutOpen(true)}>
                Change shortcut
              </button>
            </div>
            <NumberField
              label="Hold keys for"
              value={action.holdMs ?? 35}
              min={0}
              max={5000}
              step={5}
              suffix="ms"
              onChange={(holdMs) => onUpdate({ ...action, holdMs })}
            />
          </div>
        )}

        {action.type === 'text' && (
          <div className="stack">
            <textarea
              rows={3}
              value={action.text}
              placeholder="Text to type on the PC…"
              onChange={(event) => onUpdate({ ...action, text: event.target.value })}
            />
            <NumberField
              label="Delay per character"
              value={action.perCharMs ?? 4}
              min={0}
              max={1000}
              suffix="ms"
              onChange={(perCharMs) => onUpdate({ ...action, perCharMs })}
            />
          </div>
        )}

        {action.type === 'macro' && (
          <MacroEditor
            steps={action.steps}
            repeat={action.repeat}
            repeatDelayMs={action.repeatDelayMs}
            onChange={(steps) => onUpdate({ ...action, steps })}
            onChangeMeta={(patch) => onUpdate({ ...action, ...patch })}
            onRecordingChange={setMacroRecording}
          />
        )}

        {action.type === 'launch' && (
          <div className="stack">
            <label className="field">
              <span>Application path</span>
              <div className="row gap">
                <input
                  value={action.path}
                  placeholder="C:\\Program Files\\App\\app.exe"
                  onChange={(event) => onUpdate({ ...action, path: event.target.value })}
                />
                <button type="button" className="button secondary" onClick={() => void chooseApp()} disabled={busy}>
                  <Icon name="folder" size={15} /> Browse
                </button>
              </div>
            </label>
            <label className="field">
              <span>Arguments (optional)</span>
              <input
                value={argsToString(action.args)}
                placeholder="--fullscreen &quot;My file.txt&quot;"
                onChange={(event) => onUpdate({ ...action, args: parseArgs(event.target.value) })}
              />
            </label>
          </div>
        )}

        {action.type === 'url' && (
          <div className="stack">
            <label className="field">
              <span>URL</span>
              <div className="row gap">
                <input
                  value={action.url}
                  placeholder="https://example.com"
                  onChange={(event) => onUpdate({ ...action, url: event.target.value })}
                />
                <button type="button" className="button secondary" onClick={() => void openUrl()}>
                  <Icon name="link" size={15} /> Open
                </button>
              </div>
            </label>
            <p className="hint">Only http:// and https:// links are allowed.</p>
          </div>
        )}

        {action.type === 'command' && (
          <div className="stack">
            <div className="warning">
              <Icon name="terminal" size={16} />
              Commands run with your Windows user account. Only add commands you trust.
            </div>
            <label className="field">
              <span>Command</span>
              <textarea
                rows={2}
                value={action.command}
                spellCheck={false}
                placeholder="cmd or PowerShell command…"
                onChange={(event) => onUpdate({ ...action, command: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Working directory (optional)</span>
              <input value={action.cwd ?? ''} onChange={(event) => onUpdate({ ...action, cwd: event.target.value || undefined })} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={action.hidden ?? true}
                onChange={(event) => onUpdate({ ...action, hidden: event.target.checked })}
              />
              Run without a console window
            </label>
          </div>
        )}

        {action.type === 'media' && (
          <label className="field">
            <span>Media key</span>
            <select value={action.key} onChange={(event) => onUpdate({ ...action, key: event.target.value as MediaKey })}>
              {MEDIA_KEYS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {action.type === 'delay' && (
          <NumberField
            label="Wait before the next action"
            value={action.ms}
            min={0}
            max={60000}
            step={50}
            suffix="ms"
            onChange={(ms) => onUpdate({ ...action, ms })}
          />
        )}

        {action.type === 'mic' && (
          <p className="hint">
            Toggles mute on the default capture device. Use the control&apos;s Test mute button or Run all
            actions to verify it on this PC.
          </p>
        )}

        {action.type === 'obs' && (
          <div className="stack">
            <label className="field">
              <span>OBS input</span>
              <input
                value={action.input ?? ''}
                maxLength={128}
                spellCheck={false}
                placeholder="Default — first audio input"
                onChange={(event) =>
                  onUpdate({ ...action, input: event.target.value || undefined })
                }
              />
            </label>
            <p className="hint">
              Toggles mute through OBS WebSocket. Leave the field blank to use the first OBS audio
              input. Names belong to the current scene collection.
            </p>
          </div>
        )}

        {action.type === 'page' && (
          <div className="two-col">
            <label className="field">
              <span>Direction</span>
              <select
                value={action.direction}
                onChange={(event) => {
                  const direction = event.target.value as 'next' | 'prev' | 'goto'
                  onUpdate({
                    ...action,
                    direction,
                    pageId: direction === 'goto' ? (action.pageId ?? pages[0]?.id) : undefined,
                  })
                }}
              >
                <option value="next">Next page</option>
                <option value="prev">Previous page</option>
                <option value="goto">Go to page…</option>
              </select>
            </label>
            {action.direction === 'goto' && (
              <label className="field">
                <span>Target page</span>
                <select
                  value={action.pageId ?? pages[0]?.id ?? ''}
                  onChange={(event) => onUpdate({ ...action, pageId: event.target.value })}
                >
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        </div>
      )}

      {shortcutOpen && action.type === 'hotkey' && (
        <ShortcutDialog
          initial={action.keys}
          title="Change shortcut"
          onClose={() => setShortcutOpen(false)}
          onSave={(keys) => {
            onUpdate({ ...action, keys })
            setShortcutOpen(false)
          }}
        />
      )}
      {action.type === 'hotkey' && action.keys.length > 0 && (
        <div className="sr-only">{formatCombo(action.keys, platform)}</div>
      )}
    </div>
  )
}
