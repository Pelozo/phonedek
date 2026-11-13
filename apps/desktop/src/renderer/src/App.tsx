import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addButton,
  buttonSpan,
  canPlaceButton,
  createEmptyButton,
  nextFreeSlotForPage,
  normalizeHostPlatform,
  occupiedCells,
  pageCapacity,
  pageGrid,
} from '@phonedek/shared'
import type { Action, ControlSpec, DeckButton, DeckConfig, LightTarget, MicAction, ObsAction } from '@phonedek/shared'
import type { AppState, ObsInputView, ServerInfoView, UpdateStatus, PermissionStatus } from '../../shared/api'
import { isUpdateNoticeVisible, updateIndicatorLabel } from '../../shared/update-status'
import { DeckCanvas } from './components/DeckCanvas'
import { DeckMark, Icon } from './components/Icons'
import { Inspector } from './components/Inspector'
import { LightPickerDialog } from './components/LightPickerDialog'
import { PopMenu } from './components/Menu'
import { ObsInputDialog } from './components/ObsInputDialog'
import { PairDialog } from './components/PairDialog'
import { PermissionBanner } from './components/PermissionBanner'
import { ConfirmProvider } from './components/Primitives'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { cutButtonFromPage, moveButtonToPage, pasteButtonIntoPage } from './lib/clipboard'
import { createKeyboardLauncher, keyboardSpanCandidates } from './lib/keyboard'
import { LIGHT_STATUS_TILES, createLightStatusButton, type LightStatusTilePreset } from './lib/lightStatus'
import { lightControlSpec } from './lib/lights'
import { OBS_STATUS_TILES, createObsStatusButton, type ObsStatusTilePreset } from './lib/obsStatus'
import {
  TWITCH_STATUS_TILES,
  createTwitchStatusButton,
  type TwitchStatusTilePreset,
} from './lib/twitchStatus'
import { HostPlatformProvider } from './lib/platform'
import {
  SHORTCUT_PRESETS,
  shortcutPreset,
  shortcutPresetControl,
  type ShortcutPresetId,
} from './lib/shortcut'

type ToastKind = 'info' | 'success' | 'error'
interface ToastState {
  message: string
  kind: ToastKind
}

type SaveStatus = 'saved' | 'saving' | 'error'

type LightPickerRequest =
  | { kind: 'control'; target: LightTarget }
  | { kind: 'status'; preset: LightStatusTilePreset }

/** Clipboard shortcuts must never steal native text editing. */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return Boolean(element.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]'))
}

