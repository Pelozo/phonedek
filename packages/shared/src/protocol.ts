import { z } from 'zod'
import { PROTOCOL_VERSION, type ClientMessage } from './types'

export const DeviceInfoSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
})

export const PointerButtonEventSchema = z.object({
  button: z.enum(['left', 'right', 'middle']),
  action: z.enum(['down', 'up', 'click', 'doubleclick']),
})

export const PointerMessageSchema = z
  .object({
    type: z.literal('pointer'),
    seq: z.number().int().min(0),
    phase: z.enum(['start', 'move', 'end', 'cancel']),
    profileId: z.string().min(1).max(64).optional(),
    pageId: z.string().min(1).max(64).optional(),
    controlId: z.string().min(1).max(128).optional(),
    dx: z.number().finite().min(-2).max(2).optional(),
    dy: z.number().finite().min(-2).max(2).optional(),
    scrollX: z.number().finite().min(-10).max(10).optional(),
    scrollY: z.number().finite().min(-10).max(10).optional(),
    buttons: z.array(PointerButtonEventSchema).max(4).optional(),
  })
  .superRefine((message, ctx) => {
    const hasMovement =
      message.dx !== undefined ||
      message.dy !== undefined ||
      message.scrollX !== undefined ||
      message.scrollY !== undefined ||
      message.buttons !== undefined

    if (message.phase === 'start') {
      for (const key of ['profileId', 'pageId', 'controlId'] as const) {
        if (message[key] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `start requires ${key}`,
          })
        }
      }
      if (hasMovement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'start must not carry movement or buttons',
        })
      }
      return
    }

    for (const key of ['profileId', 'pageId', 'controlId'] as const) {
      if (message[key] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is only allowed on start`,
        })
      }
    }
    if (message.phase === 'cancel' && hasMovement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cancel must not carry movement or buttons',
      })
    }
  })

export const WatchMessageSchema = z.object({
  type: z.literal('watch'),
  profileId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64),
  controlIds: z.array(z.string().min(1).max(128)).max(32).optional(),
  intervalMs: z.number().int().min(500).max(5000).optional(),
})

export const ControlStateEntrySchema = z.object({
  controlId: z.string().min(1).max(128),
  revision: z.number().int().min(0),
  value: z.number().finite().min(0).max(1).optional(),
  muted: z.boolean().optional(),
  available: z.boolean(),
  detail: z.string().max(64).optional(),
})

export const ControlStateMessageSchema = z.object({
  type: z.literal('controlState'),
  profileId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64),
  states: z.array(ControlStateEntrySchema).max(32),
})

export const KeyboardMessageSchema = z
  .object({
    type: z.literal('keyboard'),
    seq: z.number().int().min(0),
    phase: z.enum(['start', 'text', 'key', 'release', 'end', 'cancel']),
    profileId: z.string().min(1).max(64).optional(),
    pageId: z.string().min(1).max(64).optional(),
    controlId: z.string().min(1).max(128).optional(),
    text: z.string().min(1).max(4096).optional(),
    keys: z.array(z.string().min(1).max(24)).min(1).max(8).optional(),
    repeat: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((message, ctx) => {
    const hasIds =
      message.profileId !== undefined ||
      message.pageId !== undefined ||
      message.controlId !== undefined

    if (message.phase === 'start') {
      for (const key of ['profileId', 'pageId', 'controlId'] as const) {
        if (message[key] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `start requires ${key}`,
          })
        }
      }
      if (message.text !== undefined || message.keys !== undefined || message.repeat !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'start must not carry text, keys or repeat',
        })
      }
      return
    }

    if (hasIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ids are only allowed on start',
      })
    }

    if (message.phase === 'text') {
      if (message.text === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['text'],
          message: 'text phase requires text',
        })
      }
      if (message.keys !== undefined || message.repeat !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'text phase must not carry keys or repeat',
        })
      }
      return
    }

    if (message.phase === 'key') {
      if (message.keys === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['keys'],
          message: 'key phase requires keys',
        })
      }
      if (message.text !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'key phase must not carry text',
        })
      }
      return
    }

    if (
      message.text !== undefined ||
      message.keys !== undefined ||
      message.repeat !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${message.phase} must not carry text, keys or repeat`,
      })
    }
  })

export const ClientMessageSchema = z.union([
  z.object({
    type: z.literal('hello'),
    protocol: z.literal(PROTOCOL_VERSION),
    device: DeviceInfoSchema,
    capabilities: z.array(z.string().min(1).max(40)).max(16).optional(),
  }),
  z.object({
    type: z.literal('press'),
    requestId: z.string().min(1).max(64),
    profileId: z.string().min(1).max(64),
    pageId: z.string().min(1).max(64),
    buttonId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal('input'),
    requestId: z.string().min(1).max(64),
    profileId: z.string().min(1).max(64),
    pageId: z.string().min(1).max(64),
    controlId: z.string().min(1).max(128),
    phase: z.enum(['start', 'move', 'end']),
    value: z.number().finite().min(0).max(1).optional(),
    delta: z.number().finite().min(-100).max(100).optional(),
  }),
  PointerMessageSchema,
  WatchMessageSchema,
  KeyboardMessageSchema,
  z.object({ type: z.literal('ping'), t: z.number().finite() }),
])

export type ParsedClientMessage = { ok: true; message: ClientMessage } | { ok: false; error: string }

export function parseClientMessage(input: unknown): ParsedClientMessage {
  const parsed = ClientMessageSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }
  }
  return { ok: true, message: parsed.data as ClientMessage }
}

export function isPressMessage(message: ClientMessage): message is Extract<ClientMessage, { type: 'press' }> {
  return message.type === 'press'
}

export function isInputMessage(message: ClientMessage): message is Extract<ClientMessage, { type: 'input' }> {
  return message.type === 'input'
}

export function isPointerMessage(message: ClientMessage): message is Extract<ClientMessage, { type: 'pointer' }> {
  return message.type === 'pointer'
}

export function isWatchMessage(message: ClientMessage): message is Extract<ClientMessage, { type: 'watch' }> {
  return message.type === 'watch'
}

export function isKeyboardMessage(message: ClientMessage): message is Extract<ClientMessage, { type: 'keyboard' }> {
  return message.type === 'keyboard'
}
