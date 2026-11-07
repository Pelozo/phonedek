import { useState } from 'react'
import { Icon } from './Icons'

export interface IconGroup {
  id: string
  label: string
  icons: string[]
}

/**
 * Curated emoji set grouped by the kinds of actions a deck button performs.
 * Keeping categories short makes the common icons fast to scan while still
 * offering a much larger palette than a single flat row.
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

export function IconPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (icon: string) => void
}) {
  const [groupId, setGroupId] = useState(() => {
    const containing = ICON_GROUPS.find((group) => value && group.icons.includes(value))
    return containing?.id ?? 'common'
  })
  const group = ICON_GROUPS.find((item) => item.id === groupId) ?? ICON_GROUPS[0]!

  return (
    <div className="icon-picker">
      <div className="icon-picker-tabs" role="tablist" aria-label="Icon categories">
        {ICON_GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === groupId}
            className={item.id === groupId ? 'active' : ''}
            onClick={() => setGroupId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="icon-picker-grid" role="tabpanel" aria-label={`${group.label} icons`}>
        {group.icons.map((icon) => (
          <button
            key={icon}
            type="button"
            className={icon === value ? 'selected' : ''}
            title={icon}
            aria-label={`Use ${icon}`}
            onClick={() => onChange(icon)}
          >
            {icon}
          </button>
        ))}
      </div>
      <div className="icon-picker-foot">
        <span>{group.icons.length} icons</span>
        {value && (
          <button type="button" className="icon-picker-clear" onClick={() => onChange('')}>
            <Icon name="x" size={12} /> Clear icon
          </button>
        )}
      </div>
    </div>
  )
}
