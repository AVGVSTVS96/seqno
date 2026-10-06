import { Data } from "effect"
import { dayEnd, dayStart, resolveDay } from "./dates.ts"
import type { FieldDef } from "./fields.ts"
import type { CompareOp, Value } from "./model.ts"

export interface QueryContext {
  readonly today: number
  readonly page?: string
  readonly block?: string
}

export type Edge = "start" | "end"

export const edgeOf = (op: CompareOp): Edge => (op === "<=" || op === ">" ? "end" : "start")

export class QueryError extends Data.TaggedError("QueryError")<{ readonly message: string }> {}

export const fail = (message: string): never => {
  throw new QueryError({ message })
}

const contextValue = (value: Value, ctx: QueryContext): Value => {
  if (typeof value !== "object" || value._tag !== "Context") return value
  const resolved = value.of === "page" ? ctx.page : ctx.block
  if (resolved === undefined) return fail(`@${value.of} is only available inside a ${value.of}`)
  return resolved
}

export const literal = (def: FieldDef, raw: Value, ctx: QueryContext, edge: Edge): string | number | boolean => {
  const value = contextValue(raw, ctx)
  const scalar = typeof value !== "object"
  switch (def.type) {
    case "name":
    case "string":
      if (!scalar) return fail(`expected a name, got a date`)
      return String(value).toLowerCase()
    case "id":
      if (typeof value !== "string") return fail(`expected a block id`)
      return value
    case "bool":
      if (typeof value !== "boolean") return fail(`expected true or false`)
      return value
    case "any":
      if (!scalar) return fail(`dates on untyped properties are not supported`)
      return typeof value === "number" ? value : String(value).toLowerCase()
    case "date":
    case "time": {
      const day = typeof value === "number" ? value : resolveDay(value, ctx.today)
      if (day === null) return fail(`expected a date, got ${JSON.stringify(value)}`)
      if (def.type === "date") return day
      return edge === "start" ? dayStart(day) : dayEnd(day)
    }
  }
}
