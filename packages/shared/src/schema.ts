import { z } from 'zod'
import {
  CONFIG_SCHEMA_VERSION,
  RIG_MAX_DEADLINE_MS,
  RIG_MAX_GUARDS,
  RIG_MAX_PRESETS,
  RIG_MAX_SERIALIZED_BYTES,
  RIG_MAX_STEPS,
  RIG_MAX_STEP_DELAY_MS,
  RULE_COOLDOWN_MAX_MS,
  RULE_DEBOUNCE_MAX_MS,
  RULE_MAX_ACTIONS,
  RULE_MAX_CONDITIONS,
  RULE_MAX_NAME,
  RULE_MAX_NOTICE,
  RULE_MAX_PROCESS,
  RULE_MAX_SCENE,
  RULE_MAX_SERIALIZED_BYTES,
  RULES_MAX_RULES,
  STREAMERBOT_MAX_ACTION_NAME,
  STREAMERBOT_MAX_ARGS,
  STREAMERBOT_MAX_ARG_KEY,
  STREAMERBOT_MAX_ARG_VALUE,
  type AppVolumeAction,
  type ConfigAction,
  type DeckConfig,
  type ScrollModifier,
  type StateBinding,
  type StreamerBotAction,
} from './types'
import { MODIFIER_KEYS, isModifier, isValidKeyName, normalizeCombo, normalizeKey } from './keys'
import { isImageAssetName, isVideoAssetName } from './media'

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Expected a hex color like #12aBef')

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'IDs may only contain letters, digits, "-" and "_"')

const assetName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid asset name')

const imageAssetName = assetName.refine(
  isImageAssetName,
  'Expected an image asset (.png, .jpg, .jpeg, .webp, .gif or .bmp)',
)
const videoAssetName = assetName.refine(
  isVideoAssetName,
  'Expected a video asset (.mp4, .webm, .m4v or .mov)',
)

const overlay = z.number().min(0).max(0.95).optional()

export const BackgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('color'), color: hexColor, overlay }),
  z.object({
    type: z.literal('gradient'),
    from: hexColor,
    to: hexColor,
    angle: z.number().min(0).max(360).optional(),
    overlay,
  }),
  z.object({
    type: z.literal('image'),
    asset: imageAssetName,
    fit: z.enum(['cover', 'contain']),
    overlay,
  }),
  z.object({
    type: z.literal('video'),
    asset: videoAssetName,
    fit: z.enum(['cover', 'contain']),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    overlay,
  }),
])

export const MediaIconSchema = z
  .object({
    type: z.enum(['image', 'video']),
    asset: assetName,
    fit: z.enum(['cover', 'contain']),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const valid = value.type === 'video' ? isVideoAssetName(value.asset) : isImageAssetName(value.asset)
    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asset'],
        message:
          value.type === 'video'
            ? 'Expected a video asset (.mp4, .webm, .m4v or .mov)'
            : 'Expected an image asset (.png, .jpg, .jpeg, .webp, .gif or .bmp)',
      })
    }
  })

