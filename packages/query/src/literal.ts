import type { CompareOp, QueryContext, Value } from "./ast.ts"
import { dayEnd, dayStart, resolveDay } from "./dates.ts"
import { fail } from "./error.ts"
import type { FieldDef, Primitive } from "./fields.ts"

export type Edge = "start" | "end"

export const edgeOf = (op: CompareOp): Edge => (op === "<=" || op === ">" ? "end" : "start")

const contextValue = (value: Value, ctx: QueryContext): Value => {
  if (typeof value !== "object" || value._tag !== "Context") return value
  const resolved = value.of === "page" ? ctx.page : ctx.block
  return resolved ?? fail(`@${value.of} is only available inside a ${value.of}`)
}

export const literal = (def: FieldDef, raw: Value, ctx: QueryContext, edge: Edge): Primitive => {
  const value = contextValue(raw, ctx)
  const scalar = typeof value !== "object"
  switch (def.type) {
    case "name":
    case "string":
      return scalar ? String(value).toLowerCase() : fail("expected a name, got a date")
    case "id":
      return typeof value === "string" ? value : fail("expected a block id")
    case "bool":
      return typeof value === "boolean" ? value : fail("expected true or false")
    case "any":
      if (!scalar) return fail("dates on untyped properties are not supported")
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
