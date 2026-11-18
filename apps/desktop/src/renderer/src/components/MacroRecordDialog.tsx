import { useCallback, useEffect, useRef, useState } from 'react'
import { describeStep, keyFromEvent, MacroRecorder } from '@phonedek/shared'
import type { MacroStep, MouseButton } from '@phonedek/shared'
import type { MacroCaptureSupportView } from '../../../shared/api'
import { Modal } from './Primitives'
import { Icon } from './Icons'

type CaptureMode = 'focused' | 'global' | null

function stopHotkeyLabel(support: MacroCaptureSupportView | null): string {
  const command = support?.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return (support?.stopHotkey ?? 'CommandOrControl+Alt+F10')
    .replace('CommandOrControl', command)
    .split('+')
    .join(' + ')
}

function domButton(button: number): MouseButton | null {
  if (button === 0) return 'left'
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return null
}

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
  const [mode, setMode] = useState<CaptureMode>(null)
  const [countdown, setCountdown] = useState(0)
  const [captureDelays, setCaptureDelays] = useState(true)
  const [coalesceText, setCoalesceText] = useState(true)
  const [captureMouse, setCaptureMouse] = useState(true)
  const [captureMouseMove, setCaptureMouseMove] = useState(false)
  const [globalCapture, setGlobalCapture] = useState(true)
  const [support, setSupport] = useState<MacroCaptureSupportView | null>(null)
  const [supportError, setSupportError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [steps, setSteps] = useState<MacroStep[]>([])
  const [elapsed, setElapsed] = useState(0)
  const elapsedBase = useRef(0)
  const resumedAt = useRef(0)
  const modeRef = useRef<CaptureMode>(null)
  const recordingRef = useRef(false)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const subscriptions = useRef<Array<() => void>>([])
  const stopRef = useRef<() => void>(() => undefined)
  /** Invalidates an in-flight start when the dialog closes or recording stops. */
  const session = useRef(0)

  const clearCountdown = useCallback((): void => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
    setCountdown(0)
  }, [])

  const cleanupCapture = useCallback((): void => {
    session.current += 1
    clearCountdown()
    for (const unsubscribe of subscriptions.current) {
      try {
        unsubscribe()
      } catch {
        // listeners are already gone
      }
    }
    subscriptions.current = []
    if (modeRef.current === 'global') {
      void window.phonedek.stopMacroCapture().catch(() => undefined)
    }
    modeRef.current = null
  }, [clearCountdown])

  const stopRecording = useCallback((): void => {
    const active = recorder.current
    if (active) setSteps(active.finish())
    recordingRef.current = false
    cleanupCapture()
    setRecording(false)
    setPaused(false)
    setMode(null)
  }, [cleanupCapture])

  stopRef.current = stopRecording

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

  useEffect(() => {
    let alive = true
    void window.phonedek
      .getMacroCaptureSupport()
      .then((result) => {
        if (!alive) return
        setSupport(result)
        if (!result.supported) setGlobalCapture(false)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setSupportError(error instanceof Error ? error.message : String(error))
        setGlobalCapture(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // Never leave a global hook (or a countdown) behind when the dialog closes.
  useEffect(() => {
    return () => {
      recordingRef.current = false
      cleanupCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const beginRecorder = (nextMode: Exclude<CaptureMode, null>): void => {
    session.current += 1
    recorder.current = new MacroRecorder({
      captureDelays,
      coalesceText,
      captureMouse,
      captureMouseMove,
    })
    modeRef.current = nextMode
    recordingRef.current = true
    setSteps([])
    setPaused(false)
    setRecording(true)
    setMode(nextMode)
    setElapsed(0)
    elapsedBase.current = 0
    resumedAt.current = Date.now()
  }

  const beginFocused = (): void => {
    beginRecorder('focused')
  }

  const beginGlobal = async (): Promise<void> => {
    beginRecorder('global')
    const sessionID = session.current
    const offEvent = window.phonedek.onMacroCaptureEvent((event) => {
      if (!recordingRef.current) return
      const active = recorder.current
      if (!active) return
      active.record(event)
      setSteps(active.getPreviewSteps())
    })
    const offStopped = window.phonedek.onMacroCaptureStopped((event) => {
      setNotice(
        event.reason === 'hotkey'
          ? `Stopped with ${stopHotkeyLabel(support)}.`
          : 'Global capture stopped.',
      )
      stopRecording()
    })
    subscriptions.current = [offEvent, offStopped]

    let result
    try {
      result = await window.phonedek.startMacroCapture({
        captureMouse,
        captureMouseMove,
        ignoreSelf: true,
      })
    } catch (error) {
      result = {
        ok: false,
        active: false,
        stopHotkey: support?.stopHotkey ?? 'CommandOrControl+Alt+F10',
        captureMouse,
        captureMouseMove,
        ignoreSelf: true,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    if (session.current !== sessionID) {
      // The dialog closed (or the user stopped) while the IPC start was in
      // flight. Make sure the hook does not outlive the dialog.
      void window.phonedek.stopMacroCapture().catch(() => undefined)
      return
    }

    if (!result.ok) {
      cleanupCapture()
      recorder.current = null
      recordingRef.current = false
      setRecording(false)
      setMode(null)
      setCaptureError(
        `${result.error ?? 'Global capture could not start.'} Falling back to keys and mouse inside PhoneDeck.`,
      )
      beginFocused()
    }
  }

  const start = (): void => {
    if (!support && !supportError) return
    setCaptureError(null)
    setNotice(null)
    setSupportError(null)
    if (globalCapture && support?.supported) {
      setCountdown(3)
      let remaining = 3
      countdownTimer.current = setInterval(() => {
        remaining -= 1
        if (remaining <= 0) {
          clearCountdown()
          void beginGlobal()
        } else {
          setCountdown(remaining)
        }
      }, 1000)
      return
    }
    beginFocused()
  }

  const cancelCountdown = (): void => {
    clearCountdown()
  }

  // Focused fallback: capture inside this window only. Mouse coordinates use
  // screenX/screenY so recorded clicks still replay at absolute positions.
  useEffect(() => {
    if (!recording || mode !== 'focused') return

    const preview = (): void => {
      if (!recorder.current) return
      setSteps(recorder.current.getPreviewSteps())
    }

    const onDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'down', key, time: Date.now() })
      preview()
    }
    const onUp = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key || !recorder.current) return
      recorder.current.record({ kind: 'up', key, time: Date.now() })
      preview()
    }
    const insideDialog = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest('.modal'))
    const onMouseDown = (event: MouseEvent): void => {
      if (insideDialog(event.target)) return
      const button = domButton(event.button)
      if (!button || !recorder.current) return
      recorder.current.record({
        kind: 'down',
        button,
        x: event.screenX,
        y: event.screenY,
        time: Date.now(),
      })
      preview()
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (insideDialog(event.target)) return
      const button = domButton(event.button)
      if (!button || !recorder.current) return
      recorder.current.record({
        kind: 'up',
        button,
        x: event.screenX,
        y: event.screenY,
        time: Date.now(),
      })
      preview()
    }
    const onMouseMove = (event: MouseEvent): void => {
      if (insideDialog(event.target) || !recorder.current) return
      recorder.current.record({ kind: 'move', x: event.screenX, y: event.screenY, time: Date.now() })
      preview()
    }
    const onWheel = (event: WheelEvent): void => {
      if (insideDialog(event.target) || !recorder.current) return
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const direction = horizontal
        ? event.deltaX > 0
          ? 'right'
          : 'left'
        : event.deltaY > 0
          ? 'down'
          : 'up'
      recorder.current.record({ kind: 'wheel', direction, amount: 1, time: Date.now() })
      preview()
    }
    const onBlur = (): void => {
      if (modeRef.current === 'focused') stopRef.current()
    }

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    if (captureMouse) {
      window.addEventListener('mousedown', onMouseDown, true)
      window.addEventListener('mouseup', onMouseUp, true)
      window.addEventListener('mousemove', onMouseMove, true)
      window.addEventListener('wheel', onWheel, true)
    }
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [recording, mode, captureMouse])

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

  const close = (): void => {
    recordingRef.current = false
    cleanupCapture()
    onClose()
  }

  const save = (): void => {
    let finalSteps = steps
    if (recording) {
      finalSteps = recorder.current?.finish() ?? []
      recordingRef.current = false
      cleanupCapture()
      setRecording(false)
      setPaused(false)
      setMode(null)
      setSteps(finalSteps)
    }
    onSave(finalSteps)
    onClose()
  }

  const seconds = Math.floor(elapsed / 1000)
  const timeLabel = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${Math.floor((elapsed % 1000) / 100)}`
  const starting = countdown > 0
  const busy = starting || recording
  const checkingSupport = support === null && supportError === null
  const stopKey = stopHotkeyLabel(support)

  return (
    <Modal
      title="Record a macro"
      subtitle="Press keys or use the mouse. Chords, text, pauses, clicks and scrolls are all editable afterwards."
      onClose={close}
      closeOnEscape={false}
      wide
      footer={
        <>
          <button className="button ghost" onClick={close}>
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
              <button className="button danger" onClick={stopRecording}>
                <Icon name="stop" size={16} /> Stop recording
              </button>
            </>
          )}
          {starting && (
            <button className="button danger" onClick={cancelCountdown}>
              <Icon name="stop" size={16} /> Cancel countdown
            </button>
          )}
          {!busy && (
            <button className="button secondary" onClick={start} disabled={checkingSupport}>
              <Icon name="record" size={16} /> {checkingSupport ? 'Checking capture…' : steps.length ? 'Record again' : 'Start recording'}
            </button>
          )}
          <button className="button primary" onClick={save} disabled={busy || steps.length === 0}>
            Add {steps.length} step{steps.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className={`record-banner${(recording && !paused) || starting ? ' recording' : ''}`}>
        <span className="record-dot" />
        <strong>
          {starting
            ? `Starting in ${countdown}…`
            : recording
              ? paused
                ? 'Paused'
                : mode === 'global'
                  ? 'Recording system-wide'
                  : 'Recording in PhoneDeck'
              : steps.length
                ? 'Recording stopped'
                : 'Ready to record'}
        </strong>
        <span className="record-time">{timeLabel}</span>
      </div>

      <div className="record-options">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={captureDelays}
            disabled={busy}
            onChange={(event) => setCaptureDelays(event.target.checked)}
          />
          Capture pauses as delay steps
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={coalesceText}
            disabled={busy}
            onChange={(event) => setCoalesceText(event.target.checked)}
          />
          Group typing into text steps
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={captureMouse}
            disabled={busy}
            onChange={(event) => {
              setCaptureMouse(event.target.checked)
              if (!event.target.checked) setCaptureMouseMove(false)
            }}
          />
          Record mouse (clicks, drags, wheel)
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={captureMouseMove}
            disabled={busy || !captureMouse}
            onChange={(event) => setCaptureMouseMove(event.target.checked)}
          />
          Record movement (sampled, drag paths always included)
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={globalCapture && support?.supported === true}
            disabled={busy || !support?.supported}
            onChange={(event) => setGlobalCapture(event.target.checked)}
          />
          Global capture (outside PhoneDeck)
        </label>
        <span className="hint">
          {supportError
            ? `Could not check global capture: ${supportError}`
            : !support
              ? 'Checking global capture support…'
              : support.supported
                ? `Global stop: ${stopKey}. Input while a PhoneDeck window is focused is ignored.`
                : support.reason}
        </span>
        <span className="hint">
          Global capture sees keystrokes and mouse activity in every app until you stop it. An OS notification
          confirms when recording starts and stops. Actions triggered from your phone during recording can appear
          as steps.
        </span>
        {captureError && <span className="record-error">{captureError}</span>}
        {notice && <span className="record-notice">{notice}</span>}
      </div>

      <div className="record-steps">
        {steps.length === 0 ? (
          <div className="empty-state">
            <Icon name="keyboard" size={26} />
            <p>
              {recording || starting
                ? 'Type, click, drag or scroll to add steps.'
                : globalCapture && support?.supported
                  ? 'Click “Start recording”. After a 3-second countdown you can work in any app; PhoneDeck ignores its own focused input.'
                  : 'Click “Start recording”, then type or use the mouse in this window.'}
            </p>
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
        Pauses longer than 140 ms become delays (capped at 2 s). Mouse movement is sampled and capped; drag paths
        are kept even when movement recording is off. Use Pause/Resume to skip a section and Undo to remove the
        last step. Recording stops automatically if the dialog closes or the global stop hotkey is pressed.
      </p>
    </Modal>
  )
}
