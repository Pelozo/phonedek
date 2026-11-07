import { useEffect, useState } from 'react'
import type { DeckConfig, DeckPage, DeckProfile } from '@phonedek/shared'
import {
  addPage,
  addProfile,
  clearPageGrid,
  deletePage,
  deleteProfile,
  duplicatePage,
  duplicateProfile,
  pageCapacity,
  pageGrid,
  resizeGrid,
  resizePageGrid,
  updateGrid,
  updatePageMeta,
  updateProfileMeta,
} from '@phonedek/shared'
import type { ServerInfoView, SettingsView } from '../../../shared/api'
import { Icon } from './Icons'
import { NumberField, useConfirm } from './Primitives'

const GRID_PRESETS = [
  { columns: 3, rows: 3 },
  { columns: 4, rows: 4 },
  { columns: 5, rows: 3 },
  { columns: 8, rows: 4 },
]

function GridSizeControls({
  columns,
  rows,
  label,
  onChange,
}: {
  columns: number
  rows: number
  label: string
  onChange: (columns: number, rows: number) => void
}) {
  return (
    <>
      <div className="grid-steppers">
        <div className="grid-stepper" role="group" aria-label={`${label} columns: ${columns}`}>
          <span className="grid-stepper-label">Columns</span>
          <div className="grid-stepper-controls">
            <button
              type="button"
              onClick={() => onChange(columns - 1, rows)}
              disabled={columns <= 1}
              aria-label={`Decrease ${label} columns`}
            >
              −
            </button>
            <span className="grid-stepper-value" aria-live="polite">
              {columns}
            </span>
            <button
              type="button"
              onClick={() => onChange(columns + 1, rows)}
              disabled={columns >= 10}
              aria-label={`Increase ${label} columns`}
            >
              +
            </button>
          </div>
        </div>
        <div className="grid-stepper" role="group" aria-label={`${label} rows: ${rows}`}>
          <span className="grid-stepper-label">Rows</span>
          <div className="grid-stepper-controls">
            <button
              type="button"
              onClick={() => onChange(columns, rows - 1)}
              disabled={rows <= 1}
              aria-label={`Decrease ${label} rows`}
            >
              −
            </button>
            <span className="grid-stepper-value" aria-live="polite">
              {rows}
            </span>
            <button
              type="button"
              onClick={() => onChange(columns, rows + 1)}
              disabled={rows >= 10}
              aria-label={`Increase ${label} rows`}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="grid-presets" role="group" aria-label={`${label} grid presets`}>
        {GRID_PRESETS.map((preset) => {
          const active = preset.columns === columns && preset.rows === rows
          return (
            <button
              key={`${preset.columns}x${preset.rows}`}
              type="button"
              className={`grid-preset${active ? ' active' : ''}`}
              aria-pressed={active}
              title={`Set ${label.toLowerCase()} grid to ${preset.columns} × ${preset.rows}`}
              onClick={() => onChange(preset.columns, preset.rows)}
            >
              {preset.columns}×{preset.rows}
            </button>
          )
        })}
      </div>
    </>
  )
}

