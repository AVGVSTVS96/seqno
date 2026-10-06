import { fail } from "../literal.ts"
import { and, finishQuery, or, type CompareOp, type Field, type Filter, type Query, type Sort, type Value, type View } from "../model.ts"
import { read, show, type Form } from "./reader.ts"
import { field, pathRef, word } from "./values.ts"

const OPS = new Set(["=", "!=", "<", "<=", ">", ">="])

export const ednValue = (f: Form, of?: Field): Value => {
  if (f.t === "num" || f.t === "str") return f.v
  if (f.t === "kw") return f.v === "current-page" ? word("@page") : f.v === "current-block" ? word("@block") : word(f.v, of)
  if (f.t === "sym" && (f.v === "true" || f.v === "false")) return f.v === "true"
  return fail(`expected a value, got ${show(f)}`)
}

const kw = (f: Form | undefined): string => (f?.t === "kw" ? f.v : fail(`expected a :keyword, got ${f ? show(f) : "nothing"}`))

const clause = (f: Form): Filter => {
  if (f.t === "vec") {
    const [head, ...rest] = f.items
    const name = field(kw(head))
    if (rest.length === 0) return { _tag: "Has", field: name }
    if (rest.length === 1) {
      const v = rest[0]!
      return v.t === "set"
        ? { _tag: "In", field: name, values: v.items.map((x) => ednValue(x, name)) }
        : { _tag: "Compare", field: name, op: "=", value: ednValue(v, name) }
    }
    const op = kw(rest[0])
    if (op === "between" && rest.length === 3) return { _tag: "Between", field: name, from: ednValue(rest[1]!, name), to: ednValue(rest[2]!, name) }
    if (OPS.has(op) && rest.length === 2) return { _tag: "Compare", field: name, op: op as CompareOp, value: ednValue(rest[1]!, name) }
    return fail(`can't read clause ${show(f)}`)
  }
  if (f.t !== "list" || f.items[0]?.t !== "sym") return fail(`can't read clause ${show(f)}`)
  const [head, ...args] = f.items as [{ v: string }, ...Form[]]
  const all = () => and(args.map(clause)) ?? fail(`(${head.v}) needs a clause`)
  switch (head.v) {
    case "and":
      return all()
    case "or":
      return or(args.map(clause))
    case "not":
      return { _tag: "Not", filter: all() }
    case "under":
    case "child-of":
      return { _tag: "Under", ancestor: all(), self: false, direct: head.v === "child-of" }
    case "has-block":
      return { _tag: "HasBlock", filter: all() }
    case "page-ref":
      return pathRef(ednValue(args[0]!, "ref"))
    case "text":
      return args[0]?.t === "str" ? { _tag: "Search", text: args[0].v } : fail("(text) takes a string")
    default:
      return fail(`unknown clause (${head.v} ...)`)
  }
}

export const parseEdn = (src: string): Query => {
  const [top] = read(src, { wiki: false })
  if (top?.t !== "map") return fail("expected a {:find ... :where [...]} map")
  const entries = new Map<string, Form>()
  for (let i = 0; i < top.items.length; i += 2) entries.set(kw(top.items[i]), top.items[i + 1]!)
  const get = (k: string) => entries.get(k)
  const whereForm = get("where")
  const where = whereForm === undefined ? undefined : whereForm.t === "vec" ? and(whereForm.items.map(clause)) : clause(whereForm)
  const sortForm = get("sort-by")
  const pairs = sortForm?.t === "vec" ? (sortForm.items[0]?.t === "vec" ? sortForm.items : [sortForm]) : []
  const sort: Sort[] = pairs.map((p) => {
    const items = p.t === "vec" ? p.items : []
    return { field: field(kw(items[0])), dir: items[1] && kw(items[1]) === "desc" ? "desc" : "asc" }
  })
  const viewForm = get("view")
  const view: View | undefined =
    viewForm?.t === "vec" && kw(viewForm.items[0]) === "table"
      ? { _tag: "Table", columns: viewForm.items.slice(1).map((c) => field(kw(c))) }
      : viewForm?.t === "vec" && kw(viewForm.items[0]) === "board"
        ? { _tag: "Board", by: field(kw(viewForm.items[1])) }
        : undefined
  const group = get("group-by")
  const limit = get("limit")
  return finishQuery({
    find: get("find") ? kw(get("find")) : "blocks",
    ...(where ? { where } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    ...(group ? { group: field(kw(group)) } : {}),
    ...(view ? { view } : {}),
    ...(limit?.t === "num" ? { limit: limit.v } : {}),
  })
}
