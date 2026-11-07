import { useEffect, useRef, useState } from 'react'
import { formatKeyLabel, isModifier, keyFromEvent, normalizeCombo } from '@phonedek/shared'
import { useHostPlatform } from '../lib/platform'
import { Modal } from './Primitives'

export function Keycaps({
  keys,
  small,
  platform,
}: {
  keys: string[]
  small?: boolean
  platform?: string
}) {
  const hostPlatform = useHostPlatform()
  const activePlatform = platform ?? hostPlatform
  return (
    <span className={small ? 'keycaps small' : 'keycaps'}>
      {keys.map((key) => (
        <kbd key={key}>{formatKeyLabel(key, activePlatform)}</kbd>
      ))}
    </span>
  )
}

export function ShortcutDialog({
  initial,
  title = 'Record shortcut',
  onSave,
  onClose,
}: {
  initial?: string[]
  title?: string
  onSave: (keys: string[]) => void
  onClose: () => void
}) {
  const [held, setHeld] = useState<string[]>([])
  const [chord, setChord] = useState<string[]>(initial ?? [])
  const heldRef = useRef<string[]>([])

  useEffect(() => {
    const onDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key) return
      if (heldRef.current.includes(key)) return
      heldRef.current = [...heldRef.current, key]
      setHeld(heldRef.current)
      setChord(normalizeCombo(heldRef.current))
    }
    const onUp = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const key = keyFromEvent(event)
      if (!key) return
      heldRef.current = heldRef.current.filter((item) => item !== key)
      setHeld(heldRef.current)
      setChord((previous) => {
        const meaningful = previous.filter((item) => !isModifier(item))
        return meaningful.length > 0 ? previous : []
      })
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [])

  const valid = chord.some((key) => !isModifier(key))

  return (
    <Modal
      title={title}
      subtitle="Press the key combination you want the phone button to send."
      onClose={onClose}
      closeOnEscape={false}
      footer={
        <>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button ghost" onClick={() => setChord([])} disabled={!chord.length}>
            Clear
          </button>
          <button className="button primary" onClick={() => valid && onSave(chord)} disabled={!valid}>
            Save shortcut
          </button>
        </>
      }
    >
      <div className={`shortcut-capture${held.length ? ' active' : ''}`}>
        {chord.length > 0 ? (
          <Keycaps keys={chord} />
        ) : (
          <span className="capture-placeholder">Press any shortcut…</span>
        )}
      </div>
      <p className="hint">
        Modifier-only combinations are not valid. Use the Save button (Esc can itself be part of a shortcut).
      </p>
    </Modal>
  )
}
