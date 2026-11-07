import { z } from 'zod'
import { CONFIG_SCHEMA_VERSION, type DeckConfig } from './types'
import { isValidKeyName, normalizeCombo } from './keys'
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

export const ActionSchema = z.union([
  hotkeySchema,
  textSchema,
  z.object({
    type: z.literal('macro'),
    steps: z.array(MacroStepSchema).max(300),
    repeat: z.number().int().min(1).max(50).optional(),
    repeatDelayMs: z.number().int().min(0).max(60_000).optional(),
  }),
  launchSchema,
  urlSchema,
  commandSchema,
  mediaSchema,
  delaySchema,
  pageSchema,
])

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
})

export const PageSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  background: BackgroundSchema.optional(),
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
  })
  .superRefine((config, ctx) => {
    const profileIds = new Set<string>()
    for (const profile of config.profiles) {
      if (profileIds.has(profile.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate profile id: ${profile.id}` })
      }
      profileIds.add(profile.id)

      const capacity = profile.grid.columns * profile.grid.rows
      const pageIds = new Set<string>()
      for (const page of profile.pages) {
        if (pageIds.has(page.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate page id in ${profile.name}: ${page.id}` })
        }
        pageIds.add(page.id)

        const slots = new Set<number>()
        const buttonIds = new Set<string>()
        for (const button of page.buttons) {
          if (button.slot >= capacity) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Button "${button.label}" uses slot ${button.slot}, outside the ${profile.grid.columns}x${profile.grid.rows} grid`,
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

          for (const action of button.actions) {
            if (action.type === 'page' && action.direction === 'goto' && !action.pageId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Button "${button.label}" has a "goto page" action without a page`,
              })
            }
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
