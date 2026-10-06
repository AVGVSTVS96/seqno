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
import { read, show, type Form } from "./reader.ts"
import { field, sortField, word } from "./values.ts"

interface Acc {
  pages: boolean
  blocks: boolean
  sort: Sort[]
  group?: Field
  view?: View
  limit?: number
}

const name = (f: Form): string => {
  if (f._tag === "Sym" || f._tag === "Str" || f._tag === "Wiki" || f._tag === "Kw") return f.v
  if (f._tag === "Num") return String(f.v)
  return fail(`expected a name, got ${show(f)}`)
}

const value = (f: Form, of: Field): Value =>
  f._tag === "Num" ? f.v : f._tag === "Sym" || f._tag === "Wiki" ? word(f.v, of) : name(f)

const compareOrIn = (fieldName: string, args: ReadonlyArray<Form>): Filter => {
  const f = field(fieldName)
  const [first, second] = args
  if (first === undefined) return { _tag: "Has", field: f }
  const op = first._tag === "Sym" ? first.v : ""
  if (args.length === 2 && second !== undefined && isCompareOp(op))
    return { _tag: "Compare", field: f, op, value: value(second, f) }
  if (args.length === 1) return { _tag: "Compare", field: f, op: "=", value: value(first, f) }
  return { _tag: "In", field: f, values: args.map((a) => value(a, f)) }
}

const lowerAll = (args: ReadonlyArray<Form>) => args.map((a) => name(a).toLowerCase())

const filter = (f: Form, acc: Acc): Filter | null => {
  const block = (x: Filter) => {
    acc.blocks = true
    return x
  }
  if (f._tag === "Wiki") return block(pathRef(f.v))
  if (f._tag === "Str") return block({ _tag: "Search", text: f.v })
  if (f._tag === "Sym" && (f.v.startsWith("#") || f.v === "@page"))
    return block(pathRef(word(f.v.replace(/^#/, ""))))
  if (f._tag !== "List") return fail(`not a query filter: ${show(f)}`)
  const [head, ...args] = f.items
  if (head?._tag !== "Sym") return fail(`not a query filter: ${show(f)}`)
  const arg = (i: number): Form => args[i] ?? fail(`(${head.v}) is missing an argument`)
  const sub = () => args.map((a) => filter(a, acc)).filter((x) => x !== null)
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
      const of = args.length === 3 ? field(name(arg(0))) : "page.day"
      return block({
        _tag: "Between",
        field: of,
        from: value(arg(args.length - 2), of),
        to: value(arg(args.length - 1), of),
      })
    }
    case "property":
      return block(compareOrIn(`property.${name(arg(0)).toLowerCase()}`, args.slice(1)))
    case "page-property":
      acc.pages = true
      return compareOrIn(`page.property.${name(arg(0)).toLowerCase()}`, args.slice(1))
    case "page-tags":
      acc.pages = true
      return { _tag: "In", field: "page.tag", values: args.map(name) }
    case "page":
      return block(compareOrIn("page", args))
    case "namespace":
      return block(compareOrIn("page.namespace", args))
    case "under":
    case "child-of":
      return block({
        _tag: "Under",
        ancestor: and(sub()) ?? fail(`(${head.v}) needs a filter`),
        self: false,
        direct: head.v === "child-of",
      })
    case "has-block":
    case "pages": {
      const blocks = acc.blocks
      const inner = and(sub())
      acc.blocks = blocks
      acc.pages = true
      if (head.v === "pages") return inner ?? null
      return { _tag: "HasBlock", filter: inner ?? fail("(has-block) needs a filter") }
    }
    case "sort-by": {
      const dir = args[1] !== undefined && name(args[1]).toLowerCase() === "asc" ? "asc" : "desc"
      acc.sort.push({ field: sortField(name(arg(0))), dir })
      return null
    }
    case "group-by":
      acc.group = field(name(arg(0)))
      return null
    case "limit": {
      const n = Number(name(arg(0)))
      acc.limit = Number.isInteger(n) && n >= 0 ? n : fail("(limit) takes a whole number")
      return null
    }
    case "view": {
      const kind = name(arg(0))
      const fields = args.slice(1).map((a) => field(name(a)))
      const [by] = fields
      if (kind === "table") acc.view = { _tag: "Table", columns: fields }
      else if (kind === "board")
        acc.view = { _tag: "Board", by: by ?? fail("(view board) needs a field") }
      else if (kind !== "list") fail(`unknown view "${kind}"; use list, table or board`)
      return null
    }
    case "text":
      return block({ _tag: "Search", text: name(arg(0)) })
    case "all-page-tags":
      return fail("(all-page-tags) lists tags, not blocks or pages; use a pages query on page.tag")
    default:
      return block(compareOrIn(head.v, args))
  }
}

export const readLogseq = (src: string): Query => {
  const body = src
    .trim()
    .replace(/^\{\{query\s+/, "")
    .replace(/\}\}$/, "")
  const acc: Acc = { pages: false, blocks: false, sort: [] }
  const where = and(
    read(body, { wiki: true })
      .map((f) => filter(f, acc))
      .filter((x) => x !== null),
  )
  if (acc.pages && acc.blocks)
    fail(
      "page filters (pages, page-property, page-tags, has-block) can't be mixed with block filters",
    )
  return finishQuery({
    find: acc.pages ? "pages" : "blocks",
    ...(where ? { where } : {}),
    ...(acc.sort.length > 0 ? { sort: acc.sort } : {}),
    ...(acc.group ? { group: acc.group } : {}),
    ...(acc.view ? { view: acc.view } : {}),
    ...(acc.limit !== undefined ? { limit: acc.limit } : {}),
  })
}
