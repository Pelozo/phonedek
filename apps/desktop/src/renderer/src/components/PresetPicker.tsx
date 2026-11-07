import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ACTION_PACKS,
  describeAction,
  formatCombo,
  isPresetAvailable,
  resolvePresetActions,
} from '@phonedek/shared'
import type { Action, ActionPack, ActionPreset, HostPlatform, MediaKey } from '@phonedek/shared'
import { useHostPlatform } from '../lib/platform'
import { Icon } from './Icons'
import { Modal } from './Primitives'

const MEDIA_LABELS: Record<MediaKey, string> = {
  playpause: 'Play / pause',
  next: 'Next track',
  prev: 'Previous track',
  stop: 'Stop',
  volumeup: 'Volume up',
  volumedown: 'Volume down',
  mute: 'Mute',
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFE0F/g, '')
}

function actionSummary(action: Action, platform: HostPlatform): string {
  if (action.type === 'hotkey') return formatCombo(action.keys, platform)
  if (action.type === 'media') return `Media: ${MEDIA_LABELS[action.key]}`
  return describeAction(action, platform)
}

function presetDescription(preset: ActionPreset, platform: HostPlatform): string {
  return preset.platformDescriptions?.[platform] ?? preset.description
}

function presetSummary(preset: ActionPreset, platform: HostPlatform): string {
  const summaries = resolvePresetActions(preset, platform).map((action) => actionSummary(action, platform))
  if (summaries.length === 0) return 'No actions'
  if (summaries.length === 1) return summaries[0] ?? 'Action'
  return `${summaries.length} actions · ${summaries.join(' → ')}`
}

function searchHaystack(pack: ActionPack, preset: ActionPreset, platform: HostPlatform): string {
  return normalize(
    [
      pack.name,
      pack.description,
      preset.name,
      presetDescription(preset, platform),
      presetSummary(preset, platform),
    ].join(' '),
  )
}

export function PresetPicker({
  onPick,
  onClose,
}: {
  onPick: (pack: ActionPack, preset: ActionPreset, actions: Action[]) => void
  onClose: () => void
}) {
  const platform = useHostPlatform()
  const [query, setQuery] = useState('')
  const [activePackId, setActivePackId] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const tokens = useMemo(() => normalize(query).trim().split(/\s+/).filter(Boolean), [query])
  const filteredPacks = useMemo(
    () =>
      ACTION_PACKS.map((pack) => {
        const available = pack.presets.filter((preset) => isPresetAvailable(preset, platform))
        const presets =
          tokens.length === 0
            ? available
            : available.filter((preset) => {
                const haystack = searchHaystack(pack, preset, platform)
                return tokens.every((token) => haystack.includes(token))
              })
        return { pack, presets, total: available.length }
      }).filter((entry) => entry.presets.length > 0),
    [tokens, platform],
  )

  const activeEntry = filteredPacks.find((entry) => entry.pack.id === activePackId) ?? filteredPacks[0]
  const activePresets = activeEntry?.presets ?? []
  const searching = tokens.length > 0

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (filteredPacks.some((entry) => entry.pack.id === activePackId)) return
    const first = filteredPacks[0]
    if (first) setActivePackId(first.pack.id)
  }, [filteredPacks, activePackId])

  const clearSearch = (): void => {
    setQuery('')
    inputRef.current?.focus()
  }

  const choose = (pack: ActionPack, preset: ActionPreset): void => {
    onPick(pack, preset, resolvePresetActions(preset, platform))
    onClose()
  }

  const onRailKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!buttons || buttons.length === 0) return
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(buttons.length - 1, current + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = buttons.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const entry = filteredPacks[next]
    if (!entry) return
    setActivePackId(entry.pack.id)
    buttons[next]?.focus()
  }

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!buttons || buttons.length === 0) return
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(buttons.length - 1, current + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = buttons.length - 1
        break
      case 'PageDown':
        next = Math.min(buttons.length - 1, current + 5)
        break
      case 'PageUp':
        next = Math.max(0, current - 5)
        break
      default:
        return
    }
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <Modal
      title="Preset actions"
      subtitle="Add a ready-made pack preset to this key. Existing actions are kept."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="preset-footer-note">Presets append to the selected key.</span>
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="preset-picker">
        <div className="preset-search">
          <Icon name="search" size={15} className="preset-search-icon" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search packs, presets, shortcuts…"
            aria-label="Search preset actions"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                const first = listRef.current?.querySelector<HTMLButtonElement>('button')
                if (first) {
                  event.preventDefault()
                  first.focus()
                }
                return
              }
              if (event.key === 'Enter' && activePresets.length === 1 && activeEntry) {
                event.preventDefault()
                choose(activeEntry.pack, activePresets[0] as ActionPreset)
              }
            }}
          />
          {query && (
            <button type="button" className="preset-search-clear" aria-label="Clear preset search" onClick={clearSearch}>
              <Icon name="x" size={13} />
            </button>
          )}
        </div>

        <div className="preset-layout">
          <nav
            ref={railRef}
            className="preset-rail"
            aria-label="Action pack"
            onKeyDown={onRailKeyDown}
          >
            {filteredPacks.map(({ pack, presets, total }) => {
              const active = pack.id === activeEntry?.pack.id
              return (
                <button
                  key={pack.id}
                  type="button"
                  className={`preset-pack${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActivePackId(pack.id)}
                >
                  <span className="preset-pack-head">
                    <strong>{pack.name}</strong>
                    <span className="preset-pack-count">
                      {searching ? `${presets.length}/${total}` : presets.length}
                    </span>
                  </span>
                  <span className="preset-pack-desc">{pack.description}</span>
                </button>
              )
            })}
          </nav>

          <div className="preset-results">
            <div className="preset-results-head">
              <div>
                <h3>{activeEntry?.pack.name ?? (searching ? 'No matches' : 'No presets available')}</h3>
                <p>
                  {activeEntry?.pack.description ??
                    (searching
                      ? 'Try a broader search or clear the query.'
                      : 'This platform has no presets in the available packs.')}
                </p>
              </div>
              <span className="preset-result-count">
                {activePresets.length}
                {searching && activeEntry ? `/${activeEntry.total}` : ''}{' '}
                {activePresets.length === 1 ? 'preset' : 'presets'}
              </span>
            </div>

            {activePresets.length === 0 ? (
              <div className="preset-empty" role="status">
                <Icon name="search" size={22} />
                <p>
                  {searching
                    ? `No presets match “${query.trim()}”.`
                    : 'No presets are available for this platform.'}
                </p>
                {searching && (
                  <button type="button" className="button secondary small" onClick={clearSearch}>
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div
                ref={listRef}
                className="preset-list"
                role="group"
                aria-label={`${activeEntry?.pack.name ?? ''} presets`}
                onKeyDown={onListKeyDown}
              >
                {activePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="preset-item"
                    title={`Add ${preset.name}`}
                    onClick={() => activeEntry && choose(activeEntry.pack, preset)}
                  >
                    <span className="preset-item-icon" aria-hidden="true">
                      {preset.icon ?? '＋'}
                    </span>
                    <span className="preset-item-copy">
                      <span className="preset-item-title">
                        <strong>{preset.name}</strong>
                        <span className="preset-item-summary">{presetSummary(preset, platform)}</span>
                      </span>
                      {presetDescription(preset, platform) !== presetSummary(preset, platform) && (
                        <span className="preset-item-desc">{presetDescription(preset, platform)}</span>
                      )}
                    </span>
                    <span className="preset-item-add" aria-hidden="true">
                      <Icon name="plus" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
