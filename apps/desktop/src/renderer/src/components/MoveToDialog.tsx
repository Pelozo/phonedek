import { useEffect, useRef, useState } from 'react'
import type { DeckConfig } from '@phonedek/shared'
import { pageGrid } from '@phonedek/shared'
import { Icon } from './Icons'
import { Modal } from './Primitives'

interface MoveTarget {
  key: string
  profileId: string
  profileName: string
  pageId: string
  pageName: string
  isStart: boolean
  buttonCount: number
  columns: number
  rows: number
}

function collectTargets(
  config: DeckConfig,
  sourceProfileId: string,
  sourcePageId: string,
): MoveTarget[] {
  const targets: MoveTarget[] = []
  for (const profile of config.profiles) {
    for (const page of profile.pages) {
      if (profile.id === sourceProfileId && page.id === sourcePageId) continue
      const grid = pageGrid(profile, page)
      targets.push({
        key: `${profile.id}::${page.id}`,
        profileId: profile.id,
        profileName: profile.name,
        pageId: page.id,
        pageName: page.name,
        isStart: profile.defaultPageId === page.id,
        buttonCount: page.buttons.length,
        columns: grid.columns,
        rows: grid.rows,
      })
    }
  }
  return targets
}

/**
 * Flat page picker for moving the selected component. Every profile is
 * listed with its pages; the active source page is excluded.
 */
export function MoveToDialog({
  config,
  sourceProfileId,
  sourcePageId,
  buttonLabel,
  onMove,
  onClose,
}: {
  config: DeckConfig
  sourceProfileId: string
  sourcePageId: string
  buttonLabel: string
  onMove: (profileId: string, pageId: string) => void
  onClose: () => void
}) {
  const targets = collectTargets(config, sourceProfileId, sourcePageId)
  const [selectedKey, setSelectedKey] = useState<string | null>(targets[0]?.key ?? null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = targets.find((target) => target.key === selectedKey) ?? null

  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()
  }, [])

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    )
    if (options.length === 0) return
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    let next = current
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(options.length - 1, current + 1)
    if (event.key === 'ArrowUp') next = current < 0 ? 0 : Math.max(0, current - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = options.length - 1
    event.preventDefault()
    const option = options[next]
    option?.focus()
    const key = option?.dataset.key
    if (key) setSelectedKey(key)
  }

  const move = (): void => {
    if (!selected) return
    onMove(selected.profileId, selected.pageId)
  }

  let lastProfileId = ''

  return (
    <Modal
      title="Move component"
      subtitle={`“${buttonLabel || 'Untitled'}” · pick a destination page`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={move} disabled={!selected}>
            <Icon name="layers" size={15} /> Move component
          </button>
        </>
      }
    >
      {targets.length === 0 ? (
        <div className="move-empty">
          <Icon name="layers" size={22} />
          <p>There is no other page to move this component to. Add a page first.</p>
        </div>
      ) : (
        <div
          className="move-picker"
          ref={listRef}
          role="listbox"
          aria-label="Destination page"
          onKeyDown={onListKeyDown}
        >
          {targets.map((target) => {
            const showProfile = target.profileId !== lastProfileId
            lastProfileId = target.profileId
            return (
              <div className="move-group" key={target.key}>
                {showProfile && (
                  <div className="move-profile">
                    <Icon name="monitor" size={13} />
                    <strong>{target.profileName}</strong>
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={target.key === selectedKey}
                  data-key={target.key}
                  className={`move-option${target.key === selectedKey ? ' selected' : ''}`}
                  onClick={() => setSelectedKey(target.key)}
                >
                  <span className="move-option-name">
                    <Icon name="layers" size={15} />
                    <strong>{target.pageName}</strong>
                    {target.isStart && <em className="tag">start</em>}
                  </span>
                  <span className="move-option-meta mono">
                    {target.buttonCount} btn · {target.columns}×{target.rows}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
