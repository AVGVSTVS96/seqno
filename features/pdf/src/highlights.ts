import { Option, Result, Schema } from "effect"
import { printFipp, readEdn, type Edn } from "@seqno/syntax"
import type { Scaled } from "./model.ts"

const Rect = Schema.Struct({
  x1: Schema.Number,
  y1: Schema.Number,
  x2: Schema.Number,
  y2: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})

export const Highlight = Schema.Struct({
  id: Schema.String,
  page: Schema.Number,
  position: Schema.Struct({
    bounding: Rect,
    rects: Schema.Array(Rect),
    page: Schema.Number,
  }),
  content: Schema.Struct({
    text: Schema.optionalKey(Schema.String),
    image: Schema.optionalKey(Schema.Number),
  }),
  properties: Schema.Struct({ color: Schema.optionalKey(Schema.String) }),
})
export type Highlight = typeof Highlight.Type

const HighlightsFile = Schema.Struct({
  highlights: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  extra: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ page: Schema.optionalKey(Schema.NullOr(Schema.Number)) })),
  ),
})

export interface Highlights {
  readonly highlights: ReadonlyArray<Highlight>
  readonly page: number | null
}

export const emptyHighlightsFile = "{:highlights []}"

export const isArea = (highlight: Highlight) => highlight.content.image !== undefined

const plain = (value: Edn): unknown => {
  if (value === null || typeof value !== "object") return value
  switch (value._tag) {
    case "Keyword":
    case "Symbol":
      return value.name
    case "Tagged":
      return plain(value.value)
    case "Vector":
    case "List":
    case "Set":
      return value.items.map(plain)
    case "Map":
      return Object.fromEntries(
        value.entries.map(([key, item]) => [String(plain(key)), plain(item)]),
      )
  }
}

export const readHighlights = (text: string): Result.Result<Highlights, string> =>
  Result.flatMap(readEdn(text), (edn) => {
    const file = Schema.decodeUnknownOption(HighlightsFile)(plain(edn))
    if (Option.isNone(file)) return Result.fail("not a highlights map")
    const decode = Schema.decodeUnknownOption(Highlight)
    return Result.succeed({
      highlights: (file.value.highlights ?? []).flatMap((item) => Option.toArray(decode(item))),
      page: file.value.extra?.page ?? null,
    })
  })

const keyword = (name: string): Edn => ({ _tag: "Keyword", name })

const map = (entries: ReadonlyArray<readonly [string, Edn]>): Edn => ({
  _tag: "Map",
  entries: entries.map(([key, value]) => [keyword(key), value]),
})

const rect = (scaled: Scaled): Edn =>
  map([
    ["x1", scaled.x1],
    ["y1", scaled.y1],
    ["x2", scaled.x2],
    ["y2", scaled.y2],
    ["width", scaled.width],
    ["height", scaled.height],
  ])

const highlightEdn = (highlight: Highlight): Edn =>
  map([
    ["id", { _tag: "Tagged", tag: "uuid", value: highlight.id }],
    ["page", highlight.page],
    [
      "position",
      map([
        ["bounding", rect(highlight.position.bounding)],
        ["rects", { _tag: "List", items: highlight.position.rects.map(rect) }],
        ["page", highlight.position.page],
      ]),
    ],
    [
      "content",
      map([
        ...(highlight.content.text === undefined
          ? []
          : [["text", highlight.content.text] as const]),
        ...(highlight.content.image === undefined
          ? []
          : [["image", highlight.content.image] as const]),
      ]),
    ],
    [
      "properties",
      map(highlight.properties.color === undefined ? [] : [["color", highlight.properties.color]]),
    ],
  ])

export const printHighlights = (highlights: Highlights): string =>
  printFipp(
    map([
      ["highlights", { _tag: "Vector", items: highlights.highlights.map(highlightEdn) }],
      ["extra", highlights.page === null ? null : map([["page", highlights.page]])],
    ]),
  )
