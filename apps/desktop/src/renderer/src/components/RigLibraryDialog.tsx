import { useEffect, useMemo, useState } from 'react'
import type {
  DeckConfig,
  EventRule,
  RigGuard,
  RigPreset,
  RigStep,
  RigStepAction,
} from '@phonedek/shared'
import {
  estimateRigMs,
  RIG_DEFAULT_DEADLINE_MS,
  RIG_MAX_DEADLINE_MS,
  RIG_MAX_GUARDS,
  RIG_MAX_PRESETS,
  RIG_MAX_STEPS,
  rulesUsingRig,
} from '@phonedek/shared'
import type {
  RigPreviewView,
  RigRunView,
  RigStatusView,
  ServerInfoView,
} from '../../../shared/api'
import {
  formatRigDuration,
  nextRigId,
  rigDraftErrors,
  rigHasDestructiveSteps,
  removeRigFromConfig,
  rigReferences,
  rigRunTone,
  rigsOf,
  rigStatusText,
  rigStepDefaults,
  rigStepSummary,
  rigTemplate,
  type RigReference,
  type RigTemplateId,
  type RigTone,
} from '../lib/rigs'
import { useHostPlatform } from '../lib/platform'
import { ActionEditor } from './ActionEditor'
import { GuardRows } from './GuardRows'
import { Icon } from './Icons'
import { IconPicker } from './IconPicker'
import { PopMenu, type MenuItem } from './Menu'
import { Modal, NumberField, Toggle, useConfirm } from './Primitives'

