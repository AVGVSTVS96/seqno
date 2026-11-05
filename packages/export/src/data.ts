import { Predicate } from "effect"
import { normalizePageName } from "@seqno/domain"
import type { Block, BlockId, PageId } from "@seqno/domain"
import { joinProperties, parseInline, propertyKey } from "@seqno/syntax"
import type { PropertyConfig } from "@seqno/syntax"
import { propertyLines } from "./items.ts"
import type { PropertyLine } from "./items.ts"
import { shelve } from "./library.ts"
import type { Library, PageBlocks, Shelf } from "./library.ts"
import { isList, propertyValue } from "./values.ts"
import type { PropertyValue } from "./values.ts"

type Edn =
  | string
  | number
  | boolean
  | null
  | { readonly _tag: "Keyword"; readonly name: string }
  | { readonly _tag: "Uuid"; readonly value: string }
  | { readonly _tag: "Vector"; readonly items: readonly Edn[] }
  | { readonly _tag: "List"; readonly items: readonly Edn[] }
  | { readonly _tag: "Set"; readonly items: readonly Edn[] }
  | { readonly _tag: "Map"; readonly entries: ReadonlyArray<readonly [Edn, Edn]> }

const keyword = (name: string): Edn => ({ _tag: "Keyword", name })
const vector = (items: readonly Edn[]): Edn => ({ _tag: "Vector", items })

const seq = (items: readonly Edn[]): Edn =>
  items.length === 0 ? vector(items) : { _tag: "List", items }

const map = (entries: ReadonlyArray<readonly [string, Edn]>): Edn => ({
  _tag: "Map",
  entries: entries.map(([key, value]) => [keyword(key), value]),
})

const ednString = (text: string) =>
  `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`

const MARGIN = 72

const flat = (value: Edn): string => {
  if (value === null) {
    return "nil"
  }

  if (Predicate.isString(value)) {
    return ednString(value)
  }

  if (Predicate.isNumber(value) || Predicate.isBoolean(value)) {
    return String(value)
  }

  switch (value._tag) {
    case "Keyword": {
      return `:${value.name}`
    }

    case "Uuid": {
      return `#uuid ${ednString(value.value)}`
    }

    case "Vector": {
      return `[${value.items.map(flat).join(" ")}]`
    }

    case "List": {
      return `(${value.items.map(flat).join(" ")})`
    }

    case "Set": {
      return `#{${value.items.map(flat).join(" ")}}`
    }

    case "Map": {
      return `{${value.entries.map(([key, item]) => `${flat(key)} ${flat(item)}`).join(", ")}}`
    }
  }
}

const printEdn = (value: Edn, column: number, tail: number): string => {
  const one = flat(value)

  if (column + one.length + tail < MARGIN || !Predicate.isObject(value)) {
    return one
  }

  const pad = " ".repeat(column + 1)

  const items = (open: string, close: string, list: readonly Edn[]) =>
    `${open}${list
      .map((item, index) =>
        printEdn(item, column + open.length, index === list.length - 1 ? tail + 1 : 0),
      )
      .join(`\n${" ".repeat(column + open.length)}`)}${close}`

  switch (value._tag) {
    case "Keyword":
    case "Uuid":
    case "Set": {
      return one
    }

    case "Vector": {
      return items("[", "]", value.items)
    }

    case "List": {
      return items("(", ")", value.items)
    }

    case "Map": {
      return `{${value.entries
        .map(([key, item], index) => {
          const last = index === value.entries.length - 1 ? tail + 1 : 1
          const head = flat(key)
          const inline = flat(item)

          return column + 1 + head.length + 1 + inline.length + last < MARGIN
            ? `${head} ${inline}`
            : `${head}\n${pad}${printEdn(item, column + 1, last)}`
        })
        .join(`,\n${pad}`)}}`
    }
  }
}

const VALID_KEY = /^[^\s"|^(){}#,][^\s"|^(){},]*$/u

type Properties = ReadonlyArray<readonly [string, PropertyValue]> | null

const typed = (lines: ReadonlyArray<readonly [string, string]>, config: PropertyConfig) =>
  lines.flatMap(([raw, value]) => {
    const key = propertyKey(raw)

    return key !== "id" && VALID_KEY.test(key)
      ? [[key, propertyValue(key, value, config)] as const]
      : []
  })

const pagePropertiesOf = (
  props: Readonly<Record<string, string>>,
  config: PropertyConfig,
): Properties => {
  const kept = typed(Object.entries(props), config)

  return kept.length === 0 ? null : kept
}

