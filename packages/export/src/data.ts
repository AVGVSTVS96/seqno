import { normalizePageName, type Block, type PageId } from "@seqno/domain"
import { joinProperties, parseInline } from "@seqno/syntax"
import { propertyLines, type PropertyLine } from "./items.ts"
import { shelve, type Library, type PageBlocks, type Shelf } from "./library.ts"
import { propertyValue, type PropertyValue } from "./values.ts"

type Edn =
  | string
  | number
  | boolean
  | null
  | { readonly _tag: "Keyword"; readonly name: string }
  | { readonly _tag: "Uuid"; readonly value: string }
  | { readonly _tag: "Vector"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "List"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "Set"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "Map"; readonly entries: ReadonlyArray<readonly [Edn, Edn]> }

const keyword = (name: string): Edn => ({ _tag: "Keyword", name })
const vector = (items: ReadonlyArray<Edn>): Edn => ({ _tag: "Vector", items })
const seq = (items: ReadonlyArray<Edn>): Edn =>
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
  if (value === null) return "nil"
  if (typeof value === "string") return ednString(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  switch (value._tag) {
    case "Keyword":
      return `:${value.name}`
    case "Uuid":
      return `#uuid ${ednString(value.value)}`
    case "Vector":
      return `[${value.items.map(flat).join(" ")}]`
    case "List":
      return `(${value.items.map(flat).join(" ")})`
    case "Set":
      return `#{${value.items.map(flat).join(" ")}}`
    case "Map":
      return `{${value.entries.map(([key, item]) => `${flat(key)} ${flat(item)}`).join(", ")}}`
  }
}

const printEdn = (value: Edn, column: number, tail: number): string => {
  const one = flat(value)
  if (column + one.length + tail < MARGIN || value === null || typeof value !== "object") return one
  const pad = " ".repeat(column + 1)
  const items = (open: string, close: string, list: ReadonlyArray<Edn>) =>
    `${open}${list
      .map((item, index) =>
        printEdn(item, column + open.length, index === list.length - 1 ? tail + 1 : 0),
      )
      .join(`\n${" ".repeat(column + open.length)}`)}${close}`
  switch (value._tag) {
    case "Keyword":
    case "Uuid":
    case "Set":
      return one
    case "Vector":
      return items("[", "]", value.items)
    case "List":
      return items("(", ")", value.items)
    case "Map":
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

const VALID_KEY = /^[^\s"|^(){}#,][^\s"|^(){},]*$/u

type Properties = ReadonlyArray<readonly [string, PropertyValue]> | null

const typed = (lines: ReadonlyArray<readonly [string, string]>) =>
  lines
    .filter(([key]) => key !== "id" && VALID_KEY.test(key))
    .map(([key, value]) => [key, propertyValue(key, value)] as const)

const pagePropertiesOf = (props: Readonly<Record<string, string>>): Properties => {
  const kept = typed(Object.entries(props))
  return kept.length === 0 ? null : kept
}

const HEADING = /^(#{1,6})[ \t]/

const blockPropertiesOf = (block: Block): Properties => {
  const level = HEADING.exec(block.text)?.[1]?.length
  const kept = [
    ...(level === undefined ? [] : [["heading", level] as const]),
    ...typed(Object.entries(block.props)),
  ]
  return kept.length === 0 && Object.keys(block.props).length === 0 ? null : kept
}

const contentOf = (block: Block) =>
  block.collapsed ? joinProperties(block.text, [["collapsed", "true"]]) : block.text

export interface ExportedPage {
  readonly id: string
  readonly title: string
  readonly properties: Properties
  readonly children: ReadonlyArray<ExportedBlock>
}

export interface ExportedBlock {
  readonly id: string
  readonly content: string
  readonly lines: ReadonlyArray<PropertyLine>
  readonly properties: Properties
  readonly children: ReadonlyArray<ExportedBlock>
}

const blockOf = (shelf: Shelf, pageId: PageId, block: Block): ExportedBlock => ({
  id: shelf.logseqId(block),
  content: contentOf(block),
  lines: propertyLines(block, false),
  properties: blockPropertiesOf(block),
  children: shelf.children(pageId, block.id).map((child) => blockOf(shelf, pageId, child)),
})

export const hasFile = ({ page, blocks }: PageBlocks) =>
  blocks.length > 0 || Object.keys(page.props).length > 0

const derivedUuid = (seed: string) => {
  const half = (salt: string) => {
    let hash = 0xcbf29ce484222325n
    for (const char of salt + seed) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n)
    }
    return hash.toString(16).padStart(16, "0")
  }
  const hex = half("a") + half("b")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const propertiesBlock = (page: PageBlocks["page"], properties: Properties) =>
  properties === null
    ? []
    : [
        {
          id: derivedUuid(page.id),
          content: "",
          lines: Object.entries(page.props),
          properties,
          children: [],
        },
      ]

export const exportedPages = (library: Library): ReadonlyArray<ExportedPage> => {
  const shelf = shelve(library)
  return library.pages
    .filter(hasFile)
    .toSorted((a, b) => (a.page.name < b.page.name ? -1 : a.page.name > b.page.name ? 1 : 0))
    .map(({ page }) => {
      const properties = pagePropertiesOf(page.props)
      return {
        id: page.id,
        title: page.title,
        properties,
        children: [
          ...propertiesBlock(page, properties),
          ...shelf.children(page.id, null).map((block) => blockOf(shelf, page.id, block)),
        ],
      }
    })
}

const ednValue = (value: PropertyValue): Edn =>
  typeof value === "object" ? { _tag: "Set", items: value } : value

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
    ["block/format", keyword("markdown")],
    ["block/children", vector(block.children.map(ednBlock))],
    ["block/content", block.content],
  ])

