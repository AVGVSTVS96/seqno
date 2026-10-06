import { Match, Schema } from "effect"
import {
  Field,
  type CompareOp,
  type Filter,
  type Query,
  type QueryContext,
  type Under,
  type Value,
} from "./ast.ts"
import { fail } from "./error.ts"
import { tokenize } from "./facets.ts"
import { fieldDef, type FieldDef, type Primitive } from "./fields.ts"
import { edgeOf, literal } from "./literal.ts"

export const SqlValue = Schema.Union([Schema.String, Schema.Finite, Schema.Null])
export type SqlValue = typeof SqlValue.Type

export const Compiled = Schema.Struct({
  sql: Schema.String,
  params: Schema.Array(SqlValue),
  projections: Schema.Array(Field),
})
export type Compiled = typeof Compiled.Type

interface Aliases {
  readonly b: string | undefined
  readonly p: string
}

interface State {
  readonly ctx: QueryContext
  readonly params: SqlValue[]
  readonly ctes: string[]
  n: number
}

const param = (st: State, v: Primitive) =>
  `?${st.params.push(typeof v === "boolean" ? (v ? 1 : 0) : v)}`

const NAME_SET = (k: string) =>
  `SELECT ${k} UNION SELECT n2.name FROM page_names n1 JOIN page_names n2 ON n2.page = n1.page WHERE n1.name = ${k}`

const ownerAlias = (def: FieldDef, a: Aliases, field: Field): string =>
  def.owner === "page"
    ? a.p
    : (a.b ??
      fail(`${field} is a block field; wrap it in a block condition to use it in a pages query`))

const blockAlias = (a: Aliases, what: string): string =>
  a.b ?? fail(`${what} needs a block; use it inside a block condition`)

const onField = (field: Field, a: Aliases, test: (col: string, num?: string) => string) => {
  const def = fieldDef(field)
  const alias = ownerAlias(def, a, field)
  const s = def.storage
  if (s._tag === "Column") return test(s.expr(alias))
  const ownerCol = def.owner === "page" ? "page" : "block"
  const cond = s.cond ? `${s.cond("x")} AND ` : ""
  return `${alias}.rid IN (SELECT x.${ownerCol} FROM ${s.table} x WHERE ${cond}${test(`x.${s.col}`, s.num && `x.${s.num}`)})`
}

const pick = (lit: Primitive, col: string, num?: string) =>
  typeof lit === "number" && num ? num : col

const compare = (field: Field, op: CompareOp, value: Value, a: Aliases, st: State): string => {
  const def = fieldDef(field)
  if (op === "!=") return `NOT coalesce(${compare(field, "=", value, a, st)}, 0)`
  if (op === "=" && def.type === "time") return between(field, value, value, a, st)
  const lit = literal(def, value, st.ctx, edgeOf(op))
  const k = param(st, lit)
  if (op === "=" && def.type === "name")
    return onField(field, a, (col) => `${col} IN (${NAME_SET(k)})`)
  return onField(field, a, (col, num) => `${pick(lit, col, num)} ${op} ${k}`)
}

const between = (field: Field, from: Value, to: Value, a: Aliases, st: State) => {
  const def = fieldDef(field)
  const lo = literal(def, from, st.ctx, "start")
  const hi = literal(def, to, st.ctx, "end")
  const k1 = param(st, lo)
  const k2 = param(st, hi)
  return onField(field, a, (col, num) => `${pick(lo, col, num)} BETWEEN ${k1} AND ${k2}`)
}

const blockSelect = (f: Filter, st: State) => {
  const k = ++st.n
  const a = { b: `b${k}`, p: `p${k}` }
  return `SELECT ${a.b}.rid FROM blocks ${a.b} JOIN pages ${a.p} ON ${a.p}.rid = ${a.b}.page WHERE ${filterSql(f, a, st)}`
}

const under = (f: Under, a: Aliases, st: State) => {
  const b = blockAlias(a, "UNDER")
  const k = ++st.n
  if (f.direct) {
    st.ctes.push(`s${k}(rid) AS (${blockSelect(f.ancestor, st)})`)
    return f.self ? `(${b}.rid IN s${k} OR ${b}.parent IN s${k})` : `${b}.parent IN s${k}`
  }
  const base = f.self
    ? blockSelect(f.ancestor, st)
    : `SELECT c.rid FROM blocks c WHERE c.parent IN (${blockSelect(f.ancestor, st)})`
  st.ctes.push(
    `u${k}(rid) AS (${base} UNION SELECT c.rid FROM blocks c JOIN u${k} ON c.parent = u${k}.rid)`,
  )
  return `${b}.rid IN u${k}`
}

