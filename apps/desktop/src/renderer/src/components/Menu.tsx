import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icons'

export interface MenuItem {
  label: string
  icon?: IconName
  description?: string
  danger?: boolean
  onClick: () => void
}

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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popmenu" ref={ref}>
      <div
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen((value) => !value)
        }}
        role="button"
        tabIndex={0}
      >
        {trigger}
      </div>
      {open && (
        <div className={`popmenu-panel align-${align}`} style={{ width }}>
          {items.map((item) => (
            <button
              key={item.label}
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
          ))}
        </div>
      )}
    </div>
  )
}
