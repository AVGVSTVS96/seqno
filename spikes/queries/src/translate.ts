import { parseDateWord } from "./dates.ts"
import { and, finishQuery, or, type CompareOp, type Field, type Filter, type Query, type Sort, type Value } from "./model.ts"
import { read, show, type Form } from "./syntax/reader.ts"
import { parseSimple } from "./syntax/simple.ts"
import { pathRef } from "./syntax/values.ts"

export type Translation =
  | { readonly _tag: "Translated"; readonly query: Query; readonly warnings: ReadonlyArray<string> }
  | { readonly _tag: "ConvertMe"; readonly original: string; readonly reason: string }

class Unsupported {
  readonly reason: string
  constructor(reason: string) {
    this.reason = reason
  }
}
const unsupported = (reason: string): never => {
  throw new Unsupported(reason)
}

type Term = { readonly k: "var"; readonly name: string } | { readonly k: "blank" } | { readonly k: "const"; readonly form: Form }

type Clause =
  | { readonly t: "pattern"; readonly e: Term; readonly a: string; readonly v: Term; readonly form: Form }
  | { readonly t: "pred"; readonly fn: string; readonly args: ReadonlyArray<Term>; readonly out: Term | null; readonly form: Form }
  | { readonly t: "call"; readonly name: string; readonly args: ReadonlyArray<Term>; readonly form: Form }
  | { readonly t: "not"; readonly body: ReadonlyArray<Clause>; readonly form: Form }
  | { readonly t: "or"; readonly branches: ReadonlyArray<ReadonlyArray<Clause>>; readonly form: Form }

interface Scope {
  readonly clauses: ReadonlyArray<Clause>
  readonly parent: Scope | null
}

interface Rule {
  readonly params: ReadonlyArray<string>
  readonly bodies: ReadonlyArray<ReadonlyArray<Form>>
}

const term = (f: Form): Term =>
  f.t === "sym" && f.v.startsWith("?") ? { k: "var", name: f.v } : f.t === "sym" && f.v === "_" ? { k: "blank" } : { k: "const", form: f }

const parseClause = (f: Form): Clause => {
  if (f.t === "vec" && f.items[0]?.t === "list") {
    const [call, out] = f.items as [{ items: Form[] }, Form | undefined]
    const [fn, ...args] = call.items
    return { t: "pred", fn: fn?.t === "sym" ? fn.v : "?", args: args.map(term), out: out ? term(out) : null, form: f }
  }
  if (f.t === "vec" && f.items.length === 3 && f.items[1]?.t === "kw") {
    return { t: "pattern", e: term(f.items[0]!), a: f.items[1].v, v: term(f.items[2]!), form: f }
  }
  if (f.t === "vec" && f.items.length === 2 && f.items[1]?.t === "kw") {
    return { t: "pattern", e: term(f.items[0]!), a: f.items[1].v, v: { k: "blank" }, form: f }
  }
  if (f.t === "list" && f.items[0]?.t === "sym") {
    const [head, ...rest] = f.items as [{ v: string }, ...Form[]]
    if (head.v === "not") return { t: "not", body: rest.map(parseClause), form: f }
    if (head.v === "or")
      return {
        t: "or",
        branches: rest.map((b) => (b.t === "list" && b.items[0]?.t === "sym" && b.items[0].v === "and" ? b.items.slice(1).map(parseClause) : [parseClause(b)])),
        form: f,
      }
    if (head.v === "or-join" || head.v === "not-join" || head.v === "and") return unsupported(`${head.v} is not translated`)
    return { t: "call", name: head.v, args: rest.map(term), form: f }
  }
  return unsupported(`can't read clause ${show(f)}`)
}

const mentions = (c: Clause, v: string): boolean => {
  const inTerm = (t: Term) => t.k === "var" && t.name === v
  switch (c.t) {
    case "pattern":
      return inTerm(c.e) || inTerm(c.v)
    case "pred":
      return c.args.some(inTerm) || (c.out !== null && inTerm(c.out))
    case "call":
      return c.args.some(inTerm)
    case "not":
      return c.body.some((x) => mentions(x, v))
    case "or":
      return c.branches.some((b) => b.some((x) => mentions(x, v)))
  }
}