const keys = z
  .array(z.string().min(1).max(24))
  .min(1, 'A shortcut needs at least one key')
  .max(8)
  .superRefine((value, ctx) => {
    for (const key of value) {
      if (!isValidKeyName(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown key name: ${key}` })
      }
    }
    try {
      normalizeCombo(value)
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message })
    }
  })

const holdMs = z.number().int().min(0).max(5000).optional()
const perCharMs = z.number().int().min(0).max(1000).optional()

/** Shortcut chords use the same key validation as hotkeys. */
const shortcutBindingSchema = z.object({
  type: z.literal('shortcut'),
  keys,
  reverseKeys: keys.optional(),
  holdKeys: keys.optional(),
  repeat: z.number().int().min(1, 'repeat must be between 1 and 5').max(5, 'repeat must be between 1 and 5').optional(),
  travelSteps: z
    .number()
    .int()
    .min(4, 'travelSteps must be between 4 and 100')
    .max(100, 'travelSteps must be between 4 and 100')
    .optional(),
})
const mediaKey = z.enum(['playpause', 'next', 'prev', 'stop', 'volumeup', 'volumedown', 'mute'])

const hotkeySchema = z.object({
  type: z.literal('hotkey'),
  keys,
  holdMs,
  action: z.enum(['press', 'down', 'up']).optional(),
})
const textSchema = z.object({ type: z.literal('text'), text: z.string().max(10_000), perCharMs })
const delaySchema = z.object({ type: z.literal('delay'), ms: z.number().int().min(0).max(60_000) })
const mediaSchema = z.object({ type: z.literal('media'), key: mediaKey })
const mouseSchema = z.object({
  type: z.literal('mouse'),
  button: z.enum(['left', 'right', 'middle']),
  action: z.enum(['click', 'doubleclick', 'down', 'up', 'move', 'scroll']),
  x: z.number().int().min(-100_000).max(100_000).optional(),
  y: z.number().int().min(-100_000).max(100_000).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().int().min(1).max(100).optional(),
})
const launchSchema = z.object({
  type: z.literal('launch'),
  path: z.string().min(1).max(4096),
  args: z.array(z.string().max(2048)).max(32).optional(),
})
const urlSchema = z.object({ type: z.literal('url'), url: z.string().min(1).max(2048) })
const commandSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1).max(4000),
  cwd: z.string().max(4096).optional(),
  hidden: z.boolean().optional(),
})
const pageSchema = z.object({
  type: z.literal('page'),
  direction: z.enum(['next', 'prev', 'goto']),
  pageId: id.optional(),
})
const micSchema = z.object({
  type: z.literal('mic'),
  action: z.literal('toggleMute'),
})
/** OBS names (input, scene, source, marker) are user-defined, max 128 chars. */
const obsName = z.string().min(1).max(128)
const obsSchema = z.union([
  z.object({ type: z.literal('obs'), action: z.literal('toggleMute'), input: obsName.optional() }),
  z.object({ type: z.literal('obs'), action: z.literal('setScene'), scene: obsName.optional() }),
  z.object({
    type: z.literal('obs'),
    action: z.enum(['toggleStream', 'startStream', 'stopStream']),
  }),
  z.object({
    type: z.literal('obs'),
    action: z.enum(['toggleRecord', 'startRecord', 'stopRecord']),
  }),
  z.object({
    type: z.literal('obs'),
    action: z.enum(['startReplay', 'stopReplay', 'toggleReplay', 'saveReplay']),
  }),
  z.object({ type: z.literal('obs'), action: z.literal('toggleVirtualCam') }),
  z.object({
    type: z.literal('obs'),
    action: z.literal('setSourceVisibility'),
    scene: obsName.optional(),
    source: obsName,
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal('obs'),
    action: z.literal('toggleSourceVisibility'),
    scene: obsName.optional(),
    source: obsName,
  }),
  z.object({ type: z.literal('obs'), action: z.literal('addMarker'), name: obsName.optional() }),
])

/** Twitch text limits: chat 500, marker 140, stream title 140, category 100. */
const twitchChat = z
  .string()
  .max(500, 'Twitch chat messages are limited to 500 characters')
  .refine((value) => value.trim().length > 0, 'Twitch chat message cannot be empty')
const twitchTitle = z
  .string()
  .max(140, 'Twitch stream titles are limited to 140 characters')
  .refine((value) => value.trim().length > 0, 'Twitch stream title cannot be empty')
const twitchGame = z
  .string()
  .max(100, 'Twitch category names are limited to 100 characters')
  .refine((value) => value.trim().length > 0, 'Twitch category cannot be empty')
const twitchMarkerDescription = z
  .string()
  .max(140, 'Twitch marker descriptions are limited to 140 characters')

const twitchSchema = z.union([
  z.object({ type: z.literal('twitch'), action: z.literal('sendChat'), message: twitchChat }),
  z.object({
    type: z.literal('twitch'),
    action: z.literal('createMarker'),
    description: twitchMarkerDescription.optional(),
  }),
  z.object({ type: z.literal('twitch'), action: z.literal('setTitle'), title: twitchTitle }),
  z.object({ type: z.literal('twitch'), action: z.literal('setGame'), game: twitchGame }),
])

/** Local-light device id reference; omitted = the first configured light. */
const lightRef = id.optional()
const lightTarget = z.enum(['power', 'brightness', 'temperature'])

const lightSchema = z.union([
  z.object({
    type: z.literal('light'),
    action: z.literal('setPower'),
    light: lightRef,
    on: z.boolean(),
  }),
  z.object({
    type: z.literal('light'),
    action: z.literal('togglePower'),
    light: lightRef,
  }),
])

/** Phone-local launcher; no desktop executor plan step. */
const keyboardSchema = z.object({
  type: z.literal('keyboard'),
  action: z.literal('open'),
})

/** Phone-local per-app mixer launcher. */
const mixerLauncherSchema = z.object({
  type: z.literal('mixer'),
  action: z.literal('open'),
})

/**
 * Streamer.bot action invocation. The action itself is user-configured:
 * `actionName` must match an existing Streamer.bot action, and `args` is a small
 * string map exposed there as `%key%`. Only the desktop config supplies them.
 */
const streamerBotArgValue = z.string().max(STREAMERBOT_MAX_ARG_VALUE)
const streamerBotArgs = z
  .record(z.string().min(1).max(STREAMERBOT_MAX_ARG_KEY), streamerBotArgValue)
  .superRefine((value, ctx) => {
    const keys = Object.keys(value)
    if (keys.length > STREAMERBOT_MAX_ARGS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Streamer.bot actions accept at most ${STREAMERBOT_MAX_ARGS} arguments`,
      })
    }
    for (const key of keys) {
      if (key.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Streamer.bot argument names cannot be blank',
        })
      }
    }
  })
const streamerBotSchema = z.object({
  type: z.literal('streamerbot'),
  action: z.literal('doAction'),
  actionName: z
    .string()
    .max(
      STREAMERBOT_MAX_ACTION_NAME,
      `Streamer.bot action names are limited to ${STREAMERBOT_MAX_ACTION_NAME} characters`,
    )
    .refine((value) => value.trim().length > 0, 'Streamer.bot action name cannot be empty'),
  args: streamerBotArgs.optional(),
})

