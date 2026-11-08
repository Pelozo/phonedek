import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  compact,
  closeOnEscape = true,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  compact?: boolean
  closeOnEscape?: boolean
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!closeOnEscape) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Only the top-most modal owns Escape; a confirm opened from another
      // dialog must not dismiss the dialog underneath it.
      const backdrops = document.querySelectorAll('.modal-backdrop')
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeOnEscape, onClose])

  const className = wide ? 'modal modal-wide' : compact ? 'modal modal-compact' : 'modal'

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={className} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export interface ConfirmOptions {
  title: string
  message: ReactNode
  /** Optional supporting lines, rendered as a mono readout list. */
  details?: ReactNode[]
  /** Optional irreversible/impact warning line. */
  warning?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Use the solid danger primary for destructive operations. */
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

function ConfirmDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions
  onCancel: () => void
  onConfirm: () => void
}) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Destructive confirms land on Cancel so Enter cannot remove data by reflex.
    const target = options.danger ? cancelRef.current : primaryRef.current
    target?.focus()
  }, [options])

  return (
    <Modal
      title={options.title}
      onClose={onCancel}
      compact
      footer={
        <>
          <button ref={cancelRef} type="button" className="button secondary" onClick={onCancel}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className={`button ${options.danger ? 'danger-solid' : 'primary'}`}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="confirm-content">
        <p className="confirm-message">{options.message}</p>
        {options.details && options.details.length > 0 && (
          <ul className="confirm-details">
            {options.details.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        {options.warning && <p className="confirm-warning">{options.warning}</p>}
      </div>
    </Modal>
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions } | null>(null)
  const resolver = useRef<((confirmed: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // A newer request supersedes a stale one instead of leaking its promise.
      resolver.current?.(false)
      resolver.current = resolve
      setRequest({ options })
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setRequest(null)
    resolve?.(confirmed)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <ConfirmDialog
          options={request.options}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return confirm
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={`toggle-row${disabled ? ' disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  )
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  format,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  /** Optional formatted readout beside the field label, e.g. `1.00×`. */
  format?: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const set = (next: number): void => {
    if (Number.isNaN(next)) return
    onChange(Math.max(min, Math.min(max, next)))
  }
  return (
    <label className={`number-field${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        {format && <em className="number-format">{format(value)}</em>}
      </span>
      <div className="number-control">
        <button type="button" onClick={() => set(value - step)} disabled={disabled || value <= min} aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => set(Number(event.target.value))}
        />
        {suffix && <em>{suffix}</em>}
        <button type="button" onClick={() => set(value + step)} disabled={disabled || value >= max} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </label>
  )
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const short = value.length >= 7 ? value.slice(0, 7) : value
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="color-field">
      <span>{label}</span>
      <div className="color-control">
        <input type="color" value={short} onChange={(event) => onChange(event.target.value)} aria-label={`${label} color`} />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(next.trim())) onChange(next.trim())
          }}
          onBlur={() => {
            if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(draft.trim())) setDraft(value)
          }}
        />
      </div>
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  ariaLabel,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  ariaLabel?: string
  onChange: (value: number) => void
  onCommit?: (value: number) => void
}) {
  const commit = (element: HTMLInputElement): void => onCommit?.(Number(element.value))
  return (
    <label className={`slider-field${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        <em>
          {value}
          {suffix}
        </em>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => commit(event.currentTarget)}
        onKeyUp={(event) => commit(event.currentTarget)}
        onBlur={(event) => commit(event.currentTarget)}
      />
    </label>
  )
}
