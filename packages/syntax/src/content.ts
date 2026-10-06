import { analyzeBlock, type Marker, type Region, type Span, type TextEdit } from "./block.ts"
import { parseInline, type Inline } from "./inline.ts"
import { HEADING, LIST_KEYS, MARKER, PLANNING_LINE } from "./patterns.ts"

export type Body =
  | { readonly _tag: "Paragraph"; readonly inline: ReadonlyArray<Inline>; readonly span: Span }
  | {
      readonly _tag: "Heading"
      readonly level: number
      readonly inline: ReadonlyArray<Inline>
      readonly span: Span
    }
  | {
      readonly _tag: "Code"
      readonly language: string
      readonly code: string
      readonly span: Span
    }
  | {
      readonly _tag: "Quote"
      readonly lines: ReadonlyArray<ReadonlyArray<Inline>>
      readonly span: Span
    }

export interface ShownProperty {
  readonly key: string
  readonly value: ReadonlyArray<Inline>
  readonly span: Span
}

export interface Planning {
  readonly kind: "SCHEDULED" | "DEADLINE"
  readonly date: string
  readonly span: Span
}

export interface Logbook {
  readonly entries: ReadonlyArray<string>
  readonly seconds: number
  readonly span: Span
}

export interface BlockContent {
  readonly marker: Marker | null
  readonly heading: number | null
  readonly title: ReadonlyArray<Inline> | null
  readonly properties: ReadonlyArray<ShownProperty>
  readonly planning: ReadonlyArray<Planning>
  readonly logbook: Logbook | null
  readonly body: ReadonlyArray<Body>
  readonly numbered: boolean
}

interface Line {
  readonly text: string
  readonly from: number
}

