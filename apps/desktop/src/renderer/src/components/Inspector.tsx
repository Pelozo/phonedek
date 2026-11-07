import { useEffect, useState } from 'react'
import type { Action, ActionPack, ActionPreset, DeckButton, DeckConfig, DeckPage, DeckProfile, MacroStep, MediaIcon } from '@phonedek/shared'
import {
  compactPage,
  describeAction,
  pageCapacity,
  pageGrid,
  removeButton,
  resizePageGrid,
  updateButton,
  updatePageMeta,
  updateProfileMeta,
  updateTheme,
} from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import { backgroundStyle, buttonBackground, textColorFor } from '../lib/ui'
import { ActionEditor } from './ActionEditor'
import { BackgroundEditor } from './BackgroundEditor'
import { DeckMedia } from './DeckMedia'
import { Icon } from './Icons'
import { IconPicker } from './IconPicker'
import { PopMenu } from './Menu'
import { PresetPicker } from './PresetPicker'
import { ColorField, NumberField, Toggle, useConfirm } from './Primitives'
import { useHostPlatform } from '../lib/platform'

const DEFAULT_MACRO_STEP: MacroStep = { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }

function defaultAction(type: Action['type'], platform: string): Action {
  switch (type) {
    case 'hotkey':
      return { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }
    case 'text':
      return { type: 'text', text: '', perCharMs: 4 }
    case 'macro':
      return { type: 'macro', steps: [DEFAULT_MACRO_STEP] }
    case 'launch':
      return {
        type: 'launch',
        path: platform === 'darwin' ? '/System/Applications/TextEdit.app' : 'notepad.exe',
        args: [],
      }
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
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [iconBusy, setIconBusy] = useState<'image' | 'video' | null>(null)
  const platform = useHostPlatform()
  const confirm = useConfirm()

  const makeAction = (type: Action['type']): Action => defaultAction(type, platform)

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
    const total = pageCapacity(profile, page)
    const activePageGrid = pageGrid(profile, page)
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
            <div className="section-heading">
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
            <div className="section-heading">
              <h3>Profile theme</h3>
            </div>
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
            <div className="section-heading">
              <h3>Grid &amp; sizing</h3>
            </div>
            <div className="preview-strip">
              <Icon name="grid" size={16} />
              <span>
                <strong className="mono">
                  {activePageGrid.columns} × {activePageGrid.rows}
                </strong>{' '}
                page grid · {usedSlots}/{total} slots · {page.grid ? 'custom' : 'inherited'}.
                Size and presets are in the sidebar’s 02 Deck section.
              </span>
            </div>
            <div className="two-col">
              <NumberField
                label="Page gap"
                value={activePageGrid.gap}
                min={0}
                max={60}
                suffix="px"
                onChange={(gap) =>
                  onChangeConfig(
                    resizePageGrid(config, profile.id, page.id, { ...activePageGrid, gap }),
                  )
                }
              />
              <NumberField
                label="Page padding"
                value={activePageGrid.padding}
                min={0}
                max={80}
                suffix="px"
                onChange={(padding) =>
                  onChangeConfig(
                    resizePageGrid(config, profile.id, page.id, { ...activePageGrid, padding }),
                  )
                }
              />
            </div>
            <p className="hint">Gap and padding are stored with this page; changing them creates a custom layout.</p>
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

  const addPreset = (pack: ActionPack, preset: ActionPreset, actions: Action[]): void => {
    const plainLabel = button.label.trim().toLowerCase()
    const untitled = plainLabel === '' || plainLabel === 'untitled' || plainLabel === 'untitled button' || plainLabel === 'new button'
    update({
      actions: [...button.actions, ...structuredClone(actions)],
      ...(untitled
        ? {
            label: preset.name,
            ...(preset.icon ? { icon: preset.icon } : {}),
          }
        : {}),
    })
    onToast(`${pack.name} · ${preset.name} added`, 'success')
  }

  const chooseIconMedia = async (kind: 'image' | 'video'): Promise<void> => {
    setIconBusy(kind)
    try {
      const result = await window.phonedek.importAsset(kind)
      if (result.ok && result.asset) {
        const previous = button.iconMedia
        const next: MediaIcon = {
          type: kind,
          asset: result.asset,
          fit: previous?.fit ?? 'cover',
          ...(kind === 'video'
            ? {
                loop: previous?.loop ?? true,
                muted: previous?.muted ?? true,
              }
            : {}),
        }
        update({ iconMedia: next })
      } else if (result.error) {
        onToast(result.error, 'error')
      }
    } finally {
      setIconBusy(null)
    }
  }

  const updateIconMedia = (patch: Partial<MediaIcon>): void => {
    if (!button.iconMedia) return
    update({ iconMedia: { ...button.iconMedia, ...patch } })
  }

  const removeIconMedia = (): void => {
    update({ iconMedia: undefined })
  }

  const deleteButton = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete button',
      message: `Delete the “${button.label || 'Untitled'}” button?`,
      warning: 'Its content and all of its actions are removed. This cannot be undone.',
      confirmLabel: 'Delete button',
      danger: true,
    })
    if (!confirmed) return
    onChangeConfig(removeButton(config, profile.id, page.id, button.id))
    onSelectButton(null)
  }

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div className="inspector-heading">
          <span className="button-avatar" style={buttonBackground(button, page, profile, server)}>
            {button.iconMedia ? (
              <DeckMedia media={button.iconMedia} server={server} fallback={button.icon || '＋'} />
            ) : (
              button.icon || '＋'
            )}
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
          <button type="button" className="icon-button bordered danger" onClick={() => void deleteButton()} aria-label="Delete button">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      <div className="inspector-scroll">
        <section className="inspector-section">
          <div className="section-heading">
            <h3>Content</h3>
          </div>
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
          <div className="field">
            <span>Icon</span>
            <div className="row gap">
              <input
                className="icon-input"
                value={button.icon ?? ''}
                maxLength={16}
                placeholder="＋"
                aria-label="Custom emoji icon"
                onChange={(event) => update({ icon: event.target.value || undefined })}
              />
              <span className="hint">Search below or paste any emoji.</span>
            </div>
            <IconPicker
              key={button.id}
              value={button.icon}
              onChange={(icon) => update(icon ? { icon } : { icon: undefined, iconMedia: undefined })}
            />
          </div>

          <div className="icon-media-block">
            <div className="section-title">
              <span>Media icon</span>
              {button.iconMedia && <span className="tag">media</span>}
            </div>

            {button.iconMedia ? (
              <>
                <div className="icon-media-current">
                  <div className="icon-media-preview">
                    <DeckMedia media={button.iconMedia} server={server} fallback={button.icon || '＋'} />
                  </div>
                  <div className="icon-media-meta">
                    <strong>{button.iconMedia.type === 'video' ? 'Video icon' : 'Image / GIF icon'}</strong>
                    <small className="mono">{button.iconMedia.asset}</small>
                  </div>
                </div>

                <div className="icon-media-actions">
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => void chooseIconMedia('image')}
                    disabled={iconBusy !== null}
                  >
                    <Icon name="image" size={14} />
                    {iconBusy === 'image' ? 'Importing…' : 'Replace image/GIF'}
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => void chooseIconMedia('video')}
                    disabled={iconBusy !== null}
                  >
                    <Icon name="video" size={14} />
                    {iconBusy === 'video' ? 'Importing…' : 'Replace video'}
                  </button>
                  <button type="button" className="button danger ghost small" onClick={removeIconMedia}>
                    Remove
                  </button>
                </div>

                <div className="icon-media-controls">
                  <label className="field icon-media-fit">
                    <span>Fit</span>
                    <select
                      value={button.iconMedia.fit}
                      onChange={(event) =>
                        updateIconMedia({ fit: event.target.value as 'cover' | 'contain' })
                      }
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </label>
                  {button.iconMedia.type === 'video' && (
                    <div className="icon-media-toggles">
                      <Toggle
                        label="Loop"
                        checked={button.iconMedia.loop !== false}
                        onChange={(loop) => updateIconMedia({ loop })}
                      />
                      <Toggle
                        label="Muted"
                        checked={button.iconMedia.muted !== false}
                        onChange={(muted) => updateIconMedia({ muted })}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="icon-media-actions">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void chooseIconMedia('image')}
                  disabled={iconBusy !== null}
                >
                  <Icon name="image" size={14} />
                  {iconBusy === 'image' ? 'Importing…' : 'Choose image/GIF'}
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void chooseIconMedia('video')}
                  disabled={iconBusy !== null}
                >
                  <Icon name="video" size={14} />
                  {iconBusy === 'video' ? 'Importing…' : 'Choose video'}
                </button>
              </div>
            )}

            <p className="hint">GIFs animate; MP4/H.264 is the most compatible video. The emoji stays as the fallback.</p>
          </div>
        </section>

        <section className="inspector-section">
          <div className="section-heading">
            <h3>Appearance</h3>
          </div>

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
          <div className="section-heading">
            <h3>
              Actions <span className="count">{button.actions.length}</span>
            </h3>
            <div className="row gap">
              <button
                type="button"
                className="button secondary small preset-launch"
                onClick={() => setPresetsOpen(true)}
                aria-label="Browse preset actions"
                title="Browse preset actions"
              >
                <Icon name="grid" size={15} />
                <span className="preset-launch-label">Presets</span>
              </button>
              <PopMenu
                align="right"
                trigger={
                  <button type="button" className="button secondary small">
                    <Icon name="plus" size={15} /> Add action
                  </button>
                }
                items={[
                  { label: 'Browse presets…', icon: 'grid', description: 'Ready-made shortcut packs', onClick: () => setPresetsOpen(true) },
                  { label: 'Shortcut', icon: 'keyboard', description: 'Send a key combination', onClick: () => update({ actions: [...button.actions, makeAction('hotkey')] }) },
                  { label: 'Type text', icon: 'text', description: 'Type a phrase on the PC', onClick: () => update({ actions: [...button.actions, makeAction('text')] }) },
                  { label: 'Macro', icon: 'bolt', description: 'A recorded sequence', onClick: () => update({ actions: [...button.actions, makeAction('macro')] }) },
                  { label: 'Launch app', icon: 'app', description: 'Start a program', onClick: () => update({ actions: [...button.actions, makeAction('launch')] }) },
                  { label: 'Open URL', icon: 'link', description: 'Open a web page', onClick: () => update({ actions: [...button.actions, makeAction('url')] }) },
                  { label: 'Run command', icon: 'terminal', description: 'Run a shell command', onClick: () => update({ actions: [...button.actions, makeAction('command')] }) },
                  { label: 'Media key', icon: 'music', description: 'Play, pause, volume…', onClick: () => update({ actions: [...button.actions, makeAction('media')] }) },
                  { label: 'Delay', icon: 'clock', description: 'Wait before the next action', onClick: () => update({ actions: [...button.actions, makeAction('delay')] }) },
                  { label: 'Change page', icon: 'layers', description: 'Navigate to another deck page', onClick: () => update({ actions: [...button.actions, makeAction('page')] }) },
                ]}
              />
            </div>
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
                  onTest={(candidate) => void testActions([candidate], describeAction(candidate, platform))}
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

      {presetsOpen && <PresetPicker onClose={() => setPresetsOpen(false)} onPick={addPreset} />}
    </aside>
  )
}
