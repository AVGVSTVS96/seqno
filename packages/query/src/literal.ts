import { Predicate } from "effect"
import { isScalar } from "./ast.ts"
import type { CompareOp, Primitive, QueryContext, Value } from "./ast.ts"
import { dayEnd, dayStart, resolveDay } from "./dates.ts"
import { fail } from "./error.ts"
import type { FieldDef } from "./fields.ts"

export type Edge = "start" | "end"

export const edgeOf = (op: CompareOp): Edge => (op === "<=" || op === ">" ? "end" : "start")

const contextValue = (value: Value, ctx: QueryContext): Value => {
  if (isScalar(value) || value._tag !== "Context") {
    return value
  }

  const resolved = value.of === "page" ? ctx.page : ctx.block

  return resolved ?? fail(`@${value.of} is only available inside a ${value.of}`)
}

export const literal = (def: FieldDef, raw: Value, ctx: QueryContext, edge: Edge): Primitive => {
  const value = contextValue(raw, ctx)

  switch (def.type) {
    case "name":
    case "string": {
      return isScalar(value) ? String(value).toLowerCase() : fail("expected a name, got a date")
    }

    case "id": {
      return Predicate.isString(value) ? value : fail("expected a block id")
    }

    case "bool": {
      return Predicate.isBoolean(value) ? value : fail("expected true or false")
    }

    case "any": {
      if (!isScalar(value)) {
        return fail("dates on untyped properties are not supported")
      }

      return Predicate.isNumber(value) ? value : String(value).toLowerCase()
    }

    case "date":
    case "time": {
      const day = Predicate.isNumber(value) ? value : resolveDay(value, ctx.today)

      if (day === null) {
        return fail(`expected a date, got ${JSON.stringify(value)}`)
      }

      if (def.type === "date") {
        return day
      }

      return edge === "start" ? dayStart(day) : dayEnd(day)
    }
  }
}