const TEMPLATE_ORDER: RigTemplateId[] = ['go-live', 'brb', 'wrap']
const TONE_CLASS: Record<RigTone, string> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  muted: 'muted',
  live: 'live',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function CommitInput({
  value,
  maxLength,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string
  maxLength: number
  placeholder?: string
  ariaLabel: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const next = draft.trim()
    if (!next) {
      setDraft(value)
      return
    }
    if (next !== value) onCommit(next)
    else setDraft(value)
  }
  return (
    <input
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
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

function actionLabel(action: RigStepAction): string {
  return rigStepSummary({ action }).label
}

export function RigLibraryDialog({
  config,
  server,
  initialRigId,
  onChangeConfig,
  onClose,
  onToast,
}: {
  config: DeckConfig
  server: ServerInfoView | null
  initialRigId?: string | null
  onChangeConfig: (config: DeckConfig) => void
  onClose: () => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const rigs = rigsOf(config)
  const platform = useHostPlatform()
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialRigId && rigs.some((rig) => rig.id === initialRigId)) return initialRigId
    return rigs[0]?.id ?? null
  })
  const [statuses, setStatuses] = useState<RigStatusView[]>([])
  const [busy, setBusy] = useState<'check' | 'run' | 'abort' | null>(null)
  const [preview, setPreview] = useState<RigPreviewView | null>(null)
  const [run, setRun] = useState<RigRunView | null>(null)
  const [failureIndex, setFailureIndex] = useState<number | null>(null)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<{
    rig: RigPreset
    references: RigReference[]
    rules: EventRule[]
  } | null>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const rig = rigs.find((item) => item.id === selectedId) ?? null
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.presetId, status])),
    [statuses],
  )
  const currentStatus = rig ? statusById.get(rig.id) : undefined
  const currentReading = rigStatusText(currentStatus)
  const statusActive = currentStatus?.active === true
  const errors = rig ? rigDraftErrors(rig, rigs) : []

  const refreshStatuses = async (): Promise<void> => {
    try {
      setStatuses(await window.phonedek.getRigStatuses())
    } catch {
      // Status is informational; the next tick retries.
    }
  }

  useEffect(() => {
    void refreshStatuses()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshStatuses()
    }, 1500)
    return () => window.clearInterval(timer)
    // The dialog remounts per open; polling is intentionally scoped to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId && rigs.some((item) => item.id === selectedId)) return
    setSelectedId(rigs[0]?.id ?? null)
  }, [rigs, selectedId])

  useEffect(() => {
    setPreview(null)
    setRun(null)
    setFailureIndex(null)
    setIconPickerOpen(false)
    setExpandedStep(null)
  }, [selectedId])

  const changeRig = (next: RigPreset): void => {
    onChangeConfig({
      ...config,
      rigs: rigs.map((item) => (item.id === next.id ? next : item)),
    })
    setPreview(null)
  }

  const addRig = (): void => {
    if (rigs.length >= RIG_MAX_PRESETS) {
      onToast(`A config accepts at most ${RIG_MAX_PRESETS} rigs.`, 'error')
      return
    }
    const id = nextRigId(rigs)
    const next: RigPreset = {
      id,
      name: `Rig ${rigs.length + 1}`,
      steps: [rigStepDefaults(undefined, { type: 'delay', ms: 250 })],
      deadlineMs: RIG_DEFAULT_DEADLINE_MS,
    }
    onChangeConfig({ ...config, rigs: [...rigs, next] })
    setSelectedId(id)
    setPreview(null)
    setRun(null)
    onToast('Blank rig added — add a step or a guard.', 'success')
  }

  const addTemplate = (kind: RigTemplateId): void => {
    if (rigs.length >= RIG_MAX_PRESETS) {
      onToast(`A config accepts at most ${RIG_MAX_PRESETS} rigs.`, 'error')
      return
    }
    const next = rigTemplate(kind, nextRigId(rigs))
    onChangeConfig({ ...config, rigs: [...rigs, next] })
    setSelectedId(next.id)
    setPreview(null)
    setRun(null)
    onToast(`${next.name} template added`, 'success')
  }

  const requestDelete = async (): Promise<void> => {
    if (!rig) return
    const references = rigReferences(config, rig.id)
    const ruleReferences = rulesUsingRig(config.rules, rig.id)
    if (references.length === 0) {
      const ok = await confirm({
        title: 'Delete rig',
        message: `Delete “${rig.name}”?`,
        details: ruleReferences.slice(0, 6).map((rule) => `Automation rule: ${rule.name}`),
        warning:
          ruleReferences.length > 0
            ? `${ruleReferences.length} automation rule${ruleReferences.length === 1 ? '' : 's'} use this rig. Those actions are removed; rules with no actions left are deleted. Its guards and steps are removed. This cannot be undone.`
            : 'Its guards and steps are removed. This cannot be undone.',
        confirmLabel: 'Delete rig',
        danger: true,
      })
      if (!ok) return
      onChangeConfig(removeRigFromConfig(config, rig.id, [], false))
      setSelectedId(rigs.find((item) => item.id !== rig.id)?.id ?? null)
      setPreview(null)
      setRun(null)
      onToast(`Rig “${rig.name}” deleted`, 'success')
      return
    }
    setDeleteRequest({ rig, references, rules: ruleReferences })
  }

  const finishDelete = (mode: 'buttons' | 'unlink'): void => {
    const request = deleteRequest
    setDeleteRequest(null)
    if (!request) return
    const count = new Set(request.references.map((reference) => reference.buttonId)).size
    onChangeConfig(removeRigFromConfig(config, request.rig.id, request.references, mode === 'buttons'))
    setSelectedId(rigs.find((item) => item.id !== request.rig.id)?.id ?? null)
    setPreview(null)
    setRun(null)
    onToast(
      mode === 'buttons'
        ? `Rig deleted with ${count} referenced button${count === 1 ? '' : 's'}`
        : `Rig deleted · ${count} button${count === 1 ? '' : 's'} kept without the rig`,
      'success',
    )
  }

  const addGuard = (): void => {
    if (!rig) return
    if ((rig.guards?.length ?? 0) >= RIG_MAX_GUARDS) {
      onToast(`A rig accepts at most ${RIG_MAX_GUARDS} guards.`, 'error')
      return
    }
    changeRig({ ...rig, guards: [...(rig.guards ?? []), { probe: 'obsStreaming' }] })
  }

  const addStep = (action: RigStepAction): void => {
    if (!rig) return
    if (rig.steps.length >= RIG_MAX_STEPS) {
      onToast(`A rig accepts at most ${RIG_MAX_STEPS} steps.`, 'error')
      return
    }
    changeRig({ ...rig, steps: [...rig.steps, rigStepDefaults(rig, action)] })
    setExpandedStep(rig.steps.length)
  }

  const updateStep = (index: number, patch: Partial<RigStep>): void => {
    if (!rig) return
    changeRig({
      ...rig,
      steps: rig.steps.map((step, current) => (current === index ? { ...step, ...patch } : step)),
    })
  }

  const removeStep = (index: number): void => {
    if (!rig) return
    if (rig.steps.length <= 1) {
      onToast('A rig needs at least one step. Add another step before deleting this one.', 'info')
      return
    }
    changeRig({ ...rig, steps: rig.steps.filter((_, current) => current !== index) })
    setExpandedStep(null)
  }

  const moveStep = (index: number, direction: -1 | 1): void => {
    if (!rig) return
    const target = index + direction
    if (target < 0 || target >= rig.steps.length) return
    const steps = [...rig.steps]
    const [step] = steps.splice(index, 1)
    if (step) steps.splice(target, 0, step)
    changeRig({ ...rig, steps })
    setExpandedStep(null)
  }

  const checkRig = async (): Promise<void> => {
    if (!rig) return
    setBusy('check')
    try {
      const result = await window.phonedek.previewRig(rig.id)
      setPreview(result)
      if (result.ok) {
        onToast(`Pre-flight passed · ${result.guards.length} guard${result.guards.length === 1 ? '' : 's'} OK`, 'success')
      } else {
        onToast(
          result.error?.trim() ||
            `${result.blocked.length} guard${result.blocked.length === 1 ? '' : 's'} blocked this rig`,
          'error',
        )
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const startRun = async (): Promise<void> => {
    if (!rig) return
    const blocker = rigDraftErrors(rig, rigs)[0]
    if (blocker) {
      onToast(blocker, 'error')
      return
    }
    if (rigHasDestructiveSteps(rig)) {
      const destructive = rig.steps
        .filter((step) => {
          const action = step.action
          return (
            action.type === 'command' ||
            action.type === 'launch' ||
            (action.type === 'obs' &&
              (action.action === 'stopStream' || action.action === 'stopRecord'))
          )
        })
        .map((step) => rigStepSummary(step).label)
      const ok = await confirm({
        title: 'Run rig',
        message: `Run “${rig.name}” on this PC?`,
        details: destructive.slice(0, 6),
        warning:
          'This rig stops a stream/recording, launches an app or runs a command. It cannot be rolled back.',
        confirmLabel: 'Run rig',
        danger: true,
      })
      if (!ok) return
    }
    setBusy('run')
    setRun(null)
    setFailureIndex(null)
    setPreview(null)
    try {
      const result = await window.phonedek.runRig(rig.id)
      setRun(result)
      const failed = result.failures[0]
      if (failed) setFailureIndex(failed.index)
      await refreshStatuses()
      if (result.ok) onToast(result.message ?? `${rig.name} completed`, 'success')
      else if (result.status === 'busy') {
        onToast(result.error ?? 'Another rig is already running.', 'info')
      } else {
        onToast(
          result.error?.trim() ||
            result.message?.trim() ||
            `${rig.name}: ${result.status} · ${result.completed}/${result.total}`,
          result.status === 'blocked' ? 'info' : 'error',
        )
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const stopRun = async (): Promise<void> => {
    setBusy('abort')
    try {
      const result = await window.phonedek.abortRig()
      onToast(
        result.ok ? 'Stop requested — the rig ends at the next step or delay.' : (result.error ?? 'Could not stop the rig'),
        result.ok ? 'info' : 'error',
      )
      await refreshStatuses()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const revealFailure = (index: number): void => {
    setFailureIndex(index)
    document.getElementById(`rig-step-${index}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const lights = server?.settings.lights ?? []
  const running = statusActive || busy === 'run'
  const estimate = rig ? estimateRigMs(rig) : 0
  const deleteGroups: Array<{ reference: RigReference; vias: Array<'action' | 'state'> }> = []
  if (deleteRequest) {
    const seen = new Map<string, { reference: RigReference; vias: Set<'action' | 'state'> }>()
    for (const reference of deleteRequest.references) {
      const existing = seen.get(reference.buttonId)
      if (existing) existing.vias.add(reference.via)
      else seen.set(reference.buttonId, { reference, vias: new Set([reference.via]) })
    }
    for (const { reference, vias } of seen.values()) {
      deleteGroups.push({ reference, vias: [...vias] })
    }
  }
  const stepMenuItems: MenuItem[] = [
    { label: 'Shortcut', section: 'Shortcuts', icon: 'keyboard', description: 'Send a key combination', onClick: () => addStep({ type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }) },
    { label: 'Type text', icon: 'text', description: 'Type a phrase on the PC', onClick: () => addStep({ type: 'text', text: '', perCharMs: 4 }) },
    { label: 'Macro', icon: 'bolt', description: 'Replay a recorded sequence', onClick: () => addStep({ type: 'macro', steps: [{ type: 'hotkey', keys: ['CTRL', 'C'], holdMs: 35 }] }) },
    { label: 'Delay', icon: 'clock', description: 'Pause inside the sequence', onClick: () => addStep({ type: 'delay', ms: 250 }) },
    { label: 'Launch app', section: 'Apps', icon: 'app', description: 'Start a program', onClick: () => addStep({ type: 'launch', path: platform === 'darwin' ? '/System/Applications/TextEdit.app' : 'notepad.exe', args: [] }) },
    { label: 'Open URL', icon: 'link', description: 'Open a web page', onClick: () => addStep({ type: 'url', url: 'https://' }) },
    { label: 'Run command', icon: 'terminal', description: 'Run a shell command', onClick: () => addStep({ type: 'command', command: 'echo Hello from PhoneDeck', hidden: true }) },
    { label: 'OBS scene', section: 'OBS', icon: 'layers', description: 'First scene unless you name one', onClick: () => addStep({ type: 'obs', action: 'setScene' }) },
    { label: 'OBS start stream', icon: 'wifi', description: 'Start streaming only', onClick: () => addStep({ type: 'obs', action: 'startStream' }) },
    { label: 'OBS stop stream', icon: 'stop', description: 'Stop streaming only', onClick: () => addStep({ type: 'obs', action: 'stopStream' }) },
    { label: 'OBS toggle stream', icon: 'wifi', description: 'Start or stop streaming', onClick: () => addStep({ type: 'obs', action: 'toggleStream' }) },
    { label: 'OBS start recording', icon: 'record', description: 'Start recording only', onClick: () => addStep({ type: 'obs', action: 'startRecord' }) },
    { label: 'OBS stop recording', icon: 'stop', description: 'Stop recording only', onClick: () => addStep({ type: 'obs', action: 'stopRecord' }) },
    { label: 'OBS toggle recording', icon: 'record', description: 'Start or stop recording', onClick: () => addStep({ type: 'obs', action: 'toggleRecord' }) },
    { label: 'OBS save replay', icon: 'refresh', description: 'Save the last replay clip', onClick: () => addStep({ type: 'obs', action: 'saveReplay' }) },
    { label: 'OBS toggle replay', icon: 'refresh', description: 'Start or stop the replay buffer', onClick: () => addStep({ type: 'obs', action: 'toggleReplay' }) },
    { label: 'OBS virtual cam', icon: 'video', description: 'Start or stop the virtual camera', onClick: () => addStep({ type: 'obs', action: 'toggleVirtualCam' }) },
    { label: 'OBS source visibility', icon: 'image', description: 'Show or hide a source', onClick: () => addStep({ type: 'obs', action: 'toggleSourceVisibility', source: 'Camera' }) },
    { label: 'OBS marker', icon: 'clock', description: 'Drop a chapter marker', onClick: () => addStep({ type: 'obs', action: 'addMarker' }) },
    { label: 'OBS mute', icon: 'microphone', description: 'Toggle mute on an OBS input', onClick: () => addStep({ type: 'obs', action: 'toggleMute' }) },
    { label: 'Twitch chat', section: 'Twitch', icon: 'text', description: 'Post a chat message', onClick: () => addStep({ type: 'twitch', action: 'sendChat', message: '' }) },
    { label: 'Twitch marker', icon: 'clock', description: 'Drop a stream marker', onClick: () => addStep({ type: 'twitch', action: 'createMarker' }) },
    { label: 'Twitch title', icon: 'monitor', description: 'Replace the stream title', onClick: () => addStep({ type: 'twitch', action: 'setTitle', title: '' }) },
    { label: 'Twitch game', icon: 'grid', description: 'Replace the stream category', onClick: () => addStep({ type: 'twitch', action: 'setGame', game: '' }) },
    { label: 'Light on', section: 'Lights', icon: 'light', description: 'Turn a configured light on', onClick: () => addStep({ type: 'light', action: 'setPower', on: true }) },
    { label: 'Light off', icon: 'light', description: 'Turn a configured light off', onClick: () => addStep({ type: 'light', action: 'setPower', on: false }) },
    { label: 'Toggle light', icon: 'light', description: 'Switch a configured light', onClick: () => addStep({ type: 'light', action: 'togglePower' }) },
    { label: 'Media key', section: 'Audio', icon: 'music', description: 'Play, pause, skip, volume', onClick: () => addStep({ type: 'media', key: 'playpause' }) },
    { label: 'Mic mute', icon: 'microphone', description: 'Toggle the default mic', onClick: () => addStep({ type: 'mic', action: 'toggleMute' }) },
    { label: 'App audio mute', icon: 'sliders', description: 'Toggle one app audio session', onClick: () => addStep({ type: 'appVolume', action: 'toggleMute', match: {} }) },
    { label: 'Streamer.bot', section: 'Integrations', icon: 'bolt', description: 'Run one local Streamer.bot action', onClick: () => addStep({ type: 'streamerbot', action: 'doAction', actionName: '' }) },
  ]

  return (
    <Modal
      title="Rig library"
      subtitle="Guarded host-action sequences. Pre-flight first; one rig runs at a time."
      onClose={onClose}
      wide
      className="rig-modal"
      bodyClassName="rig-modal-body"
      footer={
        <>
          <span className="rig-footer-note mono">
            {rigs.length}/{RIG_MAX_PRESETS} RIGS · CHANGES SAVE WITH THE DECK
          </span>
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="rig-library">
        <aside className="rig-rail" aria-label="Rig presets">
          <div className="rig-rail-head">
            <span className="rig-kicker">RIG PRESETS</span>
            <span className="mono">{rigs.length}</span>
          </div>
          <div className="rig-rail-list">
            {rigs.length === 0 && (
              <p className="rig-rail-empty">
                No rigs yet. Start from a template or build one from scratch.
              </p>
            )}
            {rigs.map((item) => {
              const reading = rigStatusText(statusById.get(item.id))
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`rig-rail-item${item.id === rig?.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className={`rig-dot ${TONE_CLASS[reading.tone]}`} aria-hidden="true" />
                  <span className="rig-rail-text">
                    <strong>{item.name}</strong>
                    <small>
                      {item.steps.length} STEP{item.steps.length === 1 ? '' : 'S'} ·{' '}
                      {item.guards?.length ?? 0} GUARD{(item.guards?.length ?? 0) === 1 ? '' : 'S'}
                    </small>
                  </span>
                  <span className="rig-rail-meta">
                    <span className={`rig-rail-status ${TONE_CLASS[reading.tone]}`}>{reading.label}</span>
                    <span className="mono">{reading.age}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="add-row rig-new"
            onClick={addRig}
            disabled={rigs.length >= RIG_MAX_PRESETS}
          >
            <Icon name="plus" size={15} /> New rig
          </button>
        </aside>

        <section className="rig-detail" aria-label={rig ? rig.name : 'Rig templates'}>
          {!rig ? (
            <div className="rig-empty">
              <span className="rig-kicker">NO RIG CONFIGURED</span>
              <h3>Build a guarded sequence</h3>
              <p>
                A rig runs existing host actions in order, but only after its guards pass. Start from
                one of these generic templates, then replace the steps with your own apps and keys.
              </p>
              <div className="rig-templates">
                {TEMPLATE_ORDER.map((kind) => {
                  const template = rigTemplate(kind)
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="rig-template"
                      onClick={() => addTemplate(kind)}
                    >
                      <span className="rig-template-icon">{template.icon}</span>
                      <strong>{template.name}</strong>
                      <small>{template.description}</small>
                      <span className="rig-template-meta mono">
                        {template.steps.length} STEPS · {template.guards?.length ?? 0} GUARD
                        {(template.guards?.length ?? 0) === 1 ? '' : 'S'} · ~
                        {formatRigDuration(estimateRigMs(template))}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" className="button secondary" onClick={addRig}>
                <Icon name="plus" size={15} /> Blank rig
              </button>
            </div>
          ) : (
            <>
              <header className="rig-detail-head">
                <div className="rig-identity">
                  <span className="rig-icon" aria-hidden="true">
                    {rig.icon || '⚡'}
                  </span>
                  <div>
                    <span className="rig-kicker">
                      RIG {pad(rigs.findIndex((item) => item.id === rig.id) + 1)} / {pad(rigs.length)}
                    </span>
                    <h3>{rig.name}</h3>
                  </div>
                  <span
                    className={`rig-status-pill ${TONE_CLASS[currentReading.tone]}`}
                    title={currentReading.detail}
                  >
                    <span className={`rig-dot ${TONE_CLASS[currentReading.tone]}`} />
                    {currentReading.label}
                    <span className="rig-status-age mono">{currentReading.age}</span>
                  </span>
                </div>
                <div className="rig-head-actions">
                  <span className="rig-estimate mono">{rigEstimateText(rig)}</span>
                  <button type="button" className="button danger ghost small" onClick={() => void requestDelete()}>
                    <Icon name="trash" size={14} /> Delete rig
                  </button>
                </div>
              </header>

              <div className="rig-detail-scroll">
                <section className="rig-section rig-identity-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>00</em> Identity
                    </h4>
                    <span className={`rig-validity ${errors.length === 0 ? 'ok' : 'warn'}`}>
                      {errors.length === 0 ? 'VALID' : `${errors.length} ISSUE${errors.length === 1 ? '' : 'S'}`}
                    </span>
                  </div>
                  <div className="rig-meta-grid">
                    <label className="field">
                      <span>Name</span>
                      <CommitInput
                        value={rig.name}
                        maxLength={60}
                        ariaLabel="Rig name"
                        onCommit={(name) => changeRig({ ...rig, name })}
                      />
                    </label>
                    <label className="field">
                      <span>On error</span>
                      <select
                        value={rig.onError ?? 'failFast'}
                        onChange={(event) =>
                          changeRig({
                            ...rig,
                            onError: event.target.value === 'continue' ? 'continue' : undefined,
                          })
                        }
                      >
                        <option value="failFast">Stop at the first failure</option>
                        <option value="continue">Continue with the next step</option>
                      </select>
                    </label>
                    <NumberField
                      label="Deadline"
                      value={Math.round((rig.deadlineMs ?? RIG_DEFAULT_DEADLINE_MS) / 1000)}
                      min={1}
                      max={RIG_MAX_DEADLINE_MS / 1000}
                      step={5}
                      suffix="s"
                      onChange={(seconds) =>
                        changeRig({ ...rig, deadlineMs: Math.round(seconds * 1000) })
                      }
                    />
                  </div>
                  <label className="field">
                    <span>Description</span>
                    <input
                      value={rig.description ?? ''}
                      maxLength={140}
                      placeholder="What this rig is for"
                      onChange={(event) =>
                        changeRig({ ...rig, description: event.target.value || undefined })
                      }
                    />
                  </label>
                  <div className="rig-icon-block">
                    <div className="rig-icon-row">
                      <span className="rig-icon large">{rig.icon || '⚡'}</span>
                      <div>
                        <strong>Tile icon</strong>
                        <small>Used when a new rig button takes its label from this rig.</small>
                      </div>
                      <input
                        className="rig-icon-input"
                        value={rig.icon ?? ''}
                        maxLength={32}
                        placeholder="⚡"
                        aria-label="Rig icon emoji"
                        onChange={(event) =>
                          changeRig({ ...rig, icon: event.target.value || undefined })
                        }
                      />
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => setIconPickerOpen((open) => !open)}
                        aria-expanded={iconPickerOpen}
                      >
                        {iconPickerOpen ? 'Hide icons' : 'Browse icons'}
                      </button>
                      {rig.icon && (
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => changeRig({ ...rig, icon: undefined })}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {iconPickerOpen && (
                      <div className="rig-icon-picker">
                        <IconPicker
                          key={rig.id}
                          value={rig.icon}
                          onChange={(icon) => changeRig({ ...rig, icon: icon || undefined })}
                        />
                      </div>
                    )}
                  </div>
                  {errors.length > 0 && (
                    <ul className="rig-errors">
                      {errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>01</em> Guards
                      <span className="rig-count mono">
                        {rig.guards?.length ?? 0}/{RIG_MAX_GUARDS}
                      </span>
                    </h4>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={addGuard}
                      disabled={(rig.guards?.length ?? 0) >= RIG_MAX_GUARDS}
                    >
                      <Icon name="plus" size={14} /> Add guard
                    </button>
                  </div>
                  <p className="hint">
                    Every guard must match before the first step. Unavailable probes fail closed.
                    Guards are previewed by Check and re-evaluated by Run.
                  </p>
                  {(rig.guards?.length ?? 0) === 0 ? (
                    <div className="rig-section-empty">No guards — this rig runs unconditionally.</div>
                  ) : (
                    <GuardRows
                      guards={rig.guards ?? []}
                      lights={lights}
                      onChange={(guards) => changeRig({ ...rig, guards })}
                    />
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>02</em> Steps
                      <span className="rig-count mono">
                        {rig.steps.length}/{RIG_MAX_STEPS}
                      </span>
                    </h4>
                    {rig.steps.length >= RIG_MAX_STEPS ? (
                      <span className="hint">Step limit reached</span>
                    ) : (
                      <PopMenu
                        align="right"
                        width={300}
                        trigger={
                          <button type="button" className="button secondary small">
                            <Icon name="plus" size={14} /> Add step
                          </button>
                        }
                        items={stepMenuItems}
                      />
                    )}
                  </div>
                  <p className="hint">
                    Steps run top to bottom. A step is one host action; macros stay one step. Page,
                    keyboard, mixer and rig actions are not allowed inside a rig. Click a step card
                    to edit the action's fields.
                  </p>
                  <div className="rig-step-list">
                    {rig.steps.map((step, index) => {
                      const summary = rigStepSummary(step)
                      return (
                        <div
                          key={step.id ?? `step-${index}`}
                          id={`rig-step-${index + 1}`}
                          className={`rig-step-card${failureIndex === index + 1 ? ' failed' : ''}`}
                        >
                          <div className="rig-step-head">
                            <span className="rig-step-index mono">{pad(index + 1)}</span>
                            <span className="rig-step-label">{summary.label}</span>
                            <span className="rig-step-kind mono">{step.action.type.toUpperCase()}</span>
                            {(step.delayMs ?? 0) > 0 && (
                              <span className="rig-step-flag mono">+{formatRigDuration(step.delayMs ?? 0)}</span>
                            )}
                            {step.continueOnError && <span className="rig-step-flag">CONTINUE</span>}
                          </div>
                          <ActionEditor
                            action={step.action}
                            index={index}
                            total={rig.steps.length}
                            pages={[]}
                            server={server}
                            onUpdate={(action) =>
                              updateStep(index, { action: action as unknown as RigStepAction })
                            }
                            onDelete={() => removeStep(index)}
                            onMove={(direction) => moveStep(index, direction)}
                            collapsible
                            collapsed={expandedStep !== index}
                            onToggleCollapse={() =>
                              setExpandedStep(expandedStep === index ? null : index)
                            }
                            onTest={(candidate) => {
                              void window.phonedek
                                .testActions(
                                  [candidate] as unknown as Parameters<typeof window.phonedek.testActions>[0],
                                  actionLabel(candidate as unknown as RigStepAction),
                                )
                                .then((result) =>
                                  onToast(
                                    result.ok
                                      ? `Executed “${summary.label}” on this PC`
                                      : (result.error ?? 'Step failed'),
                                    result.ok ? 'success' : 'error',
                                  ),
                                )
                                .catch((error: unknown) =>
                                  onToast(error instanceof Error ? error.message : String(error), 'error'),
                                )
                            }}
                          />
                          <div className="rig-step-fields">
                            <label className="field">
                              <span>Label override</span>
                              <input
                                value={step.label ?? ''}
                                maxLength={60}
                                placeholder={actionLabel(step.action)}
                                onChange={(event) =>
                                  updateStep(index, { label: event.target.value || undefined })
                                }
                              />
                            </label>
                            <NumberField
                              label="Delay after"
                              value={step.delayMs ?? 0}
                              min={0}
                              max={10_000}
                              step={50}
                              suffix="ms"
                              onChange={(delayMs) =>
                                updateStep(index, { delayMs: delayMs > 0 ? delayMs : undefined })
                              }
                            />
                            <Toggle
                              label="Continue on error"
                              description="Keep going even if this step fails."
                              checked={step.continueOnError === true}
                              onChange={(continueOnError) =>
                                updateStep(index, { continueOnError: continueOnError || undefined })
                              }
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="rig-section rig-preflight">
                  <div className="rig-section-head">
                    <h4>
                      <em>03</em> Pre-flight / run
                    </h4>
                    <span className={`rig-run-token ${TONE_CLASS[currentReading.tone]} mono`}>
                      {running ? 'RUNNING' : currentReading.label}
                    </span>
                  </div>
                  <div className="rig-runbar">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void checkRig()}
                      disabled={busy !== null || running}
                    >
                      <Icon
                        name={busy === 'check' ? 'refresh' : 'check'}
                        size={15}
                      />{' '}
                      {busy === 'check' ? 'Checking…' : 'Check'}
                    </button>
                    {running ? (
                      <button
                        type="button"
                        className="button danger-solid"
                        onClick={() => void stopRun()}
                        disabled={busy === 'abort'}
                      >
                        <Icon name="stop" size={15} /> {busy === 'abort' ? 'Stopping…' : 'Stop'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => void startRun()}
                        disabled={busy !== null || errors.length > 0}
                      >
                        <Icon name="play" size={15} /> Run
                      </button>
                    )}
                    <span className="rig-estimate mono">
                      {rig.steps.length} step{rig.steps.length === 1 ? '' : 's'} · ~
                      {formatRigDuration(estimate)}
                    </span>
                    <span className="rig-deadline mono">
                      deadline {formatRigDuration(rig.deadlineMs ?? RIG_DEFAULT_DEADLINE_MS)}
                    </span>
                  </div>
                  <p className="hint">
                    Check evaluates guards without touching the last-run chip. Run evaluates them
                    again, then executes in one queue slot. Stop ends the rig at the next step or
                    delay boundary.
                  </p>

                  {preview && (
                    <div className={`rig-report${preview.ok ? ' ok' : ' blocked'}`}>
                      <div className="rig-report-head">
                        <span className={`rig-dot ${preview.ok ? 'ok' : 'warn'}`} />
                        <strong>{preview.ok ? 'Pre-flight OK' : 'Pre-flight blocked'}</strong>
                        <span className="mono">
                          {preview.total} step{preview.total === 1 ? '' : 's'} · ~
                          {formatRigDuration(preview.estimatedMs)}
                        </span>
                      </div>
                      {preview.error && <p className="rig-report-error">{preview.error}</p>}
                      <ul className="rig-guard-results">
                        {preview.guards.map((guard, index) => {
                          const unknown = !guard.available || guard.actual === null
                          const verdict = unknown ? 'UNKNOWN' : guard.ok ? 'OK' : 'BLOCKED'
                          const tone: RigTone = unknown ? 'muted' : guard.ok ? 'ok' : 'warn'
                          return (
                            <li className={`rig-guard-result ${TONE_CLASS[tone]}`} key={`${guard.probe}-${index}`}>
                              <span className={`rig-dot ${TONE_CLASS[tone]}`} />
                              <span className="rig-guard-result-text">
                                <strong>{guard.label}</strong>
                                <small>
                                  expected {guard.expect ? 'ON' : 'OFF'} · actual{' '}
                                  {guard.actual === null ? 'UNKNOWN' : guard.actual ? 'ON' : 'OFF'}
                                  {guard.error ? ` · ${guard.error}` : ''}
                                </small>
                              </span>
                              <span className="mono">{verdict}</span>
                            </li>
                          )
                        })}
                      </ul>
                      {!preview.ok && (
                        <p className="rig-report-error">
                          Run will not start until every guard passes.
                        </p>
                      )}
                    </div>
                  )}

                  {run && (
                    <div className={`rig-report run ${TONE_CLASS[rigRunTone(run.status)]}`}>
                      <div className="rig-report-head">
                        <span className={`rig-dot ${TONE_CLASS[rigRunTone(run.status)]}`} />
                        <strong>{run.status.toUpperCase()}</strong>
                        <span className="mono">
                          {run.completed}/{run.total} steps · {formatRigDuration(run.durationMs)}
                        </span>
                      </div>
                      <p className="rig-report-message">
                        {run.message?.trim() ||
                          run.error?.trim() ||
                          (run.status === 'ok'
                            ? `“${run.name}” completed.`
                            : `“${run.name}” ended ${run.status}.`)}
                      </p>
                      {run.status === 'busy' && run.active && (
                        <p className="hint">
                          Busy with “{run.active.name}” · step {run.active.index}/{run.active.total}.
                        </p>
                      )}
                      {run.failures.length > 0 && (
                        <ul className="rig-failures">
                          {run.failures.map((failure) => (
                            <li key={`${failure.index}-${failure.label}`}>
                              <button type="button" onClick={() => revealFailure(failure.index)}>
                                <span className="mono">{pad(failure.index)}</span>
                                <span>
                                  <strong>{failure.label}</strong>
                                  <small>{failure.error}</small>
                                </span>
                                <Icon name="chevron-right" size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {run.guards && run.guards.length > 0 && (
                        <ul className="rig-guard-results compact">
                          {run.guards.map((guard, index) => {
                            const unknown = !guard.available || guard.actual === null
                            const tone: RigTone = unknown ? 'muted' : guard.ok ? 'ok' : 'warn'
                            return (
                              <li className={`rig-guard-result ${TONE_CLASS[tone]}`} key={`run-${guard.probe}-${index}`}>
                                <span className={`rig-dot ${TONE_CLASS[tone]}`} />
                                <span className="rig-guard-result-text">
                                  <strong>{guard.label}</strong>
                                  <small>
                                    actual {guard.actual === null ? 'UNKNOWN' : guard.actual ? 'ON' : 'OFF'}
                                  </small>
                                </span>
                                <span className="mono">{unknown ? 'UNKNOWN' : guard.ok ? 'OK' : 'BLOCKED'}</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </section>
      </div>

      {deleteRequest && (
        <Modal
          title="Rig is in use"
          subtitle={`${deleteRequest.rig.name} is referenced by ${deleteGroups.length} button${
            deleteGroups.length === 1 ? '' : 's'
          }${deleteRequest.rules.length > 0 ? ` and ${deleteRequest.rules.length} automation rule${deleteRequest.rules.length === 1 ? '' : 's'}` : ''}.`}
          onClose={() => setDeleteRequest(null)}
          compact
          footer={
            <>
              <button type="button" className="button secondary" onClick={() => setDeleteRequest(null)}>
                Cancel
              </button>
              <button type="button" className="button secondary" onClick={() => finishDelete('unlink')}>
                Keep buttons
              </button>
              <button type="button" className="button danger-solid" onClick={() => finishDelete('buttons')}>
                Delete buttons too
              </button>
            </>
          }
        >
          <div className="confirm-content">
            <p className="confirm-message">
              Deleting the rig does not have to delete the buttons that point at it.
            </p>
            <ul className="confirm-details">
              {deleteGroups.slice(0, 6).map(({ reference, vias }) => (
                <li key={reference.buttonId}>
                  {reference.profileName} · {reference.pageName} · {reference.buttonLabel}
                  {' · '}
                  {vias
                    .map((via) => (via === 'state' ? 'status tile' : 'rig action'))
                    .join(' + ')}
                </li>
              ))}
              {deleteGroups.length > 6 && <li>+{deleteGroups.length - 6} more buttons</li>}
            </ul>
            {deleteRequest.rules.length > 0 && (
              <ul className="confirm-details">
                {deleteRequest.rules.slice(0, 6).map((rule) => (
                  <li key={rule.id}>Automation rule: {rule.name}</li>
                ))}
                {deleteRequest.rules.length > 6 && (
                  <li>+{deleteRequest.rules.length - 6} more automation rules</li>
                )}
              </ul>
            )}
            <p className="confirm-warning">
              “Keep buttons” leaves each button in place and removes its rig action/status, so the
              deck stays valid. “Delete buttons too” removes those buttons entirely. Automation
              rules that used this rig lose that action, and rules left with no actions are deleted.
            </p>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function rigEstimateText(rig: RigPreset): string {
  const steps = `${rig.steps.length} STEP${rig.steps.length === 1 ? '' : 'S'}`
  const guards = `${rig.guards?.length ?? 0} GUARD${(rig.guards?.length ?? 0) === 1 ? '' : 'S'}`
  return `${steps} · ${guards} · ~${formatRigDuration(estimateRigMs(rig))}`
}