/** Per-app audio session selector; `.exe`, case and path are normalized. */
const appVolumeMatch = z
  .object({
    process: z.string().min(1).max(128).optional(),
  })
  .strict()
const appVolumeSchema = z.union([
  z.object({
    type: z.literal('appVolume'),
    action: z.literal('setMute'),
    match: appVolumeMatch,
    muted: z.boolean(),
  }),
  z.object({
    type: z.literal('appVolume'),
    action: z.literal('toggleMute'),
    match: appVolumeMatch,
  }),
])

/**
 * Config-owned PC audio endpoint reference.
 *
 * Ids are opaque host keys (letters/digits/`-`/`_`), never endpoint paths, so
 * there is no reference-to-device check at config time: the target is resolved
 * against the live host enumeration when the action runs. At least one of `id`
 * or `name` is required; `name` is the fallback after a driver reinstall.
 */
const audioDeviceId = z
  .string()
  .min(1)
  .max(128, 'Device ids are limited to 128 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Device ids are opaque host keys')

const audioDeviceName = z
  .string()
  .min(1)
  .max(120, 'Device names are limited to 120 characters')
  .refine((value) => value.trim().length > 0, 'Device names cannot be blank')

export const audioDeviceRefSchema = z
  .object({
    id: audioDeviceId.optional(),
    name: audioDeviceName.optional(),
  })
  .strict()
  .superRefine((ref, ctx) => {
    if (ref.id === undefined && ref.name === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A device needs an id or a name',
      })
    }
  })

/**
 * Normalization used only to reject duplicate cycle targets. It matches the
 * desktop's later name-fallback comparison: NFKC, trim, collapse whitespace and
 * lowercase. Parentheses are deliberate and preserved (`Speakers (Realtek)`).
 */
export function normalizeAudioDeviceName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * `set` carries exactly one `device`; `cycle` carries an ordered 2..8 list and
 * no singular target. Wrong-field combinations are schema errors so a broken
 * config never reaches the executor.
 */
export const AudioDeviceActionSchema = z
  .object({
    type: z.literal('audioDevice'),
    action: z.enum(['set', 'cycle']),
    kind: z.enum(['output', 'input']),
    device: audioDeviceRefSchema.optional(),
    devices: z.array(audioDeviceRefSchema).max(8, 'A cycle accepts at most 8 devices').optional(),
    allRoles: z.boolean().optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (action.action === 'set') {
      if (!action.device) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['device'],
          message: 'set requires a device',
        })
      }
      if (action.devices !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices'],
          message: 'set must not carry devices',
        })
      }
      return
    }

    if (!action.devices || action.devices.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['devices'],
        message: 'cycle needs 2..8 devices',
      })
    }
    if (action.device !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['device'],
        message: 'cycle must not carry device',
      })
    }

    // Duplicate refs would let a cycle land on the same endpoint twice.
    const keys = new Set<string>()
    for (const [index, ref] of (action.devices ?? []).entries()) {
      const key =
        ref.id !== undefined
          ? `id:${ref.id.toLowerCase()}`
          : `name:${normalizeAudioDeviceName(ref.name ?? '')}`
      if (keys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices', index],
          message: 'Duplicate device',
        })
      }
      keys.add(key)
    }
  })

/**
 * Read-only current-default tile. `device` is optional: omitted = a generic
 * Output/Input readout; present = active only while that target is current.
 */
export const AudioDeviceStateBindingSchema = z
  .object({
    type: z.literal('audioDevice'),
    target: z.enum(['output', 'input']),
    device: audioDeviceRefSchema.optional(),
  })
  .strict()

export const MacroStepSchema = z.discriminatedUnion('type', [
  hotkeySchema,
  textSchema,
  delaySchema,
  mediaSchema,
  mouseSchema,
  launchSchema,
  urlSchema,
  commandSchema,
])

/** Start one configured rig. Only the desktop can resolve `presetId`. */
export const rigRunSchema = z.object({
  type: z.literal('rig'),
  action: z.literal('run'),
  presetId: id,
})

const macroSchema = z.object({
  type: z.literal('macro'),
  steps: z.array(MacroStepSchema).max(300),
  repeat: z.number().int().min(1).max(50).optional(),
  repeatDelayMs: z.number().int().min(0).max(60_000).optional(),
})

/**
 * Runtime union accepts `rig.run` and `audioDevice`, but its static output
 * deliberately stays the pre-rig wired union. Old desktop/renderer code passes
 * parsed actions into APIs typed with `ConfigAction`, so widening here would
 * break P0's "old code still compiles" rule. P1/P3 widen those consumers, then
 * this annotation is removed. Inspect staged arms structurally via
 * `rigActionOf`/`isRigRunAction` or the action's `type`.
 */
export const ActionSchema = z.union([
  hotkeySchema,
  textSchema,
  macroSchema,
  launchSchema,
  urlSchema,
  commandSchema,
  mediaSchema,
  delaySchema,
  pageSchema,
  micSchema,
  obsSchema,
  twitchSchema,
  lightSchema,
  appVolumeSchema,
  keyboardSchema,
  mixerLauncherSchema,
  streamerBotSchema,
  rigRunSchema,
  AudioDeviceActionSchema,
]) as unknown as z.ZodType<ConfigAction | AppVolumeAction | StreamerBotAction>

