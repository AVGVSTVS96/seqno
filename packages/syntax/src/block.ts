import { Option, Schema } from "effect"
import { parseInline } from "./inline.ts"
import type { Dialect, Inline } from "./inline.ts"
import { mathSpans } from "./math.ts"
import {
  BLOCK_REF,
  HEADING,
  INLINE_CODE,
  LIST_KEYS,
  MACRO,
  MARKER,
  PLANNING_LINE,
  PRIORITY,
  PROPERTY,
  TAG,
  TAG_TRAILER,
  UUID,
} from "./patterns.ts"

export const Span = Schema.Struct({ from: Schema.Int, to: Schema.Int })

export type Span = typeof Span.Type

export const Marker = Schema.Literals([
  "TODO",
  "DOING",
  "DONE",
  "LATER",
  "NOW",
  "WAITING",
  "WAIT",
  "CANCELED",
  "CANCELLED",
  "IN-PROGRESS",
  "STARTED",
])

export type Marker = typeof Marker.Type

export const Priority = Schema.Literals(["A", "B", "C"])

export type Priority = typeof Priority.Type

export const Repeater = Schema.Struct({
  kind: Schema.Literals(["+", "++", ".+"]),
  amount: Schema.Int,
  unit: Schema.Literals(["h", "d", "w", "m", "y"]),
})

export type Repeater = typeof Repeater.Type

export const Timestamp = Schema.Struct({
  day: Schema.Int,
  time: Schema.NullOr(Schema.String),
  repeater: Schema.NullOr(Repeater),
})

export type Timestamp = typeof Timestamp.Type

export const Property = Schema.Struct({ key: Schema.String, value: Schema.String, span: Span })

export type Property = typeof Property.Type

export const Ref = Schema.Union([
  Schema.TaggedStruct("PageRef", { name: Schema.String, span: Span }),
  Schema.TaggedStruct("Tag", { name: Schema.String, span: Span }),
  Schema.TaggedStruct("BlockRef", { uuid: Schema.String, span: Span }),
])

export type Ref = typeof Ref.Type

export const Macro = Schema.Struct({ name: Schema.String, args: Schema.String, span: Span })

export type Macro = typeof Macro.Type

export const Region = Schema.Struct({
  kind: Schema.Literals(["Fence", "Directive", "Drawer"]),
  name: Schema.String,
  span: Span,
})

export type Region = typeof Region.Type

export const BlockSyntax = Schema.Struct({
  marker: Schema.NullOr(Marker),
  priority: Schema.NullOr(Priority),
  heading: Schema.NullOr(Schema.Int),
  properties: Schema.Array(Property),
  props: Schema.Record(Schema.String, Schema.String),
  id: Schema.NullOr(Schema.String),
  collapsed: Schema.Boolean,
  scheduled: Schema.NullOr(Timestamp),
  deadline: Schema.NullOr(Timestamp),
  refs: Schema.Array(Ref),
  macros: Schema.Array(Macro),
  regions: Schema.Array(Region),
})

export type BlockSyntax = typeof BlockSyntax.Type

export const TextEdit = Schema.Struct({ from: Schema.Int, to: Schema.Int, insert: Schema.String })

export type TextEdit = typeof TextEdit.Type

const decodeMarker = Schema.decodeUnknownOption(Marker)
const decodePriority = Schema.decodeUnknownOption(Priority)
const decodeRepeater = Schema.decodeUnknownOption(Repeater)
const VERBATIM = new Set(["QUERY", "SRC", "EXAMPLE", "EXPORT", "COMMENT"])

const TIMESTAMP =
  /(SCHEDULED|DEADLINE): <(\d{4})-(\d{2})-(\d{2})(?: [^\s\d>]+)?(?: (\d{1,2}:\d{2}))?(?: (\.\+|\+\+|\+)(\d+)([hdwmy]))?>/gu

const DRAWER_OPEN = /^[ \t]*:([A-Za-z][\w-]*):[ \t]*$/u
const DRAWER_CLOSE = /^[ \t]*:END:[ \t]*$/iu
const FENCE = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/u
const DIRECTIVE = /^[ \t]*#\+BEGIN_(\S+)/iu

interface Line {
  readonly text: string
  readonly from: number
}

const linesOf = (text: string): readonly Line[] => {
  let from = 0

  return text.split("\n").map((line) => {
    const entry = { text: line, from }
    from += line.length + 1

    return entry
  })
}

