import type { SqlValue } from "./db.ts"
import { fieldDef, type FieldDef } from "./fields.ts"
import { edgeOf, fail, literal, type QueryContext } from "./literal.ts"
import { tokenize } from "./markdown.ts"
import type { CompareOp, Field, Filter, Query, Value } from "./model.ts"

export interface Compiled {
  readonly sql: string
  readonly params: ReadonlyArray<SqlValue>
  readonly projections: ReadonlyArray<Field>
}

interface Aliases {
  readonly b?: string
  readonly p: string
}

interface State {
  readonly ctx: QueryContext
  readonly params: SqlValue[]
  readonly ctes: string[]
  n: number
}

const param = (st: State, v: string | number | boolean) => `?${st.params.push(typeof v === "boolean" ? (v ? 1 : 0) : v)}`

const NAME_SET = (k: string) =>
  `SELECT ${k} UNION SELECT n2.name FROM page_names n1 JOIN page_names n2 ON n2.page = n1.page WHERE n1.name = ${k}`

const ownerRef = (def: FieldDef, a: Aliases, field: Field) => {
  if (def.owner === "page") return `${a.p}.rid`
  if (a.b === undefined) return fail(`${field} is a block field; wrap it in a block condition to use it in a pages query`)
  return `${a.b}.rid`
}

const onField = (field: Field, a: Aliases, test: (col: string, num?: string) => string) => {
  const def = fieldDef(field)
  const s = def.storage
  const owner = ownerRef(def, a, field)
  const alias = def.owner === "page" ? a.p : a.b!
  if (s.kind === "column") return test(s.expr(alias))
  const ownerCol = def.owner === "page" ? "page" : "block"
  const cond = s.cond ? `${s.cond("x")} AND ` : ""
  return `${owner} IN (SELECT x.${ownerCol} FROM ${s.table} x WHERE ${cond}${test(`x.${s.col}`, s.num && `x.${s.num}`)})`
}

const pick = (lit: string | number | boolean, col: string, num?: string) => (typeof lit === "number" && num ? num : col)

const compare = (field: Field, op: CompareOp, value: Value, a: Aliases, st: State): string => {
  const def = fieldDef(field)
  if (op === "!=") return `NOT coalesce(${compare(field, "=", value, a, st)}, 0)`
  if (op === "=" && def.type === "time") return between(field, value, value, a, st)
  const lit = literal(def, value, st.ctx, edgeOf(op))
  if (op === "=" && def.type === "name") {
    const k = param(st, lit)
    return onField(field, a, (col) => `${col} IN (${NAME_SET(k)})`)
  }
  const k = param(st, lit)
  return onField(field, a, (col, num) => `${pick(lit, col, num)} ${op} ${k}`)
}

const between = (field: Field, from: Value, to: Value, a: Aliases, st: State) => {
  const def = fieldDef(field)
  const lo = literal(def, from, st.ctx, "start")
  const hi = literal(def, to, st.ctx, "end")
  const [k1, k2] = [param(st, lo), param(st, hi)]
  return onField(field, a, (col, num) => `${pick(lo, col, num)} BETWEEN ${k1} AND ${k2}`)
}

const blockSelect = (f: Filter, st: State) => {
  const k = ++st.n
  const a = { b: `b${k}`, p: `p${k}` }
  return `SELECT ${a.b}.rid FROM blocks ${a.b} JOIN pages ${a.p} ON ${a.p}.rid = ${a.b}.page WHERE ${filterSql(f, a, st)}`
}

const under = (f: Extract<Filter, { _tag: "Under" }>, a: Aliases, st: State) => {
  if (a.b === undefined) return fail("UNDER needs a block; use it inside a block condition")
  const k = ++st.n
  if (f.direct) {
    st.ctes.push(`s${k}(rid) AS (${blockSelect(f.ancestor, st)})`)
    return f.self ? `(${a.b}.rid IN s${k} OR ${a.b}.parent IN s${k})` : `${a.b}.parent IN s${k}`
  }
  const base = f.self ? blockSelect(f.ancestor, st) : `SELECT c.rid FROM blocks c WHERE c.parent IN (${blockSelect(f.ancestor, st)})`
  st.ctes.push(`u${k}(rid) AS (${base} UNION SELECT c.rid FROM blocks c JOIN u${k} ON c.parent = u${k}.rid)`)
  return `${a.b}.rid IN u${k}`
}