const filterSql = (f: Filter, a: Aliases, st: State): string =>
  Match.valueTags(f, {
    And: (x) =>
      x.all.length === 0 ? "1" : `(${x.all.map((y) => filterSql(y, a, st)).join(" AND ")})`,
    Or: (x) =>
      x.any.length === 0 ? "0" : `(${x.any.map((y) => filterSql(y, a, st)).join(" OR ")})`,
    Not: (x) => `NOT coalesce(${filterSql(x.filter, a, st)}, 0)`,
    Compare: (x) => compare(x.field, x.op, x.value, a, st),
    In: (x) =>
      x.values.length === 0
        ? "0"
        : `(${x.values.map((v) => compare(x.field, "=", v, a, st)).join(" OR ")})`,
    Between: (x) => between(x.field, x.from, x.to, a, st),
    Has: (x) => onField(x.field, a, (col) => `${col} IS NOT NULL`),
    Search: (x) => {
      const b = blockAlias(a, "text search")
      if (tokenize(x.text)?.length === 0) return "0"
      return `${b}.rid IN (SELECT rowid FROM fts WHERE fts MATCH ${param(st, `"${x.text.replaceAll('"', '""')}"`)})`
    },
    Under: (x) => under(x, a, st),
    HasBlock: (x) => {
      const k = ++st.n
      const inner = { b: `b${k}`, p: `p${k}` }
      return `${a.p}.rid IN (SELECT ${inner.b}.page FROM blocks ${inner.b} JOIN pages ${inner.p} ON ${inner.p}.rid = ${inner.b}.page WHERE ${filterSql(x.filter, inner, st)})`
    },
  })

const valueSql = (field: Field, a: Aliases, agg: "list" | "min") => {
  const def = fieldDef(field)
  const alias = ownerAlias(def, a, field)
  const s = def.storage
  if (s._tag === "Column") return s.expr(alias)
  const ownerCol = def.owner === "page" ? "page" : "block"
  const cond = s.cond ? ` AND ${s.cond("x")}` : ""
  const col = `x.${s.col}`
  const expr = !s.many
    ? col
    : agg === "min"
      ? `min(${def.type === "any" ? `coalesce(x.num, ${col})` : col})`
      : `group_concat(${col}, ', ' ORDER BY ${col})`
  return `(SELECT ${expr} FROM ${s.table} x WHERE x.${ownerCol} = ${alias}.rid${cond})`
}

export const projectionsOf = (q: Query): Field[] => {
  const view = q.view
  const shown =
    view === undefined
      ? []
      : Match.valueTags(view, { List: () => [], Table: (t) => t.columns, Board: (b) => [b.by] })
  return [
    ...new Set([...(q.group ? [q.group] : []), ...shown, ...(q.sort ?? []).map((s) => s.field)]),
  ]
}

export const compile = (q: Query, ctx: QueryContext): Compiled => {
  const st: State = { ctx, params: [], ctes: [], n: 0 }
  const blocks = q.find === "blocks"
  const a: Aliases = { b: blocks ? "b" : undefined, p: "p" }
  const where = q.where ? filterSql(q.where, a, st) : "1"
  const projections = projectionsOf(q)
  const select = [blocks ? "b.rid" : "p.rid", ...projections.map((f) => valueSql(f, a, "list"))]
  const order = [
    ...(q.sort ?? []).map(
      (s) => `${valueSql(s.field, a, "min")} ${s.dir.toUpperCase()} NULLS LAST`,
    ),
    "p.day DESC NULLS LAST",
    "p.name_lc",
    ...(blocks ? ["b.rid"] : []),
  ]
  const sql = [
    st.ctes.length > 0 ? `WITH RECURSIVE ${st.ctes.join(",\n  ")}` : "",
    `SELECT ${select.join(", ")}`,
    `FROM ${blocks ? "blocks b JOIN pages p ON p.rid = b.page" : "pages p"}`,
    `WHERE ${where}`,
    `ORDER BY ${order.join(", ")}`,
    q.limit !== undefined ? `LIMIT ${q.limit}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n")
  return { sql, params: st.params, projections }
}
