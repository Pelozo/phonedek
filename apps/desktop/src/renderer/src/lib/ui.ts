import type { CSSProperties } from 'react'
import type { Background, DeckButton, DeckPage, DeckProfile } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'

export function assetUrl(server: ServerInfoView | null, asset: string): string | null {
  if (!server?.running) return null
  // The editor always runs on the same machine as the server, so the loopback
  // address is both faster and compatible with the renderer CSP.
  return `http://127.0.0.1:${server.port}/assets/${encodeURIComponent(asset)}?token=${encodeURIComponent(server.token)}`
}

export function backgroundStyle(
  background: Background | undefined,
  server: ServerInfoView | null,
): CSSProperties {
  if (!background) return {}
  const overlay = background.overlay ?? 0
  const scrim = overlay > 0 ? `linear-gradient(rgba(2,6,23,${overlay}),rgba(2,6,23,${overlay}))` : null

  switch (background.type) {
    case 'color':
      return {
        background: scrim ? `${scrim}, ${background.color}` : background.color,
      }
    case 'gradient': {
      const gradient = `linear-gradient(${background.angle ?? 145}deg, ${background.from}, ${background.to})`
      return { background: scrim ? `${scrim}, ${gradient}` : gradient }
    }
    case 'image': {
      const url = assetUrl(server, background.asset)
      const image = url ? `url("${url}")` : 'linear-gradient(#1e293b, #0f172a)'
      const layers = [scrim, image].filter(Boolean).join(', ')
      return {
        backgroundImage: layers,
        backgroundSize: overlay > 0 ? `cover, ${background.fit}` : background.fit,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    }
  }
}

export function buttonBackground(
  button: DeckButton,
  _page: DeckPage,
  profile: DeckProfile,
  server: ServerInfoView | null,
): CSSProperties {
  const background = button.background ?? profile.theme.buttonBackground
  return backgroundStyle(background, server)
}

export function textColorFor(button: DeckButton, profile: DeckProfile): string {
  return button.textColor ?? profile.theme.textColor
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function cls(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
