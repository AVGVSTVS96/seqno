import { analyzeBlock } from "./block.ts"
import type { Marker, Region, Span, TextEdit } from "./block.ts"
import { parseInline } from "./inline.ts"
import type { Dialect, Inline } from "./inline.ts"
import { defaultPropertyConfig } from "./config.ts"
import type { PropertyConfig } from "./config.ts"
import { mathBlockAt } from "./math.ts"
import { HEADING, MARKER, PLANNING_LINE } from "./patterns.ts"

export type Body =
  | { readonly _tag: "Paragraph"; readonly inline: readonly Inline[]; readonly span: Span }
  | {
      readonly _tag: "Heading"
      readonly level: number
      readonly inline: readonly Inline[]
      readonly span: Span
    }
  | {
      readonly _tag: "Code"
      readonly language: string
      readonly code: string
      readonly codeFrom: number
      readonly span: Span
    }
  | {
      readonly _tag: "Quote"
      readonly lines: ReadonlyArray<readonly Inline[]>
      readonly span: Span
    }
  | {
      readonly _tag: "Admonition"
      readonly kind: AdmonitionKind
      readonly lines: ReadonlyArray<readonly Inline[]>
      readonly span: Span
    }
  | { readonly _tag: "Math"; readonly tex: string; readonly span: Span }

export type AdmonitionKind = "note" | "tip" | "important" | "caution" | "warning" | "pinned"

const admonitions: ReadonlyMap<string, AdmonitionKind> = new Map([
  ["NOTE", "note"],
  ["TIP", "tip"],
  ["IMPORTANT", "important"],
  ["CAUTION", "caution"],
  ["WARNING", "warning"],
  ["PINNED", "pinned"],
])

export interface ShownProperty {
  readonly key: string
  readonly value: readonly Inline[]
  readonly span: Span
}

export interface Planning {
  readonly kind: "SCHEDULED" | "DEADLINE"
  readonly date: string
  readonly span: Span
}

export interface Logbook {
  readonly entries: readonly string[]
  readonly seconds: number
  readonly span: Span
}

export interface BlockContent {
  readonly marker: Marker | null
  readonly heading: number | null
  readonly title: readonly Inline[] | null
  readonly properties: readonly ShownProperty[]
  readonly planning: readonly Planning[]
  readonly logbook: Logbook | null
  readonly body: readonly Body[]
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
  "ls-type",
])