const HIDDEN_KEYS = new Set([
  "id",
  "collapsed",
  "heading",
  "created-at",
  "updated-at",
  "background-color",
  "background_color",
])
const QUOTE = /^[ \t]*>[ \t]?/
const PLANNING = /(SCHEDULED|DEADLINE): <([^>\n]*)>/g
const CLOCK_DURATION = /=>\s*(\d+):(\d{2})(?::(\d{2}))?\s*$/
const FENCE_INFO = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`]*)/

export const isHiddenProperty = (key: string) =>
  HIDDEN_KEYS.has(key) || key.startsWith("logseq.") || key.startsWith("hl-")

const linesOf = (text: string): ReadonlyArray<Line> => {
  let from = 0
  return text.split("\n").map((line) => {
    const entry = { text: line, from }
    from += line.length + 1
    return entry
  })
}

const listValue = (value: string, from: number): ReadonlyArray<Inline> => {
  const nodes: Array<Inline> = []
  let at = 0
  for (const item of value.split(",")) {
    const name = item.trim()
    const start = from + at + item.indexOf(name)
    if (nodes.length > 0 && name !== "") {
      nodes.push({ _tag: "Text", text: ", ", span: { from: from + at - 1, to: start } })
    }
    if (name.startsWith("[[") || name.startsWith("#")) nodes.push(...parseInline(name, start))
    else if (name !== "") {
      nodes.push({
        _tag: "PageRef",
        name,
        brackets: false,
        span: { from: start, to: start + name.length },
      })
    }
    at += item.length + 1
  }
  return nodes
}

const durationOf = (entry: string): number => {
  const match = CLOCK_DURATION.exec(entry)
  return match === null
    ? 0
    : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
}

export const clockTotal = (seconds: number): string => {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
  ].join("")
  return parts === "" ? `${seconds % 60}s` : parts
}

const regionAt = (regions: ReadonlyArray<Region>, line: Line) =>
  regions.find((region) => region.span.from === line.from)

const within = (span: Span, line: Line) => line.from >= span.from && line.from < span.to

export const blockContent = (text: string): BlockContent => {
  const syntax = analyzeBlock(text)
  const lines = linesOf(text)
  const first = lines[0] ?? { text: "", from: 0 }
  const opensRegion = regionAt(syntax.regions, first) !== undefined
  const isProperty = syntax.properties.some((property) => within(property.span, first))
  const hasTitle = !opensRegion && !isProperty && !QUOTE.test(first.text)
  const heading = hasTitle ? (HEADING.exec(first.text)?.[0] ?? "") : ""
  const marker = hasTitle && heading === "" ? (MARKER.exec(first.text)?.[0] ?? "") : ""
  const titleFrom = heading.length + marker.length
  const titleText = first.text.slice(titleFrom)
  const titleStart = titleFrom + (titleText.length - titleText.trimStart().length)

  const planning: Array<Planning> = []
  const body: Array<Body> = []
  let logbook: Logbook | null = null
  const rest = hasTitle ? lines.slice(1) : lines
  for (let index = 0; index < rest.length; index++) {
    const line = rest[index]
    if (line === undefined) continue
    if (syntax.properties.some((property) => within(property.span, line))) continue
    const region = regionAt(syntax.regions, line)
    if (region !== undefined) {
      const inner = rest.filter(
        (candidate) =>
          candidate.from > region.span.from &&
          candidate.from + candidate.text.length < region.span.to,
      )
      index += inner.length + 1
      const span = region.span
      if (region.kind === "Drawer") {
        if (region.name === "LOGBOOK") {
          const entries = inner.map((entry) => entry.text.trim())
          logbook = {
            entries,
            seconds: entries.reduce((total, entry) => total + durationOf(entry), 0),
            span,
          }
        }
      } else if (region.kind === "Directive" && region.name === "QUOTE") {
        body.push({
          _tag: "Quote",
          lines: inner.map((entry) => parseInline(entry.text, entry.from)),
          span,
        })
      } else {
        body.push({
          _tag: "Code",
          language:
            region.kind === "Fence"
              ? (FENCE_INFO.exec(line.text)?.[1] ?? "")
              : region.name === "SRC"
                ? (/BEGIN_SRC[ \t]+(\S+)/i.exec(line.text)?.[1] ?? "")
                : "",
          code: inner.map((entry) => entry.text).join("\n"),
          span,
        })
      }
      continue
    }
    if (PLANNING_LINE.test(line.text)) {
      for (const match of line.text.matchAll(PLANNING)) {
        const from = line.from + (match.index ?? 0)
        planning.push({
          kind: match[1] === "DEADLINE" ? "DEADLINE" : "SCHEDULED",
          date: match[2] ?? "",
          span: { from, to: from + match[0].length },
        })
      }
      continue
    }
    const quote = QUOTE.exec(line.text)
    if (quote !== null) {
      const run = [line]
      while (QUOTE.test(rest[index + 1]?.text ?? "")) {
        const next = rest[index + 1]
        if (next !== undefined) run.push(next)
        index++
      }
      const last = run[run.length - 1] ?? line
      body.push({
        _tag: "Quote",
        lines: run.map((entry) => {
          const prefix = QUOTE.exec(entry.text)?.[0] ?? ""
          return parseInline(entry.text.slice(prefix.length), entry.from + prefix.length)
        }),
        span: { from: line.from, to: last.from + last.text.length },
      })
      continue
    }
    const hashes = HEADING.exec(line.text)?.[0]
    const span = { from: line.from, to: line.from + line.text.length }
    body.push(
      hashes === undefined
        ? { _tag: "Paragraph", inline: parseInline(line.text, line.from), span }
        : {
            _tag: "Heading",
            level: hashes.trim().length,
            inline: parseInline(line.text.slice(hashes.length), line.from + hashes.length),
            span,
          },
    )
  }
  return {
    marker: hasTitle ? syntax.marker : null,
    heading: heading === "" ? null : heading.trim().length,
    title: hasTitle ? parseInline(first.text.slice(titleStart), titleStart) : null,
    properties: syntax.properties
      .filter((property) => !isHiddenProperty(property.key))
      .map((property) => {
        const line = text.slice(property.span.from, property.span.to)
        const valueFrom = property.span.from + line.indexOf(property.value, line.indexOf("::") + 2)
        return {
          key: property.key,
          value: LIST_KEYS.has(property.key)
            ? listValue(property.value, valueFrom)
            : parseInline(property.value, valueFrom),
          span: property.span,
        }
      }),
    planning,
    logbook,
    body,
    numbered: syntax.props["logseq.order-list-type"] === "number",
  }
}

export const setMarker = (text: string, marker: Marker | null): TextEdit | null => {
  const line = text.split("\n")[0] ?? ""
  const current = MARKER.exec(line)?.[0]
  if (current === undefined) {
    return marker === null ? null : { from: 0, to: 0, insert: line === "" ? marker : `${marker} ` }
  }
  if (marker === current) return null
  if (marker !== null) return { from: 0, to: current.length, insert: marker }
  const spaces = /^[ \t]*/.exec(line.slice(current.length))?.[0].length ?? 0
  return { from: 0, to: current.length + spaces, insert: "" }
}