const isVar = (t: Term, v: string) => t.k === "var" && t.name === v
const lower = (s: string) => s.toLowerCase()

const inputValue = (f: Form): Value | ReadonlyArray<Form> => {
  if (f.t === "str" || f.t === "num") return f.v
  if (f.t === "vec") return f.items
  if (f.t === "kw") {
    if (f.v === "current-page") return { _tag: "Context", of: "page" }
    if (f.v === "current-block") return { _tag: "Context", of: "block" }
    return parseDateWord(f.v) ?? unsupported(`input :${f.v}`)
  }
  return unsupported(`input ${show(f)}`)
}

const SORT_ATTRS: Record<string, Field> = {
  "block/priority": "task.priority",
  "block/created-at": "created",
  "block/updated-at": "updated",
  "block/scheduled": "task.scheduled",
  "block/deadline": "task.deadline",
}

const sortOf = (f: Form): Sort => {
  const src = show(f)
  const m = /^\(fn \[(\S+)\] (\(reverse )?\(sort-by \(fn \[(\S+)\] \(get \3 :(block\/[\w-]+)(?: [^)]*)?\)\) \1\)\)?\)$/.exec(src)
  const field = m && SORT_ATTRS[m[4]!]
  if (!field) return unsupported(`:result-transform ${src}`)
  return { field, dir: m[2] ? "desc" : "asc" }
}

const OPS: Record<string, CompareOp> = { ">": ">", "<": "<", ">=": ">=", "<=": "<=", "=": "=", "not=": "!=" }
const FLIP: Record<CompareOp, CompareOp> = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", "=": "=", "!=": "!=" }
const PAGE_ATTRS = new Set(["block/name", "block/original-name", "block/tags", "block/namespace", "block/journal-day", "block/journal?", "block/alias"])
const PAGE_RULES = new Set(["page-property", "namespace", "page-tags"])

