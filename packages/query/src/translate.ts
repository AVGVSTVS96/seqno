import { Data, Match, Schema } from "effect"
import {
  and,
  finishQuery,
  or,
  pathRef,
  Query,
  type CompareOp,
  type Field,
  type Filter,
  type Sort,
  type Value,
} from "./ast.ts"
import { parseDateWord } from "./dates.ts"
import { readLogseq } from "./syntax/logseq.ts"
import { isColl, read, show, type Form } from "./syntax/reader.ts"

export const Translation = Schema.Union([
  Schema.TaggedStruct("Translated", { query: Query, warnings: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("ConvertMe", { original: Schema.String, reason: Schema.String }),
])
export type Translation = typeof Translation.Type

class Unsupported extends Data.TaggedError("Unsupported")<{ readonly reason: string }> {}

const unsupported = (reason: string): never => {
  throw new Unsupported({ reason })
}

type Term =
  | { readonly _tag: "Var"; readonly name: string }
  | { readonly _tag: "Blank" }
  | { readonly _tag: "Const"; readonly form: Form }

type Clause =
  | {
      readonly _tag: "Pattern"
      readonly e: Term
      readonly a: string
      readonly v: Term
      readonly form: Form
    }
  | {
      readonly _tag: "Pred"
      readonly fn: string
      readonly args: ReadonlyArray<Term>
      readonly out: Term | null
      readonly form: Form
    }
  | {
      readonly _tag: "Call"
      readonly name: string
      readonly args: ReadonlyArray<Term>
      readonly form: Form
    }
  | { readonly _tag: "Not"; readonly body: ReadonlyArray<Clause>; readonly form: Form }
  | {
      readonly _tag: "Or"
      readonly branches: ReadonlyArray<ReadonlyArray<Clause>>
      readonly form: Form
    }

type Pattern = Extract<Clause, { readonly _tag: "Pattern" }>
type Pred = Extract<Clause, { readonly _tag: "Pred" }>
type Call = Extract<Clause, { readonly _tag: "Call" }>

type Bound =
  | { readonly _tag: "One"; readonly value: Value }
  | { readonly _tag: "Many"; readonly forms: ReadonlyArray<Form> }

interface Scope {
  readonly clauses: ReadonlyArray<Clause>
  readonly parent: Scope | null
}

interface Rule {
  readonly params: ReadonlyArray<string>
  readonly bodies: ReadonlyArray<ReadonlyArray<Form>>
}

const BLANK: Term = { _tag: "Blank" }

const term = (f: Form): Term =>
  f._tag === "Sym" && f.v.startsWith("?")
    ? { _tag: "Var", name: f.v }
    : f._tag === "Sym" && f.v === "_"
      ? BLANK
      : { _tag: "Const", form: f }

const isVar = (t: Term | undefined, v: string | undefined) => t?._tag === "Var" && t.name === v

const branchOf = (b: Form): Clause[] => {
  if (b._tag !== "List") return [parseClause(b)]
  const [head, ...rest] = b.items
  return head?._tag === "Sym" && head.v === "and" ? rest.map(parseClause) : [parseClause(b)]
}

const parseClause = (f: Form): Clause => {
  if (f._tag === "Vec") {
    const [first, second, third] = f.items
    if (first?._tag === "List") {
      const [fn, ...args] = first.items
      return {
        _tag: "Pred",
        fn: fn?._tag === "Sym" ? fn.v : "?",
        args: args.map(term),
        out: second ? term(second) : null,
        form: f,
      }
    }
    if (first !== undefined && second?._tag === "Kw" && f.items.length <= 3) {
      return {
        _tag: "Pattern",
        e: term(first),
        a: second.v,
        v: third ? term(third) : BLANK,
        form: f,
      }
    }
  }
  if (f._tag === "List") {
    const [head, ...rest] = f.items
    if (head?._tag === "Sym") {
      if (head.v === "not") return { _tag: "Not", body: rest.map(parseClause), form: f }
      if (head.v === "or") return { _tag: "Or", branches: rest.map(branchOf), form: f }
      if (head.v === "or-join" || head.v === "not-join" || head.v === "and")
        return unsupported(`${head.v} is not translated`)
      return { _tag: "Call", name: head.v, args: rest.map(term), form: f }
    }
  }
  return unsupported(`can't read clause ${show(f)}`)
}

const mentions = (c: Clause, v: string): boolean =>
  Match.valueTags(c, {
    Pattern: (x) => isVar(x.e, v) || isVar(x.v, v),
    Pred: (x) => x.args.some((t) => isVar(t, v)) || (x.out !== null && isVar(x.out, v)),
    Call: (x) => x.args.some((t) => isVar(t, v)),
    Not: (x) => x.body.some((y) => mentions(y, v)),
    Or: (x) => x.branches.some((b) => b.some((y) => mentions(y, v))),
  })

const one = (value: Value): Bound => ({ _tag: "One", value })
const many = (forms: ReadonlyArray<Form>): Bound => ({ _tag: "Many", forms })

const inputValue = (f: Form): Bound => {
  if (f._tag === "Str" || f._tag === "Num") return one(f.v)
  if (f._tag === "Vec") return many(f.items)
  if (f._tag === "Kw") {
    if (f.v === "current-page") return one({ _tag: "Context", of: "page" })
    if (f.v === "current-block") return one({ _tag: "Context", of: "block" })
    return one(parseDateWord(f.v) ?? unsupported(`input :${f.v}`))
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

const SORT_TRANSFORM =
  /^\(fn \[(\S+)\] (\(reverse )?\(sort-by \(fn \[(\S+)\] \(get \3 :(block\/[\w-]+)(?: [^)]*)?\)\) \1\)\)?\)$/

const sortOf = (f: Form): Sort => {
  const src = show(f)
  const [, , reverse, , attr] = SORT_TRANSFORM.exec(src) ?? []
  const field = attr === undefined ? undefined : SORT_ATTRS[attr]
  return field === undefined
    ? unsupported(`:result-transform ${src}`)
    : { field, dir: reverse ? "desc" : "asc" }
}

const OPS: Record<string, CompareOp> = {
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
  "=": "=",
  "not=": "!=",
}
const FLIP: Record<CompareOp, CompareOp> = {
  ">": "<",
  "<": ">",
  ">=": "<=",
  "<=": ">=",
  "=": "=",
  "!=": "!=",
}
const PAGE_ATTRS = new Set([
  "block/name",
  "block/original-name",
  "block/tags",
  "block/namespace",
  "block/journal-day",
  "block/journal?",
  "block/alias",
])
const PAGE_RULES = new Set(["page-property", "namespace", "page-tags"])
const NONE: Filter = { _tag: "And", all: [] }

const chain = (s: Scope): Clause[] => [...s.clauses, ...(s.parent ? chain(s.parent) : [])]
const preds = (s: Scope, v: string) =>
  chain(s).filter((c): c is Pred => c._tag === "Pred" && mentions(c, v))
const patterns = (s: Scope, v: string) =>
  chain(s).filter((c): c is Pattern => c._tag === "Pattern" && isVar(c.e, v))

const translateDatalog = (
  spec: ReadonlyMap<string, Form>,
  items: ReadonlyArray<Form>,
  warnings: string[],
): Query => {
  const section = (name: string) => {
    const start = items.findIndex((f) => f._tag === "Kw" && f.v === name)
    if (start < 0) return []
    const end = items.findIndex((f, i) => i > start && f._tag === "Kw")
    return items.slice(start + 1, end < 0 ? undefined : end)
  }

  const env = new Map<string, Value>()
  const rules = new Map<string, Rule>()
  const addRules = (forms: ReadonlyArray<Form>) => {
    for (const r of forms) {
      const [head, ...body] = r._tag === "Vec" ? r.items : []
      if (head?._tag !== "List") return unsupported(`rule ${show(r)}`)
      const [nameForm, ...params] = head.items
      const name = nameForm?._tag === "Sym" ? nameForm.v : unsupported(`rule ${show(r)}`)
      rules.set(name, {
        params: params.map((p) => (p._tag === "Sym" ? p.v : unsupported(`rule ${show(r)}`))),
        bodies: [...(rules.get(name)?.bodies ?? []), body],
      })
    }
  }
  const inputsForm = spec.get("inputs")
  const inputs = inputsForm?._tag === "Vec" ? [...inputsForm.items] : []
  const rulesForm = spec.get("rules")
  for (const f of section("in")) {
    if (f._tag !== "Sym" || f.v === "$") continue
    if (f.v === "%") {
      if (rulesForm?._tag === "Vec") addRules(rulesForm.items)
      else {
        const v = inputValue(inputs.shift() ?? unsupported("missing rules input"))
        if (v._tag === "Many") addRules(v.forms)
      }
      continue
    }
    const v = inputValue(inputs.shift() ?? unsupported(`missing input for ${f.v}`))
    env.set(f.v, v._tag === "One" ? v.value : unsupported(`input ${f.v}`))
  }

  const used = new Set<Clause>()
  const all: Clause[] = []
  const track = (cs: ReadonlyArray<Clause>) =>
    cs.forEach((c) => {
      all.push(c)
      if (c._tag === "Not") track(c.body)
      if (c._tag === "Or") c.branches.forEach(track)
    })
  const scope = (clauses: ReadonlyArray<Clause>, parent: Scope | null): Scope => {
    if (parent === null) track(clauses)
    return { clauses, parent }
  }
  const take = <C extends Clause>(c: C) => {
    used.add(c)
    return c
  }

  const constValue = (t: Term): Bound => {
    if (t._tag === "Var") return one(env.get(t.name) ?? unsupported(`unbound ${t.name}`))
    if (t._tag === "Blank") return unsupported("_ used as a value")
    const f = t.form
    if (f._tag === "Set") return many(f.items)
    if (f._tag === "Kw" || f._tag === "Str" || f._tag === "Num") return one(f.v)
    return unsupported(`value ${show(f)}`)
  }
  const scalar = (t: Term): Value => {
    const v = constValue(t)
    return v._tag === "One" ? v.value : unsupported("set used as a scalar")
  }
  const setOf = (t: Term): Value[] => {
    const v = constValue(t)
    return (v._tag === "One" ? [v.value] : v.forms.map((x) => scalar(term(x)))).map((x) =>
      typeof x === "string" ? x.toLowerCase() : x,
    )
  }

  const nameOf = (s: Scope, t: Term): Value => {
    if (t._tag !== "Var") return scalar(t)
    const bound = env.get(t.name)
    if (bound !== undefined) return bound
    const found = patterns(s, t.name)
    const [only] = found
    if (
      found.length !== 1 ||
      only === undefined ||
      (only.a !== "block/name" && only.a !== "block/original-name")
    ) {
      return unsupported(`references to pages picked by more than a name (${t.name})`)
    }
    take(only)
    return nameOf(s, only.v)
  }

  const valueFilter = (
    s: Scope,
    field: Field,
    t: Term,
    onNone: () => Filter | null,
  ): Filter | null => {
    if (t._tag === "Blank") return { _tag: "Has", field }
    if (t._tag === "Const" || env.has(t.name)) {
      const vs = setOf(t)
      const [first] = vs
      return vs.length === 1 && first !== undefined
        ? { _tag: "Compare", field, op: "=", value: first }
        : { _tag: "In", field, values: vs }
    }
    const name = t.name
    const parts: Filter[] = []
    for (const p of preds(s, name)) {
      take(p)
      const [a, b] = p.args
      const op = OPS[p.fn]
      if (p.fn === "contains?" && a !== undefined && isVar(b, name))
        parts.push({ _tag: "In", field, values: setOf(a) })
      else if (op !== undefined && p.args.length === 2 && a !== undefined && b !== undefined) {
        const flipped = isVar(b, name)
        parts.push({
          _tag: "Compare",
          field,
          op: flipped ? FLIP[op] : op,
          value: scalar(flipped ? a : b),
        })
      } else if (
        p.fn === "clojure.string/starts-with?" &&
        field === "page" &&
        b?._tag === "Const"
      ) {
        const prefix = String(scalar(b))
        if (!prefix.endsWith("/")) return unsupported(show(p.form))
        warnings.push(`${show(p.form)} became a namespace filter`)
        parts.push({
          _tag: "Compare",
          field: "page.namespace",
          op: "=",
          value: prefix.slice(0, -1),
        })
      } else return unsupported(show(p.form))
    }
    return and(parts) ?? onNone()
  }

  const contentFilter = (s: Scope, t: Term): Filter => {
    if (t._tag === "Const") {
      const text = String(scalar(t))
      warnings.push(`exact content match "${text}" became a word search`)
      return { _tag: "Search", text }
    }
    if (t._tag === "Blank") return unsupported("content test _")
    const ps = preds(s, t.name)
    const [p] = ps
    if (ps.length !== 1 || p === undefined || p.fn !== "clojure.string/includes?") {
      return unsupported(`content test ${ps.map((x) => show(x.form)).join(" ")}`)
    }
    take(p)
    const text = String(scalar(p.args[1] ?? unsupported(show(p.form))))
    warnings.push(`substring match "${text}" became a word search`)
    return { _tag: "Search", text }
  }

  const callArg = (c: Call, i: number): Term => c.args[i] ?? unsupported(show(c.form))

  const pageFilter = (s: Scope, p: string): Filter | null => {
    const parts: Filter[] = []
    for (const c of chain(s)) {
      if (used.has(c)) continue
      if (c._tag === "Pattern" && isVar(c.e, p)) {
        take(c)
        const f = pagePattern(s, c)
        if (f) parts.push(f)
      } else if (c._tag === "Call" && PAGE_RULES.has(c.name) && isVar(c.args[0], p)) {
        take(c)
        if (c.name === "namespace") {
          warnings.push(
            "namespace matches every depth (Logseq's rule only matched direct children)",
          )
          parts.push({
            _tag: "Compare",
            field: "page.namespace",
            op: "=",
            value: String(nameOf(s, callArg(c, 1))).toLowerCase(),
          })
        } else if (c.name === "page-tags")
          parts.push({ _tag: "In", field: "page.tag", values: setOf(callArg(c, 1)) })
        else {
          const key = String(scalar(callArg(c, 1)))
          parts.push({
            _tag: "Compare",
            field: `page.property.${key}`,
            op: "=",
            value: scalar(callArg(c, 2)),
          })
        }
      }
    }
    return and(parts) ?? null
  }

  const pagePattern = (s: Scope, c: Pattern): Filter | null => {
    switch (c.a) {
      case "block/name":
      case "block/original-name":
        return c.v._tag === "Var" && !env.has(c.v.name)
          ? valueFilter(s, "page", c.v, () => null)
          : { _tag: "Compare", field: "page", op: "=", value: nameOf(s, c.v) }
      case "block/journal-day":
        return valueFilter(s, "page.day", c.v, () => ({
          _tag: "Compare",
          field: "page.journal",
          op: "=",
          value: true,
        }))
      case "block/tags":
        return { _tag: "Compare", field: "page.tag", op: "=", value: nameOf(s, c.v) }
      case "block/namespace": {
        warnings.push(
          "namespace matches every depth (Logseq's :block/namespace only matched direct children)",
        )
        if (c.v._tag !== "Var") return unsupported(show(c.form))
        const named = patterns(s, c.v.name).find((x) => x.a === "block/name")
        if (named === undefined) return unsupported(show(c.form))
        take(named)
        return named.v._tag === "Var" && !env.has(named.v.name)
          ? valueFilter(s, "page.namespace", named.v, () => unsupported(show(c.form)))
          : { _tag: "Compare", field: "page.namespace", op: "=", value: nameOf(s, named.v) }
      }
      default:
        return unsupported(`page attribute :${c.a}`)
    }
  }

  const substitute = (rule: Rule, c: Call) => {
    const rename = new Map(rule.params.map((p, i) => [p, callArg(c, i)]))
    const sub = (f: Form): Form => {
      const r = f._tag === "Sym" ? rename.get(f.v) : undefined
      if (r !== undefined)
        return r._tag === "Var"
          ? { _tag: "Sym", v: r.name }
          : r._tag === "Const"
            ? r.form
            : { _tag: "Sym", v: "_" }
      return isColl(f) ? { ...f, items: f.items.map(sub) } : f
    }
    return sub
  }

  const ruleCall = (s: Scope, c: Call, v: string): Filter | null => {
    const arg = (i: number) => callArg(c, i)
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
        return {
          _tag: "Compare",
          field: `property.${String(scalar(arg(1)))}`,
          op: "=",
          value: scalar(arg(2)),
        }
      case "block-content": {
        const text = String(scalar(arg(1)))
        warnings.push(`substring match "${text}" became a word search`)
        return { _tag: "Search", text }
      }
      case "page":
        return { _tag: "Compare", field: "page", op: "=", value: nameOf(s, arg(1)) }
    }
    const rule = rules.get(c.name) ?? unsupported(`rule (${c.name} ...)`)
    const bodies = rule.bodies.map((b) => b.map(parseClause))
    const recursive = bodies.findIndex((b) => b.some((x) => x._tag === "Call" && x.name === c.name))
    const [onlyBody] = rule.bodies
    if (bodies.length === 1 && recursive < 0 && onlyBody !== undefined) {
      const inner = scope(
        onlyBody.map((f) => parseClause(substitute(rule, c)(f))),
        s,
      )
      track(inner.clauses)
      return blockFilter(inner, v)
    }
    const base = bodies[1 - recursive]
    const step = bodies[recursive]
    if (bodies.length !== 2 || base === undefined || step === undefined)
      return unsupported(`rule (${c.name} ...)`)
    if (rule.params.length === 2) {
      const [a, d] = rule.params
      const [link] = base
      const isBase =
        base.length === 1 &&
        link?._tag === "Pattern" &&
        isVar(link.e, d) &&
        link.a === "block/parent" &&
        isVar(link.v, a)
      const isStep =
        step.length === 2 && step.some((x) => x._tag === "Pattern" && x.a === "block/parent")
      const ancestor = arg(0)
      if (!isBase || !isStep || !isVar(arg(1), v) || ancestor._tag !== "Var")
        return unsupported(`rule (${c.name} ...)`)
      if (ancestor.name === v) return unsupported("self-referencing ancestor")
      return { _tag: "Under", ancestor: blockFilter(s, ancestor.name), self: false, direct: false }
    }
    if (rule.params.length === 1) {
      const [x] = rule.params
      const link = base.find(
        (y): y is Pattern => y._tag === "Pattern" && y.a === "block/parent" && isVar(y.e, x),
      )
      const isStep =
        step.length === 2 &&
        step.some((y) => y._tag === "Pattern" && y.a === "block/parent" && isVar(y.e, x))
      if (link === undefined || !isStep || link.v._tag !== "Var" || !isVar(arg(0), v))
        return unsupported(`rule (${c.name} ...)`)
      const inner = scope(
        base.filter((y) => y !== link),
        s,
      )
      track(inner.clauses)
      return {
        _tag: "Under",
        ancestor: blockFilter(inner, link.v.name),
        self: false,
        direct: false,
      }
    }
    return unsupported(`rule (${c.name} ...)`)
  }

  const blockPattern = (s: Scope, c: Pattern): Filter | null => {
    switch (c.a) {
      case "block/marker":
        return valueFilter(s, "task.status", c.v, () => ({ _tag: "Has", field: "task.status" }))
      case "block/priority":
        return valueFilter(s, "task.priority", c.v, () => ({ _tag: "Has", field: "task.priority" }))
      case "block/scheduled":
        return valueFilter(s, "task.scheduled", c.v, () => ({
          _tag: "Has",
          field: "task.scheduled",
        }))
      case "block/deadline":
        return valueFilter(s, "task.deadline", c.v, () => ({ _tag: "Has", field: "task.deadline" }))
      case "block/refs":
        return { _tag: "Compare", field: "ref", op: "=", value: nameOf(s, c.v) }
      case "block/path-refs":
        return pathRef(nameOf(s, c.v))
      case "block/content":
        return contentFilter(s, c.v)
      case "block/page":
        return c.v._tag === "Var" && !env.has(c.v.name)
          ? pageFilter(s, c.v.name)
          : { _tag: "Compare", field: "page", op: "=", value: nameOf(s, c.v) }
      case "block/parent": {
        const t = c.v
        if (t._tag !== "Var") return unsupported(show(c.form))
        const bound = env.get(t.name)
        const ancestor: Filter =
          bound !== undefined
            ? { _tag: "Compare", field: "id", op: "=", value: bound }
            : blockFilter(s, t.name)
        return { _tag: "Under", ancestor, self: false, direct: true }
      }
      default:
        return unsupported(`attribute :${c.a}`)
    }
  }

  const blockClause = (s: Scope, c: Clause, v: string): Filter | null =>
    Match.valueTags(c, {
      Pattern: (x) => (isVar(x.e, v) ? blockPattern(s, take(x)) : null),
      Call: (x) => ruleCall(s, take(x), v),
      Not: (x): Filter => ({ _tag: "Not", filter: blockFilter(scope(take(x).body, s), v) }),
      Or: (x) => or(take(x).branches.map((b) => blockFilter(scope(b, s), v))),
      Pred: () => null,
    })

  const blockFilter = (s: Scope, v: string): Filter => {
    const parts: Filter[] = []
    for (const c of s.clauses) {
      if (used.has(c) || !mentions(c, v)) continue
      const f = blockClause(s, c, v)
      if (f) parts.push(f)
    }
    return and(parts) ?? NONE
  }

  const target = (root: Scope): { readonly name: string; readonly pages: boolean } => {
    const find = section("find")
    const [first] = find
    const [head, pulled] = first?._tag === "List" ? first.items : []
    if (head?._tag === "Sym" && head.v === "pull" && pulled?._tag === "Sym") {
      const name = pulled.v
      const pages =
        patterns(root, name).some((p) => PAGE_ATTRS.has(p.a)) ||
        root.clauses.some(
          (c) => c._tag === "Call" && PAGE_RULES.has(c.name) && isVar(c.args[0], name),
        )
      return { name, pages }
    }
    if (find.length === 1 && first?._tag === "Sym" && first.v.startsWith("?")) {
      const out = first.v
      const named = root.clauses.find(
        (c): c is Pattern => c._tag === "Pattern" && c.a === "block/name" && isVar(c.v, out),
      )
      if (named === undefined || named.e._tag !== "Var") return unsupported(`:find ${show(first)}`)
      take(named)
      return { name: named.e.name, pages: true }
    }
    return unsupported(
      `:find ${find.map(show).join(" ")} (aggregates and tuples are not supported)`,
    )
  }

  const root = scope(section("where").map(parseClause), null)
  const { name, pages } = target(root)
  const where = pages ? pageFilter(root, name) : blockFilter(root, name)
  const [left] = all.filter((c) => !used.has(c))
  if (left !== undefined) return unsupported(`clause ${show(left.form)}`)
  const transform = spec.get("result-transform")
  return finishQuery({
    find: pages ? "pages" : "blocks",
    ...(where && where !== NONE ? { where } : {}),
    ...(transform ? { sort: [sortOf(transform)] } : {}),
  })
}

export const translateLogseq = (text: string): Translation => {
  const src = text.replace(/#\+BEGIN_QUERY|#\+END_QUERY/g, "").trim()
  try {
    if (src.startsWith("{{query"))
      return { _tag: "Translated", query: readLogseq(src), warnings: [] }
    const [top] = read(src, { wiki: false })
    if (top?._tag !== "Map") return unsupported("not a query map")
    const spec = new Map<string, Form>()
    for (let i = 0; i + 1 < top.items.length; i += 2) {
      const k = top.items[i]
      const v = top.items[i + 1]
      if (k?._tag === "Kw" && v !== undefined) spec.set(k.v, v)
    }
    const warnings: string[] = []
    if (spec.has("view"))
      warnings.push(
        "custom :view dropped (views are declared, never code); showing the default list",
      )
    const q = spec.get("query") ?? unsupported("no :query")
    if (q._tag === "Str")
      return {
        _tag: "Translated",
        query: finishQuery({ find: "blocks", where: { _tag: "Search", text: q.v } }),
        warnings,
      }
    if (q._tag === "List") return { _tag: "Translated", query: readLogseq(show(q)), warnings }
    if (q._tag !== "Vec") return unsupported(`:query ${show(q)}`)
    return { _tag: "Translated", query: translateDatalog(spec, q.items, warnings), warnings }
  } catch (e) {
    const reason = e instanceof Unsupported ? e.reason : e instanceof Error ? e.message : String(e)
    return { _tag: "ConvertMe", original: text, reason }
  }
}
