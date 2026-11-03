import { Schema } from "effect"

export const messageType = "application/x-postmate-v1+json"

export const channels = {
  ready: "#lspmsg#ready#",
  reply: "#lspmsg#reply#",
  settings: "#lspmsg#settings#",
  hook: "#lspmsg#",
  beforeUnload: "#lspmsg#beforeunload#",
  error: "#lspmsg#error#",
} as const

export const channelOf = (pid: string) => `#lspmsg#${pid}`

export const snakeCase = (input: string) =>
  input
    .replace(/([a-z0-9])([A-Z])/g, "$1\0$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1\0$2")
    .replace(/[^A-Z0-9]+/gi, "\0")
    .split("\0")
    .filter((part) => part !== "")
    .map((part) => part.toLowerCase())
    .join("_")

const Envelope = { type: Schema.Literal(messageType) }

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
      data: Schema.Struct({ type: Schema.String, payload: Schema.optionalKey(Schema.Unknown) }),
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

export const call = (property: string, data: unknown) => ({
  postmate: "call",
  type: messageType,
  property,
  data,
})

export const request = (property: string, args: ReadonlyArray<unknown>, uid: number) => ({
  postmate: "request",
  type: messageType,
  property,
  args,
  uid,
})

export const handshake = (baseInfo: unknown) => ({
  postmate: "handshake",
  type: messageType,
  model: { baseInfo },
})