const QUOTE = /^[ \t]*>[ \t]?/
const PLANNING = /(SCHEDULED|DEADLINE): <([^>\n]*)>/g
const CLOCK_DURATION = /=>\s*(\d+):(\d{2})(?::(\d{2}))?\s*$/
const FENCE_INFO = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`]*)/

const LEADING_PRIORITY = /^\[#([ABC])\][ \t]*/

const ORG_HEADING_TAGS = /[ \t]+:(?:[^\s:]+:)+[ \t]*$/
const EXPORT_LANGUAGE = /^[ \t]*#\+BEGIN_EXPORT[ \t]+(\S+)/i
const OPENS_MATH = /\\[[(]/
const ORG_HIDDEN = /^[ \t]*(?:#\+(?!BEGIN_|END_)\S*:|#(?:[ \t]|$))/i

const titleOf = (line: string, start: number, dialect: Dialect): readonly Inline[] => {
  const own = dialect === "org" ? line.replace(ORG_HEADING_TAGS, "") : line
  const leading = LEADING_PRIORITY.exec(own.slice(start))
  const priority = leading?.[1]

  if (leading === null || (priority !== "A" && priority !== "B" && priority !== "C")) {
    return parseInline(own.slice(start), start, dialect)
  }

  const rest = start + leading[0].length

  return [
    { _tag: "Priority", priority, span: { from: start, to: start + 4 } },
    ...parseInline(own.slice(rest), rest, dialect),
  ]
}

export const isHiddenProperty = (key: string) =>
  HIDDEN_KEYS.has(key) || key.startsWith("logseq.") || key.startsWith("hl-")

const linesOf = (text: string): readonly Line[] => {
  let from = 0

  return text.split("\n").map((line) => {
    const entry = { text: line, from }
    from += line.length + 1

    return entry
  })
}

const listValue = (value: string, from: number): readonly Inline[] => {
  const nodes: Inline[] = []
  let at = 0

  for (const item of value.split(",")) {
    const name = item.trim()
    const start = from + at + item.indexOf(name)

    if (nodes.length > 0 && name !== "") {
      nodes.push({ _tag: "Text", text: ", ", span: { from: from + at - 1, to: start } })
    }

    if (name.startsWith("[[") || name.startsWith("#")) {
      nodes.push(...parseInline(name, start))
    } else if (name !== "") {
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

export const propertyValue = (
  key: string,
  value: string,
  from = 0,
  config: PropertyConfig = defaultPropertyConfig,
): readonly Inline[] =>
  config.listKeys.has(key.toLowerCase()) ? listValue(value, from) : parseInline(value, from)

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

const regionAt = (regions: readonly Region[], line: Line) =>
  regions.find((region) => region.span.from === line.from)

const within = (span: Span, line: Line) => line.from >= span.from && line.from < span.to

export const blockContent = (text: string, dialect: Dialect = "markdown"): BlockContent => {
  const org = dialect === "org"
  const syntax = analyzeBlock(text, dialect)
  const lines = linesOf(text)
  const first = lines[0] ?? { text: "", from: 0 }
  const opensRegion = regionAt(syntax.regions, first) !== undefined
  const isProperty = syntax.properties.some((property) => within(property.span, first))
  const hasTitle = !opensRegion && !isProperty && (org || !QUOTE.test(first.text))
  const heading = hasTitle && !org ? (HEADING.exec(first.text)?.[0] ?? "") : ""
  const marker = hasTitle && heading === "" ? (MARKER.exec(first.text)?.[0] ?? "") : ""
  const titleFrom = heading.length + marker.length
  const titleText = first.text.slice(titleFrom)
  const titleStart = titleFrom + (titleText.length - titleText.trimStart().length)
  const titleMath = hasTitle ? mathBlockAt(text, titleStart) : null

  const planning: Planning[] = []
  const body: Body[] = []
  let logbook: Logbook | null = null
  const rest = hasTitle ? lines.slice(1) : lines

  const queue: Line[] =
    titleMath === null
      ? [...rest]
      : [{ text: first.text.slice(titleStart), from: titleStart }, ...rest]

  const plainLine = (line: Line) =>
    regionAt(syntax.regions, line) === undefined &&
    !syntax.properties.some((property) => within(property.span, line)) &&
    !PLANNING_LINE.test(line.text) &&
    (org || (!QUOTE.test(line.text) && !HEADING.test(line.text))) &&
    mathBlockAt(text, line.from) === null

  const mathThrough = (line: Line, index: number): number => {
    if (!OPENS_MATH.test(line.text)) {
      return index
    }

    let last = index

    while (queue[last + 1] !== undefined && plainLine(queue[last + 1] ?? line)) {
      last++
    }

    if (last === index) {
      return index
    }

    const lineEnd = line.from + line.text.length
    const tail = queue[last] ?? line

    const crossing = parseInline(
      text.slice(line.from, tail.from + tail.text.length),
      line.from,
      dialect,
    ).find((node) => node.span.to > lineEnd)

    if (crossing?._tag !== "Math" || crossing.span.from >= lineEnd) {
      return index
    }

    let through = index

    while ((queue[through + 1]?.from ?? Number.POSITIVE_INFINITY) < crossing.span.to) {
      through++
    }

    return through
  }

  for (let index = 0; index < queue.length; index++) {
    const line = queue[index]

    if (line === undefined) {
      continue
    }

    if (syntax.properties.some((property) => within(property.span, line))) {
      continue
    }

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
      } else if (
        region.kind === "Directive" &&
        region.name === "EXPORT" &&
        EXPORT_LANGUAGE.exec(line.text)?.[1] === "latex"
      ) {
        body.push({ _tag: "Math", tex: inner.map((entry) => `${entry.text}\n`).join(""), span })
      } else if (region.kind === "Directive" && region.name === "QUOTE") {
        body.push({
          _tag: "Quote",
          lines: inner.map((entry) => parseInline(entry.text, entry.from, dialect)),
          span,
        })
      } else if (region.kind === "Directive" && admonitions.has(region.name)) {
        body.push({
          _tag: "Admonition",
          kind: admonitions.get(region.name) ?? "note",
          lines: inner.map((entry) => parseInline(entry.text, entry.from, dialect)),
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
          codeFrom: inner[0]?.from ?? line.from + line.text.length + 1,
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

    if (org && ORG_HIDDEN.test(line.text)) {
      continue
    }

    const math = mathBlockAt(text, line.from)

    if (math !== null) {
      body.push({ _tag: "Math", tex: math.tex, span: math.span })

      while ((queue[index + 1]?.from ?? Number.POSITIVE_INFINITY) <= math.span.to) {
        index++
      }

      const last = queue[index] ?? line
      const tail = last.text.slice(math.span.to - last.from)

      if (tail.trim() !== "") {
        queue[index--] = { text: tail, from: math.span.to }
      }

      continue
    }

    const quote = org ? null : QUOTE.exec(line.text)

    if (quote !== null) {
      const run = [line]

      while (QUOTE.test(queue[index + 1]?.text ?? "")) {
        const next = queue[index + 1]

        if (next !== undefined) {
          run.push(next)
        }

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

    const hashes = org ? undefined : HEADING.exec(line.text)?.[0]
    const through = hashes === undefined ? mathThrough(line, index) : index
    const end = queue[through] ?? line
    index = through
    const span = { from: line.from, to: end.from + end.text.length }
    body.push(
      hashes === undefined
        ? {
            _tag: "Paragraph",
            inline: parseInline(text.slice(span.from, span.to), line.from, dialect),
            span,
          }
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
    title: hasTitle ? (titleMath === null ? titleOf(first.text, titleStart, dialect) : []) : null,
    properties: syntax.properties
      .filter((property) => !isHiddenProperty(property.key))
      .map((property) => {
        const line = text.slice(property.span.from, property.span.to)
        const valueFrom = property.span.from + line.indexOf(property.value, line.indexOf("::") + 2)

        return {
          key: property.key,
          value: propertyValue(property.key, property.value, valueFrom),
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

  if (marker === current) {
    return null
  }

  if (marker !== null) {
    return { from: 0, to: current.length, insert: marker }
  }

  const spaces = /^[ \t]*/.exec(line.slice(current.length))?.[0].length ?? 0

  return { from: 0, to: current.length + spaces, insert: "" }
}