const regionsOf = (lines: readonly Line[]): readonly Region[] => {
  const regions: Region[] = []

  let open: {
    kind: Region["kind"]
    name: string
    from: number
    closes: (line: string) => boolean
  } | null = null

  for (const line of lines) {
    if (open !== null) {
      if (open.closes(line.text)) {
        regions.push({
          kind: open.kind,
          name: open.name,
          span: { from: open.from, to: line.from + line.text.length },
        })
        open = null
      }

      continue
    }

    const fence = FENCE.exec(line.text)
    const directive = DIRECTIVE.exec(line.text)
    const drawer = DRAWER_OPEN.exec(line.text)

    if (fence !== null && !(fence[1]?.startsWith("`") && fence[2]?.includes("`"))) {
      const run = fence[1] ?? "```"
      const closing = new RegExp(`^[ \\t]*${run[0] === "`" ? "`" : "~"}{${run.length},}[ \\t\\r]*$`)
      open = {
        kind: "Fence",
        name: (fence[2] ?? "").trim(),
        from: line.from,
        closes: (next) => closing.test(next),
      }
    } else if (directive !== null) {
      const name = (directive[1] ?? "").toUpperCase()
      open = {
        kind: "Directive",
        name,
        from: line.from,
        closes: (next) => next.trimStart().toUpperCase().startsWith(`#+END_${name}`),
      }
    } else if (drawer !== null && drawer[1]?.toUpperCase() !== "END") {
      open = {
        kind: "Drawer",
        name: (drawer[1] ?? "").toUpperCase(),
        from: line.from,
        closes: (next) => DRAWER_CLOSE.test(next),
      }
    }
  }

  return regions
}

const inside = (spans: readonly Span[], at: number) =>
  spans.some((span) => at >= span.from && at < span.to)

const timestampsOf = (lines: readonly Line[]) => {
  const found: { scheduled: Timestamp | null; deadline: Timestamp | null } = {
    scheduled: null,
    deadline: null,
  }

  for (const line of lines) {
    for (const match of line.text.matchAll(TIMESTAMP)) {
      const [, which, year, month, day, time, kind, amount, unit] = match

      const stamp: Timestamp = {
        day: Number(year) * 10_000 + Number(month) * 100 + Number(day),
        time: time ?? null,
        repeater: Option.getOrNull(decodeRepeater({ kind, amount: Number(amount), unit })),
      }

      if (which === "SCHEDULED") {
        found.scheduled ??= stamp
      } else {
        found.deadline ??= stamp
      }
    }
  }

  return found
}

const propertiesOf = (lines: readonly Line[], regions: readonly Region[]): readonly Property[] => {
  const properties: Property[] = []
  const start = PROPERTY.test(lines[0]?.text ?? "") ? 0 : 1

  for (const line of lines.slice(start)) {
    const property = PROPERTY.exec(line.text)

    if (property !== null) {
      properties.push({
        key: (property[1] ?? "").toLowerCase(),
        value: property[2] ?? "",
        span: { from: line.from, to: line.from + line.text.length },
      })
      continue
    }

    const drawer = regions.find(
      (region) =>
        region.kind === "Drawer" && region.span.from <= line.from && line.from < region.span.to,
    )

    if (drawer === undefined && !PLANNING_LINE.test(line.text)) {
      break
    }
  }

  return properties
}

const pageRefsOf = (text: string, excluded: readonly Span[]): readonly Ref[] => {
  const refs: Ref[] = []
  const opens: number[] = []

  for (let at = 0; at < text.length - 1; at++) {
    if (text.startsWith("[[", at)) {
      opens.push(at)
      at++
    } else if (text.startsWith("]]", at) && opens.length > 0) {
      const from = opens.pop() ?? 0
      const name = text.slice(from + 2, at).trim()

      if (name !== "" && !name.includes("\n") && !inside(excluded, from)) {
        const tagged = from > 0 && text[from - 1] === "#"
        const span = { from: tagged ? from - 1 : from, to: at + 2 }
        refs.push(tagged ? { _tag: "Tag", name, span } : { _tag: "PageRef", name, span })
      }

      at++
    }
  }

  return refs
}

const listRefs = (property: Property): readonly Ref[] => {
  const items: Ref[] = []
  let at = property.span.to - property.value.length

  for (const item of property.value.split(",")) {
    const name = item.trim()
    const from = at + item.indexOf(name)

    if (name !== "" && !name.startsWith("[[") && !name.startsWith("#")) {
      items.push({ _tag: "PageRef", name, span: { from, to: from + name.length } })
    }

    at += item.length + 1
  }

  return items
}

const spanOf = (match: RegExpMatchArray): Span => {
  const from = match.index ?? 0

  return { from, to: from + match[0].length }
}

const ORG_HEADING_TAGS = /[ \t]+:((?:[^\s:]+:)+)[ \t]*$/u

const inlineRefs = (nodes: readonly Inline[]): readonly Ref[] =>
  nodes.flatMap((node): readonly Ref[] => {
    switch (node._tag) {
      case "PageRef": {
        return [{ _tag: "PageRef", name: node.name, span: node.span }]
      }

      case "Tag": {
        return [{ _tag: "Tag", name: node.name, span: node.span }]
      }

      case "BlockRef": {
        return [{ _tag: "BlockRef", uuid: node.uuid, span: node.span }]
      }

      case "Link": {
        return node.target._tag === "Page"
          ? [{ _tag: "PageRef", name: node.target.name, span: node.span }]
          : node.target._tag === "Block"
            ? [{ _tag: "BlockRef", uuid: node.target.uuid, span: node.span }]
            : []
      }

      case "Bold":
      case "Italic":
      case "Strike":
      case "Underline":
      case "Highlight": {
        return inlineRefs(node.children)
      }

      default: {
        return []
      }
    }
  })

