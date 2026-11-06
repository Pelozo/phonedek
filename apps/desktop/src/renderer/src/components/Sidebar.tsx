import { useEffect, useState } from 'react'
import type { DeckConfig, DeckPage, DeckProfile } from '@phonedek/shared'
import {
  addPage,
  addProfile,
  deletePage,
  deleteProfile,
  duplicatePage,
  duplicateProfile,
  updatePageMeta,
  updateProfileMeta,
} from '@phonedek/shared'
import type { ServerInfoView, SettingsView } from '../../../shared/api'
import { Icon } from './Icons'

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

  const removeProfile = (profileId: string): void => {
    if (config.profiles.length <= 1) {
      onToast('At least one profile is required', 'error')
      return
    }
    if (!window.confirm('Delete this profile and all of its pages?')) return
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

  const removePage = (pageId: string): void => {
    if (profile.pages.length <= 1) {
      onToast('A profile needs at least one page', 'error')
      return
    }
    if (!window.confirm('Delete this page and its buttons?')) return
    const next = deletePage(config, profile.id, pageId)
    onChangeConfig(next)
    const nextProfile = next.profiles.find((item) => item.id === profile.id)
    if (nextProfile) onSelectPage(nextProfile.defaultPageId)
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
        <span className={`dot ${status}`} title={server.error ?? (server.running ? 'Server online' : 'Server offline')} />
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <header className="section-header">
            <span>Profiles</span>
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
                  <button type="button" className="icon-button tiny danger" onClick={() => removeProfile(item.id)} title="Delete profile">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sidebar-section">
          <label className="field compact">
            <span>Profile name</span>
            <InlineName
              value={profile.name}
              onCommit={(name) => onChangeConfig(updateProfileMeta(config, profile.id, { name }))}
            />
          </label>
          <div className="grid-summary">
            <div>
              <span>Grid</span>
              <strong>
                {profile.grid.columns} × {profile.grid.rows}
              </strong>
            </div>
            <div>
              <span>Capacity</span>
              <strong>{profile.grid.columns * profile.grid.rows} buttons</strong>
            </div>
            <div>
              <span>Used</span>
              <strong>
                {profile.pages.reduce((count, item) => count + item.buttons.length, 0)} buttons
              </strong>
            </div>
          </div>
        </section>

        <section className="sidebar-section">
          <header className="section-header">
            <span>Pages</span>
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
                      {item.buttons.length} button{item.buttons.length === 1 ? '' : 's'}
                    </small>
                  </span>
                </button>
                <div className="nav-actions">
                  <button type="button" className="icon-button tiny" onClick={() => copyPage(item.id)} title="Duplicate page">
                    <Icon name="copy" size={13} />
                  </button>
                  <button type="button" className="icon-button tiny danger" onClick={() => removePage(item.id)} title="Delete page">
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
        </section>

        <section className="sidebar-section">
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
              {server.running
                ? `${server.clients.length} connected · ${settings.port}`
                : server.error ?? 'Check the port'}
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