const HEADING = /^(#+)[ \t]/u

type Format = "markdown" | "org"

const blockPropertiesOf = (block: Block, config: PropertyConfig, format: Format): Properties => {
  const level = format === "org" ? undefined : HEADING.exec(block.text)?.[1]?.length

  const kept = [
    ...(level === undefined ? [] : [["heading", level] as const]),
    ...typed(Object.entries(block.props), config),
  ]

  return kept.length === 0 && Object.keys(block.props).length === 0 ? null : kept
}

const contentOf = (block: Block, format: Format, last: boolean) => {
  if (format === "markdown") {
    return block.collapsed ? joinProperties(block.text, [["collapsed", "true"]]) : block.text
  }

  if (Object.keys(block.props).length > 0) {
    return block.text
  }

  const raw = joinProperties(block.text, block.collapsed ? [["collapsed", "true"]] : [], "org")

  return last ? raw : `${raw}\n`
}

export interface ExportedPage {
  readonly id: string
  readonly title: string
  readonly properties: Properties
  readonly children: readonly ExportedBlock[]
}

export interface ExportedBlock {
  readonly id: string
  readonly format: Format
  readonly content: string
  readonly lines: readonly PropertyLine[]
  readonly properties: Properties
  readonly children: readonly ExportedBlock[]
}

interface Placement {
  readonly pageId: PageId
  readonly format: Format
  readonly last: BlockId | null
}

const blockOf = (shelf: Shelf, at: Placement, block: Block): ExportedBlock => ({
  id: shelf.logseqId(block),
  format: at.format,
  content: contentOf(block, at.format, block.id === at.last),
  lines: propertyLines(block, false),
  properties: blockPropertiesOf(block, shelf.properties, at.format),
  children: shelf.children(at.pageId, block.id).map((child) => blockOf(shelf, at, child)),
})

const lastBlock = (shelf: Shelf, pageId: PageId, parentId: BlockId | null): BlockId | null => {
  const last = shelf.children(pageId, parentId).at(-1)

  return last === undefined ? parentId : lastBlock(shelf, pageId, last.id)
}

export const hasFile = ({ page, blocks }: PageBlocks) =>
  blocks.length > 0 || Object.keys(page.props).length > 0

const fnv1a = (text: string) => {
  let hash = 0xcb_f2_9c_e4_84_22_23_25n

  for (const char of text) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- hashes each character's first UTF-16 unit, so ids written by earlier exports stay stable
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x1_00_00_00_01_b3n)
  }

  return hash
}

