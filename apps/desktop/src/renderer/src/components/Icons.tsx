import type { SVGProps } from 'react'

export type IconName =
  | 'plus'
  | 'trash'
  | 'copy'
  | 'cut'
  | 'clipboard'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'play'
  | 'record'
  | 'settings'
  | 'wifi'
  | 'phone'
  | 'x'
  | 'check'
  | 'grid'
  | 'image'
  | 'video'
  | 'keyboard'
  | 'text'
  | 'bolt'
  | 'link'
  | 'app'
  | 'terminal'
  | 'music'
  | 'microphone'
  | 'refresh'
  | 'monitor'
  | 'save'
  | 'download'
  | 'upload'
  | 'folder'
  | 'pause'
  | 'drag'
  | 'lock'
  | 'mouse'
  | 'trackpad'
  | 'clock'
  | 'layers'
  | 'search'
  | 'arrow-up'
  | 'arrow-down'
  | 'undo'
  | 'stop'
  | 'sliders'
  | 'light'
  | 'temperature'

const paths: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  cut: 'M6 4l12 12M18 4 6 16M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  clipboard: 'M9 4h6v3H9zM8 5H5v16h14V5h-2M9 12h6M9 16h4',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-left': 'm15 18-6-6 6-6',
  'chevron-right': 'm9 18 6-6-6-6',
  play: 'M8 5v14l11-7z',
  record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.33.7.6 1 .3.26.68.4 1.1.4H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 13 4 4L19 7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9h.01',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  text: 'M5 6h14M12 6v12M8 18h8',
  bolt: 'm13 2-9 12h7l-1 8 9-12h-7z',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  app: 'M4 4h16v16H4zM8 8h8v8H8z',
  terminal: 'm5 7 5 5-5 5M12 17h7',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3M20 16a3 3 0 1 1-3-3',
  microphone: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8',
  refresh: 'M20 11a8 8 0 1 0-2 5M20 4v7h-7',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  save: 'M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-6h8v6',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  folder: 'M3 6h7l2 2h9v12H3z',
  pause: 'M8 5v14M16 5v14',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  lock: 'M6 10h12v11H6zM9 10V7a3 3 0 0 1 6 0v3',
  mouse: 'M7 3h10v18H7zM12 3v7M9 7h6',
  trackpad: 'M4 4h16v16H4zM12 12.4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  undo: 'M9 7H4v5M4 12a8 8 0 1 0 2.3-5.7L4 9',
  stop: 'M7 7h10v10H7z',
  sliders: 'M4 7h16M4 12h16M4 17h16M8 4v6M16 9v6M10 14v6',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3z',
  temperature: 'M12 3a2 2 0 0 0-2 2v8.3a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2zM12 9v7',
}

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}

/**
 * PhoneDeck brand mark: dark chassis tile with a 2x2 key grid, three
 * warm-white keys and one signal-orange key. Geometry mirrors the Android
 * adaptive-icon foreground so every surface uses the same mark.
 */
export function DeckMark({
  size = 28,
  title,
  ...props
}: { size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 108 108"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect x="0" y="0" width="108" height="108" rx="23.8" fill="#0B0A09" />
      <rect x="30" y="30" width="22" height="22" rx="4" fill="#F1ECE2" />
      <rect x="56" y="30" width="22" height="22" rx="4" fill="#F1ECE2" />
      <rect x="30" y="56" width="22" height="22" rx="4" fill="#F1ECE2" />
      <rect x="56" y="56" width="22" height="22" rx="4" fill="#F26A2E" />
    </svg>
  )
}
