import { useState } from 'react'
import { describeStep } from '@phonedek/shared'
import type { MacroStep, MediaKey, MouseAction } from '@phonedek/shared'
import { Icon } from './Icons'
import { PopMenu } from './Menu'
import { NumberField } from './Primitives'
import { Keycaps, ShortcutDialog } from './ShortcutDialog'
import { MacroRecordDialog } from './MacroRecordDialog'

const MEDIA_KEYS: Array<{ value: MediaKey; label: string }> = [
  { value: 'playpause', label: 'Play / pause' },
  { value: 'next', label: 'Next track' },
  { value: 'prev', label: 'Previous track' },
  { value: 'stop', label: 'Stop' },
  { value: 'volumeup', label: 'Volume up' },
  { value: 'volumedown', label: 'Volume down' },
  { value: 'mute', label: 'Mute' },
]

const MOUSE_ACTIONS: Array<{ value: MouseAction; label: string }> = [
  { value: 'click', label: 'Click' },
  { value: 'doubleclick', label: 'Double-click' },
  { value: 'down', label: 'Hold down' },
  { value: 'up', label: 'Release' },
  { value: 'move', label: 'Move to position' },
  { value: 'scroll', label: 'Scroll' },
]

function defaultStep(type: MacroStep['type']): MacroStep {
  switch (type) {
    case 'hotkey':
      return { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35, action: 'press' }
    case 'text':
      return { type: 'text', text: '', perCharMs: 4 }
    case 'delay':
      return { type: 'delay', ms: 250 }
    case 'media':
      return { type: 'media', key: 'playpause' }
    case 'mouse':
      return { type: 'mouse', button: 'left', action: 'click' }
    case 'launch':
      return { type: 'launch', path: 'notepad.exe', args: [] }
    case 'url':
      return { type: 'url', url: 'https://example.com' }
    case 'command':
      return { type: 'command', command: 'echo Hello from PhoneDeck', hidden: true }
  }
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
    result.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\"/g, '"'))
  }
  return result
}

function stepLabel(step: MacroStep): string {
  switch (step.type) {
    case 'hotkey':
      return 'Shortcut'
    case 'text':
      return 'Type text'
    case 'delay':
      return 'Delay'
    case 'media':
      return 'Media'
    case 'mouse':
      return 'Mouse'
    case 'launch':
      return 'Launch app'
    case 'url':
      return 'Open URL'
    case 'command':
      return 'Run command'
  }
}

