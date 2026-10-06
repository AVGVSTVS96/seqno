import { Match } from "effect"
import type { CompareOp, Field, Filter, QueryContext, Under, Value } from "./ast.ts"
import { tokenize, type BlockFacets } from "./facets.ts"
import { fieldDef, type Primitive } from "./fields.ts"
import { edgeOf, literal } from "./literal.ts"

export type Names = (name: string) => ReadonlySet<string>
export type Assumed = ReadonlyMap<Filter, boolean>
export type Tri = boolean | undefined

const toNum = (value: string): number | null => {
  const n = Number(value)
  return value.trim() !== "" && Number.isFinite(n) ? n : null
}

const cmp = (a: Primitive, op: CompareOp, b: Primitive) => {
  const x = typeof a === "boolean" || typeof b === "boolean" ? Number(a) : a
  const y = typeof a === "boolean" || typeof b === "boolean" ? Number(b) : b
  switch (op) {
    case "=":
      return x === y
    case "!=":
      return x !== y
    case "<":
      return x < y
    case "<=":
      return x <= y
    case ">":
      return x > y
    case ">=":
      return x >= y
  }
}

const operand = (v: Primitive, lit: Primitive): Primitive | null =>
  typeof lit === "number" && typeof v === "string" ? toNum(v) : v

const compare = (
  field: Field,
  op: CompareOp,
  value: Value,
  f: BlockFacets,
  ctx: QueryContext,
  names: Names,
): boolean => {
  if (op === "!=") return !compare(field, "=", value, f, ctx, names)
  const def = fieldDef(field)
  if (op === "=" && def.type === "time") return between(field, value, value, f, ctx)
  const lit = literal(def, value, ctx, edgeOf(op))
  const values = def.values(f)
  if (op === "=" && def.type === "name") {
    const set = names(String(lit))
    return values.some((v) => set.has(String(v)))
  }
  return values.some((v) => {
    const x = operand(v, lit)
    return x !== null && cmp(x, op, lit)
  })
}

const between = (field: Field, from: Value, to: Value, f: BlockFacets, ctx: QueryContext) => {
  const def = fieldDef(field)
  const lo = literal(def, from, ctx, "start")
  const hi = literal(def, to, ctx, "end")
  return def.values(f).some((v) => {
    const x = operand(v, lo)
    return x !== null && cmp(x, ">=", lo) && cmp(x, "<=", hi)
  })
}

const phrase = (content: string, text: string): Tri => {
  const hay = tokenize(content)
  const needle = tokenize(text)
  if (hay === null || needle === null) return undefined
  if (needle.length === 0) return false
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((t, j) => hay[i + j] === t)) return true
  return false
}

const all = (results: ReadonlyArray<() => Tri>, stop: boolean): Tri => {
  let out: Tri = !stop
  for (const run of results) {
    const r = run()
    if (r === stop) return stop
    if (r === undefined) out = undefined
  }
  return out
}

export const evaluate = (
  f: Filter,
  facets: BlockFacets,
  ctx: QueryContext,
  names: Names,
  assumed: Assumed = new Map(),
): Tri =>
  Match.valueTags(f, {
    And: (x): Tri =>
      all(
        x.all.map((y) => () => evaluate(y, facets, ctx, names, assumed)),
        false,
      ),
    Or: (x): Tri =>
      all(
        x.any.map((y) => () => evaluate(y, facets, ctx, names, assumed)),
        true,
      ),
    Not: (x): Tri => {
      const r = evaluate(x.filter, facets, ctx, names, assumed)
      return r === undefined ? undefined : !r
    },
    Compare: (x): Tri => compare(x.field, x.op, x.value, facets, ctx, names),
    In: (x): Tri => x.values.some((v) => compare(x.field, "=", v, facets, ctx, names)),
    Between: (x): Tri => between(x.field, x.from, x.to, facets, ctx),
    Has: (x): Tri => fieldDef(x.field).values(facets).length > 0,
    Search: (x): Tri => phrase(facets.content, x.text),
    Under: (x): Tri => assumed.get(x),
    HasBlock: (x): Tri => assumed.get(x),
  })

const nodes = (f: Filter): Filter[] =>
  f._tag === "And"
    ? f.all.flatMap(nodes)
    : f._tag === "Or"
      ? f.any.flatMap(nodes)
      : f._tag === "Not"
        ? nodes(f.filter)
        : [f]

export const isLocal = (f: Filter): boolean =>
  nodes(f).every((n) => n._tag !== "Under" && n._tag !== "HasBlock")

export const undersOf = (f: Filter): Under[] | null => {
  const found = nodes(f).flatMap((n): Array<Under | null> =>
    n._tag === "Under" ? [n] : n._tag === "HasBlock" ? [null] : [],
  )
  const unders = found.filter((n): n is Under => n !== null)
  return unders.length === found.length && unders.every((u) => isLocal(u.ancestor)) ? unders : null
}
