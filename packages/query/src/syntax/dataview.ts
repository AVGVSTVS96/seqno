import {
  and,
  finishQuery,
  isCompareOp,
  or,
  pathRef,
  type Field,
  type Filter,
  type Query,
  type Sort,
  type Value,
  type View,
} from "../ast.ts"
import { fail } from "../error.ts"
import { field, word } from "./values.ts"

type Text = "Word" | "Str" | "Wiki" | "Tag" | "Punct" | "Op"
type Tok =
  | { readonly [K in Text]: { readonly _tag: K; readonly v: string } }[Text]
  | { readonly _tag: "Num"; readonly v: number }

const TOKEN =
  /\s+|"((?:[^"\\]|\\.)*)"|#?\[\[([^\]]+)\]\]|#([\w/.-]+)|(<=|>=|!=|=|<|>)|([(),])|(-)(?=[#["(])|([^\s(),"=<>!]+)/gy
const NUMBER = /^[+-]?\d+(\.\d+)?$/

const lex = (src: string): Tok[] => {
  const out: Tok[] = []
  const re = new RegExp(TOKEN)
  let pos = 0
  for (let m = re.exec(src); m !== null && m[0] !== ""; m = re.exec(src)) {
    pos = re.lastIndex
    const [all, str, wiki, tag, op, punct, minus, bare] = m
    if (str !== undefined) out.push({ _tag: "Str", v: str.replace(/\\(.)/g, "$1") })
    else if (wiki !== undefined) out.push({ _tag: all.startsWith("#") ? "Tag" : "Wiki", v: wiki })
    else if (tag !== undefined) out.push({ _tag: "Tag", v: tag })
    else if (op !== undefined) out.push({ _tag: "Op", v: op })
    else if (punct !== undefined || minus !== undefined) out.push({ _tag: "Punct", v: all })
    else if (bare !== undefined)
      out.push(NUMBER.test(bare) ? { _tag: "Num", v: Number(bare) } : { _tag: "Word", v: bare })
  }
  if (pos < src.length) fail(`can't read "${src.slice(pos, pos + 12)}"`)
  return out
}

export const readDataview = (src: string): Query => {
  const toks = lex(src)
  let i = 0
  const peek = () => toks[i]
  const isKw = (kw: string, at = i) => {
    const t = toks[at]
    return t?._tag === "Word" && t.v.toUpperCase() === kw
  }
  const accept = (kw: string) => {
    if (!isKw(kw)) return false
    i++
    return true
  }
  const expect = (kw: string) =>
    accept(kw) || fail(`expected ${kw} near "${String(peek()?.v ?? "end")}"`)
  const punct = (p: string) => {
    const t = peek()
    if (t?._tag !== "Punct" || t.v !== p) return false
    i++
    return true
  }
  const next = (): Tok => toks[i++] ?? fail("unexpected end of query")

  const fieldTok = (): Field => {
    const t = next()
    return t._tag === "Word" ? field(t.v) : fail(`expected a field, got "${String(t.v)}"`)
  }
  const value = (of: Field): Value => {
    const t = next()
    if (t._tag === "Num") return t.v
    if (t._tag === "Word" || t._tag === "Wiki") return word(t.v, of)
    if (t._tag === "Str") return t.v
    return fail(`expected a value, got "${t.v}"`)
  }

  const binary = (unary: () => Filter): (() => Filter) => {
    const conj = (): Filter => {
      const parts = [unary()]
      while (accept("AND")) parts.push(unary())
      return and(parts) ?? fail("expected a condition")
    }
    return () => {
      const parts = [conj()]
      while (accept("OR")) parts.push(conj())
      return or(parts)
    }
  }

  const source: () => Filter = binary(() => sourceUnary())
  const sourceUnary = (): Filter => {
    if (punct("(")) {
      const inner = source()
      return punct(")") ? inner : fail("missing )")
    }
    if (punct("-")) return { _tag: "Not", filter: sourceUnary() }
    const t = next()
    if (t._tag === "Tag" || t._tag === "Wiki") return pathRef(t.v)
    if (t._tag === "Word" && t.v === "@page") return pathRef(word(t.v))
    if (t._tag === "Str") return { _tag: "Compare", field: "page.namespace", op: "=", value: t.v }
    return fail(`FROM takes #tag, [[page]], "namespace" or @page, got "${String(t.v)}"`)
  }

  const expr: () => Filter = binary(() => unary())
  const unary = (): Filter => (accept("NOT") ? { _tag: "Not", filter: unary() } : primary())
  const primary = (): Filter => {
    if (punct("(")) {
      const inner = expr()
      return punct(")") ? inner : fail("missing )")
    }
    if (accept("UNDER")) return { _tag: "Under", ancestor: primary(), self: false, direct: false }
    if (isKw("CHILD") && isKw("OF", i + 1)) {
      i += 2
      return { _tag: "Under", ancestor: primary(), self: false, direct: true }
    }
    if (isKw("HAS") && isKw("BLOCK", i + 1)) {
      i += 2
      return { _tag: "HasBlock", filter: primary() }
    }
    const t = peek()
    if (t?._tag === "Tag" || t?._tag === "Wiki") {
      i++
      return pathRef(t.v)
    }
    if (t?._tag === "Word" && t.v === "@page") {
      i++
      return pathRef(word(t.v))
    }
    if (t?._tag === "Word" && t.v === "@block") {
      i++
      return { _tag: "Compare", field: "id", op: "=", value: word(t.v) }
    }
    if (isKw("TEXT") && isKw("MATCHES", i + 1)) {
      i += 2
      const s = next()
      return s._tag === "Str"
        ? { _tag: "Search", text: s.v }
        : fail("MATCHES takes a quoted string")
    }
    const f = fieldTok()
    const op = peek()
    if (op?._tag === "Op" && isCompareOp(op.v)) {
      i++
      return { _tag: "Compare", field: f, op: op.v, value: value(f) }
    }
    if (accept("IN")) {
      if (!punct("(")) fail("IN takes a list: IN (a, b)")
      const values = [value(f)]
      while (punct(",")) values.push(value(f))
      return punct(")") ? { _tag: "In", field: f, values } : fail("missing )")
    }
    if (accept("BETWEEN")) {
      const from = value(f)
      expect("AND")
      return { _tag: "Between", field: f, from, to: value(f) }
    }
    return { _tag: "Has", field: f }
  }

  let find: Query["find"] = "blocks"
  let view: View | undefined
  const kind = () => {
    if (accept("PAGES")) find = "pages"
    else accept("BLOCKS")
  }
  if (accept("LIST")) kind()
  else if (accept("TABLE")) {
    kind()
    const columns = [fieldTok()]
    while (punct(",")) columns.push(fieldTok())
    view = { _tag: "Table", columns }
  } else if (accept("BOARD")) {
    kind()
    expect("BY")
    view = { _tag: "Board", by: fieldTok() }
  }
  const filters: Filter[] = []
  if (accept("FROM")) filters.push(source())
  if (accept("WHERE")) filters.push(expr())
  const sort: Sort[] = []
  if (accept("SORT")) {
    do {
      const f = fieldTok()
      const desc = accept("DESC")
      if (!desc) accept("ASC")
      sort.push({ field: f, dir: desc ? "desc" : "asc" })
    } while (punct(","))
  }
  let group: Field | undefined
  if (accept("GROUP")) {
    expect("BY")
    group = fieldTok()
  }
  let limit: number | undefined
  if (accept("LIMIT")) {
    const n = next()
    limit =
      n._tag === "Num" && Number.isInteger(n.v) && n.v >= 0
        ? n.v
        : fail("LIMIT takes a whole number")
  }
  const rest = toks[i]
  if (rest !== undefined) fail(`unexpected "${String(rest.v)}"`)
  const where = and(filters)
  return finishQuery({
    find,
    ...(where ? { where } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    ...(group ? { group } : {}),
    ...(view ? { view } : {}),
    ...(limit !== undefined ? { limit } : {}),
  })
}
