import { useState } from 'react'
import type { Background } from '@phonedek/shared'
import { GRADIENTS, SOLID_PRESETS } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { backgroundStyle } from '../lib/ui'
import { DeckMedia } from './DeckMedia'
import { ColorField, Slider, Toggle } from './Primitives'
import { Icon } from './Icons'

type Mode = 'color' | 'gradient' | 'image' | 'video'

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
    // Image and video wait for the user to choose a file, so we never write an
    // invalid "empty asset" background into the config.
  }

  const chooseImage = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.importAsset('image')
      if (result.ok && result.asset) {
        onChange({
          type: 'image',
          asset: result.asset,
          fit: value.type === 'image' ? value.fit : 'cover',
          ...(value.overlay ? { overlay: value.overlay } : {}),
        })
        setMode('image')
      } else if (result.error) {
        // The App-level toast is not available here; use a native alert as fallback.
        window.alert(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const chooseVideo = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.importAsset('video')
      if (result.ok && result.asset) {
        onChange({
          type: 'video',
          asset: result.asset,
          fit: value.type === 'video' ? value.fit : 'cover',
          loop: value.type === 'video' ? (value.loop ?? true) : true,
          muted: value.type === 'video' ? (value.muted ?? true) : true,
          autoplay: true,
          ...(value.overlay ? { overlay: value.overlay } : {}),
        })
        setMode('video')
      } else if (result.error) {
        window.alert(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const clearVideo = (): void => {
    if (value.type !== 'video') return
    onChange({
      type: 'color',
      color: '#0d0c0b',
      ...(value.overlay ? { overlay: value.overlay } : {}),
    })
    setMode('color')
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
        {(['color', 'gradient', 'image', 'video'] as const).map((item) => (
          <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => switchMode(item)}>
            {item === 'color' ? 'Solid' : item === 'gradient' ? 'Gradient' : item === 'image' ? 'Image' : 'Video'}
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
                <p className="hint">PNG, JPG, WEBP, GIF or BMP · animated GIFs play in the deck · up to 25 MB.</p>
              </>
            )
          })()}
        </div>
      )}

      {mode === 'video' && (
        <div className="stack">
          <div className="media-preview">
            {value.type === 'video' && value.asset ? (
              <DeckMedia media={value} server={server} />
            ) : (
              <span className="media-placeholder">
                <Icon name="video" size={22} />
                {value.type === 'video' ? 'No video selected' : 'Choose a video to switch the background'}
              </span>
            )}
          </div>
          <div className="media-action-row">
            <button type="button" className="button secondary" onClick={() => void chooseVideo()} disabled={busy}>
              <Icon name="folder" size={16} />
              {busy ? 'Importing…' : value.type === 'video' && value.asset ? 'Replace video' : 'Choose video'}
            </button>
            {value.type === 'video' && value.asset && (
              <button type="button" className="button danger ghost small" onClick={clearVideo}>
                Remove
              </button>
            )}
            <select
              aria-label="Video fit"
              value={value.type === 'video' ? value.fit : 'cover'}
              disabled={value.type !== 'video'}
              onChange={(event) =>
                value.type === 'video' && onChange({ ...value, fit: event.target.value as 'cover' | 'contain' })
              }
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </div>
          {value.type === 'video' && (
            <div className="media-options">
              <Toggle
                label="Loop"
                checked={value.loop !== false}
                onChange={(loop) => onChange({ ...value, loop })}
              />
              <Toggle
                label="Muted"
                checked={value.muted !== false}
                onChange={(muted) => onChange({ ...value, muted })}
              />
            </div>
          )}
          <p className="hint">
            MP4/H.264 is the most compatible format · up to 100 MB. Videos loop and stay muted by default.
          </p>
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
