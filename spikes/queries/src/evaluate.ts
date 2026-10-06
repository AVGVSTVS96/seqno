import { fieldDef, type BlockFacets, type Primitive } from "./fields.ts"
import { edgeOf, literal, type QueryContext } from "./literal.ts"
import { tokenize, toNum } from "./markdown.ts"
import type { CompareOp, Field, Filter, Value } from "./model.ts"

export type Names = (name: string) => ReadonlySet<string>
export type Assumed = ReadonlyMap<Filter, boolean>

type Tri = boolean | undefined

const cmp = (a: Primitive, op: CompareOp, b: Primitive) => {
  const [x, y] = typeof a === "boolean" || typeof b === "boolean" ? [Number(a), Number(b)] : [a, b]
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

const compare = (field: Field, op: CompareOp, value: Value, f: BlockFacets, ctx: QueryContext, names: Names): boolean => {
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
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((t, j) => hay[i + j] === t)) return true
  return false
}

export const evaluate = (f: Filter, facets: BlockFacets, ctx: QueryContext, names: Names, assumed: Assumed = new Map()): Tri => {
  switch (f._tag) {
    case "And": {
      let out: Tri = true
      for (const x of f.all) {
        const r = evaluate(x, facets, ctx, names, assumed)
        if (r === false) return false
        if (r === undefined) out = undefined
      }
      return out
    }
    case "Or": {
      let out: Tri = false
      for (const x of f.any) {
        const r = evaluate(x, facets, ctx, names, assumed)
        if (r === true) return true
        if (r === undefined) out = undefined
      }
      return out
    }
    case "Not": {
      const r = evaluate(f.filter, facets, ctx, names, assumed)
      return r === undefined ? undefined : !r
    }
    case "Compare":
      return compare(f.field, f.op, f.value, facets, ctx, names)
    case "In":
      return f.values.some((v) => compare(f.field, "=", v, facets, ctx, names))
    case "Between":
      return between(f.field, f.from, f.to, facets, ctx)
    case "Has":
      return fieldDef(f.field).values(facets).length > 0
    case "Search":
      return phrase(facets.content, f.text)
    case "Under":
    case "HasBlock":
      return assumed.get(f)
  }
}

const nodes = (f: Filter): Filter[] =>
  f._tag === "And" ? f.all.flatMap(nodes) : f._tag === "Or" ? f.any.flatMap(nodes) : f._tag === "Not" ? nodes(f.filter) : [f]

export const isLocal = (f: Filter): boolean => nodes(f).every((n) => n._tag !== "Under" && n._tag !== "HasBlock")

export const undersOf = (f: Filter): Extract<Filter, { _tag: "Under" }>[] | null => {
  const found = nodes(f).filter((n) => n._tag === "Under" || n._tag === "HasBlock")
  return found.every((n) => n._tag === "Under" && isLocal(n.ancestor)) ? (found as Extract<Filter, { _tag: "Under" }>[]) : null
}
