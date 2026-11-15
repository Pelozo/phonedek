import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { normalizeVersion, whatsNewFor } from '../lib/whatsNew'
import { Icon } from './Icons'

/**
 * Studio Console "What's New" surface. Opened automatically after an upgrade
 * or manually from Settings → About. The body scrolls inside a capped panel so
 * the Close action always stays visible.
 */
export function WhatsNewDialog({
  version,
  onClose,
}: {
  version: string
  onClose: () => void
}) {
  const entry = whatsNewFor(version)
  const displayVersion = normalizeVersion(version)
  const backdropRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Only the top-most modal owns Escape; Settings may still be open below.
      const backdrops = document.querySelectorAll('.modal-backdrop')
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop whats-new-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal whats-new-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        <header className="whats-new-header">
          <div className="whats-new-heading">
            <span className="whats-new-eyebrow">WHAT&apos;S NEW · {displayVersion}</span>
            <h2 id="whats-new-title">{entry.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        <div className="whats-new-body">
          <ol className="whats-new-list">
            {entry.highlights.map((highlight, index) => (
              <li key={`${index}-${highlight}`}>
                <span className="whats-new-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="whats-new-text">{highlight}</span>
              </li>
            ))}
          </ol>
        </div>

        <footer className="whats-new-footer">
          <span className="whats-new-meta">PHONEDECK · v{displayVersion}</span>
          <button ref={closeRef} type="button" className="button primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
