import { useEffect, useRef, useState } from 'react'
import { describeStep, keyFromEvent, MacroRecorder } from '@phonedek/shared'
import type { MacroStep } from '@phonedek/shared'
import { Modal } from './Primitives'
import { Icon } from './Icons'

export function MacroRecordDialog({
  onSave,
  onClose,
  onRecordingChange,
}: {
  onSave: (steps: MacroStep[]) => void
  onClose: () => void
  onRecordingChange?: (recording: boolean) => void
}) {
  const recorder = useRef<MacroRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [captureDelays, setCaptureDelays] = useState(true)
  const [coalesceText, setCoalesceText] = useState(true)
  const [steps, setSteps] = useState<MacroStep[]>([])
  const [elapsed, setElapsed] = useState(0)
  const elapsedBase = useRef(0)
  const resumedAt = useRef(0)

  useEffect(() => {
    onRecordingChange?.(recording)
    return () => {
      if (recording) onRecordingChange?.(false)
    }
  }, [recording, onRecordingChange])

  useEffect(() => {
    if (!recording || paused) return
    const timer = setInterval(() => setElapsed(elapsedBase.current + (Date.now() - resumedAt.current)), 100)
    return () => clearInterval(timer)
  }, [recording, paused])

  const stop = (): void => {
    if (!recorder.current) return
    setSteps(recorder.current.finish())
    setRecording(false)
    setPaused(false)
  }

  useEffect(() => {
    if (!recording) return
    const onDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'down', key, time: Date.now() })
      setSteps(recorder.current.getPreviewSteps())
    }
    const onUp = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'up', key, time: Date.now() })
      setSteps(recorder.current.getPreviewSteps())
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
    recorder.current = new MacroRecorder({ captureDelays, coalesceText })
    setSteps([])
    setPaused(false)
    setRecording(true)
    setElapsed(0)
    elapsedBase.current = 0
    resumedAt.current = Date.now()
  }

  const pause = (): void => {
    if (!recorder.current) return
    recorder.current.pause(Date.now())
    elapsedBase.current += Date.now() - resumedAt.current
    setElapsed(elapsedBase.current)
    setSteps(recorder.current.getPreviewSteps())
    setPaused(true)
  }

  const resume = (): void => {
    if (!recorder.current) return
    recorder.current.resume(Date.now())
    resumedAt.current = Date.now()
    setPaused(false)
  }

  const undo = (): void => {
    if (!recorder.current) return
    setSteps(recorder.current.undoLast())
  }

  const save = (): void => {
    if (recording) {
      onSave(recorder.current?.finish() ?? [])
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
      subtitle="Press keys or type here. Chords, text, pauses and added steps are all editable afterwards."
      onClose={onClose}
      closeOnEscape={false}
      wide
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          {recording && (
            <>
              <button className="button ghost" onClick={undo} disabled={steps.length === 0}>
                <Icon name="undo" size={16} /> Undo last
              </button>
              {paused ? (
                <button className="button secondary" onClick={resume}>
                  <Icon name="play" size={16} /> Resume
                </button>
              ) : (
                <button className="button secondary" onClick={pause}>
                  <Icon name="pause" size={16} /> Pause
                </button>
              )}
              <button className="button danger" onClick={stop}>
                <Icon name="stop" size={16} /> Stop recording
              </button>
            </>
          )}
          {!recording && (
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
      <div className={`record-banner${recording && !paused ? ' recording' : ''}`}>
        <span className="record-dot" />
        <strong>{recording ? (paused ? 'Paused' : 'Recording') : steps.length ? 'Recording stopped' : 'Ready to record'}</strong>
        <span className="record-time">{timeLabel}</span>
      </div>

      <div className="record-options">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={captureDelays}
            disabled={recording}
            onChange={(event) => setCaptureDelays(event.target.checked)}
          />
          Capture pauses as delay steps
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={coalesceText}
            disabled={recording}
            onChange={(event) => setCoalesceText(event.target.checked)}
          />
          Group typing into text steps
        </label>
        <span className="hint">Turn text grouping off for game inputs that need individual key presses.</span>
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
        Keys are captured while this window is focused. Pauses longer than 140 ms become delays (capped at 2 s).
        Use Pause/Resume to skip a section, and Undo to remove the last step.
      </p>
    </Modal>
  )
}
