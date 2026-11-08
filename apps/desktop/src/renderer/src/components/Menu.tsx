import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icons'

export interface MenuItem {
  label: string
  /** Optional group heading rendered above the first item of the group. */
  section?: string
  icon?: IconName
  description?: string
  danger?: boolean
  onClick: () => void
}

interface PanelPosition {
  left: number
  top: number
  width: number
  openUp: boolean
}

/**
 * Popover rendered into document.body so it never gets clipped by the
 * inspector's scroll container.
 */
export function PopMenu({
  trigger,
  items,
  align = 'left',
  width = 260,
}: {
  trigger: ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null)
      return
    }
    const rect = triggerRef.current.getBoundingClientRect()
    const estimatedHeight = Math.min(items.length * 48 + 12, 420)
    const openUp = rect.bottom + estimatedHeight + 10 > window.innerHeight && rect.top > estimatedHeight
    const left =
      align === 'right'
        ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
        : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPosition({
      left,
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      width,
      openUp,
    })
  }, [open, align, width, items.length])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const close = (): void => setOpen(false)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <div className="popmenu" ref={triggerRef}>
      <div
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((value) => !value)
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        {trigger}
      </div>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            className={`popmenu-panel${position.openUp ? ' up' : ''}`}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              transform: position.openUp ? 'translateY(-100%)' : undefined,
            }}
          >
            {items.map((item, index) => {
              const section = item.section && item.section !== items[index - 1]?.section ? item.section : null
              return (
                <Fragment key={item.label}>
                  {section && <span className="popmenu-section">{section}</span>}
                  <button
                    type="button"
                    className={item.danger ? 'popmenu-item danger' : 'popmenu-item'}
                    onClick={() => {
                      setOpen(false)
                      item.onClick()
                    }}
                  >
                    {item.icon && (
                      <span className="popmenu-icon">
                        <Icon name={item.icon} size={17} />
                      </span>
                    )}
                    <span>
                      <strong>{item.label}</strong>
                      {item.description && <small>{item.description}</small>}
                    </span>
                  </button>
                </Fragment>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