/* ------------------------------------------------------------------ */
/* Rig presets                                                          */
/* ------------------------------------------------------------------ */

/**
 * Host actions allowed inside a rig step. Explicitly excludes `page`,
 * `keyboard`, `mixer` and `rig`, so a step cannot navigate the phone, open a
 * phone-local panel, or nest another rig. `audioDevice` is included at runtime
 * (so a "Streaming" rig can switch the interface + mic); the static
 * `RigStepAction` stays narrow until the editor's rig-step picker widens in P3.
 */
const rigStepActionSchema = z.union([
  hotkeySchema,
  textSchema,
  macroSchema,
  launchSchema,
  urlSchema,
  commandSchema,
  mediaSchema,
  delaySchema,
  micSchema,
  obsSchema,
  twitchSchema,
  lightSchema,
  appVolumeSchema,
  streamerBotSchema,
  AudioDeviceActionSchema,
])

const rigGuardArg = z.string().min(1).max(260)
export const rigGuardSchema = z
  .object({
    probe: z.enum(['obsStreaming', 'obsRecording', 'twitchLive', 'micMuted', 'appRunning', 'lightOn']),
    expect: z.boolean().optional(),
    arg: rigGuardArg.optional(),
    label: z.string().min(1).max(60).optional(),
  })
  .superRefine((guard, ctx) => {
    if (guard.probe === 'appRunning') {
      if (guard.arg === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['arg'],
          message: 'appRunning guards require an application name',
        })
      } else if (guard.arg.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['arg'],
          message: 'appRunning guards require a non-blank application name',
        })
      }
      return
    }

    if (guard.arg === undefined) return
    if (guard.probe !== 'lightOn') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['arg'],
        message: `${guard.probe} guards do not accept an argument`,
      })
      return
    }
    if (guard.arg.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(guard.arg)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['arg'],
        message: 'Light ids may only contain letters, digits, "-" and "_"',
      })
    }
  })

export const rigStepSchema = z.object({
  id: id.optional(),
  label: z.string().min(1).max(60).optional(),
  action: rigStepActionSchema,
  delayMs: z.number().int().min(0).max(RIG_MAX_STEP_DELAY_MS).optional(),
  continueOnError: z.boolean().optional(),
})

export const rigPresetSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    icon: z.string().max(32).optional(),
    description: z.string().max(140).optional(),
    steps: z
      .array(rigStepSchema)
      .min(1, 'A rig needs at least one step')
      .max(RIG_MAX_STEPS, `A rig accepts at most ${RIG_MAX_STEPS} steps`),
    guards: z.array(rigGuardSchema).max(RIG_MAX_GUARDS, `A rig accepts at most ${RIG_MAX_GUARDS} guards`).optional(),
    onError: z.enum(['failFast', 'continue']).optional(),
    deadlineMs: z.number().int().min(1000).max(RIG_MAX_DEADLINE_MS).optional(),
  })
  .superRefine((rig, ctx) => {
    const stepIds = new Set<string>()
    for (const step of rig.steps) {
      if (!step.id) continue
      if (stepIds.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: `Duplicate step id in rig ${rig.name}: ${step.id}`,
        })
      }
      stepIds.add(step.id)
    }
  })

/** Read-only last-run status tile for one rig. */
export const rigStateBindingSchema = z.object({
  type: z.literal('rig'),
  presetId: id,
})

/* ------------------------------------------------------------------ */
/* Event rules                                                          */
/* ------------------------------------------------------------------ */

const ruleNameText = z.string().trim().min(1, 'Rule name cannot be empty').max(RULE_MAX_NAME)

const ruleSceneText = z
  .string()
  .trim()
  .min(1, 'Scene cannot be empty')
  .max(RULE_MAX_SCENE, `Scene names are limited to ${RULE_MAX_SCENE} characters`)

const ruleProcessText = z
  .string()
  .trim()
  .min(1, 'Process name cannot be empty')
  .max(RULE_MAX_PROCESS, `Process names are limited to ${RULE_MAX_PROCESS} characters`)
  .refine(
    (name) => !/[\\/\u0000-\u001F\u007F]/.test(name),
    'Process names cannot contain slashes or control characters',
  )

const ruleNoticeText = z
  .string()
  .trim()
  .min(1, 'Notice text cannot be empty')
  .max(RULE_MAX_NOTICE, `Notices are limited to ${RULE_MAX_NOTICE} characters`)

/**
 * A state transition that may fire a rule.
 *
 * Strict arms on purpose: a field from the wrong arm is a path-specific schema
 * error instead of being silently stripped.
 */
export const eventTriggerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['obs.streaming', 'obs.recording', 'obs.replay', 'twitch.live']),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('obs.scene'),
      scene: ruleSceneText,
    })
    .strict(),
  z
    .object({
      kind: z.enum(['process.started', 'process.stopped']),
      process: ruleProcessText,
    })
    .strict(),
  z
    .object({
      kind: z.enum(['phone.connected', 'phone.disconnected']),
    })
    .strict(),
])

