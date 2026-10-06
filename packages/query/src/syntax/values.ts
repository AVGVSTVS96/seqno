import { isField, type Field, type Value } from "../ast.ts"
import { parseDateWord } from "../dates.ts"
import { fail } from "../error.ts"
import { fieldDef } from "../fields.ts"

export const word = (s: string, f?: Field): Value => {
  if (s === "@page" || s === "@block")
    return { _tag: "Context", of: s === "@page" ? "page" : "block" }
  if (s === "true" || s === "false") return s === "true"
  const type = f === undefined ? undefined : fieldDef(f).type
  return (type === "date" || type === "time" ? parseDateWord(s) : null) ?? s
}

export const field = (s: string): Field => (isField(s) ? s : fail(`unknown field "${s}"`))

const LEGACY: Record<string, Field> = {
  "created-at": "created",
  "updated-at": "updated",
  page: "page",
  priority: "task.priority",
}

export const sortField = (s: string): Field =>
  LEGACY[s] ?? (isField(s) ? s : field(`property.${s.toLowerCase()}`))
