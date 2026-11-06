import { useState } from 'react'
import type { Background } from '@phonedek/shared'
import { GRADIENTS, SOLID_PRESETS } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { backgroundStyle } from '../lib/ui'
import { ColorField, Slider } from './Primitives'
import { Icon } from './Icons'

type Mode = 'color' | 'gradient' | 'image'

function modeOf(background: Background): Mode {
  return background.type
}

export function BackgroundEditor({
  value,
  onChange,
  server,
}: {
  value: Background
  onChange: (value: Background) => void
  server: ServerInfoView | null
}) {
  const [mode, setMode] = useState<Mode>(modeOf(value))
  const [busy, setBusy] = useState(false)

  const switchMode = (next: Mode): void => {
    setMode(next)
    if (next === value.type) return
    if (next === 'color') onChange({ type: 'color', color: '#1e293b' })
    if (next === 'gradient') onChange({ type: 'gradient', from: '#1e293b', to: '#334155', angle: 145 })
    // Switching to image waits for the user to choose a file, so we never
    // write an invalid "empty asset" background into the config.
  }

  const chooseImage = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.importAsset()
      if (result.ok && result.asset) {
        onChange({ type: 'image', asset: result.asset, fit: value.type === 'image' ? value.fit : 'cover' })
        setMode('image')
      } else if (result.error) {
        // The App-level toast is not available here; use a native alert as fallback.
        window.alert(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const overlay = value.overlay ?? 0
  const setOverlay = (next: number): void => {
    const cleaned = next <= 0 ? undefined : next
    if (value.type === 'color') onChange({ ...value, overlay: cleaned })
    else if (value.type === 'gradient') onChange({ ...value, overlay: cleaned })
    else onChange({ ...value, overlay: cleaned })
  }

  return (
    <div className="background-editor">
      <div className="segmented">
        {(['color', 'gradient', 'image'] as const).map((item) => (
          <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => switchMode(item)}>
            {item === 'color' ? 'Solid' : item === 'gradient' ? 'Gradient' : 'Image'}
          </button>
        ))}
      </div>

      {mode === 'color' && value.type === 'color' && (
        <div className="stack">
          <ColorField label="Color" value={value.color} onChange={(color) => onChange({ ...value, color })} />
          <div className="swatches">
            {SOLID_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className="swatch"
                style={{ background: color }}
                title={color}
                onClick={() => onChange({ ...value, color })}
              />
            ))}
          </div>
        </div>
      )}

      {mode === 'gradient' && value.type === 'gradient' && (
        <div className="stack">
          <div className="two-col">
            <ColorField label="From" value={value.from} onChange={(from) => onChange({ ...value, from })} />
            <ColorField label="To" value={value.to} onChange={(to) => onChange({ ...value, to })} />
          </div>
          <Slider
            label="Angle"
            value={value.angle ?? 145}
            min={0}
            max={360}
            suffix="°"
            onChange={(angle) => onChange({ ...value, angle })}
          />
          <div className="gradient-presets">
            {GRADIENTS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="gradient-preset"
                style={{ background: `linear-gradient(145deg, ${preset.from}, ${preset.to})` }}
                onClick={() => onChange({ type: 'gradient', from: preset.from, to: preset.to, angle: 145 })}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'image' && (
        <div className="stack">
          {(() => {
            const imageValue: Background =
              value.type === 'image' ? value : { type: 'image', asset: '', fit: 'cover' }
            return (
              <>
                <div className="image-preview" style={backgroundStyle(imageValue, server)}>
                  {!(value.type === 'image' && value.asset) && (
                    <span>
                      <Icon name="image" size={22} />
                      {value.type === 'image' ? 'No image selected' : 'Choose an image to switch the background'}
                    </span>
                  )}
                </div>
                <div className="row gap">
                  <button type="button" className="button secondary" onClick={() => void chooseImage()} disabled={busy}>
                    <Icon name="folder" size={16} />
                    {busy ? 'Importing…' : value.type === 'image' && value.asset ? 'Replace image' : 'Choose image'}
                  </button>
                  <select
                    value={value.type === 'image' ? value.fit : 'cover'}
                    disabled={value.type !== 'image'}
                    onChange={(event) =>
                      value.type === 'image' && onChange({ ...value, fit: event.target.value as 'cover' | 'contain' })
                    }
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                  </select>
                </div>
                <p className="hint">PNG, JPG, WEBP, GIF or BMP · up to 25 MB. Files are copied into PhoneDeck's data folder.</p>
              </>
            )
          })()}
        </div>
      )}

      <Slider
        label="Dark overlay"
        value={Math.round(overlay * 100)}
        min={0}
        max={90}
        suffix="%"
        onChange={(percent) => setOverlay(percent / 100)}
      />
    </div>
  )
}
