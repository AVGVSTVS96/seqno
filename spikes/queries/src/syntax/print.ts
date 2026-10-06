import { fail } from "../literal.ts"
import type { Filter, Query, Value } from "../model.ts"

const value = (v: Value): string => {
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "string") return /^[a-z_][\w./-]*$/i.test(v) && !/^[+-]?\d/.test(v) ? v : JSON.stringify(v)
  if (v._tag === "Context") return `@${v.of}`
  if (v._tag === "AbsDate") return `${String(v.ymd).slice(0, 4)}-${String(v.ymd).slice(4, 6)}-${String(v.ymd).slice(6)}`
  return v.amount === 0 && v.unit === "d" ? "today" : `${v.amount > 0 ? "+" : ""}${v.amount}${v.unit}`
}

const values = (vs: ReadonlyArray<Value>) => vs.map(value).join(" ")

const filter = (f: Filter): string => {
  switch (f._tag) {
    case "And":
      return `(and ${f.all.map(filter).join(" ")})`
    case "Or":
      return `(or ${f.any.map(filter).join(" ")})`
    case "Not":
      return `(not ${filter(f.filter)})`
    case "Search":
      return JSON.stringify(f.text)
    case "HasBlock":
      return `(has-block ${filter(f.filter)})`
    case "Under": {
      const a = f.ancestor
      if (f.self && !f.direct && a._tag === "Compare" && a.field === "ref" && a.op === "=") {
        return typeof a.value === "object" && a.value._tag === "Context" ? "@page" : `[[${String(a.value)}]]`
      }
      if (f.self) return fail("an inclusive UNDER over anything but a page reference has no text form")
      return `(${f.direct ? "child-of" : "under"} ${filter(a)})`
    }
    case "Has":
      return f.field.startsWith("property.") ? `(property ${f.field.slice(9)})` : `(${f.field})`
    case "Between":
      return f.field === "page.day" ? `(between ${value(f.from)} ${value(f.to)})` : `(between ${f.field} ${value(f.from)} ${value(f.to)})`
    case "In":
    case "Compare": {
      const vs = f._tag === "In" ? f.values : [f.value]
      const eq = f._tag === "In" || f.op === "="
      if (eq && f.field === "task.status") return `(task ${values(vs)})`
      if (eq && f.field === "task.priority") return `(priority ${values(vs)})`
      if (eq && f.field === "page.namespace") return `(namespace ${values(vs)})`
      if (eq && f.field.startsWith("property.")) return `(property ${f.field.slice(9)} ${values(vs)})`
      return eq ? `(${f.field} ${values(vs)})` : `(${f.field} ${(f as { op: string }).op} ${values(vs)})`
    }
  }
}

export const printSimple = (q: Query): string => {
  const where = q.where ? filter(q.where) : null
  const parts = [
    q.find === "pages" ? `(pages${where ? ` ${where}` : ""})` : where,
    ...(q.sort ?? []).map((s) => `(sort-by ${s.field} ${s.dir})`),
    q.group ? `(group-by ${q.group})` : null,
    q.view?._tag === "Table" ? `(view table ${q.view.columns.join(" ")})` : q.view?._tag === "Board" ? `(view board ${q.view.by})` : null,
    q.limit !== undefined ? `(limit ${q.limit})` : null,
  ]
  return `{{query ${parts.filter((p) => p !== null).join(" ")}}}`
}
