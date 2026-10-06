import { Effect } from "effect"
import { Reactivity } from "effect/reactivity"
import { compile, projectionsOf, type Compiled } from "./compile.ts"
import type { Db, Row } from "./db.ts"
import { evaluate, undersOf, type Assumed } from "./evaluate.ts"
import { fieldDef, type BlockFacets } from "./fields.ts"
import type { Change } from "./index.ts"
import { literal, type QueryContext } from "./literal.ts"
import type { Field, Filter, Query, Value } from "./model.ts"

export interface LiveQuery {
  readonly name: string
  readonly query: Query
  readonly ctx: QueryContext
  readonly compiled: Compiled
  readonly unders: ReadonlyArray<Extract<Filter, { _tag: "Under" }>> | null
  keys: ReadonlyArray<string>
  names: ReadonlyMap<string, ReadonlySet<string>>
  cancel: () => void
  rows: Row[]
  runs: number
}

export interface Tick {
  readonly woken: number
  readonly reran: ReadonlyArray<LiveQuery>
}

const NAMES_SQL = `SELECT ?1 UNION SELECT n2.name FROM page_names n1 JOIN page_names n2 ON n2.page = n1.page WHERE n1.name = ?1`

const walk = (f: Filter, visit: (f: Filter) => void) => {
  visit(f)
  if (f._tag === "And") f.all.forEach((x) => walk(x, visit))
  if (f._tag === "Or") f.any.forEach((x) => walk(x, visit))
  if (f._tag === "Not") walk(f.filter, visit)
  if (f._tag === "Under") walk(f.ancestor, visit)
  if (f._tag === "HasBlock") walk(f.filter, visit)
}

const equalities = (f: Filter): ReadonlyArray<Value> | null =>
  f._tag === "Compare" && f.op === "=" ? [f.value] : f._tag === "In" ? f.values : null

export const keysOf = (q: Query, ctx: QueryContext, names: (lit: string) => ReadonlySet<string>): string[] => {
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
      if (f._tag === "Compare" || f._tag === "In" || f._tag === "Between" || f._tag === "Has") field(f.field, equalities(f))
      if (f._tag === "Search") keys.add("text")
      if (f._tag === "Under") ["tree", "exist", "move"].forEach((k) => keys.add(k))
      if (f._tag === "HasBlock") ["exist", "move"].forEach((k) => keys.add(k))
    })
  for (const f of [...projectionsOf(q), "page"]) field(f, null)
  return [...keys]
}

const nameLiterals = (q: Query, ctx: QueryContext): string[] => {
  const out: string[] = []
  if (q.where)
    walk(q.where, (f) => {
      const eq = equalities(f)
      if (eq === null || !("field" in f)) return
      const def = fieldDef(f.field)
      if (def.type === "name" || def.keyed) for (const v of eq) out.push(String(literal(def, v, ctx, "start")))
    })
  return out
}

export const createLive = (db: Db) => {
  const reactivity = Effect.runSync(Reactivity.make)
  const woken = new Set<LiveQuery>()
  const live: LiveQuery[] = []

  const run = (lq: LiveQuery) => {
    lq.rows = db.all(lq.compiled.sql, lq.compiled.params)
    lq.runs++
  }

  const subscribe = (lq: LiveQuery) => {
    const names = new Map<string, ReadonlySet<string>>()
    const lookup = (lit: string) => {
      let set = names.get(lit)
      if (set === undefined) {
        set = new Set(db.all(NAMES_SQL, [lit]).map((r) => String(r[0])))
        names.set(lit, set)
      }
      return set
    }
    nameLiterals(lq.query, lq.ctx).forEach(lookup)
    lq.cancel()
    lq.names = names
    lq.keys = keysOf(lq.query, lq.ctx, lookup)
    lq.cancel = reactivity.registerUnsafe(lq.keys, () => woken.add(lq))
  }

  const add = (name: string, query: Query, ctx: QueryContext): LiveQuery => {
    const lq: LiveQuery = {
      name,
      query,
      ctx,
      compiled: compile(query, ctx),
      unders: query.find !== "blocks" ? null : query.where === undefined ? [] : undersOf(query.where),
      keys: [],
      names: new Map(),
      cancel: () => {},
      rows: [],
      runs: 0,
    }
    subscribe(lq)
    run(lq)
    live.push(lq)
    return lq
  }

  const names = (lq: LiveQuery) => (n: string) => lq.names.get(n) ?? new Set([n])

  const matches = (lq: LiveQuery, f: BlockFacets | null, assumed: Assumed) =>
    f === null ? false : lq.query.where === undefined ? true : evaluate(lq.query.where, f, lq.ctx, names(lq), assumed)

  const projected = (lq: LiveQuery, f: BlockFacets) =>
    JSON.stringify([...projectionsOf(lq.query), "page"].map((field) => fieldDef(field).values(f)))

  const affected = (lq: LiveQuery, change: Change) => {
    const unders = lq.unders
    if (change.kind !== "block" || unders === null || unders.length > 4) return true
    const { before, after } = change
    if (before && after) {
      for (const u of unders) {
        const a = evaluate(u.ancestor, before, lq.ctx, names(lq))
        if (a === undefined || a !== evaluate(u.ancestor, after, lq.ctx, names(lq))) return true
      }
    }
    for (let mask = 0; mask < 1 << unders.length; mask++) {
      const assumed: Assumed = new Map(unders.map((u, i) => [u, (mask & (1 << i)) !== 0]))
      const was = matches(lq, before, assumed)
      const is = matches(lq, after, assumed)
      if (was === undefined || is === undefined || was !== is) return true
      if (was && projected(lq, before!) !== projected(lq, after!)) return true
    }
    return false
  }

  const apply = (changes: ReadonlyArray<Change>): Tick => {
    const dirty = new Set<LiveQuery>()
    const touched = new Set<LiveQuery>()
    for (const change of changes) {
      woken.clear()
      reactivity.invalidateUnsafe(change.keys)
      for (const lq of woken) {
        touched.add(lq)
        if (!dirty.has(lq) && affected(lq, change)) dirty.add(lq)
      }
    }
    const aliasesMoved = changes.some((c) => "page.alias" in c.keys)
    for (const lq of dirty) {
      if (aliasesMoved) subscribe(lq)
      run(lq)
    }
    return { woken: touched.size, reran: [...dirty] }
  }

  const stale = () => live.filter((lq) => JSON.stringify(db.all(lq.compiled.sql, lq.compiled.params)) !== JSON.stringify(lq.rows))

  return { add, apply, stale, live }
}
