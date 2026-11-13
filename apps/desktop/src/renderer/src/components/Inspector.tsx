import { useEffect, useState } from 'react'
import type {
  Action,
  ActionPack,
  ActionPreset,
  DeckButton,
  ExecutableAction,
  MicAction,
  PointerBinding,
  ShortcutBinding,
  SliderOrDialControlSpec,
  TrackpadControlSpec,
  DeckConfig,
  DeckPage,
  DeckProfile,
  MacroStep,
  MediaIcon,
  ObsAction,
  ObsStateBinding,
} from '@phonedek/shared'
import {
  buttonSpan,
  canPlaceButton,
  compactPage,
  describeAction,
  occupiedCells,
  pageCapacity,
  pageGrid,
  removeButton,
  resizePageGrid,
  shortcutDeltaPerStep,
  updateButton,
  updatePageMeta,
  updateProfileMeta,
  updateTheme,
} from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  obsInputAvailability,
  obsStateBadge,
  obsStateBindingSummary,
} from '../lib/obs'
import { useObsInputs } from '../lib/useObsInputs'
import { backgroundStyle, buttonBackground, textColorFor } from '../lib/ui'
import { ActionEditor } from './ActionEditor'
import { BackgroundEditor } from './BackgroundEditor'
import { ControlPreview } from './ControlPreview'
import { DeckMedia } from './DeckMedia'
import { Icon } from './Icons'
import { IconPicker } from './IconPicker'
import { PopMenu } from './Menu'
import { MoveToDialog } from './MoveToDialog'
import { ObsStatusEditor } from './ObsStatusEditor'
import { PresetPicker } from './PresetPicker'
import { ColorField, NumberField, Toggle, useConfirm } from './Primitives'
import { ShortcutDialog } from './ShortcutDialog'
import { useHostPlatform } from '../lib/platform'
import {
  destructiveShortcutWarning,
  formatKeysCompact,
  shortcutDirectionLabel,
} from '../lib/shortcut'

const DEFAULT_MACRO_STEP: MacroStep = { type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }

