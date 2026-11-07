import type { ControlSpec } from '@phonedek/shared'

function initialPercent(control: ControlSpec): number {
  const min = control.min ?? 0
  const max = control.max ?? 100
  if (!(max > min)) return 0.5
  const initial = control.initial ?? (min + max) / 2
  return Math.max(0, Math.min(1, (initial - min) / (max - min)))
}

function badgeFor(control: ControlSpec): string {
  return control.binding.type === 'volume' ? 'VOL' : 'SCROLL'
}

/**
 * Non-interactive editor preview for a continuous control. The phone owns the
 * live value; this only mirrors the configured initial/50% position.
 */
export function ControlPreview({
  control,
  label,
  sublabel,
  className,
}: {
  control: ControlSpec
  label: string
  sublabel?: string
  className?: string
}) {
  const percent = initialPercent(control)
  const axis = control.axis ?? 'horizontal'
  const dialAngle = -135 + percent * 270

  return (
    <div
      className={`control-preview ${control.kind === 'slider' ? `slider ${axis}` : 'dial'}${className ? ` ${className}` : ''}`}
    >
      <span className="control-badge">{badgeFor(control)}</span>
      {control.kind === 'slider' ? (
        <div className="control-slider" aria-hidden="true">
          <span className="control-track" />
          <span
            className="control-thumb"
            style={axis === 'vertical' ? { bottom: `${percent * 100}%` } : { left: `${percent * 100}%` }}
          />
        </div>
      ) : (
        <div className="control-dial" aria-hidden="true">
          <span className="control-dial-ring" />
          <span className="control-dial-needle" style={{ transform: `translateX(-50%) rotate(${dialAngle}deg)` }} />
          <span className="control-dial-hub" />
        </div>
      )}
      <span className="control-copy">
        <span className="control-name">{label || 'Control'}</span>
        {sublabel && <span className="control-sublabel">{sublabel}</span>}
      </span>
    </div>
  )
}