function InlineName({
  value,
  onCommit,
  className,
}: {
  value: string
  onCommit: (value: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <input
      className={className ?? 'inline-name'}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        if (event.key === 'Escape') {
          setDraft(value)
          ;(event.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function Sidebar({
  config,
  profile,
  page,
  server,
  settings,
  onChangeConfig,
  onSelectProfile,
  onSelectPage,
  onOpenPair,
  onOpenSettings,
  onToast,
}: {
  config: DeckConfig
  profile: DeckProfile
  page: DeckPage
  server: ServerInfoView
  settings: SettingsView
  onChangeConfig: (config: DeckConfig) => void
  onSelectProfile: (id: string) => void
  onSelectPage: (id: string) => void
  onOpenPair: () => void
  onOpenSettings: () => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [profileGridOpen, setProfileGridOpen] = useState(false)
  const confirm = useConfirm()

  const addNewProfile = (): void => {
    const result = addProfile(config, `Profile ${config.profiles.length + 1}`)
    onChangeConfig(result.config)
    onSelectProfile(result.profileId)
    const nextProfile = result.config.profiles.find((item) => item.id === result.profileId)
    if (nextProfile) onSelectPage(nextProfile.defaultPageId)
    onToast('Profile created', 'success')
  }

  const copyProfile = (profileId: string): void => {
    const result = duplicateProfile(config, profileId)
    onChangeConfig(result.config)
    onSelectProfile(result.profileId)
    const nextProfile = result.config.profiles.find((item) => item.id === result.profileId)
    if (nextProfile) onSelectPage(nextProfile.defaultPageId)
    onToast('Profile duplicated', 'success')
  }

  const removeProfile = async (profileId: string): Promise<void> => {
    if (config.profiles.length <= 1) {
      onToast('At least one profile is required', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Delete profile',
      message: 'Delete this profile and all of its pages?',
      warning: 'Every page, button and action in the profile is removed. This cannot be undone.',
      confirmLabel: 'Delete profile',
      danger: true,
    })
    if (!confirmed) return
    const next = deleteProfile(config, profileId)
    onChangeConfig(next)
    const first = next.profiles[0]
    if (first) {
      onSelectProfile(first.id)
      onSelectPage(first.defaultPageId)
    }
  }

  const addNewPage = (): void => {
    const result = addPage(config, profile.id, `Page ${profile.pages.length + 1}`)
    onChangeConfig(result.config)
    onSelectPage(result.pageId)
  }

  const copyPage = (pageId: string): void => {
    const result = duplicatePage(config, profile.id, pageId)
    onChangeConfig(result.config)
    onSelectPage(result.pageId)
    onToast('Page duplicated', 'success')
  }

  const removePage = async (pageId: string): Promise<void> => {
    if (profile.pages.length <= 1) {
      onToast('A profile needs at least one page', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Delete page',
      message: 'Delete this page and its buttons?',
      warning: 'The page and its buttons are removed. This cannot be undone.',
      confirmLabel: 'Delete page',
      danger: true,
    })
    if (!confirmed) return
    const next = deletePage(config, profile.id, pageId)
    onChangeConfig(next)
    const nextProfile = next.profiles.find((item) => item.id === profile.id)
    if (nextProfile) onSelectPage(nextProfile.defaultPageId)
  }

  const usedButtons = profile.pages.reduce((count, item) => count + item.buttons.length, 0)
  const activePageGrid = pageGrid(profile, page)

  const applyPageGrid = async (columns: number, rows: number): Promise<void> => {
    const nextColumns = Math.max(1, Math.min(10, Math.round(columns)))
    const nextRows = Math.max(1, Math.min(10, Math.round(rows)))
    if (nextColumns === activePageGrid.columns && nextRows === activePageGrid.rows) return

    const limit = nextColumns * nextRows
    const removed = page.buttons.filter((button) => button.slot >= limit).length
    if (removed > 0) {
      const confirmed = await confirm({
        title: 'Resize page grid',
        message: `Resize “${page.name}” to ${nextColumns} × ${nextRows}?`,
        details: [
          `This removes ${removed} button${removed === 1 ? '' : 's'} from this page that no longer fit.`,
        ],
        warning: 'This cannot be undone.',
        confirmLabel: `Resize and remove ${removed}`,
        danger: true,
      })
      if (!confirmed) return
    }

    onChangeConfig(
      resizePageGrid(config, profile.id, page.id, {
        ...activePageGrid,
        columns: nextColumns,
        rows: nextRows,
      }),
    )
    onToast(
      removed > 0
        ? `“${page.name}” grid set to ${nextColumns} × ${nextRows} · ${removed} button${removed === 1 ? '' : 's'} removed`
        : `“${page.name}” grid set to ${nextColumns} × ${nextRows}`,
      removed > 0 ? 'info' : 'success',
    )
  }

  const applyProfileGrid = async (columns: number, rows: number): Promise<void> => {
    const nextColumns = Math.max(1, Math.min(10, Math.round(columns)))
    const nextRows = Math.max(1, Math.min(10, Math.round(rows)))
    if (nextColumns === profile.grid.columns && nextRows === profile.grid.rows) return

    const limit = nextColumns * nextRows
    const losses = profile.pages
      .filter((item) => !item.grid)
      .map((item) => ({
        name: item.name,
        count: item.buttons.filter((button) => button.slot >= limit).length,
      }))
      .filter((item) => item.count > 0)
    const removed = losses.reduce((sum, item) => sum + item.count, 0)

    if (removed > 0) {
      const where = losses.map((item) => `${item.name} (${item.count})`).join(', ')
      const confirmed = await confirm({
        title: 'Resize profile grid',
        message: `Resize the profile default grid to ${nextColumns} × ${nextRows}?`,
        details: [
          `This removes ${removed} button${removed === 1 ? '' : 's'} from inheriting pages: ${where}.`,
          'Pages with their own layout are unaffected.',
        ],
        warning: 'This cannot be undone.',
        confirmLabel: `Resize and remove ${removed}`,
        danger: true,
      })
      if (!confirmed) return
    }

    onChangeConfig(resizeGrid(config, profile.id, nextColumns, nextRows))
    onToast(
      removed > 0
        ? `Profile default set to ${nextColumns} × ${nextRows} · ${removed} button${removed === 1 ? '' : 's'} removed from inheriting pages`
        : `Profile default set to ${nextColumns} × ${nextRows}`,
      removed > 0 ? 'info' : 'success',
    )
  }

  const inheritProfileGrid = async (): Promise<void> => {
    if (!page.grid) return
    const limit = profile.grid.columns * profile.grid.rows
    const removed = page.buttons.filter((button) => button.slot >= limit).length
    if (removed > 0) {
      const confirmed = await confirm({
        title: 'Use profile grid',
        message: `Use the profile default grid (${profile.grid.columns} × ${profile.grid.rows}) for “${page.name}”?`,
        details: [`This removes ${removed} button${removed === 1 ? '' : 's'} that no longer fit.`],
        warning: 'This cannot be undone.',
        confirmLabel: `Use profile grid and remove ${removed}`,
        danger: true,
      })
      if (!confirmed) return
    }

    onChangeConfig(clearPageGrid(config, profile.id, page.id))
    onToast(
      removed > 0
        ? `“${page.name}” now inherits the profile grid · ${removed} button${removed === 1 ? '' : 's'} removed`
        : `“${page.name}” now inherits the profile grid`,
      removed > 0 ? 'info' : 'success',
    )
  }

  const status = server.error ? 'error' : server.running ? 'online' : 'offline'

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="grid" size={18} />
        </span>
        <div>
          <strong>PhoneDeck</strong>
          <small>Stream Deck for Android</small>
        </div>
        <span className="brand-status" title={server.error ?? (server.running ? 'Server online' : 'Server offline')}>
          <span className={`dot ${status}`} />
          {status}
        </span>
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <header className="section-header">
            <span>
              <em>01</em> Profiles
            </span>
            <button type="button" className="icon-button tiny" onClick={addNewProfile} aria-label="Add profile">
              <Icon name="plus" size={15} />
            </button>
          </header>
          <div className="nav-list">
            {config.profiles.map((item) => (
              <div key={item.id} className={`nav-item${item.id === profile.id ? ' active' : ''}`}>
                <button type="button" className="nav-main" onClick={() => onSelectProfile(item.id)}>
                  <Icon name="monitor" size={16} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.pages.length} page{item.pages.length === 1 ? '' : 's'} · {item.grid.columns}×{item.grid.rows}
                    </small>
                  </span>
                </button>
                <div className="nav-actions">
                  <button type="button" className="icon-button tiny" onClick={() => copyProfile(item.id)} title="Duplicate profile">
                    <Icon name="copy" size={13} />
                  </button>
                  <button type="button" className="icon-button tiny danger" onClick={() => void removeProfile(item.id)} title="Delete profile">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sidebar-section">
          <header className="section-header">
            <span>
              <em>02</em> Deck
            </span>
          </header>
          <label className="field compact">
            <span>Profile name</span>
            <InlineName
              value={profile.name}
              onCommit={(name) => onChangeConfig(updateProfileMeta(config, profile.id, { name }))}
            />
          </label>
          <div className="grid-control">
            <div className="grid-state-row">
              <span className={`grid-state${page.grid ? ' custom' : ''}`}>
                {page.grid ? 'Custom page layout' : 'Inherited from profile'}
              </span>
              {page.grid && (
                <button type="button" className="grid-reset" onClick={() => void inheritProfileGrid()}>
                  Use profile default
                </button>
              )}
            </div>
            <GridSizeControls
              columns={activePageGrid.columns}
              rows={activePageGrid.rows}
              label="Page"
              onChange={applyPageGrid}
            />
            <div className="grid-readout">
              <span>
                Page <strong>{page.buttons.length}/{pageCapacity(profile, page)}</strong>
              </span>
              <span>
                Profile <strong>{usedButtons}</strong>
              </span>
            </div>
          </div>

          <div className="grid-default">
            <button
              type="button"
              className="grid-default-toggle"
              aria-expanded={profileGridOpen}
              onClick={() => setProfileGridOpen((open) => !open)}
            >
              <span>Profile default</span>
              <span className="mono">
                {profile.grid.columns} × {profile.grid.rows}
              </span>
              <Icon name={profileGridOpen ? 'chevron-down' : 'chevron-right'} size={13} />
            </button>
            {profileGridOpen && (
              <div className="grid-default-panel">
                <GridSizeControls
                  columns={profile.grid.columns}
                  rows={profile.grid.rows}
                  label="Profile default"
                  onChange={applyProfileGrid}
                />
                <div className="two-col">
                  <NumberField
                    label="Gap"
                    value={profile.grid.gap}
                    min={0}
                    max={60}
                    suffix="px"
                    onChange={(gap) => onChangeConfig(updateGrid(config, profile.id, { gap }))}
                  />
                  <NumberField
                    label="Padding"
                    value={profile.grid.padding}
                    min={0}
                    max={80}
                    suffix="px"
                    onChange={(padding) => onChangeConfig(updateGrid(config, profile.id, { padding }))}
                  />
                </div>
                <p className="hint">Applies to pages that inherit the profile grid.</p>
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-section">
          <header className="section-header">
            <span>
              <em>03</em> Pages
            </span>
            <button type="button" className="icon-button tiny" onClick={addNewPage} aria-label="Add page">
              <Icon name="plus" size={15} />
            </button>
          </header>
          <div className="nav-list">
            {profile.pages.map((item) => (
              <div key={item.id} className={`nav-item${item.id === page.id ? ' active' : ''}`}>
                <button type="button" className="nav-main" onClick={() => onSelectPage(item.id)}>
                  <Icon name="layers" size={16} />
                  <span>
                    <strong>
                      {item.name}
                      {item.id === profile.defaultPageId && <em className="tag">start</em>}
                    </strong>
                    <small>
                      {item.buttons.length} button{item.buttons.length === 1 ? '' : 's'} ·{' '}
                      {pageGrid(profile, item).columns}×{pageGrid(profile, item).rows}
                    </small>
                  </span>
                </button>
                <div className="nav-actions">
                  <button type="button" className="icon-button tiny" onClick={() => copyPage(item.id)} title="Duplicate page">
                    <Icon name="copy" size={13} />
                  </button>
                  <button type="button" className="icon-button tiny danger" onClick={() => void removePage(item.id)} title="Delete page">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="add-row" onClick={addNewPage}>
            <Icon name="plus" size={15} /> Add page
          </button>
          {page.id !== profile.defaultPageId && (
            <button
              type="button"
              className="add-row subtle"
              onClick={() => {
                onChangeConfig(updateProfileMeta(config, profile.id, { defaultPageId: page.id }))
                onToast(`“${page.name}” is now the start page`, 'success')
              }}
            >
              <Icon name="check" size={15} /> Start on this page
            </button>
          )}
          <label className="field compact">
            <span>Page name</span>
            <InlineName
              value={page.name}
              onCommit={(name) => onChangeConfig(updatePageMeta(config, profile.id, page.id, { name }))}
            />
          </label>
        </section>
      </div>

      <footer className="sidebar-footer">
        <button type="button" className="pair-button" onClick={onOpenPair}>
          <span className="pair-button-icon">
            <Icon name="phone" size={18} />
          </span>
          <span>
            <strong>{server.running ? 'Pair a phone' : 'Server offline'}</strong>
            <small>
              {server.running ? (
                <>
                  {server.clients.length} online · <span className="mono">{settings.port}</span>
                </>
              ) : (
                (server.error ?? 'Check the port')
              )}
            </small>
          </span>
          <span className={`dot ${status}`} />
        </button>
        <button type="button" className="icon-button bordered" onClick={onOpenSettings} aria-label="Settings">
          <Icon name="settings" size={18} />
        </button>
      </footer>
    </aside>
  )
}
