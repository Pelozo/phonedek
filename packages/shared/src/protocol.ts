import { z } from 'zod'
import { PROTOCOL_VERSION, type ClientMessage } from './types'

export const DeviceInfoSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
})

export const ClientMessageSchema = z.union([
  z.object({
    type: z.literal('hello'),
    protocol: z.literal(PROTOCOL_VERSION),
    device: DeviceInfoSchema,
  }),
  z.object({
    type: z.literal('press'),
    requestId: z.string().min(1).max(64),
    profileId: z.string().min(1).max(64),
    pageId: z.string().min(1).max(64),
    buttonId: z.string().min(1).max(128),
  }),
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
