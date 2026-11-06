import { useEffect, useState } from 'react'
import type { Action, DeckButton, DeckConfig, DeckPage, DeckProfile, MacroStep } from '@phonedek/shared'
import {
  capacity,
  compactPage,
  describeAction,
  removeButton,
  resizeGrid,
  updateButton,
  updateGrid,
  updatePageMeta,
  updateProfileMeta,
  updateTheme,
} from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { backgroundStyle, buttonBackground, textColorFor } from '../lib/ui'
import { ActionEditor } from './ActionEditor'
import { BackgroundEditor } from './BackgroundEditor'
import { Icon } from './Icons'
import { PopMenu } from './Menu'
import { ColorField, NumberField, Toggle } from './Primitives'

const ICON_PICKS = ['🎮', '🎵', '🔊', '🔇', '⏯️', '⏮️', '⏭️', '📋', '📌', '↩️', '🔒', '📸', '🖥️', '▶️', '🎧', '🌐', '⚙️', '⚡', '＋', '✓']
const DEFAULT_MACRO_STEP: MacroStep = { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }

function defaultAction(type: Action['type']): Action {
  switch (type) {
    case 'hotkey':
      return { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }
    case 'text':
      return { type: 'text', text: '', perCharMs: 4 }
    case 'macro':
      return { type: 'macro', steps: [DEFAULT_MACRO_STEP] }
    case 'launch':
      return { type: 'launch', path: 'notepad.exe', args: [] }
    case 'url':
      return { type: 'url', url: 'https://' }
    case 'command':
      return { type: 'command', command: 'echo Hello from PhoneDeck', hidden: true }
    case 'media':
      return { type: 'media', key: 'playpause' }
    case 'delay':
      return { type: 'delay', ms: 250 }
    case 'page':
      return { type: 'page', direction: 'next' }
  }
}

