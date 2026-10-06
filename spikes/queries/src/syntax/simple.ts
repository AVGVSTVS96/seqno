import { fail } from "../literal.ts"
import { and, finishQuery, or, type Field, type Filter, type Query, type Sort, type Value, type View } from "../model.ts"
import { read, show, type Form } from "./reader.ts"
import { field, pathRef, sortField, word } from "./values.ts"

const OPS = new Set(["=", "!=", "<", "<=", ">", ">="])

interface Acc {
  pages: boolean
  blocks: boolean
  sort: Sort[]
  group?: string
  view?: View | undefined
  limit?: number
}

const name = (f: Form): string => {
  if (f.t === "sym" || f.t === "str" || f.t === "wiki" || f.t === "kw") return f.v
  if (f.t === "num") return String(f.v)
  return fail(`expected a name, got ${show(f)}`)
}

const value = (f: Form, of: Field): Value => {
  if (f.t === "num") return f.v
  if (f.t === "sym") return word(f.v, of)
  if (f.t === "wiki") return word(f.v, of)
  return name(f)
}

const compareOrIn = (fieldName: string, args: ReadonlyArray<Form>): Filter => {
  const f = field(fieldName)
  if (args.length === 0) return { _tag: "Has", field: f }
  const op = args[0]!.t === "sym" ? (args[0] as { v: string }).v : ""
  if (args.length === 2 && OPS.has(op)) return { _tag: "Compare", field: f, op: op as "=", value: value(args[1]!, f) }
  if (args.length === 1) return { _tag: "Compare", field: f, op: "=", value: value(args[0]!, f) }
  return { _tag: "In", field: f, values: args.map((a) => value(a, f)) }
}

const lowerAll = (args: ReadonlyArray<Form>) => args.map((a) => name(a).toLowerCase())

const filter = (f: Form, acc: Acc): Filter | null => {
  if (f.t === "wiki") return (acc.blocks = true), pathRef(f.v)
  if (f.t === "str") return (acc.blocks = true), { _tag: "Search", text: f.v }
  if (f.t === "sym" && (f.v.startsWith("#") || f.v === "@page")) return (acc.blocks = true), pathRef(word(f.v.replace(/^#/, "")))
  if (f.t !== "list" || f.items[0]?.t !== "sym") return fail(`not a query filter: ${show(f)}`)
  const [head, ...args] = f.items as [{ t: "sym"; v: string }, ...Form[]]
  const sub = () => args.map((a) => filter(a, acc)).filter((x): x is Filter => x !== null)
  const block = (x: Filter) => ((acc.blocks = true), x)
  switch (head.v) {
    case "and":
      return and(sub()) ?? null
    case "or":
      return or(sub())
    case "not":
      return { _tag: "Not", filter: and(sub()) ?? fail("(not) needs a filter") }
    case "task":
    case "todo":
      return block({ _tag: "In", field: "task.status", values: lowerAll(args) })
    case "priority":
      return block({ _tag: "In", field: "task.priority", values: lowerAll(args) })
    case "between": {
      const of = args.length === 3 ? field(name(args[0]!)) : "page.day"
      const [from, to] = args.slice(-2) as [Form, Form]
      return block({ _tag: "Between", field: of, from: value(from, of), to: value(to, of) })
    }
    case "property":
      return block(compareOrIn(`property.${name(args[0]!).toLowerCase()}`, args.slice(1)))
    case "page-property":
      acc.pages = true
      return compareOrIn(`page.property.${name(args[0]!).toLowerCase()}`, args.slice(1))
    case "page-tags":
      acc.pages = true
      return { _tag: "In", field: "page.tag", values: args.map(name) }
    case "page":
      return block(compareOrIn("page", args))
    case "namespace":
      return block(compareOrIn("page.namespace", args))
    case "under":
    case "child-of":
      return block({ _tag: "Under", ancestor: and(sub()) ?? fail(`(${head.v}) needs a filter`), self: false, direct: head.v === "child-of" })
    case "has-block":
    case "pages": {
      const blocks = acc.blocks
      const inner = and(sub())
      acc.blocks = blocks
      acc.pages = true
      if (head.v === "pages") return inner ?? null
      return { _tag: "HasBlock", filter: inner ?? fail("(has-block) needs a filter") }
    }
    case "sort-by":
      acc.sort.push({ field: sortField(name(args[0]!)), dir: args[1] && name(args[1]).toLowerCase() === "asc" ? "asc" : "desc" })
      return null
    case "group-by":
      acc.group = field(name(args[0]!))
      return null
    case "limit":
      acc.limit = Number(name(args[0]!))
      return null
    case "view": {
      const kind = name(args[0]!)
      const fields = args.slice(1).map((a) => field(name(a)))
      acc.view = kind === "table" ? { _tag: "Table", columns: fields } : kind === "board" ? { _tag: "Board", by: fields[0]! } : undefined
      return null
    }
    case "text":
      return block({ _tag: "Search", text: name(args[0]!) })
    case "all-page-tags":
      return fail("(all-page-tags) lists tags, not blocks or pages; use a pages query on page.tag")
    default:
      return block(compareOrIn(head.v, args))
  }
}

export const parseSimple = (src: string): Query => {
  const body = src.trim().replace(/^\{\{query\s+/, "").replace(/\}\}$/, "")
  const acc: Acc = { pages: false, blocks: false, sort: [] }
  const where = and(read(body, { wiki: true }).map((f) => filter(f, acc)).filter((x): x is Filter => x !== null))
  if (acc.pages && acc.blocks) fail("page filters (pages, page-property, page-tags, has-block) can't be mixed with block filters")
  return finishQuery({
    find: acc.pages ? "pages" : "blocks",
    ...(where ? { where } : {}),
    ...(acc.sort.length > 0 ? { sort: acc.sort } : {}),
    ...(acc.group ? { group: acc.group } : {}),
    ...(acc.view ? { view: acc.view } : {}),
    ...(acc.limit !== undefined ? { limit: acc.limit } : {}),
  })
}
