import { useState, type CSSProperties, type DragEvent } from 'react'
import {
  addButton,
  buttonFootprint,
  canPlaceButton,
  createEmptyButton,
  moveButton,
  occupiedCells,
  pageCapacity,
  pageGrid,
} from '@phonedek/shared'
import type { DeckConfig, DeckPage, DeckProfile } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { obsStateBadge, obsStateBindingSummary } from '../lib/obs'
import { twitchStateBadge, twitchStateBindingSummary } from '../lib/twitch'
import { lightStateBadge, lightStateBindingSummary } from '../lib/lights'
import type { StateBinding } from '@phonedek/shared'
import { backgroundStyle, buttonBackground, isVideoBackground, textColorFor } from '../lib/ui'
import { ControlPreview } from './ControlPreview'
import { DeckMedia } from './DeckMedia'
import { Icon } from './Icons'

function statusBadge(state: StateBinding): string {
  if (state.type === 'obs') return obsStateBadge(state.target)
  if (state.type === 'twitch') return twitchStateBadge(state.target)
  return lightStateBadge(state.target)
}

function statusSummary(
  state: StateBinding,
  lights: ServerInfoView['settings']['lights'],
): string | null {
  if (state.type === 'obs') return obsStateBindingSummary(state)
  if (state.type === 'twitch') return twitchStateBindingSummary(state)
  return lightStateBindingSummary(state, lights)
}

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
  const grid = pageGrid(profile, page)
  const slots = pageCapacity(profile, page)
  const bySlot = new Map(page.buttons.map((button) => [button.slot, button]))
  const occupied = occupiedCells(page.buttons, grid)
  const deckNumber = String(Math.max(1, config.profiles.findIndex((item) => item.id === profile.id) + 1)).padStart(2, '0')

  const addAt = (slot: number): void => {
    if (!canPlaceButton(page.buttons, slot, { columns: 1, rows: 1 }, grid)) {
      onToast('That cell is covered by a control. Pick a free cell.', 'info')
      return
    }
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
    const target = bySlot.get(slot)
    if (!id) {
      if (!target && !occupied.has(slot)) addAt(slot)
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

  const pageBackground = page.background ?? profile.theme.background
  const pageVideo = isVideoBackground(pageBackground) ? pageBackground : null

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
    gap: `${grid.gap}px`,
    padding: `${grid.padding}px`,
    aspectRatio: `${grid.columns} / ${grid.rows}`,
    ...backgroundStyle(pageBackground, server),
  }

  return (
    <div className="deck-stage">
      <div className="deck-device">
        <div className="deck-labelstrip">
          <span className="deck-led" aria-hidden="true" />
          <span className="deck-brand">PhoneDeck</span>
          <span className="deck-sep" aria-hidden="true" />
          <span>Deck {deckNumber}</span>
          <span className="deck-meta">
            {grid.columns}×{grid.rows} · {occupied.size}/{slots}
          </span>
        </div>
        <div className="deck-frame">
          <div className="deck-grid" style={gridStyle} onDragLeave={() => setOverSlot(null)}>
            {pageVideo && <DeckMedia media={pageVideo} server={server} className="deck-bg-media" />}
            {Array.from({ length: slots }, (_, slot) => {
              const button = bySlot.get(slot)
              if (!button) {
                if (occupied.has(slot)) return null
                const column = slot % grid.columns
                const row = Math.floor(slot / grid.columns)
                return (
                  <button
                    // eslint-disable-next-line react/no-array-index-key
                    key={`empty-${slot}`}
                    type="button"
                    className={`deck-slot empty${overSlot === slot ? ' drag-over' : ''}`}
                    style={{ gridColumn: `${column + 1}`, gridRow: `${row + 1}` }}
                    onClick={() => addAt(slot)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setOverSlot(slot)
                    }}
                    onDrop={(event) => onDrop(event, slot)}
                    title="Add a button here"
                    aria-label="Add a button here"
                  >
                    <span className="deck-empty-index">{String(slot + 1).padStart(2, '0')}</span>
                    <Icon name="plus" size={16} className="deck-empty-plus" />
                  </button>
                )
              }

              const footprint = buttonFootprint(button, grid)
              const column = footprint?.column ?? slot % grid.columns
              const row = footprint?.row ?? Math.floor(slot / grid.columns)
              const spanColumns = footprint?.columns ?? 1
              const spanRows = footprint?.rows ?? 1
              const spanning = spanColumns > 1 || spanRows > 1
              const isSelected = button.id === selectedButtonId
              const background = buttonBackground(button, page, profile, server)
              const resolvedBackground = button.background ?? profile.theme.buttonBackground
              const buttonVideo = isVideoBackground(resolvedBackground) ? resolvedBackground : null
              return (
                <div
                  key={button.id}
                  className={`deck-slot${isSelected ? ' selected' : ''}${dragging === button.id ? ' dragging' : ''}${overSlot === slot ? ' drag-over' : ''}${spanning ? ' spanning' : ''}${button.control ? ' has-control' : ''}${button.state ? ' has-state' : ''}`}
                  style={{
                    gridColumn: `${column + 1} / span ${spanColumns}`,
                    gridRow: `${row + 1} / span ${spanRows}`,
                    ...background,
                    borderRadius: `${profile.theme.buttonRadius}px`,
                    color: textColorFor(button, profile),
                    fontSize: `${Math.max(9, Math.min(20, profile.theme.fontSize))}px`,
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
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectButton(button.id)
                  }}
                >
                  {buttonVideo && <DeckMedia media={buttonVideo} server={server} className="deck-button-media" />}
                  {button.control ? (
                    <ControlPreview
                      control={button.control}
                      label={button.label}
                      sublabel={button.sublabel}
                      className="deck-control-preview"
                    />
                  ) : (
                    <div className="deck-button-content">
                      {button.iconMedia ? (
                        <span className="deck-icon deck-icon-media">
                          <DeckMedia media={button.iconMedia} server={server} fallback={button.icon || '＋'} />
                        </span>
                      ) : button.icon ? (
                        <span className="deck-icon">{button.icon}</span>
                      ) : null}
                      <span className="deck-label">{button.label || 'Untitled'}</span>
                      {button.sublabel && <span className="deck-sublabel">{button.sublabel}</span>}
                    </div>
                  )}
                  {button.state && (
                    <span
                      className="deck-status-badge"
                      title={statusSummary(button.state, server?.settings.lights ?? []) ?? undefined}
                    >
                      {statusBadge(button.state)}
                    </span>
                  )}
                  {!button.control && button.actions.length === 0 && !button.state && (
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
      </div>
      <div className="deck-hint">
        <Icon name="drag" size={13} /> Drag tiles to rearrange · click an empty cell to add a button · controls keep their span when moved
      </div>
    </div>
  )
}