export function Inspector({
  config,
  profile,
  page,
  button,
  server,
  onChangeConfig,
  onSelectButton,
  onToast,
}: {
  config: DeckConfig
  profile: DeckProfile
  page: DeckPage
  button: DeckButton | null
  server: ServerInfoView | null
  onChangeConfig: (config: DeckConfig) => void
  onSelectButton: (id: string | null) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [customBackground, setCustomBackground] = useState(button?.background !== undefined)
  const [customText, setCustomText] = useState(button?.textColor !== undefined)
  const [pageCustomBackground, setPageCustomBackground] = useState(page.background !== undefined)

  useEffect(() => {
    setCustomBackground(button?.background !== undefined)
    setCustomText(button?.textColor !== undefined)
  }, [button?.id, button?.background, button?.textColor])

  useEffect(() => {
    setPageCustomBackground(page.background !== undefined)
  }, [page.id, page.background])

  const buttonDefaultBackground = profile.theme.buttonBackground

  const testActions = async (actions: Action[], label: string): Promise<void> => {
    if (!actions.length) {
      onToast('This button has no actions yet', 'info')
      return
    }
    const result = await window.phonedek.testActions(actions, label)
    onToast(result.ok ? `Executed “${label}” on this PC` : (result.error ?? 'Action failed'), result.ok ? 'success' : 'error')
  }

  if (!button) {
    const usedSlots = page.buttons.length
    const total = capacity(profile.grid)
    return (
      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <span className="eyebrow">Page & theme</span>
            <h2>{page.name}</h2>
          </div>
          <span className="inspector-badge">
            {usedSlots}/{total} slots
          </span>
        </div>

        <div className="inspector-scroll">
          <section className="inspector-section">
            <div className="section-title">
              <h3>Page background</h3>
              <Toggle
                label=""
                checked={pageCustomBackground}
                onChange={(enabled) => {
                  setPageCustomBackground(enabled)
                  onChangeConfig(
                    updatePageMeta(config, profile.id, page.id, {
                      background: enabled ? structuredClone(profile.theme.background) : undefined,
                    }),
                  )
                }}
              />
            </div>
            {pageCustomBackground && page.background ? (
              <BackgroundEditor
                key={`page-bg-${page.id}-${page.background.type}`}
                value={page.background}
                server={server}
                onChange={(background) => onChangeConfig(updatePageMeta(config, profile.id, page.id, { background }))}
              />
            ) : (
              <div className="preview-strip">
                <div className="preview-swatch" style={backgroundStyle(profile.theme.background, server)} />
                <span>Inherited from the profile theme</span>
              </div>
            )}
          </section>

          <section className="inspector-section">
            <h3>Profile theme</h3>
            <div className="field">
              <span>Deck background</span>
              <BackgroundEditor
                key={`theme-bg-${profile.id}-${profile.theme.background.type}`}
                value={profile.theme.background}
                server={server}
                onChange={(background) => onChangeConfig(updateTheme(config, profile.id, { background }))}
              />
            </div>
            <div className="field">
              <span>Default button background</span>
              <BackgroundEditor
                key={`theme-button-${profile.id}-${profile.theme.buttonBackground.type}`}
                value={profile.theme.buttonBackground}
                server={server}
                onChange={(buttonBackgroundValue) =>
                  onChangeConfig(updateTheme(config, profile.id, { buttonBackground: buttonBackgroundValue }))
                }
              />
            </div>
            <div className="two-col">
              <ColorField
                label="Text color"
                value={profile.theme.textColor}
                onChange={(textColor) => onChangeConfig(updateTheme(config, profile.id, { textColor }))}
              />
              <ColorField
                label="Accent color"
                value={profile.theme.accentColor}
                onChange={(accentColor) => onChangeConfig(updateTheme(config, profile.id, { accentColor }))}
              />
            </div>
          </section>

          <section className="inspector-section">
            <h3>Grid & sizing</h3>
            <div className="two-col">
              <NumberField
                label="Columns"
                value={profile.grid.columns}
                min={1}
                max={10}
                onChange={(columns) => resizeWithWarning(columns, profile.grid.rows)}
              />
              <NumberField
                label="Rows"
                value={profile.grid.rows}
                min={1}
                max={10}
                onChange={(rows) => resizeWithWarning(profile.grid.columns, rows)}
              />
            </div>
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
            <div className="two-col">
              <NumberField
                label="Text size"
                value={profile.theme.fontSize}
                min={8}
                max={48}
                suffix="dp"
                onChange={(fontSize) => onChangeConfig(updateTheme(config, profile.id, { fontSize }))}
              />
              <NumberField
                label="Corner radius"
                value={profile.theme.buttonRadius}
                min={0}
                max={120}
                suffix="dp"
                onChange={(buttonRadius) => onChangeConfig(updateTheme(config, profile.id, { buttonRadius }))}
              />
            </div>
            <button
              type="button"
              className="button secondary full"
              onClick={() => {
                onChangeConfig(compactPage(config, profile.id, page.id))
                onToast('Buttons compacted to the first slots', 'success')
              }}
            >
              <Icon name="grid" size={15} /> Remove empty slots on this page
            </button>
            {page.id !== profile.defaultPageId && (
              <button
                type="button"
                className="button ghost full"
                onClick={() => {
                  onChangeConfig(updateProfileMeta(config, profile.id, { defaultPageId: page.id }))
                  onToast('Start page updated', 'success')
                }}
              >
                <Icon name="check" size={15} /> Use this page when the phone connects
              </button>
            )}
          </section>

          <div className="inspector-empty-hint">
            <Icon name="grid" size={20} />
            <p>Select a button to edit its label, background and actions.</p>
          </div>
        </div>
      </aside>
    )

    function resizeWithWarning(columns: number, rows: number): void {
      const limit = columns * rows
      const dropped = profile.pages.reduce(
        (count, item) => count + item.buttons.filter((candidate) => candidate.slot >= limit).length,
        0,
      )
      if (dropped > 0 && !window.confirm(`${dropped} button(s) no longer fit and will be removed. Continue?`)) return
      onChangeConfig(resizeGrid(config, profile.id, columns, rows))
      onSelectButton(null)
    }
  }

  const update = (patch: Partial<Omit<DeckButton, 'id' | 'slot'>>): void => {
    onChangeConfig(updateButton(config, profile.id, page.id, button.id, patch))
  }

  const updateAction = (index: number, action: Action): void => {
    update({ actions: button.actions.map((item, current) => (current === index ? action : item)) })
  }
  const deleteAction = (index: number): void => {
    update({ actions: button.actions.filter((_, current) => current !== index) })
  }
  const moveAction = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= button.actions.length) return
    const actions = [...button.actions]
    const [item] = actions.splice(index, 1)
    if (item) actions.splice(target, 0, item)
    update({ actions })
  }

  const deleteButton = (): void => {
    if (!window.confirm(`Delete the “${button.label || 'Untitled'}” button?`)) return
    onChangeConfig(removeButton(config, profile.id, page.id, button.id))
    onSelectButton(null)
  }

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div className="inspector-heading">
          <span className="button-avatar" style={buttonBackground(button, page, profile, server)}>
            {button.icon || '＋'}
          </span>
          <div>
            <span className="eyebrow">Button · slot {button.slot + 1}</span>
            <h2>{button.label || 'Untitled button'}</h2>
          </div>
        </div>
        <div className="row gap">
          <button type="button" className="button secondary small" onClick={() => void testActions(button.actions, button.label)}>
            <Icon name="play" size={14} /> Test
          </button>
          <button type="button" className="icon-button bordered danger" onClick={deleteButton} aria-label="Delete button">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      <div className="inspector-scroll">
        <section className="inspector-section">
          <h3>Appearance</h3>
          <label className="field">
            <span>Label</span>
            <input value={button.label} maxLength={60} onChange={(event) => update({ label: event.target.value })} />
          </label>
          <label className="field">
            <span>Sublabel</span>
            <input
              value={button.sublabel ?? ''}
              maxLength={60}
              placeholder="Optional hint, e.g. Ctrl + C"
              onChange={(event) => update({ sublabel: event.target.value || undefined })}
            />
          </label>
          <label className="field">
            <span>Icon</span>
            <div className="row gap">
              <input className="icon-input" value={button.icon ?? ''} maxLength={8} onChange={(event) => update({ icon: event.target.value || undefined })} />
              <div className="icon-picks">
                {ICON_PICKS.map((icon) => (
                  <button key={icon} type="button" className="icon-pick" onClick={() => update({ icon })} title={`Use ${icon}`}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <div className="section-title">
            <span>Custom background</span>
            <Toggle
              label=""
              checked={customBackground}
              onChange={(enabled) => {
                setCustomBackground(enabled)
                update({ background: enabled ? structuredClone(buttonDefaultBackground) : undefined })
              }}
            />
          </div>
          {customBackground && button.background ? (
            <BackgroundEditor
              key={`button-bg-${button.id}-${button.background.type}`}
              value={button.background}
              server={server}
              onChange={(background) => update({ background })}
            />
          ) : (
            <div className="preview-strip">
              <div className="preview-swatch" style={backgroundStyle(buttonDefaultBackground, server)} />
              <span>Using the profile's default button background</span>
            </div>
          )}

          <div className="section-title">
            <span>Custom text color</span>
            <Toggle
              label=""
              checked={customText}
              onChange={(enabled) => {
                setCustomText(enabled)
                update({ textColor: enabled ? profile.theme.textColor : undefined })
              }}
            />
          </div>
          {customText && button.textColor ? (
            <ColorField label="Text color" value={button.textColor} onChange={(textColor) => update({ textColor })} />
          ) : (
            <div className="preview-strip">
              <span className="text-swatch" style={{ color: textColorFor(button, profile) }}>
                Aa
              </span>
              <span>Using the profile text color</span>
            </div>
          )}
        </section>

        <section className="inspector-section">
          <div className="section-title">
            <h3>
              Actions <span className="count">{button.actions.length}</span>
            </h3>
            <PopMenu
              align="right"
              trigger={
                <button type="button" className="button secondary small">
                  <Icon name="plus" size={15} /> Add action
                </button>
              }
              items={[
                { label: 'Shortcut', icon: 'keyboard', description: 'Send a key combination', onClick: () => update({ actions: [...button.actions, defaultAction('hotkey')] }) },
                { label: 'Type text', icon: 'text', description: 'Type a phrase on the PC', onClick: () => update({ actions: [...button.actions, defaultAction('text')] }) },
                { label: 'Macro', icon: 'bolt', description: 'A recorded sequence', onClick: () => update({ actions: [...button.actions, defaultAction('macro')] }) },
                { label: 'Launch app', icon: 'app', description: 'Start a program', onClick: () => update({ actions: [...button.actions, defaultAction('launch')] }) },
                { label: 'Open URL', icon: 'link', description: 'Open a web page', onClick: () => update({ actions: [...button.actions, defaultAction('url')] }) },
                { label: 'Run command', icon: 'terminal', description: 'Run a shell command', onClick: () => update({ actions: [...button.actions, defaultAction('command')] }) },
                { label: 'Media key', icon: 'music', description: 'Play, pause, volume…', onClick: () => update({ actions: [...button.actions, defaultAction('media')] }) },
                { label: 'Delay', icon: 'clock', description: 'Wait before the next action', onClick: () => update({ actions: [...button.actions, defaultAction('delay')] }) },
                { label: 'Change page', icon: 'layers', description: 'Navigate to another deck page', onClick: () => update({ actions: [...button.actions, defaultAction('page')] }) },
              ]}
            />
          </div>

          {button.actions.length === 0 ? (
            <div className="empty-state small">
              <Icon name="bolt" size={22} />
              <p>No actions yet. This button will do nothing when pressed.</p>
            </div>
          ) : (
            <div className="action-list">
              {button.actions.map((action, index) => (
                <ActionEditor
                  key={`${action.type}-${index}`}
                  action={action}
                  index={index}
                  total={button.actions.length}
                  pages={profile.pages}
                  server={server}
                  onUpdate={(next) => updateAction(index, next)}
                  onDelete={() => deleteAction(index)}
                  onMove={(direction) => moveAction(index, direction)}
                  onTest={(candidate) => void testActions([candidate], describeAction(candidate))}
                />
              ))}
              <button
                type="button"
                className="button primary full"
                onClick={() => void testActions(button.actions, button.label || 'button')}
              >
                <Icon name="play" size={15} /> Run all actions on this PC
              </button>
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