const filterSql = (f: Filter, a: Aliases, st: State): string => {
  switch (f._tag) {
    case "And":
      return f.all.length === 0 ? "1" : `(${f.all.map((x) => filterSql(x, a, st)).join(" AND ")})`
    case "Or":
      return f.any.length === 0 ? "0" : `(${f.any.map((x) => filterSql(x, a, st)).join(" OR ")})`
    case "Not":
      return `NOT coalesce(${filterSql(f.filter, a, st)}, 0)`
    case "Compare":
      return compare(f.field, f.op, f.value, a, st)
    case "In":
      return f.values.length === 0 ? "0" : `(${f.values.map((v) => compare(f.field, "=", v, a, st)).join(" OR ")})`
    case "Between":
      return between(f.field, f.from, f.to, a, st)
    case "Has":
      return onField(f.field, a, (col) => `${col} IS NOT NULL`)
    case "Search": {
      if (a.b === undefined) return fail("text search needs a block; use it inside a block condition")
      if (tokenize(f.text)?.length === 0) return "0"
      return `${a.b}.rid IN (SELECT rowid FROM fts WHERE fts MATCH ${param(st, `"${f.text.replaceAll('"', '""')}"`)})`
    }
    case "Under":
      return under(f, a, st)
    case "HasBlock": {
      const k = ++st.n
      const inner = { b: `b${k}`, p: `p${k}` }
      return `${a.p}.rid IN (SELECT ${inner.b}.page FROM blocks ${inner.b} JOIN pages ${inner.p} ON ${inner.p}.rid = ${inner.b}.page WHERE ${filterSql(f.filter, inner, st)})`
    }
  }
}

const valueSql = (field: Field, a: Aliases, agg: "list" | "min") => {
  const def = fieldDef(field)
  const s = def.storage
  const owner = ownerRef(def, a, field)
  if (s.kind === "column") return s.expr(def.owner === "page" ? a.p : a.b!)
  const ownerCol = def.owner === "page" ? "page" : "block"
  const cond = s.cond ? ` AND ${s.cond("x")}` : ""
  const col = `x.${s.col}`
  const expr = !s.many ? col : agg === "min" ? `min(${def.type === "any" ? `coalesce(x.num, ${col})` : col})` : `group_concat(${col}, ', ' ORDER BY ${col})`
  return `(SELECT ${expr} FROM ${s.table} x WHERE x.${ownerCol} = ${owner}${cond})`
}

export const projectionsOf = (q: Query): Field[] => {
  const fields = [
    ...(q.group ? [q.group] : []),
    ...(q.view?._tag === "Table" ? q.view.columns : q.view?._tag === "Board" ? [q.view.by] : []),
    ...(q.sort ?? []).map((s) => s.field),
  ]
  return [...new Set(fields)]
}

export const compile = (q: Query, ctx: QueryContext): Compiled => {
  const st: State = { ctx, params: [], ctes: [], n: 0 }
  const a: Aliases = q.find === "blocks" ? { b: "b", p: "p" } : { p: "p" }
  const where = q.where ? filterSql(q.where, a, st) : "1"
  const projections = projectionsOf(q)
  const select = [q.find === "blocks" ? "b.rid" : "p.rid", ...projections.map((f) => valueSql(f, a, "list"))]
  const order = [
    ...(q.sort ?? []).map((s) => `${valueSql(s.field, a, "min")} ${s.dir.toUpperCase()} NULLS LAST`),
    "p.day DESC NULLS LAST",
    "p.name_lc",
    ...(q.find === "blocks" ? ["b.rid"] : []),
  ]
  const from = q.find === "blocks" ? "blocks b JOIN pages p ON p.rid = b.page" : "pages p"
  const sql = [
    st.ctes.length > 0 ? `WITH RECURSIVE ${st.ctes.join(",\n  ")}` : "",
    `SELECT ${select.join(", ")}`,
    `FROM ${from}`,
    `WHERE ${where}`,
    `ORDER BY ${order.join(", ")}`,
    q.limit !== undefined ? `LIMIT ${q.limit}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n")
  return { sql, params: st.params, projections }
}