export const ednOf = (pages: ReadonlyArray<ExportedPage>): string =>
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
  readonly format: "markdown"
  readonly children: ReadonlyArray<JsonBlock>
  readonly content: string
}

const jsonProperties = (properties: Properties) =>
  properties === null
    ? null
    : Object.fromEntries(properties.map(([key, value]) => [key.split("/").at(-1) ?? key, value]))

const jsonBlock = (block: ExportedBlock): JsonBlock => ({
  id: block.id,
  properties: jsonProperties(block.properties),
  format: "markdown",
  children: block.children.map(jsonBlock),
  content: block.content,
})

export const jsonOf = (pages: ReadonlyArray<ExportedPage>): string =>
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
  let hash = 0xcbf29ce484222325n
  for (const char of uuid)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n)
  let uid = ""
  for (let index = 0; index < 9; index++) {
    uid += UID_CHARS[Number(hash % 64n)] ?? "_"
    hash /= 64n
  }
  return uid
}

const TODO = /^(NOW|LATER|TODO|DOING|WAITING|WAIT|CANCELED|CANCELLED|STARTED|IN-PROGRESS)/
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

interface RoamBlock {
  readonly string: string
  readonly uid?: string
  readonly children: ReadonlyArray<RoamBlock>
}

const linkedNames = (pages: ReadonlyArray<ExportedPage>): ReadonlySet<string> => {
  const names = new Set<string>()
  const add = (name: string) => names.add(normalizePageName(name))
  const visit = (block: ExportedBlock) => {
    for (const node of parseInline(block.content)) {
      if (node._tag === "PageRef" || node._tag === "Tag") add(node.name)
      else if (node._tag === "Link" && node.target._tag === "Page") add(node.target.name)
      else if (node._tag === "Macro" && node.name === "embed") {
        const page = /^\s*\[\[(.+)\]\]\s*$/.exec(node.args)?.[1]
        if (page !== undefined) add(page)
      }
    }
    for (const [, value] of block.properties ?? []) {
      if (typeof value === "object") value.forEach(add)
    }
    block.children.forEach(visit)
  }
  pages.forEach((page) => page.children.forEach(visit))
  return names
}

export const roamJsonOf = (pages: ReadonlyArray<ExportedPage>, referenced: ReadonlySet<string>) => {
  const roamString = (block: ExportedBlock) =>
    joinProperties(
      block.content,
      block.lines.filter(([key]) => key !== "collapsed"),
    )
      .replaceAll(UUIDS, (uuid) =>
        referenced.has(uuid.toLowerCase()) ? uidOf(uuid.toLowerCase()) : uuid,
      )
      .replace(TODO, "{{[[TODO]]}}")
      .replace(/^DONE/, "{{[[DONE]]}}")
      .replaceAll("{{embed ", "{{embed: ")
      .trim()
  const roamBlock = (block: ExportedBlock): RoamBlock => ({
    string: roamString(block),
    ...(referenced.has(block.id) ? { uid: uidOf(block.id) } : {}),
    children: block.children.map(roamBlock),
  })
  const linked = linkedNames(pages)
  return JSON.stringify(
    pages.map((page) => ({
      title: page.title,
      ...(linked.has(normalizePageName(page.title)) ? { uid: uidOf(page.id) } : {}),
      children: page.children.map(roamBlock),
    })),
  )
}
