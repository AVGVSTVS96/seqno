import { parseDateWord } from "../dates.ts"
import { fieldDef } from "../fields.ts"
import { fail } from "../literal.ts"
import { FIELD_PATTERN, type Field, type Filter, type Value } from "../model.ts"

export const word = (s: string, f?: Field): Value => {
  if (s === "@page" || s === "@block") return { _tag: "Context", of: s === "@page" ? "page" : "block" }
  if (s === "true" || s === "false") return s === "true"
  const type = f === undefined ? undefined : fieldDef(f).type
  return (type === "date" || type === "time" ? parseDateWord(s) : null) ?? s
}

export const field = (s: string): Field => {
  if (!FIELD_PATTERN.test(s)) return fail(`unknown field "${s}"`)
  return s
}

const LEGACY: Record<string, Field> = { "created-at": "created", "updated-at": "updated", page: "page", priority: "task.priority" }

export const sortField = (s: string): Field => LEGACY[s] ?? (FIELD_PATTERN.test(s) ? s : field(`property.${s.toLowerCase()}`))

export const pathRef = (name: Value): Filter => ({
  _tag: "Under",
  ancestor: { _tag: "Compare", field: "ref", op: "=", value: name },
  self: true,
  direct: false,
})
