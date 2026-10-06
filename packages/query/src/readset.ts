import { childrenOf, type Field, type Filter, type Query, type QueryContext, type Value } from "./ast.ts"
import { projectionsOf } from "./compile.ts"
import { evaluate, undersOf, type Assumed, type Names } from "./evaluate.ts"
import type { BlockFacets, PageFacets, TaskFacets } from "./facets.ts"
import { fieldDef } from "./fields.ts"
import { literal } from "./literal.ts"

const walk = (f: Filter, visit: (f: Filter) => void): void => {
  visit(f)
  for (const child of childrenOf(f)) walk(child, visit)
}

const equalities = (f: Filter): { readonly field: Field; readonly values: ReadonlyArray<Value> } | null =>
  f._tag === "Compare" && f.op === "=" ? { field: f.field, values: [f.value] } : f._tag === "In" ? { field: f.field, values: f.values } : null

const fieldOf = (f: Filter): Field | null =>
  f._tag === "Compare" || f._tag === "In" || f._tag === "Between" || f._tag === "Has" ? f.field : null

export const namesOf = (q: Query, ctx: QueryContext): string[] => {
  const out = new Set<string>()
  if (q.where)
    walk(q.where, (f) => {
      const eq = equalities(f)
      if (eq === null) return
      const def = fieldDef(eq.field)
      if (def.type === "name" || def.keyed) for (const v of eq.values) out.add(String(literal(def, v, ctx, "start")))
    })
  return [...out]
}

export const readSet = (q: Query, ctx: QueryContext, names: Names): string[] => {
  const keys = new Set<string>(q.find === "blocks" ? ["exist"] : [])
  const field = (name: Field, eq: ReadonlyArray<Value> | null) => {
    const def = fieldDef(name)
    if (def.owner === "page") keys.add("move")
    if (def.type === "name") keys.add("page.alias")
    if (def.keyed && eq) for (const v of eq) for (const n of names(String(literal(def, v, ctx, "start")))) keys.add(`${def.key}:${n}`)
    else keys.add(def.key)
  }
  if (q.where)
    walk(q.where, (f) => {
      const name = fieldOf(f)
      if (name !== null) field(name, equalities(f)?.values ?? null)
      if (f._tag === "Search") keys.add("text")
      if (f._tag === "Under") ["tree", "exist", "move"].forEach((k) => keys.add(k))
      if (f._tag === "HasBlock") ["exist", "move"].forEach((k) => keys.add(k))
    })
  const shown: Field[] = [...projectionsOf(q), "page"]
  for (const f of shown) field(f, null)
  return [...keys]
}

const symdiff = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const sa = new Set(a)
  const sb = new Set(b)
  return [...new Set([...a.filter((x) => !sb.has(x)), ...b.filter((x) => !sa.has(x))])]
}

type Props = ReadonlyArray<readonly [string, string]>

const changedProps = (a: Props, b: Props) => {
  const joined = (ps: Props, key: string) => ps.flatMap(([k, v]) => (k === key ? [v] : [])).join("\u0000")
  return [...new Set([...a, ...b].map(([k]) => k))].filter((k) => joined(a, k) !== joined(b, k))
}

const TASK_FIELDS = ["status", "priority", "scheduled", "deadline"] satisfies ReadonlyArray<keyof TaskFacets>

const collector = () => {
  const out = new Set<string>()
  const add = (key: string, values: ReadonlyArray<string> = []) => {
    out.add(key)
    for (const v of values) out.add(`${key}:${v}`)
  }
  const diff = (key: string, values: ReadonlyArray<string>) => {
    if (values.length > 0) add(key, values)
  }
  return { out, add, diff }
}

export const blockTouches = (before: BlockFacets | null, after: BlockFacets | null): string[] => {
  const { out, add, diff } = collector()
  if (before === null || after === null) ["exist", "tree", "text", "created", "updated"].forEach((k) => add(k))
  else {
    if (before.parent !== after.parent) add("tree")
    if (before.page.name !== after.page.name) add("move")
    if (before.content !== after.content) add("text")
    if (before.created !== after.created) add("created")
    if (before.updated !== after.updated) add("updated")
  }
  diff("ref", symdiff(before?.refs ?? [], after?.refs ?? []))
  diff("tag", symdiff(before?.tags ?? [], after?.tags ?? []))
  diff("property", changedProps(before?.props ?? [], after?.props ?? []))
  for (const f of TASK_FIELDS) if ((before?.task?.[f] ?? null) !== (after?.task?.[f] ?? null)) add(`task.${f}`)
  return [...out]
}

export const pageTouches = (before: PageFacets | null, after: PageFacets | null): string[] => {
  const { out, add, diff } = collector()
  if (before === null || after === null || before.name !== after.name || before.day !== after.day) add("page.name")
  diff("page.tag", symdiff(before?.tags ?? [], after?.tags ?? []))
  diff("page.property", changedProps(before?.props ?? [], after?.props ?? []))
  diff("page.namespace", symdiff(before?.namespaces ?? [], after?.namespaces ?? []))
  if (symdiff(before?.aliases ?? [], after?.aliases ?? []).length > 0) add("page.alias")
  return [...out]
}

const MAX_UNDERS = 4

export const blockChangeAffects = (
  q: Query,
  ctx: QueryContext,
  names: Names,
  before: BlockFacets | null,
  after: BlockFacets | null,
): boolean => {
  if (q.find !== "blocks") return true
  const where = q.where
  const unders = where === undefined ? [] : undersOf(where)
  if (unders === null || unders.length > MAX_UNDERS) return true
  if (before !== null && after !== null) {
    for (const u of unders) {
      const was = evaluate(u.ancestor, before, ctx, names)
      if (was === undefined || was !== evaluate(u.ancestor, after, ctx, names)) return true
    }
  }
  const shown: Field[] = [...projectionsOf(q), "page"]
  const projected = (f: BlockFacets) => JSON.stringify(shown.map((field) => fieldDef(field).values(f)))
  const matches = (f: BlockFacets | null, assumed: Assumed) => (f === null ? false : where === undefined ? true : evaluate(where, f, ctx, names, assumed))
  for (let mask = 0; mask < 1 << unders.length; mask++) {
    const assumed: Assumed = new Map(unders.map((u, i) => [u, (mask & (1 << i)) !== 0]))
    const was = matches(before, assumed)
    const is = matches(after, assumed)
    if (was === undefined || is === undefined || was !== is) return true
    if (was && before !== null && after !== null && projected(before) !== projected(after)) return true
  }
  return false
}
