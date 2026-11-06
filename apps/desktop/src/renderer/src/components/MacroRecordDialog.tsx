import { useEffect, useRef, useState } from 'react'
import { describeStep, keyFromEvent, MacroRecorder } from '@phonedek/shared'
import type { MacroStep } from '@phonedek/shared'
import { Modal } from './Primitives'
import { Icon } from './Icons'

export function MacroRecordDialog({
  onSave,
  onClose,
}: {
  onSave: (steps: MacroStep[]) => void
  onClose: () => void
}) {
  const recorder = useRef<MacroRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [steps, setSteps] = useState<MacroStep[]>([])
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(0)

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 100)
    return () => clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (!recording) return
    const onDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'down', key, time: Date.now() })
      setSteps(recorder.current.getSteps())
    }
    const onUp = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'up', key, time: Date.now() })
      setSteps(recorder.current.getSteps())
    }
    const onBlur = (): void => stop()
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  const start = (): void => {
    recorder.current = new MacroRecorder()
    startedAt.current = Date.now()
    setElapsed(0)
    setSteps([])
    setRecording(true)
  }

  const stop = (): void => {
    if (!recorder.current) return
    const finished = recorder.current.finish()
    setSteps(finished)
    setRecording(false)
  }

  const save = (): void => {
    if (recording) {
      const finished = recorder.current?.finish() ?? []
      onSave(finished)
    } else {
      onSave(steps)
    }
    onClose()
  }

  const seconds = Math.floor(elapsed / 1000)
  const timeLabel = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${Math.floor((elapsed % 1000) / 100)}`

  return (
    <Modal
      title="Record a macro"
      subtitle="Type or press shortcuts here. PhoneDeck records chords, text and pauses between them."
      onClose={onClose}
      closeOnEscape={false}
      wide
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          {recording ? (
            <button className="button danger" onClick={stop}>
              <Icon name="pause" size={16} /> Stop recording
            </button>
          ) : (
            <button className="button secondary" onClick={start}>
              <Icon name="record" size={16} /> {steps.length ? 'Record again' : 'Start recording'}
            </button>
          )}
          <button className="button primary" onClick={save} disabled={recording || steps.length === 0}>
            Add {steps.length} step{steps.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className={`record-banner${recording ? ' recording' : ''}`}>
        <span className="record-dot" />
        <strong>{recording ? 'Recording' : steps.length ? 'Recording stopped' : 'Ready to record'}</strong>
        <span className="record-time">{timeLabel}</span>
      </div>

      <div className="record-steps">
        {steps.length === 0 ? (
          <div className="empty-state">
            <Icon name="keyboard" size={26} />
            <p>{recording ? 'Press keys or type to add steps.' : 'Click “Start recording”, then use your keyboard.'}</p>
          </div>
        ) : (
          steps.map((step, index) => (
            <div className="record-step" key={`${step.type}-${index}`}>
              <span className="step-index">{index + 1}</span>
              <span className="step-kind">{step.type}</span>
              <span className="step-detail">{describeStep(step)}</span>
            </div>
          ))
        )}
      </div>

      <p className="hint">
        Keys are captured while this window is focused. Pauses longer than 140 ms become timed delays (capped at 2 s).
        Typing is grouped into text steps; shortcuts become key chords.
      </p>
    </Modal>
  )
}
