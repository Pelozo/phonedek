import { useState } from 'react'
import { describeStep } from '@phonedek/shared'
import type { MacroStep, MediaKey } from '@phonedek/shared'
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

function defaultStep(type: MacroStep['type']): MacroStep {
  switch (type) {
    case 'hotkey':
      return { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }
    case 'text':
      return { type: 'text', text: '', perCharMs: 4 }
    case 'delay':
      return { type: 'delay', ms: 250 }
    case 'media':
      return { type: 'media', key: 'playpause' }
    case 'mouse':
      return { type: 'mouse', button: 'left', action: 'click' }
  }
}

export function MacroEditor({
  steps,
  onChange,
}: {
  steps: MacroStep[]
  onChange: (steps: MacroStep[]) => void
}) {
  const [recordOpen, setRecordOpen] = useState(false)
  const [shortcutIndex, setShortcutIndex] = useState<number | null>(null)

  const update = (index: number, next: MacroStep): void => {
    onChange(steps.map((step, current) => (current === index ? next : step)))
  }
  const remove = (index: number): void => onChange(steps.filter((_, current) => current !== index))
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
            trigger={
              <button type="button" className="button secondary small">
                <Icon name="plus" size={15} /> Add step
              </button>
            }
            items={[
              { label: 'Shortcut', icon: 'keyboard', description: 'A key combination', onClick: () => onChange([...steps, defaultStep('hotkey')]) },
              { label: 'Text', icon: 'text', description: 'Type a phrase', onClick: () => onChange([...steps, defaultStep('text')]) },
              { label: 'Delay', icon: 'clock', description: 'Wait before the next step', onClick: () => onChange([...steps, defaultStep('delay')]) },
              { label: 'Media key', icon: 'music', description: 'Play, volume, mute…', onClick: () => onChange([...steps, defaultStep('media')]) },
              { label: 'Mouse', icon: 'mouse', description: 'Click at the current position', onClick: () => onChange([...steps, defaultStep('mouse')]) },
            ]}
          />
        </div>
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
                <strong>{step.type === 'hotkey' ? 'Shortcut' : step.type === 'text' ? 'Type text' : step.type === 'delay' ? 'Delay' : step.type === 'media' ? 'Media' : 'Mouse'}</strong>
                <span className="step-summary">{describeStep(step)}</span>
                <div className="step-actions">
                  <button type="button" className="icon-button tiny" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move step up">
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button type="button" className="icon-button tiny" disabled={index === steps.length - 1} onClick={() => move(index, 1)} aria-label="Move step down">
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <button type="button" className="icon-button tiny danger" onClick={() => remove(index)} aria-label="Delete step">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </header>

              <div className="step-body">
                {step.type === 'hotkey' && (
                  <div className="row between">
                    <Keycaps keys={step.keys} small />
                    <button type="button" className="button ghost small" onClick={() => setShortcutIndex(index)}>
                      Change
                    </button>
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
                  <div className="three-col">
                    <label className="field">
                      <span>Button</span>
                      <select value={step.button} onChange={(event) => update(index, { ...step, button: event.target.value as 'left' | 'right' | 'middle' })}>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="middle">Middle</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Action</span>
                      <select value={step.action} onChange={(event) => update(index, { ...step, action: event.target.value as 'click' | 'down' | 'up' })}>
                        <option value="click">Click</option>
                        <option value="down">Hold down</option>
                        <option value="up">Release</option>
                      </select>
                    </label>
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
