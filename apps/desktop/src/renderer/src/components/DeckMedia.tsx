import { useEffect, useState, type ReactNode } from 'react'
import type { ServerInfoView } from '../../../shared/api'
import { assetUrl } from '../lib/ui'

export interface DeckMediaSpec {
  type: 'image' | 'video'
  asset: string
  fit?: 'cover' | 'contain'
  loop?: boolean
  muted?: boolean
  autoplay?: boolean
  overlay?: number
}

/**
 * Decorative animated image/video layer. It never receives pointer events so
 * deck drag/click handling stays on the surrounding button or slot.
 */
export function DeckMedia({
  media,
  server,
  className,
  fallback,
}: {
  media: DeckMediaSpec
  server: ServerInfoView | null
  className?: string
  fallback?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const url = assetUrl(server, media.asset)
  const fit = media.fit ?? 'cover'
  const overlay = media.overlay ?? 0

  useEffect(() => {
    setFailed(false)
  }, [media.asset, media.type, url])

  return (
    <span className={className ? `deck-media ${className}` : 'deck-media'} aria-hidden="true">
      {fallback !== undefined && fallback !== null && (
        <span className="deck-media-fallback">{fallback}</span>
      )}
      {url && !failed && media.type === 'image' && (
        <img
          className="deck-media-el"
          src={url}
          alt=""
          draggable={false}
          style={{ objectFit: fit }}
          onError={() => setFailed(true)}
        />
      )}
      {url && !failed && media.type === 'video' && (
        <video
          className="deck-media-el"
          src={url}
          autoPlay={media.autoplay !== false}
          loop={media.loop !== false}
          muted={media.muted !== false}
          playsInline
          preload="metadata"
          style={{ objectFit: fit }}
          onError={() => setFailed(true)}
        />
      )}
      {overlay > 0 && <span className="deck-media-overlay" style={{ background: `rgba(2,6,23,${overlay})` }} />}
    </span>
  )
}
