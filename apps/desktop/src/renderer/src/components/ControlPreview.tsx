import type { ControlSpec, SliderOrDialControlSpec } from '@phonedek/shared'
import { useHostPlatform } from '../lib/platform'
import {
  formatKeysCompact,
  shortcutBadge,
  shortcutDirectionLabel,
} from '../lib/shortcut'

function initialPercent(control: SliderOrDialControlSpec): number {
  const min = control.min ?? 0
  const max = control.max ?? 100
  if (!(max > min)) return 0.5
  const initial = control.initial ?? (min + max) / 2
  return Math.max(0, Math.min(1, (initial - min) / (max - min)))
}

/** Short badge shared by the deck and inspector previews. */
export function controlBadge(control: SliderOrDialControlSpec): string {
  if (control.binding.type === 'volume') {
    return control.binding.mode === 'absolute' ? 'VOL · ABS' : 'VOL · REL'
  }
  if (control.binding.type === 'mic') return 'MIC · GAIN'
  if (control.binding.type === 'obs') return 'OBS · VOL'
  if (control.binding.type === 'light') {
    if (control.binding.target === 'temperature') return 'LIGHT · TEMP'
    if (control.binding.target === 'power') return 'LIGHT · POWER'
    return 'LIGHT · BRIGHT'
  }
  if (control.binding.type === 'shortcut') return 'SHORTCUT'
  return 'SCROLL'
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
  const platform = useHostPlatform()

  if (control.kind === 'trackpad') {
    return (
      <div className={`control-preview trackpad${className ? ` ${className}` : ''}`}>
        <span className="control-badge">PAD</span>
        <div className="control-pad" aria-hidden="true">
          <span className="control-pad-dot" />
        </div>
        <span className="control-copy">
          <span className="control-name">{label || 'Trackpad'}</span>
          {sublabel && <span className="control-sublabel">{sublabel}</span>}
        </span>
      </div>
    )
  }

  const percent = initialPercent(control)
  const axis = control.axis ?? 'horizontal'
  const dialAngle = -135 + percent * 270

  if (control.binding.type === 'shortcut') {
    return (
      <div className={`control-preview shortcut${className ? ` ${className}` : ''}`}>
        <span className="control-badge">{shortcutBadge(control.binding, platform)}</span>
        <span className="control-copy">
          <span className="control-chord">{formatKeysCompact(control.binding.keys, platform)}</span>
          <span className="control-direction">
            {shortcutDirectionLabel(control.binding, platform)}
            {(control.binding.repeat ?? 1) > 1 ? ` ×${control.binding.repeat}` : ''}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div
      className={`control-preview ${control.kind === 'slider' ? `slider ${axis}` : 'dial'}${className ? ` ${className}` : ''}`}
    >
      <span className="control-badge">{controlBadge(control)}</span>
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