/** Mic actions are valid in configs but not yet part of the legacy Action union. */
const MIC_TOGGLE_ACTION: MicAction = { type: 'mic', action: 'toggleMute' }
const asLegacyAction = (action: ExecutableAction): Action => action as unknown as Action

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
    case 'obs':
      return { type: 'obs', action: 'toggleMute' }
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
  clipboardLabel,
  canPaste,
  onCopyButton,
  onCutButton,
  onPasteButton,
  onMoveButton,
}: {
  config: DeckConfig
  profile: DeckProfile
  page: DeckPage
  button: DeckButton | null
  server: ServerInfoView | null
  onChangeConfig: (config: DeckConfig) => void
  onSelectButton: (id: string | null) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
  clipboardLabel: string | null
  canPaste: boolean
  onCopyButton: () => void
  onCutButton: () => void
  onPasteButton: () => void
  onMoveButton: (profileId: string, pageId: string) => void
}) {
  const [customBackground, setCustomBackground] = useState(button?.background !== undefined)
  const [customText, setCustomText] = useState(button?.textColor !== undefined)
  const [pageCustomBackground, setPageCustomBackground] = useState(page.background !== undefined)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [iconBusy, setIconBusy] = useState<'image' | 'video' | null>(null)
  const [shortcutTarget, setShortcutTarget] = useState<'keys' | 'reverse' | 'hold' | null>(null)
  const platform = useHostPlatform()
  const confirm = useConfirm()
  const initialObsBinding =
    button?.control && button.control.kind !== 'trackpad' && button.control.binding.type === 'obs'
      ? button.control.binding
      : null
  const statusBinding = button?.state?.type === 'obs' ? button.state : null
  const obsInputsState = useObsInputs(
    initialObsBinding !== null ||
      statusBinding?.target === 'inputMute' ||
      statusBinding?.target === 'inputVolume',
  )

  const makeAction = (type: Action['type']): Action => defaultAction(type, platform)

  useEffect(() => {
    setCustomBackground(button?.background !== undefined)
    setCustomText(button?.textColor !== undefined)
  }, [button?.id, button?.background, button?.textColor])

  useEffect(() => {
    setPageCustomBackground(page.background !== undefined)
  }, [page.id, page.background])

  useEffect(() => {
    setMoveOpen(false)
  }, [button?.id])

  useEffect(() => {
    setShortcutTarget(null)
  }, [button?.id])

  const buttonDefaultBackground = profile.theme.buttonBackground
  const primaryKey = platform === 'darwin' ? '⌘' : 'Ctrl'

  const testActions = async (actions: readonly ExecutableAction[], label: string): Promise<void> => {
    if (!actions.length) {
      onToast('This button has no actions yet', 'info')
      return
    }
    // The preload API predates MicAction; the config schema and main process accept it.
    const result = await window.phonedek.testActions(actions as unknown as Action[], label)
    onToast(result.ok ? `Executed “${label}” on this PC` : (result.error ?? 'Action failed'), result.ok ? 'success' : 'error')
  }

  if (!button) {
    const activePageGrid = pageGrid(profile, page)
    const usedSlots = occupiedCells(page.buttons, activePageGrid).size
    const total = pageCapacity(profile, page)
    return (
      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <span className="eyebrow">Page & theme</span>
            <h2>{page.name}</h2>
          </div>
          <span className="inspector-badge">
            {usedSlots}/{total} cells
          </span>
        </div>

        <div className="inspector-scroll">
          <section className="inspector-section">
            <div className="section-heading">
              <h3>Component</h3>
              <span className="inspector-badge mono">PAGE</span>
            </div>
            <button
              type="button"
              className="button secondary full"
              onClick={onPasteButton}
              disabled={!canPaste}
            >
              <Icon name="clipboard" size={15} /> Paste component on this page
            </button>
            <p className="hint">
              {canPaste
                ? `Clipboard: “${clipboardLabel || 'Untitled'}”. It will use the first free cell on this page.`
                : 'Copy or cut a component on another page to paste it here.'}
            </p>
          </section>

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
                page grid · {usedSlots}/{total} cells · {page.grid ? 'custom' : 'inherited'}.
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

  const activeGrid = pageGrid(profile, page)

  const updateControl = (patch: Partial<SliderOrDialControlSpec>): void => {
    if (!button.control || button.control.kind === 'trackpad') return
    update({ control: { ...button.control, ...structuredClone(patch) } })
  }

  const updateTrackpad = (
    patch: Partial<Omit<TrackpadControlSpec, 'kind' | 'binding'>>,
  ): void => {
    if (!button.control || button.control.kind !== 'trackpad') return
    update({ control: { ...button.control, ...structuredClone(patch) } })
  }

  const updatePointerBinding = (patch: Partial<PointerBinding>): void => {
    if (!button.control || button.control.kind !== 'trackpad') return
    update({
      control: {
        ...button.control,
        binding: { ...button.control.binding, ...structuredClone(patch) },
      },
    })
  }

  const setControlBinding = (type: 'volume' | 'scroll' | 'mic' | 'obs' | 'shortcut'): void => {
    if (!button.control || button.control.kind === 'trackpad') return
    if (button.control.binding.type === type) return
    if (type === 'shortcut') {
      updateControl({
        emit: 'delta',
        binding: {
          type: 'shortcut',
          keys: ['CTRL', 'TAB'],
          reverseKeys: ['CTRL', 'SHIFT', 'TAB'],
          ...(button.control.kind === 'slider' ? { travelSteps: 20 } : {}),
        },
      })
      return
    }
    if (type === 'scroll') {
      updateControl({ emit: 'delta', binding: { type: 'scroll', axis: 'vertical' } })
      return
    }
    if (type === 'mic') {
      updateControl({
        emit: 'value',
        binding: { type: 'mic', mode: 'gain' },
        min: 0,
        max: 100,
        step: 1,
        initial: 50,
        unit: '%',
      })
      return
    }
    if (type === 'obs') {
      updateControl({
        emit: 'value',
        binding: { type: 'obs', target: 'inputVolume' },
        min: 0,
        max: 200,
        step: 1,
        initial: 100,
        unit: '%',
      })
      return
    }
    updateControl(
      platform === 'darwin'
        ? {
            emit: 'value',
            binding: { type: 'volume', mode: 'absolute' },
            min: 0,
            max: 100,
            step: 1,
            initial: 50,
            unit: '%',
          }
        : {
            emit: 'delta',
            binding: { type: 'volume', mode: 'relative', stepPercent: 2 },
            min: 0,
            max: 100,
            step: 2,
            initial: 50,
            unit: '%',
          },
    )
  }

  const setVolumeMode = (mode: 'relative' | 'absolute'): void => {
    if (!button.control || button.control.kind === 'trackpad') return
    const binding = button.control.binding
    if (binding.type !== 'volume' || binding.mode === mode) return
    if (mode === 'absolute') {
      updateControl({
        emit: 'value',
        binding: { type: 'volume', mode: 'absolute' },
        min: 0,
        max: 100,
        step: 1,
        initial: 50,
        unit: '%',
      })
    } else {
      updateControl({
        emit: 'delta',
        binding: { type: 'volume', mode: 'relative', stepPercent: 2 },
        min: 0,
        max: 100,
        step: 2,
        initial: 50,
        unit: '%',
      })
    }
  }

  const updateVolumeBinding = (patch: { stepPercent?: number }): void => {
    if (!button.control || button.control.kind === 'trackpad') return
    const binding = button.control.binding
    if (binding.type !== 'volume' || binding.mode !== 'relative') return
    updateControl({ binding: { ...binding, ...patch } })
  }

  const updateScrollBinding = (patch: { axis?: 'vertical' | 'horizontal'; invert?: boolean }): void => {
    if (!button.control || button.control.kind === 'trackpad') return
    if (button.control.binding.type !== 'scroll') return
    updateControl({ binding: { ...button.control.binding, ...patch } })
  }

  const setControlMin = (value: number): void => {
    const min = Math.max(0, Math.min(Math.round(value), controlMax - 1))
    updateControl({ min, initial: Math.min(Math.max(controlInitial, min), controlMax) })
  }

  const setControlMax = (value: number): void => {
    const ceiling = control?.binding.type === 'obs' ? 2000 : 1000
    const max = Math.max(controlMin + 1, Math.min(Math.round(value), ceiling))
    updateControl({ max, initial: Math.min(Math.max(controlInitial, controlMin), max) })
  }

  const updateSpan = (columns: number, rows: number): void => {
    const next = {
      columns: Math.max(1, Math.min(activeGrid.columns, Math.round(columns))),
      rows: Math.max(1, Math.min(activeGrid.rows, Math.round(rows))),
    }
    if (!canPlaceButton(page.buttons, button.slot, next, activeGrid, button.id)) {
      onToast(`A ${next.columns}×${next.rows} footprint does not fit here. Free the surrounding cells first.`, 'error')
      return
    }
    update({ span: next })
  }

  const removeControl = async (): Promise<void> => {
    if (!button.control) return
    const span = buttonSpan(button)
    const confirmed = await confirm({
      title: 'Remove control',
      message: `Remove the ${button.label || 'control'} and turn it back into a normal button?`,
      warning: `The ${span.columns}×${span.rows} footprint and control settings are removed. This cannot be undone.`,
      confirmLabel: 'Remove control',
      danger: true,
    })
    if (confirmed) update({ control: undefined, span: undefined })
  }

  // Trackpad editing has its own section in a later phase; the slider/dial
  // inspector below must not treat a pointer binding as a value control.
  const control =
    button.control && button.control.kind !== 'trackpad' ? button.control : undefined
  const trackpad = button.control?.kind === 'trackpad' ? button.control : undefined
  const obsControlBinding = control?.binding.type === 'obs' ? control.binding : null
  const obsSelectedInput = obsControlBinding?.input?.trim() ?? ''
  const obsAvailability = obsInputAvailability({
    status: server?.obsStatus ?? null,
    selected: obsSelectedInput,
    inputs: obsInputsState.inputs,
    loaded: obsInputsState.loaded,
  })
  const obsSelectedIsMissing =
    obsSelectedInput.length > 0 &&
    obsInputsState.loaded &&
    !obsInputsState.inputs.some((input) => input.name === obsSelectedInput)
  const controlMin = control?.min ?? 0
  const controlMax = control?.max ?? 100
  const controlStep = Math.max(1, control?.step ?? 1)
  const controlInitial = Math.min(
    Math.max(control?.initial ?? Math.round((controlMin + controlMax) / 2), controlMin),
    controlMax,
  )
  const controlSpan = buttonSpan(button)
  const controlIsAbsolute = control?.binding.type === 'volume' && control.binding.mode === 'absolute'
  const shortcut = control?.binding.type === 'shortcut' ? control.binding : null
  const shortcutWarning = shortcut
    ? (destructiveShortcutWarning(shortcut.keys, shortcut.holdKeys, platform) ??
      (shortcut.reverseKeys
        ? destructiveShortcutWarning(shortcut.reverseKeys, shortcut.holdKeys, platform)
        : null))
    : null

  const updateShortcut = (patch: Partial<ShortcutBinding>): void => {
    if (!control || control.binding.type !== 'shortcut') return
    updateControl({
      binding: { ...control.binding, ...structuredClone(patch) },
    })
  }

  const testControl = async (direction: -1 | 1): Promise<void> => {
    if (!control) return
    if (control.binding.type === 'shortcut') {
      const delta = direction * shortcutDeltaPerStep(control)
      const result = await window.phonedek.testControlInput(profile.id, page.id, button.id, delta)
      const chord =
        direction > 0
          ? control.binding.keys
          : (control.binding.reverseKeys ?? control.binding.keys)
      onToast(
        result.ok
          ? `Sent ${formatKeysCompact(chord, platform)} on this PC${control.binding.holdKeys?.length ? ' (hold keys apply on the phone)' : ''}`
          : (result.error ?? 'Control test failed'),
        result.ok ? 'success' : 'error',
      )
      return
    }
    if (control.binding.type === 'mic') {
      await testActions([MIC_TOGGLE_ACTION], 'Toggle mic mute')
      return
    }
    if (controlIsAbsolute) {
      const percent = direction < 0 ? 45 : 55
      type ControlTestResult = Awaited<ReturnType<typeof window.phonedek.testControlInput>>
      const api = window.phonedek as unknown as {
        testControlInput: (
          profileId: string,
          pageId: string,
          buttonId: string,
          delta: number,
          value?: number,
        ) => Promise<ControlTestResult>
        testControlValue?: (
          profileId: string,
          pageId: string,
          buttonId: string,
          value: number,
        ) => Promise<ControlTestResult>
      }
      let result: ControlTestResult | null = null
      if (api.testControlValue) {
        result = await api.testControlValue(profile.id, page.id, button.id, percent / 100)
      } else if (api.testControlInput.length >= 5) {
        result = await api.testControlInput(profile.id, page.id, button.id, 0, percent / 100)
      }
      if (!result) {
        onToast(
          'Absolute volume testing needs the updated desktop API. The control still works from the phone.',
          'info',
        )
        return
      }
      onToast(
        result.ok ? `Set PC volume to ${percent}%` : (result.error ?? 'Control test failed'),
        result.ok ? 'success' : 'error',
      )
      return
    }

    const result = await window.phonedek.testControlInput(profile.id, page.id, button.id, direction)
    onToast(
      result.ok
        ? `Sent one ${control.binding.type === 'volume' ? 'volume' : 'scroll'} step ${direction < 0 ? 'down' : 'up'}`
        : (result.error ?? 'Control test failed'),
      result.ok ? 'success' : 'error',
    )
  }

  const updateObsInput = (input: string | undefined): void => {
    if (!control || !obsControlBinding) return
    const previous = obsControlBinding.input
    const next = input?.trim() || undefined
    update({
      control: {
        ...control,
        binding: {
          type: 'obs',
          target: 'inputVolume',
          ...(next ? { input: next } : {}),
        },
      },
      actions: button.actions.map((action): Action =>
        action.type === 'obs' &&
        action.action === 'toggleMute' &&
        (action.input === previous || action.input === undefined)
          ? { type: 'obs', action: 'toggleMute', ...(next ? { input: next } : {}) }
          : action,
      ),
    })
  }

  const testObsVolume = async (percent: number): Promise<void> => {
    const result = await window.phonedek.testObsInputVolume(obsSelectedInput || undefined, percent)
    onToast(
      result.ok
        ? `Set OBS “${obsSelectedInput || 'default input'}” to ${percent}%`
        : (result.error ?? 'OBS volume test failed'),
      result.ok ? 'success' : 'error',
    )
  }

  const testObsMute = async (): Promise<void> => {
    const result = await window.phonedek.testObsMute(obsSelectedInput || undefined)
    onToast(
      result.ok ? `Toggled mute on OBS “${obsSelectedInput || 'default input'}”` : (result.error ?? 'OBS mute test failed'),
      result.ok ? 'success' : 'error',
    )
  }

  const updateAction = (index: number, action: ExecutableAction): void => {
    update({
      actions: button.actions.map((item, current) => (current === index ? asLegacyAction(action) : item)),
    })
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

  const addObsAction = (action: ObsAction, label: string, icon: string): void => {
    const current = button.label.trim().toLowerCase()
    const untitled =
      current === '' || current === 'untitled' || current === 'untitled button' || current === 'new button'
    update({
      actions: [...button.actions, action],
      ...(untitled ? { label, icon } : {}),
    })
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
            <h3>Component</h3>
            <span className="inspector-badge mono">{button.control ? 'CONTROL' : 'BUTTON'}</span>
          </div>
          <div className="component-actions">
            <button type="button" className="button secondary small" onClick={onCopyButton}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button type="button" className="button secondary small" onClick={onCutButton}>
              <Icon name="cut" size={14} /> Cut
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={onPasteButton}
              disabled={!canPaste}
              title={canPaste ? `Paste “${clipboardLabel || 'Untitled'}” on this page` : 'Copy a component first'}
            >
              <Icon name="clipboard" size={14} /> Paste
            </button>
            <button type="button" className="button secondary small" onClick={() => setMoveOpen(true)}>
              <Icon name="layers" size={14} /> Move to…
            </button>
          </div>
          {button.state?.type === 'obs' && (
            <div className="obs-state-summary">
              <span className="obs-state-pill">{obsStateBadge(button.state.target)}</span>
              <span>{obsStateBindingSummary(button.state)}</span>
            </div>
          )}
          <p className="hint">
            {primaryKey}+C copy · {primaryKey}+X cut · {primaryKey}+V paste on the active page.
            {clipboardLabel ? ` Clipboard: “${clipboardLabel}”.` : ' Clipboard empty.'}
          </p>
        </section>

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

        {!button.control && (
          <section className="inspector-section">
            <div className="section-heading">
              <h3>Status</h3>
              <span className="inspector-badge mono">
                {statusBinding ? obsStateBadge(statusBinding.target) : 'OFF'}
              </span>
            </div>
            <p className="hint">
              Add a live OBS readout to this button without replacing its tap actions. Status uses
              the desktop&apos;s OBS connection and control-state-v1.
            </p>
            <div className="section-title">
              <span>Show OBS status</span>
              <Toggle
                label=""
                checked={statusBinding !== null}
                onChange={(enabled) =>
                  update({
                    state: enabled ? { type: 'obs', target: 'streaming' } : undefined,
                  })
                }
              />
            </div>
            {statusBinding && (
              <>
                <ObsStatusEditor
                  key={button.id}
                  binding={statusBinding}
                  server={server}
                  onUpdate={(state: ObsStateBinding) => update({ state })}
                />
                <button
                  type="button"
                  className="button danger ghost full"
                  onClick={() => update({ state: undefined })}
                >
                  <Icon name="trash" size={15} /> Remove status
                </button>
              </>
            )}
          </section>
        )}

        {trackpad && (
          <section className="inspector-section">
            <div className="section-heading">
              <h3>Trackpad</h3>
              <span className="inspector-badge mono">PAD · POINTER</span>
            </div>

            <div className="control-preview-shell">
              <ControlPreview
                control={trackpad}
                label={button.label}
                sublabel={button.sublabel}
                className="inspector-control-preview"
              />
            </div>

            <label className="field">
              <span>Mode</span>
              <select
                value={trackpad.binding.mode ?? 'inline'}
                onChange={(event) =>
                  updatePointerBinding({
                    mode: event.target.value as 'inline' | 'fullscreen',
                  })
                }
              >
                <option value="inline">Inline on the deck tile</option>
                <option value="fullscreen">Full-screen pad</option>
              </select>
            </label>
            <p className="hint">
              {(trackpad.binding.mode ?? 'inline') === 'inline'
                ? 'The tile is the pad: drag it alongside the other buttons.'
                : 'The tile is a launcher for the large full-screen pad.'}
            </p>

            <NumberField
              label="Sensitivity"
              value={trackpad.binding.sensitivity ?? 1}
              min={0.25}
              max={3}
              step={0.05}
              format={(value) => `${value.toFixed(2)}×`}
              onChange={(sensitivity) =>
                updatePointerBinding({ sensitivity: Math.round(sensitivity * 100) / 100 })
              }
            />

            <Toggle
              label="Natural scroll"
              description="Two-finger scroll follows your fingers."
              checked={trackpad.binding.naturalScroll !== false}
              onChange={(naturalScroll) => updatePointerBinding({ naturalScroll })}
            />
            <Toggle
              label="Tap to click"
              description="A short tap clicks the left button."
              checked={trackpad.binding.tapToClick !== false}
              onChange={(tapToClick) => updatePointerBinding({ tapToClick })}
            />
            <Toggle
              label="Drag lock"
              description="Long-press holds the left button until the next tap."
              checked={trackpad.binding.dragLock !== false}
              onChange={(dragLock) => updatePointerBinding({ dragLock })}
            />
            <Toggle
              label="Haptics"
              description="Tick on taps and drag-lock."
              checked={trackpad.haptics !== false}
              onChange={(haptics) => updateTrackpad({ haptics })}
            />

            <div className="two-col">
              <NumberField
                label="Span columns"
                value={controlSpan.columns}
                min={1}
                max={activeGrid.columns}
                onChange={(columns) => updateSpan(columns, controlSpan.rows)}
              />
              <NumberField
                label="Span rows"
                value={controlSpan.rows}
                min={1}
                max={activeGrid.rows}
                onChange={(rows) => updateSpan(controlSpan.columns, rows)}
              />
            </div>

            <p className="hint">
              Pointer output cannot be previewed from the editor; open the pad on a paired phone to test it.
            </p>

            <button type="button" className="button danger ghost full" onClick={() => void removeControl()}>
              <Icon name="trash" size={15} /> Remove control
            </button>
          </section>
        )}

        {control && (
          <section className="inspector-section">
            <div className="section-heading">
              <h3>Control</h3>
              <span className="inspector-badge mono">
                {control.kind === 'slider' ? 'SLIDER' : 'DIAL'} ·{' '}
                {control.binding.type === 'volume'
                  ? `VOL · ${control.binding.mode === 'absolute' ? 'ABS' : 'REL'}`
                  : control.binding.type === 'mic'
                    ? 'MIC · GAIN'
                    : control.binding.type === 'obs'
                      ? 'OBS · VOL'
                      : control.binding.type === 'shortcut'
                        ? 'SHORTCUT'
                        : 'SCROLL'}
              </span>
            </div>

            <div className="control-preview-shell">
              <ControlPreview
                control={control}
                label={button.label}
                sublabel={button.sublabel}
                className="inspector-control-preview"
              />
            </div>

            <div className="row gap">
              {control.binding.type === 'shortcut' ? (
                <>
                  <button
                    type="button"
                    className="button secondary small"
                    title={`Send ${formatKeysCompact(control.binding.reverseKeys ?? control.binding.keys, platform)}`}
                    onClick={() => void testControl(-1)}
                  >
                    Test −
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    title={`Send ${formatKeysCompact(control.binding.keys, platform)}`}
                    onClick={() => void testControl(1)}
                  >
                    Test +
                  </button>
                  <span className="hint">
                    Sends the reverse / forward chord on this PC
                    {control.binding.holdKeys?.length ? ' · hold keys apply on the phone' : ''}
                  </span>
                </>
              ) : control.binding.type === 'mic' ? (
                <>
                  <button
                    type="button"
                    className="button secondary small"
                    title="Toggle the default capture device on this PC"
                    onClick={() => void testControl(1)}
                  >
                    Test mute
                  </button>
                  <span className="hint">Toggles the default capture device on this PC</span>
                </>
              ) : control.binding.type === 'obs' ? (
                <>
                  <button
                    type="button"
                    className="button secondary small"
                    title="Set this OBS input to 45%"
                    onClick={() => void testObsVolume(45)}
                  >
                    Test −
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    title="Set this OBS input to 55%"
                    onClick={() => void testObsVolume(55)}
                  >
                    Test +
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    title="Toggle mute on this OBS input"
                    onClick={() => void testObsMute()}
                  >
                    Test mute
                  </button>
                  <span className="hint">Talks to OBS directly · sets 45% / 55%</span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="button secondary small"
                    title={controlIsAbsolute ? 'Set the PC volume to 45%' : 'Send one step down'}
                    onClick={() => void testControl(-1)}
                  >
                    Test −
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    title={controlIsAbsolute ? 'Set the PC volume to 55%' : 'Send one step up'}
                    onClick={() => void testControl(1)}
                  >
                    Test +
                  </button>
                  <span className="hint">
                    {controlIsAbsolute ? 'Sets 45% / 55% on this PC' : 'Applies one step on this PC'}
                  </span>
                </>
              )}
            </div>

            <div className="two-col">
              <label className="field">
                <span>Kind</span>
                <select
                  value={control.kind}
                  onChange={(event) =>
                    updateControl({ kind: event.target.value as 'slider' | 'dial' })
                  }
                >
                  <option value="slider">Slider</option>
                  <option value="dial">Dial / wheel</option>
                </select>
              </label>
              <label className="field">
                <span>Binding</span>
                <select
                  value={control.binding.type}
                  onChange={(event) =>
                    setControlBinding(
                      event.target.value as 'volume' | 'scroll' | 'mic' | 'obs' | 'shortcut',
                    )
                  }
                >
                  <option value="volume">Volume</option>
                  <option value="mic">Mic</option>
                  <option value="obs">OBS input volume</option>
                  <option value="scroll">Scroll</option>
                  <option value="shortcut">Shortcut chord</option>
                </select>
              </label>
            </div>

            {shortcut && (
              <div className="shortcut-editor">
                <div className="shortcut-summary">
                  <span className="shortcut-summary-label">Primary</span>
                  <span className="shortcut-chord mono">{formatKeysCompact(shortcut.keys, platform)}</span>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => setShortcutTarget('keys')}
                  >
                    Change
                  </button>
                </div>

                <div className="shortcut-summary">
                  <span className="shortcut-summary-label">Reverse</span>
                  <span className={`shortcut-chord mono${shortcut.reverseKeys ? '' : ' muted'}`}>
                    {shortcut.reverseKeys
                      ? formatKeysCompact(shortcut.reverseKeys, platform)
                      : 'Same as primary'}
                  </span>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => setShortcutTarget('reverse')}
                  >
                    {shortcut.reverseKeys ? 'Change' : 'Set'}
                  </button>
                  {shortcut.reverseKeys && (
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => updateShortcut({ reverseKeys: undefined })}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="shortcut-summary">
                  <span className="shortcut-summary-label">Hold</span>
                  <span className={`shortcut-chord mono${shortcut.holdKeys?.length ? '' : ' muted'}`}>
                    {shortcut.holdKeys?.length
                      ? formatKeysCompact(shortcut.holdKeys, platform)
                      : 'None'}
                  </span>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => setShortcutTarget('hold')}
                  >
                    {shortcut.holdKeys?.length ? 'Change' : 'Set'}
                  </button>
                  {shortcut.holdKeys?.length ? (
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => updateShortcut({ holdKeys: undefined })}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="two-col">
                  <NumberField
                    label="Repeat"
                    value={shortcut.repeat ?? 1}
                    min={1}
                    max={5}
                    onChange={(repeat) => updateShortcut({ repeat })}
                  />
                  {control.kind === 'slider' && (
                    <NumberField
                      label="Travel steps"
                      value={shortcut.travelSteps ?? 20}
                      min={4}
                      max={100}
                      onChange={(travelSteps) => updateShortcut({ travelSteps })}
                    />
                  )}
                </div>

                <p className="hint">
                  One chord per dial detent
                  {control.kind === 'slider'
                    ? ` or per ${shortcut.travelSteps ?? 20} slices across the slider`
                    : ''}
                  . Positive movement sends the primary chord; negative sends the reverse.
                </p>
                <p className="hint mono shortcut-direction">
                  {shortcutDirectionLabel(shortcut, platform)}
                </p>
                {shortcutWarning && (
                  <p className="hint error-text">
                    Warning: this sends {shortcutWarning}, which can lock, sign out of, or close
                    apps on this PC.
                  </p>
                )}
              </div>
            )}

            {control.binding.type === 'mic' && (
              <p className="hint">Default capture device · tap the tile label to mute</p>
            )}

            {control.binding.type === 'volume' && (
              <>
                <label className="field">
                  <span>Mode</span>
                  <select
                    value={control.binding.mode}
                    onChange={(event) =>
                      setVolumeMode(event.target.value as 'relative' | 'absolute')
                    }
                  >
                    <option value="relative">Relative (volume keys)</option>
                    <option value="absolute">Absolute (set %)</option>
                  </select>
                </label>
                <p className="hint">
                  Absolute sets the PC volume directly; relative sends volume-key steps.
                </p>
              </>
            )}

            {control.binding.type === 'obs' && (
              <>
                <label className="field">
                  <span>OBS input</span>
                  <select
                    value={obsSelectedInput}
                    disabled={obsInputsState.loading && !obsInputsState.loaded}
                    onChange={(event) => updateObsInput(event.target.value || undefined)}
                  >
                    <option value="">Default — first audio input</option>
                    {obsSelectedIsMissing && (
                      <option value={obsSelectedInput}>{obsSelectedInput} (missing — pick again)</option>
                    )}
                    {obsInputsState.inputs.map((input) => (
                      <option key={input.name} value={input.name}>
                        {input.name}
                        {input.kind ? ` · ${input.kind}` : ''}
                        {input.audio ? ' · audio' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="row between">
                  <span className={`obs-availability ${obsAvailability.tone}`}>
                    <strong>{obsAvailability.label}</strong>
                    <small>{obsAvailability.detail}</small>
                  </span>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() => void obsInputsState.refresh()}
                    disabled={obsInputsState.loading}
                  >
                    <Icon name="refresh" size={14} />
                    {obsInputsState.loading ? 'Refreshing…' : 'Refresh inputs'}
                  </button>
                </div>
                {obsInputsState.error && obsAvailability.label !== 'NO OBS' && (
                  <p className="hint error-text">{obsInputsState.error}</p>
                )}
                <p className="hint">
                  100% = 0 dB · 200% = +6 dB. Input names belong to the current OBS scene collection;
                  renaming one in OBS may require picking it again.
                </p>
              </>
            )}

            {control.kind === 'slider' && control.binding.type !== 'shortcut' && (
              <label className="field">
                <span>Slider axis</span>
                <select
                  value={control.axis ?? 'horizontal'}
                  onChange={(event) => updateControl({ axis: event.target.value as 'horizontal' | 'vertical' })}
                >
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                </select>
              </label>
            )}

            {control.binding.type === 'volume' && control.binding.mode === 'relative' && (
              <NumberField
                label="Volume step"
                value={control.binding.stepPercent ?? 2}
                min={1}
                max={25}
                suffix="%"
                onChange={(stepPercent) => updateVolumeBinding({ stepPercent })}
              />
            )}

            {control.binding.type === 'scroll' && (
              <div className="two-col">
                <label className="field">
                  <span>Scroll axis</span>
                  <select
                    value={control.binding.axis}
                    onChange={(event) =>
                      updateScrollBinding({ axis: event.target.value as 'vertical' | 'horizontal' })
                    }
                  >
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </label>
                <Toggle
                  label="Invert"
                  description="Reverse wheel direction"
                  checked={control.binding.invert === true}
                  onChange={(invert) => updateScrollBinding({ invert })}
                />
              </div>
            )}

            {control.binding.type !== 'shortcut' && (
              <div className="control-range">
                <div className="two-col">
                <NumberField
                  label="Min"
                  value={controlMin}
                  min={0}
                  max={1000}
                  disabled={control.binding.type === 'obs'}
                  onChange={setControlMin}
                />
                <NumberField
                  label="Max"
                  value={controlMax}
                  min={1}
                  max={control.binding.type === 'obs' ? 2000 : 1000}
                  onChange={setControlMax}
                />
              </div>
              <div className="two-col">
                <NumberField
                  label="Display step"
                  value={controlStep}
                  min={1}
                  max={100}
                  onChange={(step) => updateControl({ step: Math.max(1, step) })}
                />
                <NumberField
                  label="Initial"
                  value={controlInitial}
                  min={controlMin}
                  max={controlMax}
                  onChange={(initial) => updateControl({ initial })}
                />
              </div>
              <label className="field">
                <span>Unit</span>
                <input
                  value={control.unit ?? ''}
                  maxLength={8}
                  placeholder="%"
                  onChange={(event) => updateControl({ unit: event.target.value || undefined })}
                />
              </label>
            </div>
            )}

            <Toggle
              label="Haptics"
              description="Vibrate the phone as the value changes."
              checked={control.haptics !== false}
              onChange={(haptics) => updateControl({ haptics })}
            />

            <div className="two-col">
              <NumberField
                label="Span columns"
                value={controlSpan.columns}
                min={1}
                max={activeGrid.columns}
                onChange={(columns) => updateSpan(columns, controlSpan.rows)}
              />
              <NumberField
                label="Span rows"
                value={controlSpan.rows}
                min={1}
                max={activeGrid.rows}
                onChange={(rows) => updateSpan(controlSpan.columns, rows)}
              />
            </div>

            <p className="hint">
              {control.binding.type === 'shortcut'
                ? 'Editor preview only. Drag on the phone to send one chord per step; Test − / Test + send a chord on this PC. Hold keys live only for the phone gesture.'
                : control.binding.type === 'mic'
                  ? 'Editor preview only. Drag on the phone to set mic gain; tap the label or mic glyph to mute. The mic action below stays as the fallback.'
                  : control.binding.type === 'obs'
                    ? 'Editor preview only. Drag on the phone to set the OBS input level; Test −, Test + and Test mute talk to OBS directly. Input names are scene-collection scoped.'
                    : control.binding.type === 'volume' && control.binding.mode === 'absolute'
                      ? 'Editor preview only. The phone sends an absolute value; tap actions stay as the fallback.'
                      : 'Editor preview only. The phone renders this control and sends relative deltas; tap actions stay as the fallback.'}
            </p>

            <button type="button" className="button danger ghost full" onClick={() => void removeControl()}>
              <Icon name="trash" size={15} /> Remove control
            </button>
          </section>
        )}

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
                  { label: 'OBS scene switcher', section: 'Integrations', icon: 'layers', description: 'Switch the program scene by name', onClick: () => addObsAction({ type: 'obs', action: 'setScene' }, 'Scene', '🎬') },
                  { label: 'OBS toggle stream', icon: 'wifi', description: 'Start or stop streaming', onClick: () => addObsAction({ type: 'obs', action: 'toggleStream' }, 'Stream', '📡') },
                  { label: 'OBS toggle recording', icon: 'record', description: 'Start or stop recording', onClick: () => addObsAction({ type: 'obs', action: 'toggleRecord' }, 'Record', '⏺️') },
                  { label: 'OBS start recording', icon: 'record', description: 'Start recording only', onClick: () => addObsAction({ type: 'obs', action: 'startRecord' }, 'Record', '⏺️') },
                  { label: 'OBS stop recording', icon: 'stop', description: 'Stop recording only', onClick: () => addObsAction({ type: 'obs', action: 'stopRecord' }, 'Record', '⏺️') },
                  { label: 'OBS save replay', icon: 'refresh', description: 'Flush the replay buffer', onClick: () => addObsAction({ type: 'obs', action: 'saveReplay' }, 'Replay', '🔁') },
                  { label: 'OBS toggle virtual cam', icon: 'video', description: 'Start or stop the virtual camera', onClick: () => addObsAction({ type: 'obs', action: 'toggleVirtualCam' }, 'VCam', '🎥') },
                  { label: 'OBS source visibility', icon: 'image', description: 'Show or hide a source', onClick: () => addObsAction({ type: 'obs', action: 'toggleSourceVisibility', source: 'Camera' }, 'Source', '👁️') },
                  { label: 'OBS add marker', icon: 'clock', description: 'Drop a chapter marker', onClick: () => addObsAction({ type: 'obs', action: 'addMarker' }, 'Marker', '🔖') },
                  { label: 'OBS mute', icon: 'microphone', description: 'Toggle mute on an OBS input', onClick: () => addObsAction({ type: 'obs', action: 'toggleMute' }, 'Mic', '🎙️') },
                  { label: 'Delay', icon: 'clock', description: 'Wait before the next action', onClick: () => update({ actions: [...button.actions, makeAction('delay')] }) },
                  { label: 'Change page', icon: 'layers', description: 'Navigate to another deck page', onClick: () => update({ actions: [...button.actions, makeAction('page')] }) },
                ]}
              />
            </div>
          </div>

          {button.actions.length === 0 ? (
            <div className="empty-state small">
              <Icon name="bolt" size={22} />
              <p>
                {button.control
                  ? button.control.kind === 'trackpad'
                    ? 'No tap action needed. Tapping this tile on the phone opens the full-screen pointer pad.'
                    : button.control.binding.type === 'mic'
                      ? 'No tap action needed. Drag this control on the phone to set mic gain; use Test mute above to verify the mic on this PC.'
                      : button.control.binding.type === 'obs'
                        ? 'No tap action needed. Drag this control on the phone to set the OBS input level; add an OBS mute action if you want a tap action.'
                        : button.control.binding.type === 'shortcut'
                          ? 'No tap action needed. Turn or drag this control on the phone to send chords; use Test − / Test + above to verify them on this PC.'
                          : 'No tap action needed. Drag this control on the phone to send volume or scroll steps; use Test − / Test + above to verify it on this PC.'
                  : 'No actions yet. This button will do nothing when pressed.'}
              </p>
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
      {shortcut && shortcutTarget && (
        <ShortcutDialog
          initial={
            shortcutTarget === 'keys'
              ? shortcut.keys
              : shortcutTarget === 'reverse'
                ? (shortcut.reverseKeys ?? [])
                : (shortcut.holdKeys ?? [])
          }
          title={
            shortcutTarget === 'keys'
              ? 'Edit primary chord'
              : shortcutTarget === 'reverse'
                ? 'Edit reverse chord'
                : 'Edit hold keys'
          }
          subtitle={
            shortcutTarget === 'keys'
              ? 'Sent when the phone control moves forward.'
              : shortcutTarget === 'reverse'
                ? 'Sent when the phone control moves backward. Leave unset to send the primary chord both ways.'
                : 'Held down for the whole phone gesture. Modifiers only.'
          }
          modifiersOnly={shortcutTarget === 'hold'}
          onSave={(keys) => {
            if (shortcutTarget === 'keys') updateShortcut({ keys })
            else if (shortcutTarget === 'reverse') updateShortcut({ reverseKeys: keys })
            else updateShortcut({ holdKeys: keys })
            setShortcutTarget(null)
          }}
          onClose={() => setShortcutTarget(null)}
        />
      )}
      {moveOpen && (
        <MoveToDialog
          config={config}
          sourceProfileId={profile.id}
          sourcePageId={page.id}
          buttonLabel={button.label}
          onMove={(targetProfileId, targetPageId) => {
            setMoveOpen(false)
            onMoveButton(targetProfileId, targetPageId)
          }}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </aside>
  )
}
