import { useEffect, useMemo, useState } from 'react'
import type { DeckConfig, EventRule, EventTrigger, RuleAction } from '@phonedek/shared'
import {
  formatRuleDuration,
  formatRigRunAge,
  RULE_COOLDOWN_DEFAULT_MS,
  RULE_COOLDOWN_MAX_MS,
  RULE_DEBOUNCE_DEFAULT_MS,
  RULE_DEBOUNCE_MAX_MS,
  RULE_MAX_ACTIONS,
  RULE_MAX_CONDITIONS,
  RULES_MAX_RULES,
} from '@phonedek/shared'
import type {
  EventRulesView,
  RuleFireView,
  RulePreviewView,
  ServerInfoView,
} from '../../../shared/api'
import {
  defaultRule,
  enabledRuleCount,
  isBooleanTrigger,
  liveSourceCount,
  moveRuleAction,
  nextRuleId,
  processMatchHint,
  removeRuleFromConfig,
  ruleActionDefaults,
  ruleActionFromKind,
  ruleActionLabel,
  ruleActionTarget,
  RULE_ACTION_KIND_LABELS,
  RULE_EDITABLE_ACTION_KINDS,
  ruleDraftErrors,
  ruleEdgeKey,
  ruleHistoryDetail,
  ruleHistorySummary,
  ruleOutcomeLabel,
  rulePreviewText,
  ruleProcessName,
  ruleReferenceIssues,
  RULE_TEMPLATE_ORDER,
  ruleTemplate,
  ruleTemplateDescription,
  ruleRunStatusLabel,
  ruleRunStatusTone,
  rulesOf,
  ruleSourceTone,
  ruleStatusText,
  ruleTriggerLabel,
  ruleTriggerOptionsFor,
  triggerFromOption,
  triggerOptionId,
  triggerSourceName,
  upsertRule,
  type RuleTemplateId,
  type RuleTone,
} from '../lib/rules'
import { rigHasDestructiveSteps, rigsOf } from '../lib/rigs'
import { GuardRows } from './GuardRows'
import { Icon } from './Icons'
import { PopMenu, type MenuItem } from './Menu'
import { Modal, NumberField, Toggle, useConfirm } from './Primitives'
import { RigPickerDialog } from './RigPickerDialog'

const TONE_CLASS: Record<RuleTone, string> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  muted: 'muted',
  live: 'live',
}

