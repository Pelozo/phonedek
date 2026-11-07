import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addButton,
  canPlaceButton,
  createEmptyButton,
  nextFreeSlotForPage,
  normalizeHostPlatform,
  occupiedCells,
  pageCapacity,
  pageGrid,
} from '@phonedek/shared'
import type { ControlSpec, DeckButton, DeckConfig } from '@phonedek/shared'
import type { AppState, ServerInfoView, UpdateStatus, PermissionStatus } from '../../shared/api'
import { isUpdateNoticeVisible, updateIndicatorLabel } from '../../shared/update-status'
import { DeckCanvas } from './components/DeckCanvas'
import { DeckMark, Icon } from './components/Icons'
import { Inspector } from './components/Inspector'
import { PopMenu } from './components/Menu'
import { PairDialog } from './components/PairDialog'
import { PermissionBanner } from './components/PermissionBanner'
import { ConfirmProvider } from './components/Primitives'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { HostPlatformProvider } from './lib/platform'

type ToastKind = 'info' | 'success' | 'error'
interface ToastState {
  message: string
  kind: ToastKind
}

type SaveStatus = 'saved' | 'saving' | 'error'

function AppContent() {
  const [config, setConfig] = useState<DeckConfig | null>(null)
  const [server, setServer] = useState<ServerInfoView | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedPageId, setSelectedPageId] = useState('')
  const [selectedButtonId, setSelectedButtonId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [pairOpen, setPairOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (config) void save(config)
        return
      }
      if (event.key !== 'Escape' || !selectedButtonId) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.modal-backdrop')) return
      setSelectedButtonId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [config, save, selectedButtonId])

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

  const addNewControl = (kind: 'volume' | 'scroll' | 'volume-wheel'): void => {
    if (!config || !profile || !page) return
    const grid = pageGrid(profile, page)
    const preferredSpan =
      kind === 'volume'
        ? { columns: 3, rows: 1 }
        : kind === 'volume-wheel'
          ? { columns: 2, rows: 1 }
          : { columns: 2, rows: 1 }

    const findSlot = (span: { columns: number; rows: number }): number | null => {
      for (let candidate = 0; candidate < grid.columns * grid.rows; candidate += 1) {
        if (canPlaceButton(page.buttons, candidate, span, grid)) return candidate
      }
      return null
    }

    let span = preferredSpan
    let slot = findSlot(span)
    const fallback = slot === null && preferredSpan.columns > 1
    if (fallback) {
      span = { columns: 1, rows: 1 }
      slot = findSlot(span)
    }
    if (slot === null) {
      showToast('No free cell left on this page. Resize the grid or remove a button first.', 'error')
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
      kind === 'scroll'
        ? {
            kind: 'dial',
            emit: 'delta',
            binding: { type: 'scroll', axis: 'vertical' },
            step: 1,
            haptics: true,
          }
        : volumeControl(kind === 'volume' ? 'slider' : 'dial')
    const button: DeckButton = {
      ...createEmptyButton(
        slot,
        kind === 'volume' ? 'Volume' : kind === 'volume-wheel' ? 'Volume' : 'Scroll',
      ),
      icon: kind === 'scroll' ? '🖱️' : '🔊',
      span,
      control,
    }
    try {
      const next = addButton(config, profile.id, page.id, button)
      setConfig(next)
      setSelectedButtonId(button.id)
      const name =
        kind === 'volume' ? 'Volume slider' : kind === 'volume-wheel' ? 'Volume wheel' : 'Scroll wheel'
      showToast(
        fallback ? `${name} added as 1×1 — no wider space was free` : `${name} added`,
        'success',
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
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

  const selectedButton = page.buttons.find((item) => item.id === selectedButtonId) ?? null
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
              width={250}
              trigger={
                <button type="button" className="button secondary" title="Add a continuous control">
                  <Icon name="sliders" size={16} /> Add control
                </button>
              }
              items={[
                {
                  label: 'Volume slider',
                  icon: 'music',
                  description: `3 × 1 · ${hostPlatform === 'darwin' || hostPlatform === 'win32' ? 'absolute volume' : 'relative volume'}`,
                  onClick: () => addNewControl('volume'),
                },
                {
                  label: 'Volume wheel',
                  icon: 'sliders',
                  description: `2 × 1 · ${hostPlatform === 'darwin' || hostPlatform === 'win32' ? 'absolute volume' : 'relative volume'}`,
                  onClick: () => addNewControl('volume-wheel'),
                },
                {
                  label: 'Scroll wheel',
                  icon: 'mouse',
                  description: '2 × 1 · vertical scroll',
                  onClick: () => addNewControl('scroll'),
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
