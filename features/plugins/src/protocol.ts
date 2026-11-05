import { Schema } from "effect"
import type { Rect } from "./inject.ts"
import type { Fields } from "./package.ts"
import type { BlockJson, PageJson } from "./shapes.ts"

export const messageType = "application/x-postmate-v1+json"

export const channels = {
  ready: "#lspmsg#ready#",
  reply: "#lspmsg#reply#",
  settings: "#lspmsg#settings#",
  hook: "#lspmsg#",
  beforeUnload: "#lspmsg#beforeunload#",
  error: "#lspmsg#error#",
} as const

export interface Outgoing {
  readonly postmate: "call" | "request" | "handshake"
  readonly type: string
}

export type Answer =
  | string
  | number
  | boolean
  | null
  | undefined
  | Fields
  | readonly unknown[]
  | BlockJson
  | PageJson
  | Rect

export type Handler = (pid: string, args: readonly unknown[]) => Answer | Promise<Answer>

export type Handlers = Readonly<Record<string, Handler>>

export const channelOf = (pid: string) => `#lspmsg#${pid}`

export const snakeCase = (input: string) =>
  input
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1\0$2")
    .replaceAll(/([A-Z])([A-Z][a-z])/gu, "$1\0$2")
    .replaceAll(/[^A-Z0-9]+/giu, "\0")
    .split("\0")
    .filter((part) => part !== "")
    .map((part) => part.toLowerCase())
    .join("_")

const Envelope = { type: Schema.Literal(messageType) }

const Emit = Schema.Struct({ type: Schema.String, payload: Schema.optionalKey(Schema.Unknown) })

export type Emit = typeof Emit.Type

export const PluginMessage = Schema.Union([
  Schema.Struct({ ...Envelope, postmate: Schema.Literal("handshake-reply") }),
  Schema.Struct({
    ...Envelope,
    postmate: Schema.Literal("reply"),
    uid: Schema.Number,
    value: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    ...Envelope,
    postmate: Schema.Literal("emit"),
    value: Schema.Struct({
      name: Schema.String,
      data: Emit,
    }),
  }),
])

export type PluginMessage = typeof PluginMessage.Type

export const decodeMessage = Schema.decodeUnknownOption(PluginMessage)

export const ApiCall = Schema.Struct({
  method: Schema.String,
  args: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  _sync: Schema.optionalKey(Schema.Number),
})

export type ApiCall = typeof ApiCall.Type

export const decodeApiCall = Schema.decodeUnknownOption(ApiCall)

export const call = <Data>(property: string, data: Data) => ({
  postmate: "call" as const,
  type: messageType,
  property,
  data,
})

export const request = <Args extends readonly unknown[]>(
  property: string,
  args: Args,
  uid: number,
) => ({
  postmate: "request" as const,
  type: messageType,
  property,
  args,
  uid,
})

export const handshake = <Info>(baseInfo: Info) => ({
  postmate: "handshake" as const,
  type: messageType,
  model: { baseInfo },
})
