import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from './Icons'

export interface IconGroup {
  id: string
  label: string
  icons: string[]
}

/**
 * The curated palette is grouped for maintainability, but the picker presents
 * one searchable grid. Group labels are kept as fallback search keywords.
 */
export const ICON_GROUPS: IconGroup[] = [
  {
    id: 'common',
    label: 'Common',
    icons: [
      '🎮', '🎵', '🔊', '🔇', '⏯️', '⏮️', '⏭️', '⏹️',
      '📋', '📌', '↩️', '↪️', '🔒', '🔓', '📸', '🖥️',
      '▶️', '🎧', '🌐', '⚙️', '⚡', '➕', '✓', '🔔',
      '🔕', '🔍', '📁', '📂', '💾', '🖱️', '⌨️', '🎯',
    ],
  },
  {
    id: 'media',
    label: 'Media',
    icons: [
      '🎬', '🎥', '🎤', '🎙️', '📺', '📻', '🎼', '🎹',
      '🥁', '🎸', '🎺', '📀', '💿', '🎚️', '🎛️', '🔉',
      '🔈', '📢', '🎶', '⏪', '⏩', '🔀', '🔁', '🔂',
    ],
  },
  {
    id: 'system',
    label: 'System',
    icons: [
      '💻', '🖨️', '🔌', '🔋', '🛠️', '🔧', '🔨', '🧰',
      '🗂️', '🗑️', '🔑', '🛡️', '🧹', '🔄', '🔃', '⏻',
      '🌙', '☀️', '📶', '📡', '📴', '📳', '🔈', '🔇',
    ],
  },
  {
    id: 'web',
    label: 'Web',
    icons: [
      '🔗', '📧', '✉️', '📨', '📩', '📤', '📥', '☁️',
      '⬆️', '⬇️', '🏠', '🛒', '💳', '🔎', '📰', '🗺️',
      '📍', '⭐', '❤️', '💬', '🔖', '📶',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icons: [
      '🕹️', '👾', '🎲', '🏆', '🥇', '🔫', '⚔️', '🗡️',
      '🏹', '🚗', '🏎️', '✈️', '🚁', '🧩', '🃏', '🎰',
      '🎳', '🎱', '🏓', '🥊', '🏁', '🎯',
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    icons: [
      '⬅️', '➡️', '⬆️', '⬇️', '↖️', '↗️', '↘️', '↙️',
      '🔙', '🔜', '⏮️', '⏭️', '⏫', '⏬', '🔀', '🔁',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icons: [
      '✅', '❌', '⚠️', '❗', '❓', 'ℹ️', '🔴', '🟢',
      '🟡', '🔵', '🟣', '⚫', '⚪', '🟠', '🔺', '🔻',
      '🔶', '🔷', '♻️', '🔰', '✳️', '✴️',
    ],
  },
  {
    id: 'work',
    label: 'Work',
    icons: [
      '📝', '📊', '📈', '📉', '🗓️', '📅', '⏰', '⏲️',
      '🧮', '💰', '🎨', '🖌️', '📷', '📹', '🎞️', '🧑‍💻',
      '📞', '📱', '🖇️', '📎', '🗃️', '🗄️', '🗒️',
    ],
  },
]

/**
 * Search aliases. These are the words a user would plausibly type while
 * looking for an icon, not a rigid taxonomy. Group labels are appended as
 * extra keywords automatically, so every icon stays discoverable.
 */
const ICON_ALIASES: Record<string, string> = {
  // Common
  '🎮': 'game gaming controller play joystick',
  '🎵': 'music note audio song tune',
  '🔊': 'volume sound speaker loud audio',
  '🔇': 'mute muted volume sound off speaker',
  '⏯️': 'play pause media toggle',
  '⏮️': 'previous prev track rewind media',
  '⏭️': 'next skip track forward media',
  '⏹️': 'stop media end',
  '📋': 'clipboard copy paste list tasks',
  '📌': 'pin keep note',
  '↩️': 'undo back return reply left',
  '↪️': 'redo forward share right',
  '🔒': 'lock locked secure private',
  '🔓': 'unlock unlocked open insecure',
  '📸': 'screenshot camera photo capture',
  '🖥️': 'desktop monitor screen display pc',
  '▶️': 'play start media',
  '🎧': 'headphones audio listen music',
  '🌐': 'browser web internet globe network',
  '⚙️': 'settings gear preferences config',
  '⚡': 'bolt lightning power fast energy',
  '➕': 'add plus new create',
  '✓': 'check done ok yes confirm',
  '🔔': 'notification bell alert ring',
  '🔕': 'silent mute notification bell off',
  '🔍': 'search find zoom magnify',
  '📁': 'folder directory files',
  '📂': 'folder open directory files',
  '💾': 'save floppy disk storage',
  '🖱️': 'mouse cursor click pointer',
  '⌨️': 'keyboard keys typing input',
  '🎯': 'target goal focus aim',
  // Media
  '🎬': 'movie film clapper video action',
  '🎥': 'video camera record film',
  '🎤': 'microphone mic record karaoke',
  '🎙️': 'microphone studio mic record podcast',
  '📺': 'tv television screen broadcast',
  '📻': 'radio broadcast audio',
  '🎼': 'music score sheet notes',
  '🎹': 'piano keyboard music keys',
  '🥁': 'drum music percussion',
  '🎸': 'guitar music instrument',
  '🎺': 'trumpet music brass',
  '📀': 'dvd disc media',
  '💿': 'cd disc media',
  '🎚️': 'slider level mixer audio',
  '🎛️': 'knobs mixer controls audio settings',
  '🔉': 'volume sound low speaker',
  '🔈': 'volume sound speaker quiet',
  '📢': 'speaker announce loud megaphone',
  '🎶': 'music notes song melody',
  '⏪': 'rewind back previous media',
  '⏩': 'fast forward skip next media',
  '🔀': 'shuffle random mix media',
  '🔁': 'repeat loop replay media',
  '🔂': 'repeat once loop media',
  // System
  '💻': 'laptop computer pc terminal code',
  '🖨️': 'printer print document',
  '🔌': 'plug power cable connect',
  '🔋': 'battery power charge',
  '🛠️': 'tools wrench repair settings',
  '🔧': 'wrench tool repair fix',
  '🔨': 'hammer tool build',
  '🧰': 'toolbox tools repair',
  '🗂️': 'tabs folders organize files',
  '🗑️': 'trash delete bin remove',
  '🔑': 'key password login access',
  '🛡️': 'shield security protect antivirus',
  '🧹': 'broom clean sweep',
  '🔄': 'refresh reload sync cycle',
  '🔃': 'refresh reload sync rotate',
  '⏻': 'power shutdown off button',
  '🌙': 'moon night dark sleep',
  '☀️': 'sun light day bright',
  '📶': 'wifi signal network wireless',
  '📡': 'satellite antenna signal network',
  '📴': 'phone off mobile disconnect',
  '📳': 'vibrate phone mode',
  // Web
  '🔗': 'link url chain website',
  '📧': 'email mail message',
  '✉️': 'mail email envelope message',
  '📨': 'email receive mail inbox',
  '📩': 'email send mail outbox',
  '📤': 'upload send outbox export',
  '📥': 'download inbox import',
  '☁️': 'cloud storage sync',
  '⬆️': 'up upload arrow',
  '⬇️': 'down download arrow',
  '🏠': 'home house start',
  '🛒': 'cart shop shopping store',
  '💳': 'card credit payment',
  '🔎': 'search find zoom inspect',
  '📰': 'news newspaper article',
  '🗺️': 'map location travel',
  '📍': 'pin location place map',
  '⭐': 'star favorite bookmark',
  '❤️': 'heart love favorite like',
  '💬': 'chat message comment speech',
  '🔖': 'bookmark tag save',
  // Gaming
  '🕹️': 'joystick game gaming arcade controller',
  '👾': 'alien game gaming arcade space',
  '🎲': 'dice game random roll',
  '🏆': 'trophy win award game',
  '🥇': 'gold medal first win',
  '🔫': 'gun weapon game shoot',
  '⚔️': 'swords battle game fight',
  '🗡️': 'dagger sword weapon game',
  '🏹': 'bow arrow game weapon',
  '🚗': 'car drive vehicle game',
  '🏎️': 'race car racing game fast',
  '✈️': 'plane airplane travel flight',
  '🚁': 'helicopter fly game',
  '🧩': 'puzzle game piece',
  '🃏': 'card joker game',
  '🎰': 'slot machine casino game',
  '🎳': 'bowling game',
  '🎱': 'billiard pool game',
  '🏓': 'ping pong table tennis game',
  '🥊': 'boxing glove game fight',
  '🏁': 'checkered flag finish race',
  // Arrows
  '⬅️': 'left arrow back',
  '➡️': 'right arrow next forward',
  '↖️': 'up left arrow northwest',
  '↗️': 'up right arrow northeast',
  '↘️': 'down right arrow southeast',
  '↙️': 'down left arrow southwest',
  '🔙': 'back return arrow',
  '🔜': 'soon next forward arrow',
  '⏫': 'up fast arrow top',
  '⏬': 'down fast arrow bottom',
  // Symbols
  '✅': 'check success done ok',
  '❌': 'cross error close no',
  '⚠️': 'warning alert caution',
  '❗': 'exclamation alert important',
  '❓': 'question help unknown',
  'ℹ️': 'info information help',
  '🔴': 'red circle record stop dot',
  '🟢': 'green circle online ok',
  '🟡': 'yellow circle warning',
  '🔵': 'blue circle info dot',
  '🟣': 'purple circle dot',
  '⚫': 'black circle dot',
  '⚪': 'white circle dot',
  '🟠': 'orange circle dot accent',
  '🔺': 'up triangle red arrow',
  '🔻': 'down triangle red arrow',
  '🔶': 'diamond orange shape',
  '🔷': 'diamond blue shape',
  '♻️': 'recycle refresh repeat',
  '🔰': 'beginner leaf symbol',
  '✳️': 'asterisk star symbol',
  '✴️': 'star sparkle symbol',
  // Work
  '📝': 'note write memo edit',
  '📊': 'chart bar graph stats',
  '📈': 'chart up growth graph',
  '📉': 'chart down loss graph',
  '🗓️': 'calendar schedule date',
  '📅': 'calendar date schedule',
  '⏰': 'alarm clock time wake',
  '⏲️': 'timer clock countdown',
  '🧮': 'abacus calculate math',
  '💰': 'money bag cash finance',
  '🎨': 'art palette design paint',
  '🖌️': 'brush paint design',
  '📷': 'camera photo picture',
  '📹': 'video camera record film',
  '🎞️': 'film frames movie video',
  '🧑‍💻': 'developer programmer laptop code',
  '📞': 'phone call telephone',
  '📱': 'phone mobile device',
  '🖇️': 'paperclip attach link',
  '📎': 'paperclip attach',
  '🗃️': 'file box archive storage',
  '🗄️': 'archive cabinet storage',
  '🗒️': 'notepad note memo',
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFE0F/g, '')
}

interface IconEntry {
  emoji: string
  keywords: string[]
  groups: string[]
  haystack: string
}

const LEGACY_GROUP_LABELS = new Map<string, Set<string>>()
for (const group of ICON_GROUPS) {
  for (const icon of group.icons) {
    const labels = LEGACY_GROUP_LABELS.get(icon) ?? new Set<string>()
    labels.add(group.label)
    LEGACY_GROUP_LABELS.set(icon, labels)
  }
}

const ICON_ENTRIES: IconEntry[] = [...LEGACY_GROUP_LABELS.entries()].map(([emoji, labels]) => {
  const keywords = (ICON_ALIASES[emoji] ?? '').split(/\s+/).filter(Boolean)
  const groups = [...labels]
  return {
    emoji,
    keywords,
    groups,
    haystack: normalize([emoji, ...keywords, ...groups].join(' ')),
  }
})

export function IconPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (icon: string) => void
}) {
  const [query, setQuery] = useState('')
  const [focusIndex, setFocusIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const tokens = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query])
  const filtered = useMemo(() => {
    if (tokens.length === 0) return ICON_ENTRIES
    return ICON_ENTRIES.filter((entry) => tokens.every((token) => entry.haystack.includes(token)))
  }, [tokens])

  const activeIndex = filtered.length > 0 ? Math.min(focusIndex, filtered.length - 1) : 0

  const setSearch = (next: string): void => {
    setQuery(next)
    setFocusIndex(0)
  }

  const focusIcon = (index: number): void => {
    if (filtered.length === 0) return
    const next = Math.max(0, Math.min(filtered.length - 1, index))
    setFocusIndex(next)
    gridRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  const clearSearch = (): void => {
    setSearch('')
    inputRef.current?.focus()
  }

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!buttons || buttons.length === 0) return
    const cells = Array.from(buttons)
    const current = Math.max(0, cells.indexOf(document.activeElement as HTMLButtonElement))
    const columns = Math.max(
      1,
      getComputedStyle(gridRef.current as HTMLDivElement).gridTemplateColumns.split(' ').filter(Boolean).length,
    )
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = current + 1
        break
      case 'ArrowLeft':
        next = current - 1
        break
      case 'ArrowDown':
        next = current + columns
        break
      case 'ArrowUp':
        next = current - columns
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = cells.length - 1
        break
      case 'PageDown':
        next = current + columns * 4
        break
      case 'PageUp':
        next = current - columns * 4
        break
      default:
        return
    }
    event.preventDefault()
    focusIcon(next)
  }

  return (
    <div className="icon-picker">
      <div className="icon-picker-search">
        <Icon name="search" size={14} className="icon-picker-search-icon" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search icons or words…"
          aria-label="Search icons"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              focusIcon(activeIndex)
              return
            }
            if (event.key === 'Escape' && query) {
              event.preventDefault()
              clearSearch()
              return
            }
            if (event.key === 'Enter' && filtered.length === 1) {
              event.preventDefault()
              const only = filtered[0]
              if (only) onChange(only.emoji)
            }
          }}
        />
        {query && (
          <button type="button" className="icon-picker-search-clear" aria-label="Clear icon search" onClick={clearSearch}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <div
        ref={gridRef}
        className="icon-picker-grid"
        role="group"
        aria-label={query ? `Icons matching ${query}` : 'All icons'}
        onKeyDown={onGridKeyDown}
      >
        {filtered.length === 0 ? (
          <div className="icon-picker-empty" role="status">
            <span>No icons match “{query}”.</span>
            <button type="button" className="icon-picker-empty-clear" onClick={clearSearch}>
              Clear search
            </button>
          </div>
        ) : (
          filtered.map((entry, index) => (
            <button
              key={entry.emoji}
              type="button"
              className={entry.emoji === value ? 'selected' : ''}
              tabIndex={index === activeIndex ? 0 : -1}
              aria-pressed={entry.emoji === value}
              title={`${entry.emoji} ${entry.keywords.slice(0, 3).join(' ')}`.trim()}
              aria-label={`Use ${entry.emoji}`}
              onClick={() => onChange(entry.emoji)}
              onFocus={() => setFocusIndex(index)}
            >
              {entry.emoji}
            </button>
          ))
        )}
      </div>

      <div className="icon-picker-foot">
        <span role="status" aria-live="polite">
          {filtered.length === ICON_ENTRIES.length
            ? `${filtered.length} icons`
            : `${filtered.length} of ${ICON_ENTRIES.length} icons`}
        </span>
        {value && (
          <button type="button" className="icon-picker-clear" onClick={() => onChange('')}>
            <Icon name="x" size={12} /> Clear icon
          </button>
        )}
      </div>
    </div>
  )
}
