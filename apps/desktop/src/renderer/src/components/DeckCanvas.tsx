import { useState, type CSSProperties, type DragEvent } from 'react'
import { addButton, capacity, createEmptyButton, moveButton } from '@phonedek/shared'
import type { DeckConfig, DeckPage, DeckProfile } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { backgroundStyle, buttonBackground, textColorFor } from '../lib/ui'
import { Icon } from './Icons'

export function DeckCanvas({
  config,
  profile,
  page,
  server,
  selectedButtonId,
  onChangeConfig,
  onSelectButton,
  onToast,
}: {
  config: DeckConfig
  profile: DeckProfile
  page: DeckPage
  server: ServerInfoView | null
  selectedButtonId: string | null
  onChangeConfig: (config: DeckConfig) => void
  onSelectButton: (id: string | null) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const slots = capacity(profile.grid)
  const bySlot = new Map(page.buttons.map((button) => [button.slot, button]))

  const addAt = (slot: number): void => {
    const button = createEmptyButton(slot)
    try {
      const next = addButton(config, profile.id, page.id, button)
      onChangeConfig(next)
      onSelectButton(button.id)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const onDrop = (event: DragEvent, slot: number): void => {
    event.preventDefault()
    setOverSlot(null)
    const id = dragging ?? event.dataTransfer.getData('text/phonedek-button')
    setDragging(null)
    if (!id) {
      if (!bySlot.has(slot)) addAt(slot)
      return
    }
    try {
      const next = moveButton(config, profile.id, page.id, id, slot)
      onChangeConfig(next)
      onSelectButton(id)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${profile.grid.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${profile.grid.rows}, minmax(0, 1fr))`,
    gap: `${profile.grid.gap}px`,
    padding: `${profile.grid.padding}px`,
    aspectRatio: `${profile.grid.columns} / ${profile.grid.rows}`,
    ...backgroundStyle(page.background ?? profile.theme.background, server),
  }

  return (
    <div className="deck-stage">
      <div
        className="deck-frame"
        style={{ background: 'rgba(2, 6, 23, 0.55)', borderColor: `${profile.theme.accentColor}33` }}
      >
        <div className="deck-grid" style={gridStyle} onDragLeave={() => setOverSlot(null)}>
          {Array.from({ length: slots }, (_, slot) => {
            const button = bySlot.get(slot)
            if (!button) {
              return (
                <button
                  // eslint-disable-next-line react/no-array-index-key
                  key={`empty-${slot}`}
                  type="button"
                  className={`deck-slot empty${overSlot === slot ? ' drag-over' : ''}`}
                  style={{ borderRadius: `${profile.theme.buttonRadius}px` }}
                  onClick={() => addAt(slot)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setOverSlot(slot)
                  }}
                  onDrop={(event) => onDrop(event, slot)}
                  title="Add a button here"
                >
                  <Icon name="plus" size={20} />
                  <span>Add</span>
                </button>
              )
            }

            const isSelected = button.id === selectedButtonId
            const background = buttonBackground(button, page, profile, server)
            return (
              <div
                key={button.id}
                className={`deck-slot${isSelected ? ' selected' : ''}${dragging === button.id ? ' dragging' : ''}${overSlot === slot ? ' drag-over' : ''}`}
                style={{
                  ...background,
                  borderRadius: `${profile.theme.buttonRadius}px`,
                  color: textColorFor(button, profile),
                  fontSize: `${Math.max(9, Math.min(20, profile.theme.fontSize))}px`,
                  outlineColor: profile.theme.accentColor,
                }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/phonedek-button', button.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(button.id)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOverSlot(null)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOverSlot(slot)
                }}
                onDrop={(event) => onDrop(event, slot)}
                onClick={() => onSelectButton(button.id)}
                onDoubleClick={() => {
                  if (button.actions.length) void window.phonedek.testActions(button.actions, button.label)
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectButton(button.id)
                }}
              >
                <div className="deck-button-content">
                  {button.icon && <span className="deck-icon">{button.icon}</span>}
                  <span className="deck-label">{button.label || 'Untitled'}</span>
                  {button.sublabel && <span className="deck-sublabel">{button.sublabel}</span>}
                </div>
                {button.actions.length === 0 && (
                  <span className="deck-warning" title="This button has no actions">
                    !
                  </span>
                )}
                <span className="deck-slot-number">{slot + 1}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="deck-hint">
        <Icon name="drag" size={14} /> Drag to rearrange · click an empty cell to add a button · double-click to test
      </div>
    </div>
  )
}