const translateDatalog = (spec: Map<string, Form>, warnings: string[]): Query => {
  const queryForm = spec.get("query")!
  const items = queryForm.t === "vec" ? queryForm.items : []
  const section = (name: string) => {
    const start = items.findIndex((f) => f.t === "kw" && f.v === name)
    if (start < 0) return []
    const end = items.findIndex((f, i) => i > start && f.t === "kw")
    return items.slice(start + 1, end < 0 ? undefined : end)
  }

  const env = new Map<string, Value>()
  const rules = new Map<string, Rule>()
  const addRules = (forms: ReadonlyArray<Form>) => {
    for (const r of forms) {
      if (r.t !== "vec" || r.items[0]?.t !== "list") return unsupported(`rule ${show(r)}`)
      const [head, ...params] = r.items[0].items
      const name = head?.t === "sym" ? head.v : unsupported(`rule ${show(r)}`)
      const prev = rules.get(name)
      rules.set(name, {
        params: params.map((p) => (p.t === "sym" ? p.v : unsupported(`rule ${show(r)}`))),
        bodies: [...(prev?.bodies ?? []), r.items.slice(1)],
      })
    }
  }
  const inputsForm = spec.get("inputs")
  const inputs = inputsForm?.t === "vec" ? [...inputsForm.items] : []
  const rulesForm = spec.get("rules")
  for (const f of section("in")) {
    if (f.t !== "sym" || f.v === "$") continue
    if (f.v === "%") {
      if (rulesForm?.t === "vec") addRules(rulesForm.items)
      else {
        const v = inputValue(inputs.shift() ?? unsupported("missing rules input"))
        if (Array.isArray(v)) addRules(v)
      }
      continue
    }
    const v = inputValue(inputs.shift() ?? unsupported(`missing input for ${f.v}`))
    if (Array.isArray(v)) return unsupported(`input ${f.v}`)
    env.set(f.v, v as Value)
  }

  const used = new Set<Clause>()
  const all: Clause[] = []
  const scope = (clauses: ReadonlyArray<Clause>, parent: Scope | null): Scope => {
    const track = (cs: ReadonlyArray<Clause>) =>
      cs.forEach((c) => {
        all.push(c)
        if (c.t === "not") track(c.body)
        if (c.t === "or") c.branches.forEach(track)
      })
    if (parent === null) track(clauses)
    return { clauses, parent }
  }
  const chain = (s: Scope): Clause[] => [...s.clauses, ...(s.parent ? chain(s.parent) : [])]
  const take = <C extends Clause>(c: C) => (used.add(c), c)

  const constValue = (t: Term): Value | ReadonlyArray<Form> => {
    if (t.k === "var") return env.get(t.name) ?? unsupported(`unbound ${t.name}`)
    if (t.k === "blank") return unsupported("_ used as a value")
    const f = t.form
    if (f.t === "set") return f.items
    if (f.t === "kw") return f.v
    if (f.t === "str" || f.t === "num") return f.v
    return unsupported(`value ${show(f)}`)
  }
  const scalar = (t: Term): Value => {
    const v = constValue(t)
    return Array.isArray(v) ? unsupported("set used as a scalar") : (v as Value)
  }
  const setOf = (t: Term): Value[] => {
    const v = constValue(t)
    return (Array.isArray(v) ? v.map((x) => scalar(term(x))) : [v as Value]).map((x) => (typeof x === "string" ? lower(x) : x))
  }
  const preds = (s: Scope, v: string) => chain(s).filter((c): c is Extract<Clause, { t: "pred" }> => c.t === "pred" && mentions(c, v))
  const patterns = (s: Scope, v: string) => chain(s).filter((c): c is Extract<Clause, { t: "pattern" }> => c.t === "pattern" && isVar(c.e, v))

  const nameOf = (s: Scope, t: Term): Value => {
    if (t.k !== "var") return scalar(t)
    if (env.has(t.name)) return env.get(t.name)!
    const named = patterns(s, t.name).filter((p) => p.a === "block/name" || p.a === "block/original-name")
    const others = patterns(s, t.name).filter((p) => !named.includes(p))
    if (named.length !== 1 || others.length > 0) return unsupported(`references to pages picked by more than a name (${t.name})`)
    const [only] = named as [Extract<Clause, { t: "pattern" }>]
    take(only)
    return nameOf(s, only.v)
  }

  const valueFilter = (s: Scope, field: Field, t: Term, onNone: () => Filter | null): Filter | null => {
    if (t.k === "blank") return { _tag: "Has", field }
    if (t.k === "const" || env.has((t as { name: string }).name)) {
      const vs = setOf(t)
      return vs.length === 1 ? { _tag: "Compare", field, op: "=", value: vs[0]! } : { _tag: "In", field, values: vs }
    }
    const name = t.name
    const parts: Filter[] = []
    for (const p of preds(s, name)) {
      take(p)
      if (p.fn === "contains?" && isVar(p.args[1]!, name)) parts.push({ _tag: "In", field, values: setOf(p.args[0]!) })
      else if (OPS[p.fn] && p.args.length === 2) {
        const [a, b] = p.args as [Term, Term]
        const flipped = isVar(b, name)
        const op = flipped ? FLIP[OPS[p.fn]!] : OPS[p.fn]!
        parts.push({ _tag: "Compare", field, op, value: scalar(flipped ? a : b) })
      } else if (p.fn === "clojure.string/starts-with?" && field === "page" && p.args[1]?.k === "const") {
        const prefix = String(scalar(p.args[1]))
        if (!prefix.endsWith("/")) return unsupported(`${show(p.form)}`)
        warnings.push(`${show(p.form)} became a namespace filter`)
        parts.push({ _tag: "Compare", field: "page.namespace", op: "=", value: prefix.slice(0, -1) })
      } else return unsupported(`${show(p.form)}`)
    }
    return and(parts) ?? onNone()
  }

  const contentFilter = (s: Scope, t: Term): Filter => {
    if (t.k === "const") {
      warnings.push(`exact content match "${String(scalar(t))}" became a word search`)
      return { _tag: "Search", text: String(scalar(t)) }
    }
    const ps = preds(s, (t as { name: string }).name)
    const [p] = ps
    if (ps.length !== 1 || p === undefined || p.fn !== "clojure.string/includes?") return unsupported(`content test ${ps.map((x) => show(x.form)).join(" ")}`)
    take(p)
    const text = String(scalar(p.args[1] ?? unsupported(show(p.form))))
    warnings.push(`substring match "${text}" became a word search`)
    return { _tag: "Search", text }
  }

  const pageFilter = (s: Scope, p: string): Filter | null => {
    const parts: Filter[] = []
    for (const c of chain(s)) {
      if (used.has(c)) continue
      if (c.t === "pattern" && isVar(c.e, p)) {
        take(c)
        const f = pagePattern(s, c)
        if (f) parts.push(f)
      } else if (c.t === "call" && PAGE_RULES.has(c.name) && isVar(c.args[0]!, p)) {
        take(c)
        if (c.name === "namespace") {
          warnings.push("namespace matches every depth (Logseq's rule only matched direct children)")
          parts.push({ _tag: "Compare", field: "page.namespace", op: "=", value: lower(String(nameOf(s, c.args[1]!))) })
        } else if (c.name === "page-tags") parts.push({ _tag: "In", field: "page.tag", values: setOf(c.args[1]!) })
        else parts.push({ _tag: "Compare", field: `page.property.${String(scalar(c.args[1]!))}`, op: "=", value: scalar(c.args[2]!) })
      }
    }
    return and(parts) ?? null
  }

  const pagePattern = (s: Scope, c: Extract<Clause, { t: "pattern" }>): Filter | null => {
    switch (c.a) {
      case "block/name":
      case "block/original-name":
        return c.v.k === "var" && !env.has(c.v.name) ? valueFilter(s, "page", c.v, () => null) : { _tag: "Compare", field: "page", op: "=", value: nameOf(s, c.v) }
      case "block/journal-day":
        return valueFilter(s, "page.day", c.v, () => ({ _tag: "Compare", field: "page.journal", op: "=", value: true }))
      case "block/tags":
        return { _tag: "Compare", field: "page.tag", op: "=", value: nameOf(s, c.v) }
      case "block/namespace": {
        warnings.push("namespace matches every depth (Logseq's :block/namespace only matched direct children)")
        if (c.v.k !== "var") return unsupported(show(c.form))
        const named = patterns(s, c.v.name).find((x) => x.a === "block/name")
        if (!named) return unsupported(show(c.form))
        take(named)
        return named.v.k === "var" && !env.has(named.v.name)
          ? valueFilter(s, "page.namespace", named.v, () => unsupported(show(c.form)))
          : { _tag: "Compare", field: "page.namespace", op: "=", value: nameOf(s, named.v) }
      }
      default:
        return unsupported(`page attribute :${c.a}`)
    }
  }

  const ruleCall = (s: Scope, c: Extract<Clause, { t: "call" }>, v: string): Filter | null => {
    const arg = (i: number) => c.args[i] ?? unsupported(show(c.form))
    switch (c.name) {
      case "task":
      case "todo":
        return valueFilter(s, "task.status", arg(1), () => null)
      case "priority":
        return valueFilter(s, "task.priority", arg(1), () => null)
      case "between":
        return { _tag: "Between", field: "page.day", from: scalar(arg(1)), to: scalar(arg(2)) }
      case "page-ref":
        return pathRef(nameOf(s, arg(1)))
      case "property":
        return { _tag: "Compare", field: `property.${String(scalar(arg(1)))}`, op: "=", value: scalar(arg(2)) }
      case "block-content": {
        warnings.push(`substring match "${String(scalar(arg(1)))}" became a word search`)
        return { _tag: "Search", text: String(scalar(arg(1))) }
      }
      case "page":
        return { _tag: "Compare", field: "page", op: "=", value: nameOf(s, arg(1)) }
    }
    const rule = rules.get(c.name) ?? unsupported(`rule (${c.name} ...)`)
    const bodies = rule.bodies.map((b) => b.map(parseClause))
    const recursive = bodies.findIndex((b) => b.some((x) => x.t === "call" && x.name === c.name))
    if (bodies.length === 1 && recursive < 0) {
      const rename = new Map(rule.params.map((p, i) => [p, c.args[i]!]))
      const sub = (f: Form): Form =>
        f.t === "sym" && rename.has(f.v)
          ? (rename.get(f.v) as Term).k === "var"
            ? { t: "sym", v: (rename.get(f.v) as { name: string }).name }
            : (rename.get(f.v) as { form: Form }).form
          : "items" in f
            ? { ...f, items: f.items.map(sub) }
            : f
      const inner = scope(rule.bodies[0]!.map((f) => parseClause(sub(f))), s)
      inner.clauses.forEach((x) => all.push(x))
      return blockFilter(inner, v)
    }
    if (bodies.length !== 2 || recursive < 0) return unsupported(`rule (${c.name} ...)`)
    const base = bodies[1 - recursive]!
    const step = bodies[recursive]!
    if (rule.params.length === 2) {
      const [a, d] = rule.params as [string, string]
      const [link] = base
      const isBase = base.length === 1 && link?.t === "pattern" && isVar(link.e, d) && link.a === "block/parent" && isVar(link.v, a)
      const isStep = step.length === 2 && step.some((x) => x.t === "pattern" && x.a === "block/parent")
      if (!isBase || !isStep || !isVar(arg(1), v) || arg(0).k !== "var") return unsupported(`rule (${c.name} ...)`)
      const anc = (arg(0) as { name: string }).name
      return { _tag: "Under", ancestor: anc === v ? unsupported("self-referencing ancestor") : blockFilter(s, anc), self: false, direct: false }
    }
    if (rule.params.length === 1) {
      const [x] = rule.params as [string]
      const link = base.find((y) => y.t === "pattern" && y.a === "block/parent" && isVar(y.e, x))
      const isStep = step.length === 2 && step.some((y) => y.t === "pattern" && y.a === "block/parent" && isVar(y.e, x))
      if (!link || !isStep || link.t !== "pattern" || link.v.k !== "var" || !isVar(arg(0), v)) return unsupported(`rule (${c.name} ...)`)
      const inner = scope(base.filter((y) => y !== link), s)
      inner.clauses.forEach((y) => all.push(y))
      return { _tag: "Under", ancestor: blockFilter(inner, link.v.name), self: false, direct: false }
    }
    return unsupported(`rule (${c.name} ...)`)
  }

  const blockPattern = (s: Scope, c: Extract<Clause, { t: "pattern" }>): Filter | null => {
    switch (c.a) {
      case "block/marker":
        return valueFilter(s, "task.status", c.v, () => ({ _tag: "Has", field: "task.status" }))
      case "block/priority":
        return valueFilter(s, "task.priority", c.v, () => ({ _tag: "Has", field: "task.priority" }))
      case "block/scheduled":
        return valueFilter(s, "task.scheduled", c.v, () => ({ _tag: "Has", field: "task.scheduled" }))
      case "block/deadline":
        return valueFilter(s, "task.deadline", c.v, () => ({ _tag: "Has", field: "task.deadline" }))
      case "block/refs":
        return { _tag: "Compare", field: "ref", op: "=", value: nameOf(s, c.v) }
      case "block/path-refs":
        return pathRef(nameOf(s, c.v))
      case "block/content":
        return contentFilter(s, c.v)
      case "block/page":
        return c.v.k === "var" && !env.has(c.v.name) ? pageFilter(s, c.v.name) : { _tag: "Compare", field: "page", op: "=", value: nameOf(s, c.v) }
      case "block/parent": {
        const t = c.v
        if (t.k === "var" && env.get(t.name) !== undefined) return { _tag: "Under", ancestor: { _tag: "Compare", field: "id", op: "=", value: env.get(t.name)! }, self: false, direct: true }
        if (t.k !== "var") return unsupported(show(c.form))
        return { _tag: "Under", ancestor: blockFilter(s, t.name), self: false, direct: true }
      }
      default:
        return unsupported(`attribute :${c.a}`)
    }
  }

  const blockFilter = (s: Scope, v: string): Filter => {
    const parts: Filter[] = []
    for (const c of s.clauses) {
      if (used.has(c) || !mentions(c, v)) continue
      if (c.t === "pattern" && isVar(c.e, v)) {
        take(c)
        const f = blockPattern(s, c)
        if (f) parts.push(f)
      } else if (c.t === "call") {
        take(c)
        const f = ruleCall(s, c, v)
        if (f) parts.push(f)
      } else if (c.t === "not") {
        take(c)
        parts.push({ _tag: "Not", filter: blockFilter(scope(c.body, s), v) })
      } else if (c.t === "or") {
        take(c)
        parts.push(or(c.branches.map((b) => blockFilter(scope(b, s), v))))
      }
    }
    return and(parts) ?? { _tag: "And", all: [] }
  }

  const find = section("find")
  const root = scope(section("where").map(parseClause), null)
  const pull = find[0]?.t === "list" && find[0].items[0]?.t === "sym" && find[0].items[0].v === "pull" ? find[0].items[1] : undefined
  let target: string
  let pages: boolean
  if (pull?.t === "sym") {
    target = pull.v
    pages =
      patterns(root, target).some((p) => PAGE_ATTRS.has(p.a)) ||
      root.clauses.some((c) => c.t === "call" && PAGE_RULES.has(c.name) && isVar(c.args[0]!, target))
  } else if (find.length === 1 && find[0]?.t === "sym" && find[0].v.startsWith("?")) {
    const out = find[0].v
    const named = root.clauses.find((c) => c.t === "pattern" && c.a === "block/name" && isVar(c.v, out))
    if (!named || named.t !== "pattern" || named.e.k !== "var") return unsupported(`:find ${show(find[0]!)}`)
    take(named)
    target = named.e.name
    pages = true
  } else return unsupported(`:find ${find.map(show).join(" ")} (aggregates and tuples are not supported)`)

  const where = pages ? pageFilter(root, target) : blockFilter(root, target)
  const left = all.filter((c) => !used.has(c))
  if (left.length > 0) return unsupported(`clause ${show(left[0]!.form)}`)
  const transform = spec.get("result-transform")
  return finishQuery({
    find: pages ? "pages" : "blocks",
    ...(where && !(where._tag === "And" && where.all.length === 0) ? { where } : {}),
    ...(transform ? { sort: [sortOf(transform)] } : {}),
  })
}

