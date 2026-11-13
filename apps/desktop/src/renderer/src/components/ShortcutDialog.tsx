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
  subtitle = 'Press the key combination you want the phone button to send.',
  modifiersOnly = false,
  onSave,
  onClose,
}: {
  initial?: string[]
  title?: string
  subtitle?: string
  /** Hold keys are modifiers only and stay captured after the keys are released. */
  modifiersOnly?: boolean
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
      if (modifiersOnly && !isModifier(key)) return
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
      // A held modifier is the whole gesture here; keep it after release.
      if (modifiersOnly) return
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
  }, [modifiersOnly])

  const valid = modifiersOnly
    ? chord.length > 0 && chord.every((key) => isModifier(key))
    : chord.some((key) => !isModifier(key))

  return (
    <Modal
      title={title}
      subtitle={subtitle}
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
          <span className="capture-placeholder">
            {modifiersOnly ? 'Hold a modifier…' : 'Press any shortcut…'}
          </span>
        )}
      </div>
      <p className="hint">
        {modifiersOnly
          ? 'Hold keys stay down for the whole phone gesture (for example Alt or Cmd).'
          : 'Modifier-only combinations are not valid. Use the Save button (Esc can itself be part of a shortcut).'}
      </p>
    </Modal>
  )
}