const derivedUuid = (seed: string) => {
  const half = (salt: string) =>
    fnv1a(salt + seed)
      .toString(16)
      .padStart(16, "0")

  const hex = half("a") + half("b")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const propertiesBlock = (page: PageBlocks["page"], properties: Properties) =>
  properties === null
    ? []
    : [
        {
          id: derivedUuid(page.id),
          format: page.format ?? ("markdown" as const),
          content:
            page.frontMatter === true
              ? joinProperties("", Object.entries(page.props), "frontMatter")
              : page.format === "org"
                ? `${joinProperties("", Object.entries(page.props), "directives")}\n\n`
                : "",
          lines:
            page.frontMatter === true || page.format === "org" ? [] : Object.entries(page.props),
          properties,
          children: [],
        },
      ]

export const exportedPages = (library: Library): readonly ExportedPage[] => {
  const shelf = shelve(library)

  return library.pages
    .filter(hasFile)
    .toSorted((a, b) => (a.page.name < b.page.name ? -1 : a.page.name > b.page.name ? 1 : 0))
    .map(({ page }) => {
      const properties = pagePropertiesOf(page.props, shelf.properties)

      return {
        id: page.id,
        title: page.title,
        properties,
        children: [
          ...propertiesBlock(page, properties),
          ...shelf.children(page.id, null).map((block) =>
            blockOf(
              shelf,
              {
                pageId: page.id,
                format: page.format ?? "markdown",
                last: lastBlock(shelf, page.id, null),
              },
              block,
            ),
          ),
        ],
      }
    })
}

const ednValue = (value: PropertyValue): Edn =>
  isList(value) ? { _tag: "Set", items: value } : value

const ednProperties = (properties: Properties): Edn =>
  properties === null
    ? null
    : {
        _tag: "Map",
        entries: properties.map(([key, value]) => [keyword(key), ednValue(value)]),
      }

const ednBlock = (block: ExportedBlock): Edn =>
  map([
    ["block/id", { _tag: "Uuid", value: block.id }],
    ["block/properties", ednProperties(block.properties)],
    ["block/format", keyword(block.format)],
    ["block/children", vector(block.children.map(ednBlock))],
    ["block/content", block.content],
  ])

export const ednOf = (pages: readonly ExportedPage[]): string =>
  `${printEdn(
    map([
      ["version", 1],
      [
        "blocks",
        seq(
          pages.map((page) =>
            map([
              ["block/id", { _tag: "Uuid", value: page.id }],
              ["block/page-name", page.title],
              ["block/properties", ednProperties(page.properties)],
              ["block/children", seq(page.children.map(ednBlock))],
            ]),
          ),
        ),
      ],
    ]),
    0,
    0,
  )}\n`

interface JsonBlock {
  readonly id: string
  readonly properties: Record<string, PropertyValue> | null
  readonly format: Format
  readonly children: readonly JsonBlock[]
  readonly content: string
}

const jsonProperties = (properties: Properties) =>
  properties === null
    ? null
    : Object.fromEntries(properties.map(([key, value]) => [key.split("/").at(-1) ?? key, value]))

const jsonBlock = (block: ExportedBlock): JsonBlock => ({
  id: block.id,
  properties: jsonProperties(block.properties),
  format: block.format,
  children: block.children.map(jsonBlock),
  content: block.content,
})

export const jsonOf = (pages: readonly ExportedPage[]): string =>
  JSON.stringify({
    version: 1,
    blocks: pages.map((page) => ({
      id: page.id,
      "page-name": page.title,
      properties: jsonProperties(page.properties),
      children: page.children.map(jsonBlock),
    })),
  })

const UID_CHARS = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

const uidOf = (uuid: string) => {
  let hash = fnv1a(uuid)
  let uid = ""

  for (let index = 0; index < 9; index++) {
    uid += UID_CHARS[Number(hash % 64n)] ?? "_"
    hash /= 64n
  }

  return uid
}

const TODO = /^(NOW|LATER|TODO|DOING|WAITING|WAIT|CANCELED|CANCELLED|STARTED|IN-PROGRESS)/u
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu

interface RoamBlock {
  readonly string: string
  readonly uid?: string
  readonly children: readonly RoamBlock[]
}

const linkedNames = (pages: readonly ExportedPage[]): ReadonlySet<string> => {
  const names = new Set<string>()
  const add = (name: string) => names.add(normalizePageName(name))

  const visit = (block: ExportedBlock) => {
    for (const node of parseInline(block.content)) {
      if (node._tag === "PageRef" || node._tag === "Tag") {
        add(node.name)
      } else if (node._tag === "Link" && node.target._tag === "Page") {
        add(node.target.name)
      } else if (node._tag === "Macro" && node.name === "embed") {
        const page = /^\s*\[\[(.+)\]\]\s*$/u.exec(node.args)?.[1]

        if (page !== undefined) {
          add(page)
        }
      }
    }

    for (const [, value] of block.properties ?? []) {
      if (isList(value)) {
        for (const name of value) {
          add(name)
        }
      }
    }

    block.children.forEach(visit)
  }

  pages.forEach((page) => {
    page.children.forEach(visit)
  })

  return names
}

export const roamJsonOf = (pages: readonly ExportedPage[], referenced: ReadonlySet<string>) => {
  const roamString = (block: ExportedBlock) =>
    (block.format === "org"
      ? block.properties === null
        ? block.content
        : joinProperties(block.content, block.lines, "org")
      : joinProperties(
          block.content,
          block.lines.filter(([key]) => key !== "collapsed"),
        )
    )
      .replaceAll(UUIDS, (uuid) =>
        referenced.has(uuid.toLowerCase()) ? uidOf(uuid.toLowerCase()) : uuid,
      )
      .replace(TODO, "{{[[TODO]]}}")
      .replace(/^DONE/u, "{{[[DONE]]}}")
      .replaceAll("{{embed ", "{{embed: ")
      .trim()

  const roamBlock = (block: ExportedBlock): RoamBlock => {
    const string = roamString(block)
    const children = block.children.map(roamBlock)

    return referenced.has(block.id)
      ? { string, uid: uidOf(block.id), children }
      : { string, children }
  }

  const linked = linkedNames(pages)

  return JSON.stringify(
    pages.map(({ title, id, children }) =>
      linked.has(normalizePageName(title))
        ? { title, uid: uidOf(id), children: children.map(roamBlock) }
        : { title, children: children.map(roamBlock) },
    ),
  )
}
