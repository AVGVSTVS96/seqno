import { Match } from "effect"
import type { CompareOp, Field, Filter, Query, Value, View } from "../ast.ts"
import { fail } from "../error.ts"

const pad = (n: number, width: number) => String(n).padStart(width, "0")

const value = (v: Value): string => {
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v)
  }

  if (typeof v === "string") {
    return /^[a-z_][\w./-]*$/iu.test(v) && !/^[+-]?\d/u.test(v) ? v : JSON.stringify(v)
  }

  return Match.valueTags(v, {
    Context: (c) => `@${c.of}`,
    AbsDate: (d) =>
      `${pad(Math.floor(d.ymd / 10_000), 4)}-${pad(Math.floor(d.ymd / 100) % 100, 2)}-${pad(d.ymd % 100, 2)}`,
    RelDate: (r) =>
      r.amount === 0 && r.unit === "d" ? "today" : `${r.amount > 0 ? "+" : ""}${r.amount}${r.unit}`,
  })
}

const values = (vs: readonly Value[]) => vs.map(value).join(" ")

const PROPERTY = /^property\.(.+)$/u

const equals = (field: Field, vs: readonly Value[]): string => {
  if (field === "task.status") {
    return `(task ${values(vs)})`
  }

  if (field === "task.priority") {
    return `(priority ${values(vs)})`
  }

  if (field === "page.namespace") {
    return `(namespace ${values(vs)})`
  }

  const [, key] = PROPERTY.exec(field) ?? []

  if (key !== undefined) {
    return `(property ${key} ${values(vs)})`
  }

  return `(${field} ${values(vs)})`
}

const compare = (field: Field, op: CompareOp, v: Value) =>
  op === "=" ? equals(field, [v]) : `(${field} ${op} ${value(v)})`

const filter = (f: Filter): string =>
  Match.valueTags(f, {
    And: (x) => `(and ${x.all.map(filter).join(" ")})`,
    Or: (x) => `(or ${x.any.map(filter).join(" ")})`,
    Not: (x) => `(not ${filter(x.filter)})`,
    Search: (x) => JSON.stringify(x.text),
    HasBlock: (x) => `(has-block ${filter(x.filter)})`,
    Under: (x) => {
      const a = x.ancestor

      if (x.self && !x.direct && a._tag === "Compare" && a.field === "ref" && a.op === "=") {
        return typeof a.value === "object" && a.value._tag === "Context"
          ? "@page"
          : `[[${String(a.value)}]]`
      }

      if (x.self) {
        return fail("an inclusive UNDER over anything but a page reference has no text form")
      }

      return `(${x.direct ? "child-of" : "under"} ${filter(a)})`
    },
    Has: (x) => {
      const [, key] = PROPERTY.exec(x.field) ?? []

      return key === undefined ? `(${x.field})` : `(property ${key})`
    },
    Between: (x) =>
      x.field === "page.day"
        ? `(between ${value(x.from)} ${value(x.to)})`
        : `(between ${x.field} ${value(x.from)} ${value(x.to)})`,
    In: (x) => equals(x.field, x.values),
    Compare: (x) => compare(x.field, x.op, x.value),
  })

const view = (v: View): string | null =>
  Match.valueTags(v, {
    List: () => null,
    Table: (t) => `(view table ${t.columns.join(" ")})`,
    Board: (b) => `(view board ${b.by})`,
  })

export const printLogseq = (q: Query): string => {
  const where = q.where ? filter(q.where) : null

  const parts = [
    q.find === "pages" ? `(pages${where ? ` ${where}` : ""})` : where,
    ...(q.sort ?? []).map((s) => `(sort-by ${s.field} ${s.dir})`),
    q.group ? `(group-by ${q.group})` : null,
    q.view ? view(q.view) : null,
    q.limit === undefined ? null : `(limit ${q.limit})`,
  ]

  return `{{query ${parts.filter((p) => p !== null).join(" ")}}}`
}