const TEMPLATE_ICON: Record<RuleTemplateId, string> = {
  'stream-started': '🔴',
  'stream-ended': '⏹️',
  'game-launched': '🎮',
  'phone-connected': '📱',
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

function ProcessTriggerField({
  process,
  onChange,
}: {
  process: string
  onChange: (process: string) => void
}) {
  const [draft, setDraft] = useState(process)
  useEffect(() => setDraft(process), [process])
  const commit = (): void => {
    const next = ruleProcessName(draft)
    if (!next) {
      setDraft(process)
      return
    }
    if (next !== process) onChange(next)
    else setDraft(next)
  }
  return (
    <label className="field rule-process-field">
      <span>Process</span>
      <input
        value={draft}
        maxLength={160}
        placeholder="game.exe"
        aria-label="Process name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') {
            setDraft(process)
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
      <small className="rule-process-hint mono">{processMatchHint(draft)}</small>
    </label>
  )
}

function SourceStrip({ view }: { view: EventRulesView | null }) {
  if (!view) {
    return (
      <div className="rule-sources" aria-label="Automation sources">
        <span className="rig-kicker">SOURCES</span>
        <span className="rule-source muted">
          <span className="rig-dot muted" aria-hidden="true" />
          <strong>WAITING</strong>
          <em>status unavailable</em>
        </span>
      </div>
    )
  }
  return (
    <div className="rule-sources" aria-label="Automation sources">
      <span className="rig-kicker">SOURCES</span>
      {view.sources.map((source) => {
        const tone = ruleSourceTone(source)
        return (
          <span className={`rule-source ${TONE_CLASS[tone]}`} key={source.name}>
            <span className={`rig-dot ${TONE_CLASS[tone]}`} aria-hidden="true" />
            <strong>{source.label.toUpperCase()}</strong>
            <em>{source.detail}</em>
          </span>
        )
      })}
    </div>
  )
}

export function RuleLibraryDialog({
  config,
  server,
  initialRuleId,
  onChangeConfig,
  onClose,
  onToast,
  onOpenRigs,
}: {
  config: DeckConfig
  server: ServerInfoView | null
  initialRuleId?: string | null
  onChangeConfig: (config: DeckConfig) => void
  onClose: () => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
  onOpenRigs?: () => void
}) {
  const rules = rulesOf(config)
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialRuleId && rules.some((rule) => rule.id === initialRuleId)) return initialRuleId
    return rules[0]?.id ?? null
  })
  const [view, setView] = useState<EventRulesView | null>(null)
  const [busy, setBusy] = useState<'check' | 'fire' | 'arm' | null>(null)
  const [preview, setPreview] = useState<RulePreviewView | null>(null)
  const [fire, setFire] = useState<RuleFireView | null>(null)
  const [rigPickerIndex, setRigPickerIndex] = useState<number | null>(null)

  const rule = rules.find((item) => item.id === selectedId) ?? null
  const statusById = useMemo(
    () => new Map((view?.statuses ?? []).map((status) => [status.ruleId, status])),
    [view],
  )
  const currentStatus = rule ? statusById.get(rule.id) : undefined
  const armed = view?.armed ?? server?.settings.automationEnabled ?? false
  const currentReading = ruleStatusText(currentStatus, armed)
  const errors = rule ? ruleDraftErrors(rule, rules) : []
  const issues = rule ? ruleReferenceIssues(rule, config) : []
  const lights = server?.settings.lights ?? []
  const history = view?.history ?? []

  const refresh = async (): Promise<EventRulesView | null> => {
    try {
      const next = await window.phonedek.getEventRules()
      setView(next)
      return next
    } catch {
      // Live status is informational; the next tick retries.
      return null
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 1_500)
    return () => window.clearInterval(timer)
    // The dialog remounts per open; polling is intentionally scoped to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId && rules.some((item) => item.id === selectedId)) return
    setSelectedId(rules[0]?.id ?? null)
  }, [rules, selectedId])

  useEffect(() => {
    setPreview(null)
    setFire(null)
    setRigPickerIndex(null)
  }, [selectedId])

  const changeRule = (next: EventRule): void => {
    onChangeConfig(upsertRule(config, next))
    setPreview(null)
  }

  const addRule = (): void => {
    if (rules.length >= RULES_MAX_RULES) {
      onToast(`A config accepts at most ${RULES_MAX_RULES} rules.`, 'error')
      return
    }
    const id = nextRuleId(rules)
    const next = defaultRule(id, config)
    onChangeConfig({ ...config, rules: [...rules, next] })
    setSelectedId(id)
    setPreview(null)
    setFire(null)
    onToast('Rule added — pick a trigger and at least one action.', 'success')
  }

  const addTemplate = (kind: RuleTemplateId): void => {
    if (rules.length >= RULES_MAX_RULES) {
      onToast(`A config accepts at most ${RULES_MAX_RULES} rules.`, 'error')
      return
    }
    const id = nextRuleId(rules)
    const next = ruleTemplate(kind, id, config)
    onChangeConfig({ ...config, rules: [...rules, next] })
    setSelectedId(id)
    setPreview(null)
    setFire(null)
    onToast(`${next.name} template added`, 'success')
  }

  const requestDelete = async (): Promise<void> => {
    if (!rule) return
    const ok = await confirm({
      title: 'Delete rule',
      message: `Delete “${rule.name}”?`,
      warning:
        'The trigger, conditions and referenced actions are removed. Rigs, profiles and pages are not touched. This cannot be undone.',
      confirmLabel: 'Delete rule',
      danger: true,
    })
    if (!ok) return
    const nextRules = rules.filter((item) => item.id !== rule.id)
    onChangeConfig(removeRuleFromConfig(config, rule.id))
    setSelectedId(nextRules[0]?.id ?? null)
    setPreview(null)
    setFire(null)
    onToast(`Rule “${rule.name}” deleted`, 'success')
  }

  const toggleArm = async (): Promise<void> => {
    setBusy('arm')
    try {
      const result = await window.phonedek.setAutomationEnabled(!armed)
      if (!result.ok) {
        onToast(result.error ?? 'Could not change automation arming.', 'error')
      } else {
        const next = await refresh()
        const nextArmed = next?.armed ?? !armed
        onToast(
          nextArmed ? 'Automation armed on this PC.' : 'Automation disarmed on this PC.',
          'success',
        )
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const addCondition = (): void => {
    if (!rule) return
    if ((rule.conditions?.length ?? 0) >= RULE_MAX_CONDITIONS) {
      onToast(`A rule accepts at most ${RULE_MAX_CONDITIONS} conditions.`, 'error')
      return
    }
    changeRule({ ...rule, conditions: [...(rule.conditions ?? []), { probe: 'obsStreaming' }] })
  }

  const addAction = (kind: RuleAction['kind']): void => {
    if (!rule) return
    if (rule.actions.length >= RULE_MAX_ACTIONS) {
      onToast(`A rule accepts at most ${RULE_MAX_ACTIONS} actions.`, 'error')
      return
    }
    if (kind === 'notice') {
      onToast('Phone notices are not available in this build.', 'info')
      return
    }
    changeRule({
      ...rule,
      actions: [...rule.actions, ruleActionDefaults(kind, config)],
    })
  }

  const updateAction = (index: number, next: RuleAction): void => {
    if (!rule) return
    changeRule({
      ...rule,
      actions: rule.actions.map((action, current) => (current === index ? next : action)),
    })
  }

  const removeAction = (index: number): void => {
    if (!rule) return
    if (rule.actions.length <= 1) {
      onToast('A rule needs at least one action. Change this row instead of removing it.', 'info')
      return
    }
    changeRule({ ...rule, actions: rule.actions.filter((_, current) => current !== index) })
  }

  const checkRule = async (): Promise<void> => {
    if (!rule) return
    setBusy('check')
    setFire(null)
    try {
      const result = await window.phonedek.previewRule(rule.id)
      setPreview(result)
      const reading = rulePreviewText(result)
      onToast(
        reading.detail,
        reading.tone === 'ok' ? 'success' : reading.tone === 'error' ? 'error' : 'info',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const fireRule = async (): Promise<void> => {
    if (!rule) return
    const blocker = ruleDraftErrors(rule, rules)[0]
    if (blocker) {
      onToast(blocker, 'error')
      return
    }
    if (rule.enabled === false) {
      onToast('Enable the rule before firing it.', 'info')
      return
    }
    const destructive = rule.actions
      .filter((action): action is Extract<RuleAction, { kind: 'runRig' }> => action.kind === 'runRig')
      .map((action) => rigsOf(config).find((rig) => rig.id === action.presetId))
      .filter((rig): rig is NonNullable<typeof rig> => rig !== undefined && rigHasDestructiveSteps(rig))
    if (destructive.length > 0) {
      const ok = await confirm({
        title: 'Fire rule now',
        message: `Run “${rule.name}” manually?`,
        details: destructive.map((rig) => `Destructive rig: ${rig.name}`),
        warning:
          'FIRE NOW bypasses debounce and cooldown but still evaluates conditions. Destructive rig steps cannot be rolled back.',
        confirmLabel: 'Fire now',
        danger: true,
      })
      if (!ok) return
    }
    setBusy('fire')
    setPreview(null)
    setFire(null)
    try {
      const result = await window.phonedek.fireRule(rule.id)
      setFire(result)
      await refresh()
      onToast(
        result.detail?.trim() ||
          `${rule.name}: ${result.status} · ${formatRuleDuration(result.durationMs)}`,
        result.ok ? 'success' : result.status === 'blocked' ? 'info' : 'error',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const clearHistory = async (): Promise<void> => {
    try {
      await window.phonedek.clearRuleHistory()
      await refresh()
      onToast('Run history cleared', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const actionMenu: MenuItem[] = [
    {
      label: 'Run rig',
      icon: 'bolt',
      description: 'Run one guarded rig from the Rig Library',
      onClick: () => addAction('runRig'),
    },
    {
      label: 'Show profile',
      icon: 'monitor',
      description: 'Switch every connected phone to a profile',
      onClick: () => addAction('showProfile'),
    },
    {
      label: 'Show page',
      icon: 'layers',
      description: 'Switch profile when needed, then open one page',
      onClick: () => addAction('showPage'),
    },
  ]

  const templateMenu: MenuItem[] = RULE_TEMPLATE_ORDER.map((kind) => ({
    label: ruleTemplate(kind, 'preview', config).name,
    onClick: () => addTemplate(kind),
  }))

  return (
    <Modal
      title="Automation"
      subtitle="Event rules for OBS, Twitch, processes and phones. Actions only reference rigs, profiles and pages."
      onClose={onClose}
      wide
      className="rig-modal"
      bodyClassName="rig-modal-body"
      footer={
        <>
          <span className="rig-footer-note mono">
            {rules.length}/{RULES_MAX_RULES} RULES · {liveSourceCount(view?.sources)} LIVE SOURCE
            {liveSourceCount(view?.sources) === 1 ? '' : 'S'} · CHANGES SAVE WITH THE DECK
          </span>
          <span className={`rule-footer-arm ${armed ? 'ok' : 'muted'} mono`}>
            {armed ? 'ARMED' : 'PAUSED'}
          </span>
          <button type="button" className="button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="rig-library rule-library">
        <div className={`rule-arm-banner${armed ? ' armed' : ''}`} role="status">
          <span className="rule-arm-icon" aria-hidden="true">
            <Icon name={armed ? 'bolt' : 'pause'} size={16} />
          </span>
          <div className="rule-arm-copy">
            <strong>{armed ? 'AUTOMATION ARMED ON THIS PC' : 'ARM AUTOMATION'}</strong>
            <p>
              {armed
                ? 'Rules fire when their trigger edge is observed. Disarm to keep the rule list but stop every automatic action immediately.'
                : 'Rules are saved but do not fire until automation is armed on this PC. Arming lets OBS, Twitch, process and phone edges run the referenced rigs and profile switches.'}
            </p>
          </div>
          <button
            type="button"
            className={`button small ${armed ? 'secondary' : 'primary'}`}
            onClick={() => void toggleArm()}
            disabled={busy === 'arm'}
          >
            {busy === 'arm' ? 'Saving…' : armed ? 'Disarm' : 'Arm automation'}
          </button>
        </div>

        <aside className="rig-rail" aria-label="Automation rules">
          <div className="rig-rail-head">
            <span className="rig-kicker">RULES</span>
            <span className="mono">
              {enabledRuleCount(rules)}/{rules.length || 0}
            </span>
          </div>
          <div className="rig-rail-list">
            {rules.length === 0 && (
              <p className="rig-rail-empty">
                No rules yet. Start from a template or build one from scratch.
              </p>
            )}
            {rules.map((item) => {
              const reading = ruleStatusText(statusById.get(item.id), armed)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`rig-rail-item${item.id === rule?.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span
                    className={`rig-dot ${item.enabled === false ? 'rule-dot-off' : TONE_CLASS[reading.tone]}`}
                    aria-label={item.enabled === false ? 'Disabled' : 'Enabled'}
                  />
                  <span className="rig-rail-text">
                    <strong>{item.name}</strong>
                    <small>{ruleTriggerLabel(item.trigger)}</small>
                  </span>
                  <span className="rig-rail-meta">
                    <span className={`rig-rail-status ${TONE_CLASS[reading.tone]}`}>
                      {reading.label}
                    </span>
                    <span className="mono">{reading.age}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="add-row rig-new"
            onClick={addRule}
            disabled={rules.length >= RULES_MAX_RULES}
          >
            <Icon name="plus" size={15} /> New rule
          </button>
          <PopMenu
            align="left"
            width={260}
            trigger={
              <button
                type="button"
                className="add-row subtle"
                disabled={rules.length >= RULES_MAX_RULES}
              >
                <Icon name="copy" size={15} /> From template
              </button>
            }
            items={templateMenu}
          />
          <div className="rule-rail-note mono">DESKTOP-OWNED · HISTORY IN MEMORY</div>
        </aside>

        <section className="rig-detail" aria-label={rule ? rule.name : 'Rule templates'}>
          {!rule ? (
            <div className="rig-empty">
              <span className="rig-kicker">NO AUTOMATION RULE</span>
              <h3>React to OBS, Twitch, a process or a phone</h3>
              <p>
                A rule watches one edge, checks up to four conditions, then runs referenced rigs,
                profile switches or page switches in order. Start with a template and replace the
                generic target with your own.
              </p>
              <div className="rig-templates rule-templates">
                {RULE_TEMPLATE_ORDER.map((kind) => {
                  const template = ruleTemplate(kind, 'preview', config)
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="rig-template"
                      onClick={() => addTemplate(kind)}
                    >
                      <span className="rig-template-icon">{TEMPLATE_ICON[kind]}</span>
                      <strong>{template.name}</strong>
                      <small>{ruleTemplateDescription(kind)}</small>
                      <span className="rig-template-meta mono">
                        {triggerSourceName(template.trigger)} · {template.actions.length} ACTION
                        {template.actions.length === 1 ? '' : 'S'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" className="button secondary" onClick={addRule}>
                <Icon name="plus" size={15} /> Blank rule
              </button>
            </div>
          ) : (
            <>
              <header className="rig-detail-head">
                <div className="rig-identity">
                  <span className="rig-icon" aria-hidden="true">
                    ⚡
                  </span>
                  <div>
                    <span className="rig-kicker">
                      RULE {pad(rules.findIndex((item) => item.id === rule.id) + 1)} / {pad(rules.length)}
                    </span>
                    <h3>{rule.name}</h3>
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
                  <span className="rig-estimate mono">
                    {triggerSourceName(rule.trigger)} · {rule.actions.length} ACTION
                    {rule.actions.length === 1 ? '' : 'S'}
                  </span>
                  <button
                    type="button"
                    className="button danger ghost small"
                    onClick={() => void requestDelete()}
                  >
                    <Icon name="trash" size={14} /> Delete rule
                  </button>
                </div>
              </header>

              <SourceStrip view={view} />

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
                  <div className="rule-identity-grid">
                    <label className="field">
                      <span>Name</span>
                      <CommitInput
                        value={rule.name}
                        maxLength={60}
                        ariaLabel="Rule name"
                        onCommit={(name) => changeRule({ ...rule, name })}
                      />
                    </label>
                    <Toggle
                      label="Rule enabled"
                      description="Switch off to keep the rule but never match it."
                      checked={rule.enabled !== false}
                      onChange={(enabled) => changeRule({ ...rule, enabled })}
                    />
                  </div>
                  <p className="rule-readout mono">
                    ID {rule.id} · EDGE {ruleEdgeKey(rule.trigger)} · {ruleTriggerLabel(rule.trigger)}
                  </p>
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
                      <em>01</em> When
                    </h4>
                    <span className="rig-count mono">{triggerSourceName(rule.trigger)}</span>
                  </div>
                  <p className="hint">
                    Rules fire on an edge, not a level. The first observation after arming or
                    reconnecting is a silent baseline, so restarting the app never fires anything.
                  </p>
                  <div className="rule-when-grid">
                    <label className="field">
                      <span>Event</span>
                      <select
                        value={triggerOptionId(rule.trigger)}
                        aria-label="Rule trigger"
                        onChange={(event) =>
                          changeRule({
                            ...rule,
                            trigger: triggerFromOption(
                              event.target.value as Parameters<typeof triggerFromOption>[0],
                              rule.trigger,
                            ),
                          })
                        }
                      >
                        {ruleTriggerOptionsFor(rule.trigger).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.group} · {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isBooleanTrigger(rule.trigger) && (
                      <div className="rule-when-value">
                        <span className="rig-kicker">VALUE</span>
                        <span className="mono">
                          {rule.trigger.kind} = {rule.trigger.active ? 'true' : 'false'}
                        </span>
                      </div>
                    )}
                    {rule.trigger.kind === 'obs.scene' && (
                      <label className="field">
                        <span>Scene name</span>
                        <CommitInput
                          value={rule.trigger.scene}
                          maxLength={120}
                          placeholder="Gameplay"
                          ariaLabel="OBS scene name"
                          onCommit={(scene) =>
                            changeRule({ ...rule, trigger: { kind: 'obs.scene', scene } })
                          }
                        />
                      </label>
                    )}
                    {(rule.trigger.kind === 'process.started' ||
                      rule.trigger.kind === 'process.stopped') && (
                      <ProcessTriggerField
                        process={rule.trigger.process}
                        onChange={(process) =>
                          changeRule({
                            ...rule,
                            trigger: { kind: rule.trigger.kind, process } as EventTrigger,
                          })
                        }
                      />
                    )}
                  </div>
                  {rule.trigger.kind === 'obs.scene' && (
                    <p className="hint">
                      Must match the OBS scene name exactly. No scene-list API is available yet, so
                      this is free text.
                    </p>
                  )}
                  {rule.trigger.kind === 'twitch.live' && (
                    <p className="hint">
                      Twitch live polling can lag 30–90 s. Use OBS as the fast trigger and keep this
                      as a backstop with a cooldown of at least 120 s.
                    </p>
                  )}
                  {rule.trigger.kind.startsWith('process.') && (
                    <p className="hint">
                      Process names are compared as basenames, case-insensitively, without .exe.
                      There is no running-app list here; type the executable name.
                    </p>
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>02</em> Only if
                      <span className="rig-count mono">
                        {rule.conditions?.length ?? 0}/{RULE_MAX_CONDITIONS}
                      </span>
                    </h4>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={addCondition}
                      disabled={(rule.conditions?.length ?? 0) >= RULE_MAX_CONDITIONS}
                    >
                      <Icon name="plus" size={14} /> Add condition
                    </button>
                  </div>
                  <p className="hint">
                    Every condition must match before the first action. The same probes as the Rig
                    Library are used; unavailable probes fail closed.
                  </p>
                  {(rule.conditions?.length ?? 0) === 0 ? (
                    <div className="rig-section-empty">
                      No conditions — the trigger alone runs the actions.
                    </div>
                  ) : (
                    <GuardRows
                      guards={rule.conditions ?? []}
                      lights={lights}
                      onChange={(conditions) =>
                        changeRule({ ...rule, conditions: conditions.length > 0 ? conditions : undefined })
                      }
                    />
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>03</em> Do
                      <span className="rig-count mono">
                        {rule.actions.length}/{RULE_MAX_ACTIONS}
                      </span>
                    </h4>
                    {rule.actions.length >= RULE_MAX_ACTIONS ? (
                      <span className="hint">Action limit reached</span>
                    ) : (
                      <PopMenu
                        align="right"
                        width={300}
                        trigger={
                          <button type="button" className="button secondary small">
                            <Icon name="plus" size={14} /> Add action
                          </button>
                        }
                        items={actionMenu}
                      />
                    )}
                  </div>
                  <p className="hint">
                    Actions run in order and are awaited. A rule can only reference an existing rig,
                    profile or page; it never contains its own command, launch or key step.
                  </p>
                  <div className="rule-action-list">
                    {rule.actions.map((action, index) => {
                      const target = ruleActionTarget(action, config)
                      const actionIssues = issues.filter((issue) => issue.actionIndex === index)
                      const profile =
                        action.kind === 'showProfile' || action.kind === 'showPage'
                          ? config.profiles.find((candidate) => candidate.id === action.profileId)
                          : undefined
                      return (
                        <div
                          className={`rule-action-row${actionIssues.length > 0 ? ' missing' : ''}`}
                          key={`${action.kind}-${index}`}
                        >
                          <span className="rig-row-index mono">{pad(index + 1)}</span>
                          <div className="rule-action-main">
                            <div className="rule-action-controls">
                              <label className="field">
                                <span>Action</span>
                                <select
                                  value={action.kind}
                                  aria-label={`Action ${index + 1} kind`}
                                  onChange={(event) =>
                                    updateAction(
                                      index,
                                      ruleActionFromKind(
                                        event.target.value as Exclude<RuleAction['kind'], 'notice'>,
                                        action,
                                        config,
                                      ),
                                    )
                                  }
                                >
                                  {RULE_EDITABLE_ACTION_KINDS.map((kind) => (
                                    <option key={kind} value={kind}>
                                      {RULE_ACTION_KIND_LABELS[kind]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {action.kind === 'runRig' && (
                                <button
                                  type="button"
                                  className={`rule-target-pick${target.missing ? ' missing' : ''}`}
                                  onClick={() => setRigPickerIndex(index)}
                                  title="Pick a rig"
                                >
                                  <span className="rig-kicker">RIG</span>
                                  <strong>{target.text}</strong>
                                  <Icon name="chevron-right" size={14} />
                                </button>
                              )}
                              {action.kind === 'showProfile' && (
                                <label className="field">
                                  <span>Profile</span>
                                  <select
                                    value={action.profileId}
                                    aria-label={`Action ${index + 1} profile`}
                                    onChange={(event) =>
                                      updateAction(index, {
                                        kind: 'showProfile',
                                        profileId: event.target.value,
                                      })
                                    }
                                  >
                                    {config.profiles.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name}
                                      </option>
                                    ))}
                                    {!config.profiles.some((item) => item.id === action.profileId) && (
                                      <option value={action.profileId}>
                                        {action.profileId} (missing)
                                      </option>
                                    )}
                                  </select>
                                </label>
                              )}
                              {action.kind === 'showPage' && (
                                <>
                                  <label className="field">
                                    <span>Profile</span>
                                    <select
                                      value={action.profileId}
                                      aria-label={`Action ${index + 1} profile`}
                                      onChange={(event) => {
                                        const nextProfile = config.profiles.find(
                                          (item) => item.id === event.target.value,
                                        )
                                        updateAction(index, {
                                          kind: 'showPage',
                                          profileId: event.target.value,
                                          pageId: nextProfile?.pages[0]?.id ?? action.pageId,
                                        })
                                      }}
                                    >
                                      {config.profiles.map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.name}
                                        </option>
                                      ))}
                                      {!config.profiles.some((item) => item.id === action.profileId) && (
                                        <option value={action.profileId}>
                                          {action.profileId} (missing)
                                        </option>
                                      )}
                                    </select>
                                  </label>
                                  <label className="field">
                                    <span>Page</span>
                                    <select
                                      value={action.pageId}
                                      aria-label={`Action ${index + 1} page`}
                                      onChange={(event) =>
                                        updateAction(index, {
                                          kind: 'showPage',
                                          profileId: action.profileId,
                                          pageId: event.target.value,
                                        })
                                      }
                                    >
                                      {(profile?.pages ?? []).map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.name}
                                        </option>
                                      ))}
                                      {profile &&
                                        !profile.pages.some((item) => item.id === action.pageId) && (
                                          <option value={action.pageId}>
                                            {action.pageId} (missing)
                                          </option>
                                        )}
                                    </select>
                                  </label>
                                </>
                              )}
                            </div>
                            <span className="rule-action-summary mono">
                              {ruleActionLabel(action, config)}
                            </span>
                            {actionIssues.length > 0 && (
                              <span className="rule-action-missing">
                                {actionIssues.map((issue) => issue.message).join(' ')} Pick another
                                target or delete the row.
                              </span>
                            )}
                          </div>
                          <div className="rule-action-buttons">
                            <button
                              type="button"
                              className="icon-button tiny rule-move-button"
                              aria-label={`Move action ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() =>
                                changeRule({ ...rule, actions: moveRuleAction(rule.actions, index, -1) })
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="icon-button tiny rule-move-button"
                              aria-label={`Move action ${index + 1} down`}
                              disabled={index === rule.actions.length - 1}
                              onClick={() =>
                                changeRule({ ...rule, actions: moveRuleAction(rule.actions, index, 1) })
                              }
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="icon-button tiny danger"
                              aria-label={`Remove action ${index + 1}`}
                              onClick={() => removeAction(index)}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {issues.length > 0 && (
                    <p className="rule-action-warning">
                      {issues.length} referenced target{issues.length === 1 ? '' : 's'} no longer
                      exist. The rule stays saved but the runtime records it as missing and runs
                      nothing.
                    </p>
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>04</em> Timing
                    </h4>
                  </div>
                  <div className="rule-timing-grid">
                    <NumberField
                      label="Debounce"
                      value={rule.debounceMs ?? RULE_DEBOUNCE_DEFAULT_MS}
                      min={0}
                      max={RULE_DEBOUNCE_MAX_MS}
                      step={100}
                      suffix="ms"
                      onChange={(debounceMs) => changeRule({ ...rule, debounceMs })}
                    />
                    <NumberField
                      label="Cooldown"
                      value={rule.cooldownMs ?? RULE_COOLDOWN_DEFAULT_MS}
                      min={0}
                      max={RULE_COOLDOWN_MAX_MS}
                      step={1_000}
                      suffix="ms"
                      onChange={(cooldownMs) => changeRule({ ...rule, cooldownMs })}
                    />
                    <label className="field">
                      <span>When a rig is busy</span>
                      <select
                        value={rule.onBusy ?? 'skip'}
                        onChange={(event) =>
                          changeRule({
                            ...rule,
                            onBusy: event.target.value === 'continue' ? 'continue' : 'skip',
                          })
                        }
                      >
                        <option value="skip">Skip the rest</option>
                        <option value="continue">Run non-rig actions</option>
                      </select>
                    </label>
                  </div>
                  <p className="hint">
                    Debounce waits for the edge to settle. Cooldown is the minimum gap between two
                    fires of this rule. OBS reacts within a second; Twitch can lag 60 s. Busy rigs
                    are never queued.
                  </p>
                </section>

                <section className="rig-section rig-preflight">
                  <div className="rig-section-head">
                    <h4>
                      <em>05</em> Check / fire
                    </h4>
                    <span className={`rig-run-token ${TONE_CLASS[currentReading.tone]} mono`}>
                      {busy === 'fire' ? 'FIRING' : currentReading.label}
                    </span>
                  </div>
                  <div className="rig-runbar">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void checkRule()}
                      disabled={busy !== null}
                    >
                      <Icon name={busy === 'check' ? 'refresh' : 'check'} size={15} />{' '}
                      {busy === 'check' ? 'Checking…' : 'Check'}
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => void fireRule()}
                      disabled={busy !== null || rule.enabled === false || errors.length > 0}
                    >
                      <Icon name="play" size={15} />{' '}
                      {busy === 'fire' ? 'Firing…' : 'Fire now'}
                    </button>
                    <span className="rig-estimate mono">
                      {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'} · debounce{' '}
                      {formatRuleDuration(rule.debounceMs ?? RULE_DEBOUNCE_DEFAULT_MS)}
                    </span>
                  </div>
                  <p className="hint">
                    Check evaluates conditions and reference targets without running anything. Fire
                    now bypasses debounce and cooldown, still evaluates conditions, and is recorded
                    as MANUAL in history.
                  </p>

                  {preview && (() => {
                    const reading = rulePreviewText(preview)
                    return (
                      <div className={`rig-report ${TONE_CLASS[reading.tone]}`}>
                        <div className="rig-report-head">
                          <span className={`rig-dot ${TONE_CLASS[reading.tone]}`} />
                          <strong>{reading.label}</strong>
                          <span className="mono">
                            {preview.blocked.length} BLOCKED · {preview.missing.length} MISSING
                          </span>
                        </div>
                        <p className="rig-report-message">{reading.detail}</p>
                        {preview.blocked.length > 0 && (
                          <ul className="rig-guard-results">
                            {preview.blocked.map((guard, index) => (
                              <li className="rig-guard-result warn" key={`${guard.probe}-${index}`}>
                                <span className="rig-dot warn" />
                                <span className="rig-guard-result-text">
                                  <strong>{guard.label}</strong>
                                  <small>
                                    expected {guard.expect ? 'ON' : 'OFF'} · actual{' '}
                                    {guard.actual === null ? 'UNKNOWN' : guard.actual ? 'ON' : 'OFF'}
                                    {guard.error ? ` · ${guard.error}` : ''}
                                  </small>
                                </span>
                                <span className="mono">BLOCKED</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {preview.missing.length > 0 && (
                          <p className="rig-report-error">{preview.missing.join(' · ')}</p>
                        )}
                        {preview.reason && (
                          <p className="hint mono">REASON · {preview.reason.toUpperCase()}</p>
                        )}
                      </div>
                    )
                  })()}

                  {fire && (
                    <div className={`rig-report run ${TONE_CLASS[ruleRunStatusTone(fire.status)]}`}>
                      <div className="rig-report-head">
                        <span className={`rig-dot ${TONE_CLASS[ruleRunStatusTone(fire.status)]}`} />
                        <strong>{ruleRunStatusLabel(fire.status)}</strong>
                        <span className="mono">
                          {fire.actions.length} ACTION{fire.actions.length === 1 ? '' : 'S'} ·{' '}
                          {formatRuleDuration(fire.durationMs)} · {fire.source.toUpperCase()}
                        </span>
                      </div>
                      <p className="rig-report-message">
                        {fire.detail?.trim() ||
                          (fire.ok
                            ? `“${fire.ruleName}” completed.`
                            : `“${fire.ruleName}” ended ${fire.status}.`)}
                      </p>
                      {fire.actions.length > 0 && (
                        <ul className="rule-outcomes">
                          {fire.actions.map((outcome, index) => (
                            <li key={`${outcome.kind}-${index}`} className={outcome.ok ? 'ok' : 'error'}>
                              <span className="mono">{pad(index + 1)}</span>
                              <span>{ruleOutcomeLabel(outcome)}</span>
                              {outcome.message && <small>{outcome.message}</small>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>

                <section className="rig-section">
                  <div className="rig-section-head">
                    <h4>
                      <em>06</em> History
                      <span className="rig-count mono">{history.length}</span>
                    </h4>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void clearHistory()}
                      disabled={history.length === 0}
                    >
                      <Icon name="trash" size={13} /> Clear
                    </button>
                  </div>
                  <p className="hint">
                    Newest first, capped in memory. Restarting the desktop clears it; nothing here
                    is written to the config or a backup.
                  </p>
                  {history.length === 0 ? (
                    <div className="rig-section-empty">No runs yet.</div>
                  ) : (
                    <div className="rule-history">
                      {history.map((entry) => {
                        const tone = ruleRunStatusTone(entry.status)
                        return (
                          <div className="rule-history-row" key={`${entry.seq}-${entry.at}`}>
                            <span className="rule-history-time mono">
                              {formatRigRunAge(entry.at)}
                            </span>
                            <span className="rule-history-rule">
                              <strong>{entry.ruleName}</strong>
                              <small>
                                {entry.trigger} · {entry.source.toUpperCase()}
                              </small>
                            </span>
                            <span className={`rule-history-status ${TONE_CLASS[tone]}`}>
                              {ruleRunStatusLabel(entry.status)}
                            </span>
                            <span className="rule-history-duration mono">
                              {formatRuleDuration(entry.durationMs)}
                            </span>
                            <span className="rule-history-detail">
                              {ruleHistoryDetail(entry)}
                              {entry.actions.length > 0 && (
                                <small>{entry.actions.map(ruleOutcomeLabel).join(' · ')}</small>
                              )}
                            </span>
                            <span className="rule-history-actions mono">
                              {ruleHistorySummary(entry)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </section>
      </div>

      {rigPickerIndex !== null && rule && (
        <RigPickerDialog
          config={config}
          title="Pick a rig"
          subtitle="The rule will run this guarded sequence when it fires. Nothing runs now."
          onPick={(rig) => {
            updateAction(rigPickerIndex, { kind: 'runRig', presetId: rig.id })
            setRigPickerIndex(null)
          }}
          onClose={() => setRigPickerIndex(null)}
          onOpenLibrary={() => {
            setRigPickerIndex(null)
            if (onOpenRigs) onOpenRigs()
            else onToast('Manage rigs from the sidebar · 04 Rigs.', 'info')
          }}
        />
      )}
    </Modal>
  )
}