function AppContent() {
  const [config, setConfig] = useState<DeckConfig | null>(null)
  const [server, setServer] = useState<ServerInfoView | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedPageId, setSelectedPageId] = useState('')
  const [selectedButtonId, setSelectedButtonId] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<DeckButton | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [pairOpen, setPairOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [obsPickerOpen, setObsPickerOpen] = useState(false)
  const [lightPicker, setLightPicker] = useState<LightPickerRequest | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [permission, setPermission] = useState<PermissionStatus | null>(null)
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [permissionDismissed, setPermissionDismissed] = useState(false)

  const skipSave = useRef(true)
  const saveNonce = useRef(0)
  const toastTimer = useRef<number | null>(null)
  const lastErrorShown = useRef('')
  const hostPlatform = normalizeHostPlatform(server?.platform)

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3800)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state: AppState = await window.phonedek.getState()
        if (cancelled) return
        setConfig(state.config)
        setServer(state.server)
        setSelectedProfileId(state.config.defaultProfileId)
        const profile = state.config.profiles.find((item) => item.id === state.config.defaultProfileId)
        setSelectedPageId(profile?.defaultPageId ?? state.config.profiles[0]?.defaultPageId ?? '')
      } catch (error) {
        if (!cancelled) setFatal(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const offServer = window.phonedek.onServerInfo((info) => setServer(info))
    const offConfig = window.phonedek.onConfigChanged((next) => {
      skipSave.current = true
      setConfig(next)
      setSelectedProfileId(next.defaultProfileId)
      const profile = next.profiles.find((item) => item.id === next.defaultProfileId)
      setSelectedPageId(profile?.defaultPageId ?? next.profiles[0]?.defaultPageId ?? '')
      setSelectedButtonId(null)
    })
    const offPair = window.phonedek.onOpenPair(() => setPairOpen(true))
    return () => {
      offServer()
      offConfig()
      offPair()
    }
  }, [])

  useEffect(() => {
    let active = true
    const offUpdates = window.phonedek.onUpdateStatus((next) => {
      if (active) setUpdateStatus(next)
    })
    void window.phonedek
      .getUpdateStatus()
      .then((next) => {
        if (active && next) setUpdateStatus(next)
      })
      .catch(() => {
        // Update status is optional; the rest of the app keeps working.
      })
    return () => {
      active = false
      offUpdates()
    }
  }, [])

  const checkForUpdates = useCallback(async (): Promise<UpdateStatus> => {
    const next = await window.phonedek.checkForUpdates()
    setUpdateStatus(next)
    return next
  }, [])

  const installUpdate = useCallback(async (): Promise<void> => {
    await window.phonedek.installUpdate()
  }, [])

  // Poll while input permission is missing so the banner disappears as soon
  // as the user flips the switch in System Settings.
  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.phonedek.getPermissionStatus()
        if (active) setPermission(next)
      } catch {
        // Permission status is informational; leave the rest of the app alone.
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 2500)
    const onFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const grantPermission = useCallback(async (): Promise<void> => {
    setPermissionBusy(true)
    try {
      const next = await window.phonedek.requestPermission()
      setPermission(next)
      if (!next.granted) showToast('Follow the macOS prompt, then return to PhoneDeck.', 'info')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setPermissionBusy(false)
    }
  }, [showToast])

  const openPermissionSetup = useCallback(async (): Promise<void> => {
    try {
      await window.phonedek.openPermissionSetup()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  const save = useCallback(
    async (target: DeckConfig) => {
      const nonce = ++saveNonce.current
      setSaveStatus('saving')
      try {
        const result = await window.phonedek.saveConfig(target)
        if (nonce !== saveNonce.current) return
        if (result.ok) {
          setSaveStatus('saved')
          setSaveErrors([])
          lastErrorShown.current = ''
        } else {
          const errors = result.errors ?? ['Could not save the configuration']
          setSaveStatus('error')
          setSaveErrors(errors)
          const message = errors[0] ?? 'Could not save the configuration'
          if (message !== lastErrorShown.current) {
            lastErrorShown.current = message
            showToast(message, 'error')
          }
        }
      } catch (error) {
        if (nonce !== saveNonce.current) return
        const message = error instanceof Error ? error.message : String(error)
        setSaveStatus('error')
        setSaveErrors([message])
        showToast(message, 'error')
      }
    },
    [showToast],
  )

  useEffect(() => {
    if (!config) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    setSaveStatus('saving')
    const timer = window.setTimeout(() => void save(config), 320)
    return () => window.clearTimeout(timer)
  }, [config, save])

  useEffect(() => {
    if (!config) return
    if (!config.profiles.some((item) => item.id === selectedProfileId)) {
      setSelectedProfileId(config.defaultProfileId)
    }
  }, [config, selectedProfileId])

  const profile = config?.profiles.find((item) => item.id === selectedProfileId) ?? config?.profiles[0] ?? null
  const page = profile?.pages.find((item) => item.id === selectedPageId) ?? profile?.pages[0] ?? null

  useEffect(() => {
    if (!profile) return
    if (!profile.pages.some((item) => item.id === selectedPageId)) {
      setSelectedPageId(profile.defaultPageId)
    }
  }, [profile, selectedPageId])

  useEffect(() => {
    if (selectedButtonId && page && !page.buttons.some((item) => item.id === selectedButtonId)) {
      setSelectedButtonId(null)
    }
  }, [page, selectedButtonId])

  const selectedButton = page?.buttons.find((item) => item.id === selectedButtonId) ?? null

  const copySelectedButton = useCallback((): boolean => {
    if (!selectedButton) return false
    setClipboard(structuredClone(selectedButton))
    showToast(`Copied “${selectedButton.label || 'Untitled'}”`, 'success')
    return true
  }, [selectedButton, showToast])

  const cutSelectedButton = useCallback((): boolean => {
    if (!config || !profile || !page || !selectedButton) return false
    const result = cutButtonFromPage(config, profile.id, page.id, selectedButton.id)
    if (!result.ok) {
      showToast(result.error, 'error')
      return false
    }
    setClipboard(result.button)
    setConfig(result.config)
    setSelectedButtonId(null)
    showToast(
      `Cut “${result.button.label || 'Untitled'}” — paste it on the target page`,
      'success',
    )
    return true
  }, [config, page, profile, selectedButton, showToast])

  const pasteClipboard = useCallback((): boolean => {
    if (!config || !clipboard || !profile || !page) return false
    const result = pasteButtonIntoPage(config, profile.id, page.id, clipboard)
    if (!result.ok) {
      showToast(result.error, 'error')
      return false
    }
    setConfig(result.config)
    setSelectedButtonId(result.button.id)
    const label = result.button.label || 'Untitled'
    if (result.fallback === 'span-reduced') {
      const span = buttonSpan(clipboard)
      showToast(
        `Pasted “${label}” as 1×1 — no ${span.columns}×${span.rows} space was free on this page`,
        'info',
      )
    } else {
      showToast(`Pasted “${label}” at slot ${result.button.slot + 1}`, 'success')
    }
    return true
  }, [clipboard, config, page, profile, showToast])

  const moveSelectedButton = useCallback(
    (targetProfileId: string, targetPageId: string): boolean => {
      if (!config || !profile || !page || !selectedButton) return false
      const result = moveButtonToPage(
        config,
        profile.id,
        page.id,
        targetProfileId,
        targetPageId,
        selectedButton.id,
      )
      if (!result.ok) {
        showToast(result.error, 'error')
        return false
      }
      setConfig(result.config)
      setSelectedProfileId(targetProfileId)
      setSelectedPageId(targetPageId)
      setSelectedButtonId(result.button.id)
      const targetProfile = result.config.profiles.find((item) => item.id === targetProfileId)
      const targetPage = targetProfile?.pages.find((item) => item.id === targetPageId)
      const where =
        targetProfile && targetPage ? `${targetProfile.name} · ${targetPage.name}` : 'the target page'
      const label = result.button.label || 'Untitled'
      if (result.fallback === 'span-reduced') {
        const span = buttonSpan(selectedButton)
        showToast(
          `Moved “${label}” to ${where} as 1×1 — no ${span.columns}×${span.rows} space was free`,
          'info',
        )
      } else {
        showToast(`Moved “${label}” to ${where}`, 'success')
      }
      return true
    },
    [config, page, profile, selectedButton, showToast],
  )

  const pasteOnActivePage = useCallback((): void => {
    pasteClipboard()
  }, [pasteClipboard])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const editable = isEditableTarget(event.target)
      const primary = hostPlatform === 'darwin' ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (!editable && primary && !event.altKey && !event.shiftKey) {
        if (key === 'c' && selectedButtonId) {
          if (copySelectedButton()) event.preventDefault()
          return
        }
        if (key === 'x' && selectedButtonId) {
          if (cutSelectedButton()) event.preventDefault()
          return
        }
        if (key === 'v' && clipboard) {
          if (pasteClipboard()) event.preventDefault()
          return
        }
      }

      if (!editable && (event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        if (config) void save(config)
        return
      }
      if (event.key !== 'Escape' || !selectedButtonId) return
      if (editable) return
      if (document.querySelector('.modal-backdrop')) return
      setSelectedButtonId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    clipboard,
    config,
    copySelectedButton,
    cutSelectedButton,
    hostPlatform,
    pasteClipboard,
    save,
    selectedButtonId,
  ])

  const selectProfile = (id: string): void => {
    setSelectedProfileId(id)
    const next = config?.profiles.find((item) => item.id === id)
    if (next) setSelectedPageId(next.defaultPageId)
    setSelectedButtonId(null)
  }

  const selectPage = (id: string): void => {
    setSelectedPageId(id)
    setSelectedButtonId(null)
  }

  const addNewButton = (): void => {
    if (!config || !profile || !page) return
    const slot = nextFreeSlotForPage(profile, page)
    if (slot === null) {
      showToast('This page is full. Add rows/columns or delete a button first.', 'error')
      return
    }
    const button = createEmptyButton(slot)
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const addNewControl = (
    kind: 'volume' | 'scroll' | 'volume-wheel' | 'mic' | 'trackpad' | 'obs' | 'shortcut' | 'keyboard',
    obsInput?: string,
    shortcutId?: ShortcutPresetId,
  ): void => {
    if (!config || !profile || !page) return
    const preset = kind === 'shortcut' ? (shortcutId ? shortcutPreset(shortcutId) : null) : null
    if (kind === 'shortcut' && !preset) {
      showToast('Unknown shortcut preset', 'error')
      return
    }
    const grid = pageGrid(profile, page)
    const spanCandidates: Array<{ columns: number; rows: number }> =
      kind === 'keyboard'
        ? keyboardSpanCandidates()
        : kind === 'trackpad'
        ? [
            { columns: 3, rows: 2 },
            { columns: 2, rows: 2 },
            { columns: 1, rows: 1 },
          ]
        : preset
          ? [preset.span, { columns: 1, rows: 1 }]
          : [
              kind === 'volume' || kind === 'mic' || kind === 'obs'
                ? { columns: 3, rows: 1 }
                : { columns: 2, rows: 1 },
              { columns: 1, rows: 1 },
            ]
    const preferredSpan = spanCandidates[0]!

    const findSlot = (span: { columns: number; rows: number }): number | null => {
      for (let candidate = 0; candidate < grid.columns * grid.rows; candidate += 1) {
        if (canPlaceButton(page.buttons, candidate, span, grid)) return candidate
      }
      return null
    }

    let span: { columns: number; rows: number } | null = null
    let slot: number | null = null
    for (const candidate of spanCandidates) {
      const found = findSlot(candidate)
      if (found !== null) {
        span = candidate
        slot = found
        break
      }
    }
    if (slot === null || span === null) {
      showToast('No free cell left on this page. Resize the grid or remove a button first.', 'error')
      return
    }
    const fallback = span.columns !== preferredSpan.columns || span.rows !== preferredSpan.rows

    if (kind === 'keyboard') {
      const button = createKeyboardLauncher(slot, span)
      try {
        const next = addButton(config, profile.id, page.id, button)
        setConfig(next)
        setSelectedButtonId(button.id)
        showToast(
          fallback
            ? `Keyboard added as ${span.columns}×${span.rows} — no ${preferredSpan.columns}×${preferredSpan.rows} space was free`
            : 'Keyboard launcher added',
          'success',
        )
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error')
      }
      return
    }

    const volumeControl = (volumeKind: 'slider' | 'dial'): ControlSpec =>
      (hostPlatform === 'darwin' || hostPlatform === 'win32')
        ? {
            kind: volumeKind,
            ...(volumeKind === 'slider' ? { axis: 'horizontal' as const } : {}),
            emit: 'value',
            binding: { type: 'volume', mode: 'absolute' },
            min: 0,
            max: 100,
            step: 1,
            initial: 50,
            unit: '%',
            haptics: true,
          }
        : {
            kind: volumeKind,
            ...(volumeKind === 'slider' ? { axis: 'horizontal' as const } : {}),
            emit: 'delta',
            binding: { type: 'volume', mode: 'relative', stepPercent: 2 },
            min: 0,
            max: 100,
            step: 2,
            initial: 50,
            unit: '%',
            haptics: true,
          }

    const control: ControlSpec =
      kind === 'trackpad'
        ? {
            kind: 'trackpad',
            emit: 'delta',
            binding: {
              type: 'pointer',
              mode: 'inline',
              sensitivity: 1,
              naturalScroll: true,
              tapToClick: true,
              dragLock: true,
            },
            haptics: true,
          }
        : preset
          ? shortcutPresetControl(preset, hostPlatform)
          : kind === 'scroll'
          ? {
              kind: 'dial',
              emit: 'delta',
              binding: { type: 'scroll', axis: 'vertical' },
              step: 1,
              haptics: true,
            }
          : kind === 'mic'
            ? {
                kind: 'slider',
                axis: 'horizontal',
                emit: 'value',
                binding: { type: 'mic', mode: 'gain' },
                min: 0,
                max: 100,
                step: 1,
                initial: 50,
                unit: '%',
                haptics: true,
              }
            : kind === 'obs'
              ? {
                  kind: 'slider',
                  axis: 'horizontal',
                  emit: 'value',
                  binding: {
                    type: 'obs' as const,
                    target: 'inputVolume' as const,
                    ...(obsInput ? { input: obsInput } : {}),
                  },
                  min: 0,
                  max: 200,
                  step: 1,
                  initial: 100,
                  unit: '%',
                  haptics: true,
                }
              : volumeControl(kind === 'volume' ? 'slider' : 'dial')
    const label =
      preset
        ? preset.label(hostPlatform)
        : kind === 'volume' || kind === 'volume-wheel'
          ? 'Volume'
          : kind === 'mic'
            ? 'Mic'
            : kind === 'obs'
              ? obsInput?.trim() || 'OBS input'
              : kind === 'scroll'
                ? 'Scroll'
                : 'Trackpad'
    // `DeckButton.actions` is still typed as the legacy `Action` union while the
    // config schema accepts `MicAction`; keep the cast local to this builder.
    const micAction: MicAction = { type: 'mic', action: 'toggleMute' }
    const obsAction: ObsAction = {
      type: 'obs',
      action: 'toggleMute',
      ...(obsInput ? { input: obsInput } : {}),
    }
    const button: DeckButton = {
      ...createEmptyButton(slot, label),
      icon:
        preset
          ? preset.tileIcon
          : kind === 'scroll' || kind === 'trackpad'
            ? '🖱️'
            : kind === 'mic'
              ? '🎙️'
              : kind === 'obs'
                ? '🎚️'
                : '🔊',
      span,
      control,
      ...(kind === 'mic'
        ? { actions: [micAction as unknown as Action] }
        : kind === 'obs'
          ? { actions: [obsAction] }
          : {}),
    }
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      const name =
        preset
          ? preset.name
          : kind === 'volume'
            ? 'Volume slider'
            : kind === 'volume-wheel'
              ? 'Volume wheel'
              : kind === 'mic'
                ? 'Mic gain'
                : kind === 'obs'
                  ? 'OBS input'
                  : kind === 'scroll'
                    ? 'Scroll wheel'
                    : 'Trackpad'
      showToast(
        fallback
          ? `${name} added as ${span.columns}×${span.rows} — no ${preferredSpan.columns}×${preferredSpan.rows} space was free`
          : `${name} added`,
        'success',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const addObsStatusTile = (preset: ObsStatusTilePreset): void => {
    if (!config || !profile || !page) return
    const slot = nextFreeSlotForPage(profile, page)
    if (slot === null) {
      showToast('This page is full. Add rows/columns or delete a button first.', 'error')
      return
    }
    const button = createObsStatusButton(preset, slot)
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      showToast(`${preset.menuLabel} added`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const addTwitchStatusTile = (preset: TwitchStatusTilePreset): void => {
    if (!config || !profile || !page) return
    const slot = nextFreeSlotForPage(profile, page)
    if (slot === null) {
      showToast('This page is full. Add rows/columns or delete a button first.', 'error')
      return
    }
    const button = createTwitchStatusButton(preset, slot)
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      showToast(
        `${preset.menuLabel} added — read-only, tapping does nothing`,
        server?.twitchStatus.connected ? 'success' : 'info',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const addLightControl = (target: LightTarget, light?: string): void => {
    if (!config || !profile || !page) return
    const grid = pageGrid(profile, page)
    const spanCandidates = [
      { columns: 3, rows: 1 },
      { columns: 1, rows: 1 },
    ]
    const findSlot = (span: { columns: number; rows: number }): number | null => {
      for (let candidate = 0; candidate < grid.columns * grid.rows; candidate += 1) {
        if (canPlaceButton(page.buttons, candidate, span, grid)) return candidate
      }
      return null
    }

    let span: { columns: number; rows: number } | null = null
    let slot: number | null = null
    for (const candidate of spanCandidates) {
      const found = findSlot(candidate)
      if (found !== null) {
        span = candidate
        slot = found
        break
      }
    }
    if (slot === null || span === null) {
      showToast('No free cell left on this page. Resize the grid or remove a button first.', 'error')
      return
    }
    const fallback = span.columns !== 3 || span.rows !== 1
    const name = target === 'temperature' ? 'Light temperature' : 'Light brightness'
    const button: DeckButton = {
      ...createEmptyButton(slot, name),
      icon: target === 'temperature' ? '🌡️' : '🔆',
      span,
      control: lightControlSpec(target, light),
    }
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      showToast(
        fallback
          ? `${name} added as ${span.columns}×${span.rows} — no 3×1 space was free`
          : `${name} added`,
        'success',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const addLightStatusTile = (preset: LightStatusTilePreset, light?: string): void => {
    if (!config || !profile || !page) return
    const slot = nextFreeSlotForPage(profile, page)
    if (slot === null) {
      showToast('This page is full. Add rows/columns or delete a button first.', 'error')
      return
    }
    const button = createLightStatusButton(preset, slot, light)
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      showToast(
        `${preset.menuLabel} added${
          preset.action ? ' — tap toggles the light' : ' — read-only, tapping does nothing'
        }`,
        'success',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const openLightPicker = (request: LightPickerRequest): void => {
    if (!server) return
    if (server.settings.lights.length === 0) {
      showToast('No lights configured — add an Elgato light in Settings → Lights first.', 'info')
      return
    }
    if (!server.settings.lightsEnabled) {
      showToast('Local light control is off — enable it in Settings → Lights to use this tile.', 'info')
    }
    setLightPicker(request)
  }

  const pickLight = (light?: string): void => {
    const request = lightPicker
    setLightPicker(null)
    if (!request) return
    if (request.kind === 'control') addLightControl(request.target, light)
    else addLightStatusTile(request.preset, light)
  }

  const openObsInputPicker = (): void => {
    if (!server) return
    if (server.obsStatus.state !== 'connected') {
      showToast('OBS is not connected — open Settings → OBS Studio to connect it first.', 'info')
      return
    }
    setObsPickerOpen(true)
  }

  const addObsInput = (input: ObsInputView): void => {
    setObsPickerOpen(false)
    addNewControl('obs', input.name)
  }

  const handleConfigImported = (next: DeckConfig): void => {
    skipSave.current = true
    setConfig(next)
    setSelectedProfileId(next.defaultProfileId)
    const nextProfile = next.profiles.find((item) => item.id === next.defaultProfileId)
    setSelectedPageId(nextProfile?.defaultPageId ?? next.profiles[0]?.defaultPageId ?? '')
    setSelectedButtonId(null)
  }

  if (fatal) {
    return (
      <div className="boot">
        <DeckMark className="brand-mark large" size={58} />
        <span className="boot-status">Boot failure</span>
        <h1>PhoneDeck could not start</h1>
        <p className="muted">{fatal}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }

  if (!config || !server || !profile || !page) {
    return (
      <div className="boot">
        <DeckMark className="brand-mark large" size={58} />
        <span className="boot-status">Starting deck server</span>
        <h1>PhoneDeck</h1>
        <p className="muted">Loading profiles and the LAN server…</p>
      </div>
    )
  }

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Unsaved' : 'Saved'
  const activeGrid = pageGrid(profile, page)
  const activeCapacity = pageCapacity(profile, page)
  const usedCells = occupiedCells(page.buttons, activeGrid).size

  return (
    <HostPlatformProvider platform={server.platform}>
      <div className="app-shell">
        <Sidebar
          config={config}
          profile={profile}
          page={page}
          server={server}
          settings={server.settings}
          onChangeConfig={setConfig}
          onSelectProfile={selectProfile}
          onSelectPage={selectPage}
          onOpenPair={() => setPairOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onToast={showToast}
        />

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{profile.name}</span>
            <Icon name="chevron-right" size={14} />
            <strong>{page.name}</strong>
            <span className="grid-pill">
              {activeGrid.columns} × {activeGrid.rows}
            </span>
            <span className="slot-pill">
              {usedCells}/{activeCapacity} cells
            </span>
          </div>

          <div className="topbar-actions">
            {updateStatus && isUpdateNoticeVisible(updateStatus) && (
              <button
                type="button"
                className={`update-pill ${updateStatus.state}`}
                onClick={() => setSettingsOpen(true)}
                title="Open update settings"
              >
                <Icon name={updateStatus.state === 'downloaded' ? 'arrow-up' : 'download'} size={15} />
                {updateIndicatorLabel(updateStatus)}
              </button>
            )}
            <div className={`save-state ${saveStatus}`} title={saveErrors[0] ?? 'Configuration is stored on this PC'}>
              <Icon name={saveStatus === 'saved' ? 'check' : saveStatus === 'saving' ? 'refresh' : 'bolt'} size={15} />
              {saveLabel}
            </div>
            <button type="button" className="button secondary" onClick={addNewButton}>
              <Icon name="plus" size={16} /> Add button
            </button>
            <PopMenu
              align="right"
              width={270}
              trigger={
                <button type="button" className="button secondary" title="Add a continuous control">
                  <Icon name="sliders" size={16} /> Add control
                </button>
              }
              items={[
                {
                  label: 'Volume slider',
                  section: 'Audio',
                  icon: 'music',
                  description: '3 × 1 · jump straight to any level',
                  onClick: () => addNewControl('volume'),
                },
                {
                  label: 'Mic gain',
                  icon: 'microphone',
                  description: '3 × 1 · gain + tap to mute',
                  onClick: () => addNewControl('mic'),
                },
                {
                  label: 'Volume wheel',
                  icon: 'sliders',
                  description: '2 × 1 · turn or drag for small ± steps',
                  onClick: () => addNewControl('volume-wheel'),
                },
                {
                  label: 'OBS input',
                  section: 'Integrations',
                  icon: 'sliders',
                  description:
                    server.obsStatus.state === 'connected'
                      ? '3 × 1 · pick an OBS source, tap to mute'
                      : 'Connect OBS in Settings first',
                  onClick: openObsInputPicker,
                },
                ...OBS_STATUS_TILES.map((preset) => ({
                  label: preset.menuLabel,
                  section: 'OBS status',
                  icon: preset.menuIcon,
                  description: preset.menuDescription,
                  onClick: () => addObsStatusTile(preset),
                })),
                ...TWITCH_STATUS_TILES.map((preset) => ({
                  label: preset.menuLabel,
                  section: 'Twitch status',
                  icon: preset.menuIcon,
                  description: server.twitchStatus.connected
                    ? preset.menuDescription
                    : `${preset.menuDescription} · connect Twitch in Settings`,
                  onClick: () => addTwitchStatusTile(preset),
                })),
                {
                  label: 'Light brightness',
                  section: 'Lighting',
                  icon: 'light',
                  description: '3 × 1 · 0–100% for a configured Key Light',
                  onClick: () => openLightPicker({ kind: 'control', target: 'brightness' }),
                },
                {
                  label: 'Light temperature',
                  icon: 'temperature',
                  description: '3 × 1 · 143–344 mired, warm to cool',
                  onClick: () => openLightPicker({ kind: 'control', target: 'temperature' }),
                },
                ...LIGHT_STATUS_TILES.map((preset) => ({
                  label: preset.menuLabel,
                  section: 'Light status',
                  icon: preset.menuIcon,
                  description:
                    server.settings.lightsEnabled && server.settings.lights.length > 0
                      ? preset.menuDescription
                      : `${preset.menuDescription} · add a light in Settings`,
                  onClick: () => openLightPicker({ kind: 'status', preset }),
                })),
                {
                  label: 'Scroll wheel',
                  section: 'Navigation',
                  icon: 'mouse',
                  description: '2 × 1 · one mouse-wheel notch per step',
                  onClick: () => addNewControl('scroll'),
                },
                ...SHORTCUT_PRESETS.map((preset) => ({
                  label: preset.name,
                  section: preset.section,
                  icon: preset.menuIcon,
                  description: `${preset.span.columns} × ${preset.span.rows} · ${preset.description}`,
                  onClick: () => addNewControl('shortcut', undefined, preset.id),
                })),
                {
                  label: 'Trackpad',
                  section: 'Pointer',
                  icon: 'trackpad',
                  description: '3 × 2 · inline cursor pad (full screen optional)',
                  onClick: () => addNewControl('trackpad'),
                },
                {
                  label: 'Keyboard',
                  section: 'Pointer',
                  icon: 'keyboard',
                  description: '2 × 1 · full-screen phone keyboard for the active PC window',
                  onClick: () => addNewControl('keyboard'),
                },
              ]}
            />
            <button type="button" className="button primary" onClick={() => setPairOpen(true)}>
              <span className={`dot ${server.running ? 'online' : 'offline'}`} />
              Pair phone
              {server.clients.length > 0 && <span className="client-count">{server.clients.length}</span>}
            </button>
            <button type="button" className="icon-button bordered" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Icon name="settings" size={18} />
            </button>
          </div>
        </header>

        {permission && !permissionDismissed && (
          <PermissionBanner
            permission={permission}
            busy={permissionBusy}
            onGrant={() => void grantPermission()}
            onOpenSetup={() => void openPermissionSetup()}
            onDismiss={() => setPermissionDismissed(true)}
          />
        )}

        <div className="workspace-body">
          <DeckCanvas
            config={config}
            profile={profile}
            page={page}
            server={server}
            selectedButtonId={selectedButtonId}
            onChangeConfig={setConfig}
            onSelectButton={setSelectedButtonId}
            onToast={showToast}
          />
          <Inspector
            config={config}
            profile={profile}
            page={page}
            button={selectedButton}
            server={server}
            onChangeConfig={setConfig}
            onSelectButton={setSelectedButtonId}
            onToast={showToast}
            clipboardLabel={clipboard?.label ?? null}
            canPaste={clipboard !== null}
            onCopyButton={copySelectedButton}
            onCutButton={cutSelectedButton}
            onPasteButton={pasteOnActivePage}
            onMoveButton={moveSelectedButton}
          />
        </div>

        <footer className="statusbar">
          <span>
            <Icon name={server.running ? 'wifi' : 'monitor'} size={14} />
            {server.running ? `LAN server on ${server.port}` : (server.error ?? 'Server offline')}
          </span>
          <span>
            <Icon name="lock" size={13} /> PIN pairing
          </span>
          <span>
            <Icon name="phone" size={13} /> {server.clients.length} device{server.clients.length === 1 ? '' : 's'}
          </span>
          <span className="spacer" />
          <span>{server.version}</span>
        </footer>
      </main>

      {obsPickerOpen && (
        <ObsInputDialog onPick={addObsInput} onClose={() => setObsPickerOpen(false)} />
      )}
      {lightPicker && (
        <LightPickerDialog
          title={
            lightPicker.kind === 'control'
              ? lightPicker.target === 'temperature'
                ? 'Add light temperature'
                : 'Add light brightness'
              : lightPicker.preset.menuLabel
          }
          description={
            lightPicker.kind === 'control'
              ? 'Choose which configured light this slider drives. You can change it later in the Inspector.'
              : 'Choose which configured light this status tile reads. You can change it later in the Inspector.'
          }
          lights={server.settings.lights}
          onPick={pickLight}
          onOpenSettings={() => {
            setLightPicker(null)
            setSettingsOpen(true)
          }}
          onClose={() => setLightPicker(null)}
        />
      )}
      {pairOpen && (
        <PairDialog
          server={server}
          settings={server.settings}
          onClose={() => setPairOpen(false)}
          onServerUpdate={setServer}
          onToast={showToast}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          server={server}
          settings={server.settings}
          serverName={config.serverName}
          updateStatus={updateStatus}
          permission={permission}
          onGrantPermission={grantPermission}
          onOpenPermissionSetup={openPermissionSetup}
          onCheckForUpdates={checkForUpdates}
          onInstallUpdate={installUpdate}
          onRenameServer={(name) => setConfig({ ...config, serverName: name })}
          onClose={() => setSettingsOpen(false)}
          onServerUpdate={setServer}
          onConfigImported={handleConfigImported}
          onToast={showToast}
        />
      )}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
      </div>
    </HostPlatformProvider>
  )
}

export default function App() {
  return (
    <ConfirmProvider>
      <AppContent />
    </ConfirmProvider>
  )
}