/**
 * Reference-only rule action. No inline host action, no nested rule/rig.
 *
 * References are checked against the surrounding config in
 * `DeckConfigSchema`; this schema only validates shapes.
 */
export const ruleActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('runRig'), presetId: id }).strict(),
  z.object({ kind: z.literal('showProfile'), profileId: id }).strict(),
  z.object({ kind: z.literal('showPage'), profileId: id, pageId: id }).strict(),
  z.object({ kind: z.literal('notice'), text: ruleNoticeText }).strict(),
])

export const eventRuleSchema = z.object({
  id,
  name: ruleNameText,
  enabled: z.boolean().optional(),
  trigger: eventTriggerSchema,
  conditions: z
    .array(rigGuardSchema)
    .max(RULE_MAX_CONDITIONS, `A rule accepts at most ${RULE_MAX_CONDITIONS} conditions`)
    .optional(),
  actions: z
    .array(ruleActionSchema)
    .min(1, 'A rule needs at least one action')
    .max(RULE_MAX_ACTIONS, `A rule accepts at most ${RULE_MAX_ACTIONS} actions`),
  debounceMs: z.number().int().min(0).max(RULE_DEBOUNCE_MAX_MS).optional(),
  cooldownMs: z.number().int().min(0).max(RULE_COOLDOWN_MAX_MS).optional(),
  onBusy: z.enum(['skip', 'continue']).optional(),
})

export const GridSchema = z.object({
  columns: z.number().int().min(1).max(10),
  rows: z.number().int().min(1).max(10),
  gap: z.number().int().min(0).max(60),
  padding: z.number().int().min(0).max(80),
})

export const ThemeSchema = z.object({
  background: BackgroundSchema,
  buttonBackground: BackgroundSchema,
  textColor: hexColor,
  accentColor: hexColor,
  fontSize: z.number().int().min(8).max(48),
  buttonRadius: z.number().int().min(0).max(120),
})

export const CellSpanSchema = z.object({
  columns: z.number().int().min(1).max(10),
  rows: z.number().int().min(1).max(10),
})

const controlAxis = z.enum(['horizontal', 'vertical']).optional()

/**
 * Scroll modifiers accept the usual key aliases (`Control`, `Cmd`, `Option`, …)
 * and normalize to CTRL/ALT/SHIFT/WIN. Duplicates are rejected rather than
 * silently deduplicated so a hand-edited config reports the mistake.
 */