const orgRefs = (lines: readonly Line[], excluded: readonly Span[]): readonly Ref[] =>
  lines.flatMap((line, index) => {
    if (inside(excluded, line.from)) {
      return []
    }

    const tags = index === 0 ? ORG_HEADING_TAGS.exec(line.text) : null
    const own = tags === null ? line.text : line.text.slice(0, tags.index)

    const headingTags: readonly Ref[] =
      tags === null
        ? []
        : (tags[1] ?? "")
            .split(":")
            .filter((name) => name !== "")
            .map((name) => {
              const from = line.from + line.text.indexOf(`:${name}:`, tags.index) + 1

              return { _tag: "Tag", name, span: { from, to: from + name.length } }
            })

    return [
      ...inlineRefs(parseInline(own, line.from, "org")).filter(
        (ref) => !inside(excluded, ref.span.from),
      ),
      ...headingTags,
    ]
  })

export const analyzeBlock = (text: string, dialect: Dialect = "markdown"): BlockSyntax => {
  const lines = linesOf(text)
  const title = lines[0]?.text ?? ""
  const regions = regionsOf(lines)

  const code = [
    ...regions
      .filter((region) => region.kind !== "Directive" || VERBATIM.has(region.name))
      .map((region) => region.span),
    ...(dialect === "org" ? [] : [...text.matchAll(INLINE_CODE)].map(spanOf)),
  ]

  const verbatim = [...code, ...mathSpans(text, code)]

  const macros = [...text.matchAll(MACRO)]
    .filter((match) => !inside(verbatim, match.index ?? 0))
    .map((match): Macro => ({
      name: (match[1] ?? "").toLowerCase(),
      args: (match[2] ?? "").trim(),
      span: spanOf(match),
    }))

  const queries = macros.filter((macro) => macro.name === "query").map((macro) => macro.span)
  const excluded = [...verbatim, ...queries]

  const blockRefs = [...text.matchAll(BLOCK_REF)]
    .filter((match) => !inside(excluded, match.index ?? 0))
    .map((match): Ref => ({
      _tag: "BlockRef",
      uuid: (match[1] ?? "").toLowerCase(),
      span: spanOf(match),
    }))

  const tags = [...text.matchAll(TAG)].flatMap((match): readonly Ref[] => {
    const name = (match[1] ?? "").replace(TAG_TRAILER, "")
    const from = match.index ?? 0

    return name === "" || inside(excluded, from)
      ? []
      : [{ _tag: "Tag", name, span: { from, to: from + 1 + name.length } }]
  })

  const properties = dialect === "org" ? [] : propertiesOf(lines, regions)
  const listed = properties.filter((property) => LIST_KEYS.has(property.key)).flatMap(listRefs)

  const refs = (
    dialect === "org"
      ? orgRefs(lines, excluded)
      : [...pageRefsOf(text, excluded), ...tags, ...blockRefs, ...listed]
  ).toSorted((a, b) => a.span.from - b.span.from)

  const props = Object.fromEntries(properties.map((property) => [property.key, property.value]))
  const id = properties.find((property) => property.key === "id")?.value ?? ""

  return {
    marker: Option.getOrNull(decodeMarker(MARKER.exec(title)?.[1])),
    priority: Option.getOrNull(decodePriority(PRIORITY.exec(title)?.[1])),
    heading: dialect === "org" ? null : (HEADING.exec(title)?.[1]?.length ?? null),
    properties,
    props,
    id: UUID.test(id) ? id.toLowerCase() : null,
    collapsed: props["collapsed"]?.toLowerCase() === "true",
    ...timestampsOf(lines.filter((line) => PLANNING_LINE.test(line.text))),
    refs,
    macros,
    regions,
  }
}

export const setProperty = (text: string, key: string, value: string | null): TextEdit | null => {
  const properties = analyzeBlock(text).properties
  const existing = properties.find((property) => property.key === key.toLowerCase())

  if (existing !== undefined) {
    if (value === null) {
      const from = existing.span.from === 0 ? 0 : existing.span.from - 1

      const to =
        existing.span.from === 0 && existing.span.to < text.length
          ? existing.span.to + 1
          : existing.span.to

      return { from, to, insert: "" }
    }

    const line = `${key}:: ${value}`

    return text.slice(existing.span.from, existing.span.to) === line
      ? null
      : { from: existing.span.from, to: existing.span.to, insert: line }
  }

  if (value === null) {
    return null
  }

  if (text === "") {
    return { from: 0, to: 0, insert: `${key}:: ${value}` }
  }

  const newline = text.indexOf("\n")
  const after = properties.at(-1)?.span.to ?? (newline === -1 ? text.length : newline)

  return { from: after, to: after, insert: `\n${key}:: ${value}` }
}

export const applyEdit = (text: string, edit: TextEdit): string =>
  text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