export const translateLogseq = (text: string): Translation => {
  const original = text
  const src = text.replace(/#\+BEGIN_QUERY|#\+END_QUERY/g, "").trim()
  try {
    if (src.startsWith("{{query")) return { _tag: "Translated", query: parseSimple(src), warnings: [] }
    const [top] = read(src, { wiki: false })
    if (top?.t !== "map") return unsupported("not a query map")
    const spec = new Map<string, Form>()
    for (let i = 0; i < top.items.length; i += 2) {
      const k = top.items[i]!
      if (k.t === "kw") spec.set(k.v, top.items[i + 1]!)
    }
    const warnings: string[] = []
    if (spec.has("view")) warnings.push("custom :view dropped (views are declared, never code); showing the default list")
    const q = spec.get("query") ?? unsupported("no :query")
    if (q.t === "str") return { _tag: "Translated", query: finishQuery({ find: "blocks", where: { _tag: "Search", text: q.v } }), warnings }
    if (q.t === "list") return { _tag: "Translated", query: parseSimple(show(q)), warnings }
    return { _tag: "Translated", query: translateDatalog(spec, warnings), warnings }
  } catch (e) {
    if (e instanceof Unsupported) return { _tag: "ConvertMe", original, reason: e.reason }
    return { _tag: "ConvertMe", original, reason: e instanceof Error ? e.message : String(e) }
  }
}