export function MacroEditor({
  steps,
  repeat = 1,
  repeatDelayMs = 0,
  onChange,
  onChangeMeta,
  onRecordingChange,
}: {
  steps: MacroStep[]
  repeat?: number
  repeatDelayMs?: number
  onChange: (steps: MacroStep[]) => void
  onChangeMeta: (patch: { repeat?: number; repeatDelayMs?: number }) => void
  onRecordingChange?: (recording: boolean) => void
}) {
  const [recordOpen, setRecordOpen] = useState(false)
  const [shortcutIndex, setShortcutIndex] = useState<number | null>(null)

  const update = (index: number, next: MacroStep): void => {
    onChange(steps.map((step, current) => (current === index ? next : step)))
  }
  const remove = (index: number): void => onChange(steps.filter((_, current) => current !== index))
  const duplicate = (index: number): void => {
    const step = steps[index]
    if (!step) return
    const copy = structuredClone(step)
    onChange([...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)])
  }
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const copy = [...steps]
    const [item] = copy.splice(index, 1)
    if (item) copy.splice(target, 0, item)
    onChange(copy)
  }

  return (
    <div className="macro-editor">
      <div className="macro-toolbar">
        <span className="muted">
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
        <div className="row gap">
          <button type="button" className="button secondary small" onClick={() => setRecordOpen(true)}>
            <Icon name="record" size={15} /> Record
          </button>
          <PopMenu
            align="right"
            width={300}
            trigger={
              <button type="button" className="button secondary small">
                <Icon name="plus" size={15} /> Add step
              </button>
            }
            items={[
              { label: 'Shortcut', icon: 'keyboard', description: 'Press, hold or release keys', onClick: () => onChange([...steps, defaultStep('hotkey')]) },
              { label: 'Type text', icon: 'text', description: 'Type a phrase', onClick: () => onChange([...steps, defaultStep('text')]) },
              { label: 'Delay', icon: 'clock', description: 'Wait before the next step', onClick: () => onChange([...steps, defaultStep('delay')]) },
              { label: 'Media key', icon: 'music', description: 'Play, volume, mute…', onClick: () => onChange([...steps, defaultStep('media')]) },
              { label: 'Mouse click', icon: 'mouse', description: 'Click/double-click at the cursor', onClick: () => onChange([...steps, defaultStep('mouse')]) },
              { label: 'Mouse move', icon: 'mouse', description: 'Move to absolute screen coordinates', onClick: () => onChange([...steps, { type: 'mouse', button: 'left', action: 'move', x: 0, y: 0 }]) },
              { label: 'Mouse scroll', icon: 'mouse', description: 'Scroll the wheel', onClick: () => onChange([...steps, { type: 'mouse', button: 'left', action: 'scroll', direction: 'down', amount: 1 }]) },
              { label: 'Launch app', icon: 'app', description: 'Start a program', onClick: () => onChange([...steps, defaultStep('launch')]) },
              { label: 'Open URL', icon: 'link', description: 'Open a web page', onClick: () => onChange([...steps, defaultStep('url')]) },
              { label: 'Run command', icon: 'terminal', description: 'Run a shell command', onClick: () => onChange([...steps, defaultStep('command')]) },
            ]}
          />
          {steps.length > 0 && (
            <button type="button" className="icon-button tiny danger" title="Clear all steps" onClick={() => { if (steps.length && window.confirm('Remove every step from this macro?')) onChange([]) }}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="macro-repeat-row">
        <NumberField
          label="Repeat macro"
          value={repeat}
          min={1}
          max={50}
          suffix="×"
          onChange={(value) => onChangeMeta({ repeat: value })}
        />
        <NumberField
          label="Pause between repeats"
          value={repeatDelayMs}
          min={0}
          max={60000}
          step={100}
          suffix="ms"
          onChange={(value) => onChangeMeta({ repeatDelayMs: value })}
        />
      </div>

      {steps.length === 0 ? (
        <div className="empty-state small">
          <Icon name="bolt" size={22} />
          <p>No steps yet. Record a macro or add steps manually.</p>
        </div>
      ) : (
        <div className="step-list">
          {steps.map((step, index) => (
            <div className="step-card" key={`${step.type}-${index}`}>
              <header>
                <span className="step-badge">{index + 1}</span>
                <strong>{stepLabel(step)}</strong>
                <span className="step-summary">{describeStep(step)}</span>
                <div className="step-actions">
                  <button type="button" className="icon-button tiny" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move step up">
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button type="button" className="icon-button tiny" disabled={index === steps.length - 1} onClick={() => move(index, 1)} aria-label="Move step down">
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <button type="button" className="icon-button tiny" onClick={() => duplicate(index)} aria-label="Duplicate step">
                    <Icon name="copy" size={14} />
                  </button>
                  <button type="button" className="icon-button tiny danger" onClick={() => remove(index)} aria-label="Delete step">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </header>

              <div className="step-body">
                {step.type === 'hotkey' && (
                  <div className="stack">
                    <div className="row between gap">
                      <Keycaps keys={step.keys} small />
                      <button type="button" className="button ghost small" onClick={() => setShortcutIndex(index)}>
                        Change keys
                      </button>
                    </div>
                    <div className="two-col">
                      <label className="field">
                        <span>Key action</span>
                        <select
                          value={step.action ?? 'press'}
                          onChange={(event) => update(index, { ...step, action: event.target.value as 'press' | 'down' | 'up' })}
                        >
                          <option value="press">Press and release</option>
                          <option value="down">Hold down</option>
                          <option value="up">Release</option>
                        </select>
                      </label>
                      <NumberField
                        label="Hold for"
                        value={step.holdMs ?? 35}
                        min={0}
                        max={5000}
                        step={5}
                        suffix="ms"
                        disabled={(step.action ?? 'press') !== 'press'}
                        onChange={(holdMs) => update(index, { ...step, holdMs })}
                      />
                    </div>
                    {(step.action ?? 'press') !== 'press' && (
                      <p className="hint">
                        Hold-down steps keep keys pressed until a matching Release step. Use them for drags and held modifiers.
                      </p>
                    )}
                  </div>
                )}

                {step.type === 'text' && (
                  <div className="stack">
                    <textarea
                      rows={2}
                      value={step.text}
                      placeholder="Text to type…"
                      onChange={(event) => update(index, { ...step, text: event.target.value })}
                    />
                    <NumberField
                      label="Delay per character"
                      value={step.perCharMs ?? 4}
                      min={0}
                      max={1000}
                      suffix="ms"
                      onChange={(perCharMs) => update(index, { ...step, perCharMs })}
                    />
                  </div>
                )}

                {step.type === 'delay' && (
                  <NumberField
                    label="Wait"
                    value={step.ms}
                    min={0}
                    max={60000}
                    step={50}
                    suffix="ms"
                    onChange={(ms) => update(index, { ...step, ms })}
                  />
                )}

                {step.type === 'media' && (
                  <select value={step.key} onChange={(event) => update(index, { ...step, key: event.target.value as MediaKey })}>
                    {MEDIA_KEYS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                )}

                {step.type === 'mouse' && (
                  <div className="stack">
                    <div className="three-col">
                      <label className="field">
                        <span>Action</span>
                        <select
                          value={step.action}
                          onChange={(event) => {
                            const action = event.target.value as MouseAction
                            const next = { ...step, action }
                            if (action === 'move') {
                              next.x = step.x ?? 0
                              next.y = step.y ?? 0
                            }
                            if (action === 'scroll') next.direction = step.direction ?? 'down'
                            update(index, next)
                          }}
                        >
                          {MOUSE_ACTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Button</span>
                        <select
                          value={step.button}
                          disabled={step.action === 'move' || step.action === 'scroll'}
                          onChange={(event) => update(index, { ...step, button: event.target.value as 'left' | 'right' | 'middle' })}
                        >
                          <option value="left">Left</option>
                          <option value="right">Right</option>
                          <option value="middle">Middle</option>
                        </select>
                      </label>
                      {step.action === 'scroll' ? (
                        <label className="field">
                          <span>Direction</span>
                          <select
                            value={step.direction ?? 'down'}
                            onChange={(event) => update(index, { ...step, direction: event.target.value as 'up' | 'down' | 'left' | 'right' })}
                          >
                            <option value="up">Up</option>
                            <option value="down">Down</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                      ) : (
                        <label className="field">
                          <span>X / Y (optional)</span>
                          <div className="row gap">
                            <input
                              type="number"
                              value={step.x ?? ''}
                              placeholder="auto"
                              onChange={(event) => update(index, { ...step, x: event.target.value === '' ? undefined : Number(event.target.value) })}
                            />
                            <input
                              type="number"
                              value={step.y ?? ''}
                              placeholder="auto"
                              onChange={(event) => update(index, { ...step, y: event.target.value === '' ? undefined : Number(event.target.value) })}
                            />
                          </div>
                        </label>
                      )}
                    </div>
                    {step.action === 'scroll' && (
                      <NumberField
                        label="Notches"
                        value={step.amount ?? 1}
                        min={1}
                        max={100}
                        suffix="×"
                        onChange={(amount) => update(index, { ...step, amount })}
                      />
                    )}
                    {(step.action === 'move' || step.action === 'click' || step.action === 'doubleclick') && (
                      <p className="hint">Leave X/Y empty to use the current cursor position.</p>
                    )}
                  </div>
                )}

                {step.type === 'launch' && (
                  <div className="stack">
                    <label className="field">
                      <span>Application path</span>
                      <div className="row gap">
                        <input
                          value={step.path}
                          placeholder="C:\\Program Files\\App\\app.exe"
                          onChange={(event) => update(index, { ...step, path: event.target.value })}
                        />
                        <button
                          type="button"
                          className="button secondary"
                          onClick={async () => {
                            const path = await window.phonedek.pickApplication()
                            if (path) update(index, { ...step, path })
                          }}
                        >
                          <Icon name="folder" size={15} /> Browse
                        </button>
                      </div>
                    </label>
                    <label className="field">
                      <span>Arguments (optional)</span>
                      <input
                        value={argsToString(step.args)}
                        placeholder="--fullscreen &quot;My file.txt&quot;"
                        onChange={(event) => update(index, { ...step, args: parseArgs(event.target.value) })}
                      />
                    </label>
                  </div>
                )}

                {step.type === 'url' && (
                  <label className="field">
                    <span>URL</span>
                    <input
                      value={step.url}
                      placeholder="https://example.com"
                      onChange={(event) => update(index, { ...step, url: event.target.value })}
                    />
                  </label>
                )}

                {step.type === 'command' && (
                  <div className="stack">
                    <div className="warning">
                      <Icon name="terminal" size={16} />
                      Commands run with your Windows user account. Only add commands you trust.
                    </div>
                    <label className="field">
                      <span>Command</span>
                      <textarea
                        rows={2}
                        value={step.command}
                        spellCheck={false}
                        onChange={(event) => update(index, { ...step, command: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Working directory (optional)</span>
                      <input value={step.cwd ?? ''} onChange={(event) => update(index, { ...step, cwd: event.target.value || undefined })} />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={step.hidden ?? true}
                        onChange={(event) => update(index, { ...step, hidden: event.target.checked })}
                      />
                      Run without a console window
                    </label>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {recordOpen && (
        <MacroRecordDialog
          onClose={() => setRecordOpen(false)}
          onSave={(recorded) => onChange([...steps, ...recorded])}
          onRecordingChange={onRecordingChange}
        />
      )}
      {shortcutIndex !== null && steps[shortcutIndex]?.type === 'hotkey' && (
        <ShortcutDialog
          initial={(steps[shortcutIndex] as Extract<MacroStep, { type: 'hotkey' }>).keys}
          onClose={() => setShortcutIndex(null)}
          onSave={(keys) => {
            const step = steps[shortcutIndex]
            if (step?.type === 'hotkey') update(shortcutIndex, { ...step, keys })
            setShortcutIndex(null)
          }}
        />
      )}
    </div>
  )
}
