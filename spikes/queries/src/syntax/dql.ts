import { fail } from "../literal.ts"
import { and, finishQuery, or, type CompareOp, type Field, type Filter, type Query, type Sort, type Value, type View } from "../model.ts"
import { field, pathRef, word } from "./values.ts"

type Tok =
  | { readonly t: "word" | "str" | "wiki" | "tag" | "punct" | "op"; readonly v: string }
  | { readonly t: "num"; readonly v: number }

const lex = (src: string): Tok[] => {
  const out: Tok[] = []
  const re = /\s+|"((?:[^"\\]|\\.)*)"|#?\[\[([^\]]+)\]\]|#([\w/.-]+)|(<=|>=|!=|=|<|>)|([(),])|(-)(?=[#["(])|([^\s(),"=<>!]+)/gy
  let pos = 0
  for (let m = re.exec(src); m !== null && m[0] !== ""; m = re.exec(src)) {
    pos = re.lastIndex
    if (m[1] !== undefined) out.push({ t: "str", v: m[1].replace(/\\(.)/g, "$1") })
    else if (m[2] !== undefined) out.push({ t: m[0].startsWith("#") ? "tag" : "wiki", v: m[2] })
    else if (m[3] !== undefined) out.push({ t: "tag", v: m[3] })
    else if (m[4] !== undefined) out.push({ t: "op", v: m[4] })
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ t: "punct", v: m[0] })
    else if (m[7] !== undefined) out.push(/^[+-]?\d+(\.\d+)?$/.test(m[7]) ? { t: "num", v: Number(m[7]) } : { t: "word", v: m[7] })
  }
  if (pos < src.length) fail(`can't read "${src.slice(pos, pos + 12)}"`)
  return out
}

export const parseDql = (src: string): Query => {
  const toks = lex(src)
  let i = 0
  const peek = () => toks[i]
  const isKw = (kw: string, at = i) => toks[at]?.t === "word" && String(toks[at]!.v).toUpperCase() === kw
  const accept = (kw: string) => (isKw(kw) ? (i++, true) : false)
  const expect = (kw: string) => accept(kw) || fail(`expected ${kw} near "${String(peek()?.v ?? "end")}"`)
  const punct = (p: string) => (peek()?.t === "punct" && peek()!.v === p ? (i++, true) : false)
  const next = () => toks[i++] ?? fail("unexpected end of query")

  const fieldTok = (): Field => {
    const t = next()
    return t.t === "word" ? field(t.v) : fail(`expected a field, got "${String(t.v)}"`)
  }
  const value = (of: Field): Value => {
    const t = next()
    if (t.t === "num") return t.v
    if (t.t === "word" || t.t === "wiki") return word(t.v, of)
    if (t.t === "str") return t.v
    return fail(`expected a value, got "${t.v}"`)
  }

  const binary = (unary: () => Filter): (() => Filter) => {
    const conj = () => {
      const parts = [unary()]
      while (accept("AND")) parts.push(unary())
      return and(parts)!
    }
    return () => {
      const parts = [conj()]
      while (accept("OR")) parts.push(conj())
      return or(parts)
    }
  }

  const source: () => Filter = binary(() => srcUnary())
  const srcUnary = (): Filter => {
    if (punct("(")) {
      const inner = source()
      return punct(")") ? inner : fail("missing )")
    }
    if (punct("-")) return { _tag: "Not", filter: srcUnary() }
    const t = next()
    if (t.t === "tag" || t.t === "wiki") return pathRef(t.v)
    if (t.t === "word" && t.v === "@page") return pathRef(word(t.v))
    if (t.t === "str") return { _tag: "Compare", field: "page.namespace", op: "=", value: t.v }
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
    if (isKw("CHILD") && isKw("OF", i + 1)) return (i += 2), { _tag: "Under", ancestor: primary(), self: false, direct: true }
    if (isKw("HAS") && isKw("BLOCK", i + 1)) return (i += 2), { _tag: "HasBlock", filter: primary() }
    const t = peek()
    if (t?.t === "tag" || t?.t === "wiki") return i++, pathRef(t.v)
    if (t?.t === "word" && t.v === "@page") return i++, pathRef(word(t.v))
    if (t?.t === "word" && t.v === "@block") return i++, { _tag: "Compare", field: "id", op: "=", value: word(t.v) }
    if (isKw("TEXT") && isKw("MATCHES", i + 1)) {
      i += 2
      const s = next()
      return s.t === "str" ? { _tag: "Search", text: s.v } : fail("MATCHES takes a quoted string")
    }
    const f = fieldTok()
    const op = peek()
    if (op?.t === "op") return i++, { _tag: "Compare", field: f, op: op.v as CompareOp, value: value(f) }
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
    do sort.push({ field: fieldTok(), dir: accept("DESC") ? "desc" : (accept("ASC"), "asc") })
    while (punct(","))
  }
  let group: Field | undefined
  if (accept("GROUP")) {
    expect("BY")
    group = fieldTok()
  }
  let limit: number | undefined
  if (accept("LIMIT")) {
    const n = next()
    limit = n.t === "num" ? n.v : fail("LIMIT takes a number")
  }
  if (i < toks.length) fail(`unexpected "${String(toks[i]!.v)}"`)
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
