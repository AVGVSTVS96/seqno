import { Schema } from "effect"
import type { ShapeJson, Vec } from "@seqno/domain"

export type Raw = ShapeJson

export type Field = Schema.Json | undefined

export const isText = Schema.is(Schema.String)

export const isRaw = Schema.is(Schema.JsonObject)

export const isList = Schema.is(Schema.Array(Schema.Json))

const isVec = Schema.is(Schema.Tuple([Schema.Number, Schema.Number]))

export const vecIn = (value: Field): Vec | undefined => (isVec(value) ? value : undefined)

export const rawIn = (value: Field): Raw => (isRaw(value) ? value : {})