const ScrollModifierListSchema = z
  .array(z.string())
  .max(4, 'At most 4 scroll modifiers')
  .superRefine((values, ctx) => {
    const seen = new Set<string>()
    values.forEach((raw, index) => {
      let key: string
      try {
        key = normalizeKey(raw)
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Unknown scroll modifier: ${raw}`,
        })
        return
      }
      if (!isModifier(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Scroll modifiers must be CTRL, SHIFT, ALT or WIN: ${raw}`,
        })
        return
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate scroll modifier: ${key}`,
        })
        return
      }
      seen.add(key)
    })
  })
  .transform((values) => {
    const normalized = new Set<ScrollModifier>()
    for (const raw of values) {
      try {
        const key = normalizeKey(raw)
        if (isModifier(key)) normalized.add(key as ScrollModifier)
      } catch {
        // The refinement above already reported this value.
      }
    }
    return MODIFIER_KEYS.filter((key) => normalized.has(key))
  })

export const ControlBindingSchema = z.union([
  z.discriminatedUnion('mode', [
    z.object({
      type: z.literal('volume'),
      mode: z.literal('relative'),
      stepPercent: z.number().int().min(1).max(25).optional(),
    }),
    z.object({
      type: z.literal('volume'),
      mode: z.literal('absolute'),
    }),
  ]),
  z.object({
    type: z.literal('scroll'),
    axis: z.enum(['vertical', 'horizontal']),
    invert: z.boolean().optional(),
    modifiers: ScrollModifierListSchema.optional(),
  }),
  z.object({
    type: z.literal('mic'),
    mode: z.literal('gain'),
  }),
  z.object({
    type: z.literal('obs'),
    target: z.literal('inputVolume'),
    input: z.string().min(1).max(128).optional(),
  }),
  z.object({
    type: z.literal('light'),
    target: z.enum(['power', 'brightness', 'temperature']),
    light: id.optional(),
  }),
  z.object({
    type: z.literal('appVolume'),
    target: z.literal('volume'),
    match: appVolumeMatch,
  }),
  shortcutBindingSchema,
  z.object({
    type: z.literal('media'),
    target: z.literal('position'),
  }),
])

/** Pointer bindings are only valid on `trackpad` controls. */
export const PointerBindingSchema = z.object({
  type: z.literal('pointer'),
  mode: z.enum(['inline', 'fullscreen']).optional(),
  sensitivity: z.number().finite().min(0.25).max(3).optional(),
  naturalScroll: z.boolean().optional(),
  tapToClick: z.boolean().optional(),
  dragLock: z.boolean().optional(),
})

const controlFields = {
  axis: controlAxis,
  emit: z.enum(['value', 'delta']),
  binding: ControlBindingSchema,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().gt(0, 'step must be greater than 0').optional(),
  initial: z.number().finite().optional(),
  unit: z.string().min(1).max(16).optional(),
  haptics: z.boolean().optional(),
  commit: z.enum(['live', 'end']).optional(),
  display: z.enum(['raw', 'percent', 'time']).optional(),
}

const sliderOrDialControlSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('slider'), ...controlFields }),
    z.object({ kind: z.literal('dial'), ...controlFields }),
  ])
  .superRefine((control, ctx) => {
    if (control.binding.type === 'volume') {
      const expectedEmit = control.binding.mode === 'absolute' ? 'value' : 'delta'
      if (control.emit !== expectedEmit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emit'],
          message:
            control.binding.mode === 'absolute'
              ? 'Absolute volume requires emit "value"'
              : 'Relative volume requires emit "delta"',
        })
      }
    }
    if (control.binding.type === 'mic' && control.emit !== 'value') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['emit'],
        message: 'Mic gain requires emit "value"',
      })
    }
    if (control.binding.type === 'shortcut' && control.emit !== 'delta') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['emit'],
        message: 'Shortcut controls require emit "delta"',
      })
    }
    if (control.binding.type === 'media') {
      if (control.emit !== 'value') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emit'],
          message: 'Media position requires emit "value"',
        })
      }
      if (control.min !== undefined && control.min !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['min'],
          message: 'Media position requires min 0 (or omit it)',
        })
      }
      if (control.max !== undefined && control.max !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['max'],
          message: 'Media position requires max 1 (or omit it)',
        })
      }
    }
    if (control.binding.type === 'obs') {
      if (control.emit !== 'value') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emit'],
          message: 'OBS input volume requires emit "value"',
        })
      }
      if (control.min !== undefined && control.min !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['min'],
          message: 'OBS input volume requires min 0 (or omit it)',
        })
      }
      if (control.max !== undefined && (control.max < 1 || control.max > 2000)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['max'],
          message: 'OBS input volume max must be between 1 and 2000',
        })
      }
    }
    if (control.binding.type === 'light') {
      if (control.emit !== 'value') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emit'],
          message: 'Light controls require emit "value"',
        })
      }
      if (control.binding.target === 'brightness' || control.binding.target === 'power') {
        if (control.min !== undefined && (control.min < 0 || control.min > 100)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['min'],
            message: 'Light brightness/power min must be between 0 and 100',
          })
        }
        if (control.max !== undefined && (control.max < 0 || control.max > 100)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['max'],
            message: 'Light brightness/power max must be between 0 and 100',
          })
        }
      }
      if (control.binding.target === 'temperature') {
        if (control.min !== undefined && (control.min < 143 || control.min > 344)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['min'],
            message: 'Elgato temperature min must be between 143 and 344 mired',
          })
        }
        if (control.max !== undefined && (control.max < 143 || control.max > 344)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['max'],
            message: 'Elgato temperature max must be between 143 and 344 mired',
          })
        }
      }
    }
    if (control.binding.type === 'appVolume') {
      if (control.emit !== 'value') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emit'],
          message: 'App volume requires emit "value"',
        })
      }
      if (control.min !== undefined && (control.min < 0 || control.min > 100)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['min'],
          message: 'App volume min must be between 0 and 100',
        })
      }
      if (control.max !== undefined && (control.max < 0 || control.max > 100)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['max'],
          message: 'App volume max must be between 0 and 100',
        })
      }
    }
    if (control.min !== undefined && control.max !== undefined && control.min >= control.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max'],
        message: 'max must be greater than min',
      })
    }
    if (control.initial !== undefined) {
      if (control.min !== undefined && control.initial < control.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['initial'],
          message: 'initial must be within min and max',
        })
      }
      if (control.max !== undefined && control.initial > control.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['initial'],
          message: 'initial must be within min and max',
        })
      }
    }
  })

export const TrackpadControlSpecSchema = z.object({
  kind: z.literal('trackpad'),
  emit: z.literal('delta'),
  binding: PointerBindingSchema,
  haptics: z.boolean().optional(),
})

export const ControlSpecSchema = z.union([sliderOrDialControlSchema, TrackpadControlSpecSchema])

/** Read-only status binding on a normal button (OBS phase 2). */
export const ObsStateBindingSchema = z.object({
  type: z.literal('obs'),
  target: z.enum([
    'streaming',
    'recording',
    'replay',
    'virtualCam',
    'scene',
    'inputMute',
    'inputVolume',
  ]),
  scene: obsName.optional(),
  input: obsName.optional(),
})

/** Read-only Twitch status tile (live/viewers/uptime/title/game). */
export const TwitchStateBindingSchema = z.object({
  type: z.literal('twitch'),
  target: z.enum(['live', 'viewers', 'uptime', 'title', 'game']),
})

/** Read-only local-light status tile (power/brightness/temperature). */
export const LightStateBindingSchema = z.object({
  type: z.literal('light'),
  target: lightTarget,
  light: id.optional(),
})

/** Read-only per-app volume/mute status tile. */
export const AppVolumeStateBindingSchema = z.object({
  type: z.literal('appVolume'),
  target: z.enum(['volume', 'mute']),
  match: appVolumeMatch,
})

/**
 * Runtime union accepts the staged rig and audio-device status tiles; its
 * static output stays the narrower `StateBinding` so old renderers compile
 * unchanged. `validateConfig` casts the parsed deck back at the boundary; the
 * reference check below inspects rig state structurally.
 */
export const StateBindingSchema = z.union([
  ObsStateBindingSchema,
  TwitchStateBindingSchema,
  LightStateBindingSchema,
  AppVolumeStateBindingSchema,
  rigStateBindingSchema,
  AudioDeviceStateBindingSchema,
]) as unknown as z.ZodType<StateBinding>

export const ButtonSchema = z.object({
  id,
  slot: z.number().int().min(0).max(99),
  label: z.string().max(60),
  sublabel: z.string().max(60).optional(),
  icon: z.string().max(32).optional(),
  iconMedia: MediaIconSchema.optional(),
  background: BackgroundSchema.optional(),
  textColor: hexColor.optional(),
  actions: z.array(ActionSchema).max(16),
  control: ControlSpecSchema.optional(),
  state: StateBindingSchema.optional(),
  span: CellSpanSchema.optional(),
})

export const PageSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  background: BackgroundSchema.optional(),
  grid: GridSchema.optional(),
  buttons: z.array(ButtonSchema).max(100),
})

export const ProfileSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  grid: GridSchema,
  theme: ThemeSchema,
  pages: z.array(PageSchema).min(1).max(20),
  defaultPageId: id,
})

export const DeckConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    updatedAt: z.string().min(1).max(64),
    serverName: z.string().min(1).max(80),
    defaultProfileId: id,
    profiles: z.array(ProfileSchema).min(1).max(20),
    rigs: z
      .array(rigPresetSchema)
      .max(RIG_MAX_PRESETS, `A config accepts at most ${RIG_MAX_PRESETS} rigs`)
      .optional(),
    rules: z
      .array(eventRuleSchema)
      .max(RULES_MAX_RULES, `A config accepts at most ${RULES_MAX_RULES} rules`)
      .optional(),
  })
  .superRefine((config, ctx) => {
    // Rig ids are config-scoped; buttons reference them by id only.
    const rigIds = new Set<string>()
    for (const rig of config.rigs ?? []) {
      if (rigIds.has(rig.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate rig id: ${rig.id}` })
      }
      rigIds.add(rig.id)
    }

    if (config.rigs) {
      const serialized = JSON.stringify(config.rigs)
      const bytes =
        typeof TextEncoder === 'undefined' ? serialized.length : new TextEncoder().encode(serialized).length
      if (bytes > RIG_MAX_SERIALIZED_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rigs are too large to sync (max ${RIG_MAX_SERIALIZED_BYTES / 1024} KB)`,
        })
      }
    }

    const profileIds = new Set<string>()
    for (const profile of config.profiles) {
      if (profileIds.has(profile.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate profile id: ${profile.id}` })
      }
      profileIds.add(profile.id)

      const pageIds = new Set<string>()
      for (const page of profile.pages) {
        if (pageIds.has(page.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate page id in ${profile.name}: ${page.id}` })
        }
        pageIds.add(page.id)

        const effectiveGrid = page.grid ?? profile.grid
        const pageCapacity = effectiveGrid.columns * effectiveGrid.rows
        const slots = new Set<number>()
        const buttonIds = new Set<string>()
        const cellOwners = new Map<number, typeof page.buttons[number]>()
        for (const button of page.buttons) {
          if (button.slot >= pageCapacity) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Button "${button.label}" uses slot ${button.slot}, outside the ${effectiveGrid.columns}x${effectiveGrid.rows} grid`,
            })
          }
          if (slots.has(button.slot)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Two buttons share slot ${button.slot} in page ${page.name}` })
          }
          slots.add(button.slot)
          if (buttonIds.has(button.id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate button id in page ${page.name}: ${button.id}` })
          }
          buttonIds.add(button.id)

          // `slot` is the top-left anchor in a row-major grid. Validate the whole
          // footprint, not just the anchor, so spanning tiles cannot overflow or
          // overlap each other.
          if (button.slot >= 0 && button.slot < pageCapacity) {
            const span = button.span ?? { columns: 1, rows: 1 }
            const row = Math.floor(button.slot / effectiveGrid.columns)
            const column = button.slot % effectiveGrid.columns
            const fits =
              column + span.columns <= effectiveGrid.columns && row + span.rows <= effectiveGrid.rows
            if (!fits) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Button "${button.label}" at slot ${button.slot} with a ${span.columns}x${span.rows} span extends outside the ${effectiveGrid.columns}x${effectiveGrid.rows} grid`,
              })
            } else {
              let overlapped = false
              for (let rowOffset = 0; rowOffset < span.rows && !overlapped; rowOffset += 1) {
                for (let columnOffset = 0; columnOffset < span.columns; columnOffset += 1) {
                  const cell = (row + rowOffset) * effectiveGrid.columns + (column + columnOffset)
                  const owner = cellOwners.get(cell)
                  if (owner && owner !== button) {
                    ctx.addIssue({
                      code: z.ZodIssueCode.custom,
                      message: `Buttons "${owner.label}" and "${button.label}" overlap at cell ${cell} in page ${page.name}`,
                    })
                    overlapped = true
                    break
                  }
                  cellOwners.set(cell, button)
                }
              }
            }
          }

          for (const action of button.actions) {
            if (action.type === 'page' && action.direction === 'goto' && !action.pageId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Button "${button.label}" has a "goto page" action without a page`,
              })
            }
          }

          // `ActionSchema` is staged narrow on purpose; inspect the parsed
          // runtime value structurally so this rule still runs.
          const rigActions = (button.actions as unknown as readonly { type: string; presetId?: unknown }[]).filter(
            (action): action is { type: 'rig'; presetId: string } =>
              action.type === 'rig' && typeof action.presetId === 'string',
          )
          if (rigActions.length > 0) {
            // A rig owns the button: mixing it with other actions or a
            // continuous control would make ordering and readback ambiguous.
            if (button.actions.length !== 1) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Button "${button.label}" must use a rig action on its own (remove its other actions)`,
              })
            }
            if (button.control) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Button "${button.label}" cannot combine a rig action with a control`,
              })
            }
            for (const action of rigActions) {
              if (!rigIds.has(action.presetId)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Button "${button.label}" references an unknown rig: ${action.presetId}`,
                })
              }
            }
          }
          // `StateBindingSchema` is staged narrow on purpose; inspect the parsed
          // runtime value structurally so the rig reference check still runs.
          const rigState = button.state as unknown as { type?: string; presetId?: unknown } | undefined
          if (
            rigState?.type === 'rig' &&
            typeof rigState.presetId === 'string' &&
            !rigIds.has(rigState.presetId)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Button "${button.label}" has an unknown rig state: ${rigState.presetId}`,
            })
          }
        }
      }
      if (!pageIds.has(profile.defaultPageId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Profile ${profile.name} has an unknown default page` })
      }
    }
    if (!profileIds.has(config.defaultProfileId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unknown default profile' })
    }

    // Rule actions are reference-only, so every target must exist in the same
    // config. `showPage` additionally requires the page to belong to the chosen
    // profile. A rejected config never reaches the runtime, which keeps
    // automation from pointing at a deleted or typo'd target.
    const profilePages = new Map<string, Set<string>>()
    for (const profile of config.profiles) {
      profilePages.set(profile.id, new Set(profile.pages.map((page) => page.id)))
    }

    const ruleIds = new Set<string>()
    for (const [ruleIndex, rule] of (config.rules ?? []).entries()) {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', ruleIndex, 'id'],
          message: `Duplicate rule id: ${rule.id}`,
        })
      }
      ruleIds.add(rule.id)

      for (const [actionIndex, action] of rule.actions.entries()) {
        const actionPath = ['rules', ruleIndex, 'actions', actionIndex]
        switch (action.kind) {
          case 'runRig':
            if (!rigIds.has(action.presetId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...actionPath, 'presetId'],
                message: `Rule "${rule.name}" references an unknown rig: ${action.presetId}`,
              })
            }
            break
          case 'showProfile':
            if (!profilePages.has(action.profileId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...actionPath, 'profileId'],
                message: `Rule "${rule.name}" references an unknown profile: ${action.profileId}`,
              })
            }
            break
          case 'showPage': {
            const pages = profilePages.get(action.profileId)
            if (!pages) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...actionPath, 'profileId'],
                message: `Rule "${rule.name}" references an unknown profile: ${action.profileId}`,
              })
            } else if (!pages.has(action.pageId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...actionPath, 'pageId'],
                message: `Rule "${rule.name}" references an unknown page in profile ${action.profileId}: ${action.pageId}`,
              })
            }
            break
          }
          case 'notice':
            break
        }
      }
    }

    if (config.rules) {
      const serialized = JSON.stringify(config.rules)
      const bytes =
        typeof TextEncoder === 'undefined' ? serialized.length : new TextEncoder().encode(serialized).length
      if (bytes > RULE_MAX_SERIALIZED_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules'],
          message: `Rules are too large to sync (max ${RULE_MAX_SERIALIZED_BYTES / 1024} KB)`,
        })
      }
    }
  })

export interface ValidationSuccess {
  ok: true
  config: DeckConfig
}

export interface ValidationFailure {
  ok: false
  errors: string[]
}

export function validateConfig(input: unknown): ValidationSuccess | ValidationFailure {
  const parsed = DeckConfigSchema.safeParse(input)
  if (parsed.success) return { ok: true, config: parsed.data as DeckConfig }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    }),
  }
}

export function parseConfig(input: unknown): DeckConfig {
  const result = validateConfig(input)
  if (!result.ok) throw new Error(`Invalid deck config:\n${result.errors.join('\n')}`)
  return result.config
}

export function isDeckConfig(input: unknown): input is DeckConfig {
  return validateConfig(input).ok
}
