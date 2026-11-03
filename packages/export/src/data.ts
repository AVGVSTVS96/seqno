import type { Block, PageId } from "@seqno/domain"
import { joinProperties } from "@seqno/syntax"
import { propertyLines } from "./items.ts"
import { shelve, type Library, type PageBlocks, type Shelf } from "./library.ts"

type Edn =
  | string
  | number
  | null
  | { readonly _tag: "Keyword"; readonly name: string }
  | { readonly _tag: "Uuid"; readonly value: string }
  | { readonly _tag: "Vector"; readonly items: ReadonlyArray<Edn> }
  | { readonly _tag: "Map"; readonly entries: ReadonlyArray<readonly [Edn, Edn]> }

const keyword = (name: string): Edn => ({ _tag: "Keyword", name })
const vector = (items: ReadonlyArray<Edn>): Edn => ({ _tag: "Vector", items })
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

const isNested = (value: Edn) =>
  value !== null && typeof value === "object" && (value._tag === "Vector" || value._tag === "Map")

const printEdn = (value: Edn, pad: string): string => {
  if (value === null) return "nil"
  if (typeof value === "string") return ednString(value)
  if (typeof value === "number") return String(value)
  const inner = `${pad} `
  switch (value._tag) {
    case "Keyword":
      return `:${value.name}`
    case "Uuid":
      return `#uuid ${ednString(value.value)}`
    case "Vector":
      return `[${value.items.map((item) => printEdn(item, inner)).join(`\n${inner}`)}]`
    case "Map":
      return `{${value.entries
        .map(([key, item]) =>
          isNested(item)
            ? `${printEdn(key, inner)}\n${inner}${printEdn(item, inner)}`
            : `${printEdn(key, inner)} ${printEdn(item, inner)}`,
        )
        .join(`,\n${inner}`)}}`
  }
}

const VALID_KEY = /^[^\s"|^(){}#:\d,][^\s"|^(){},]*$/u

const propertiesOf = (lines: ReadonlyArray<readonly [string, string]>) => {
  const kept = lines.filter(([key]) => key !== "id" && VALID_KEY.test(key))
  return kept.length === 0 ? null : kept
}

export interface ExportedPage {
  readonly id: string
  readonly title: string
  readonly properties: ReadonlyArray<readonly [string, string]> | null
  readonly children: ReadonlyArray<ExportedBlock>
}

export interface ExportedBlock {
  readonly id: string
  readonly content: string
  readonly properties: ReadonlyArray<readonly [string, string]> | null
  readonly children: ReadonlyArray<ExportedBlock>
}

const blockOf = (shelf: Shelf, pageId: PageId, block: Block): ExportedBlock => ({
  id: shelf.logseqId(block),
  content: block.text,
  properties: propertiesOf(propertyLines(block, false)),
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

const propertiesBlock = (pageId: PageId, properties: ExportedPage["properties"]) =>
  properties === null ? [] : [{ id: derivedUuid(pageId), content: "", properties, children: [] }]

export const exportedPages = (library: Library): ReadonlyArray<ExportedPage> => {
  const shelf = shelve(library)
  return library.pages
    .filter(hasFile)
    .toSorted((a, b) => (a.page.name < b.page.name ? -1 : a.page.name > b.page.name ? 1 : 0))
    .map(({ page }) => {
      const properties = propertiesOf(Object.entries(page.props))
      return {
        id: page.id,
        title: page.title,
        properties,
        children: [
          ...propertiesBlock(page.id, properties),
          ...shelf.children(page.id, null).map((block) => blockOf(shelf, page.id, block)),
        ],
      }
    })
}

const ednProperties = (properties: ExportedBlock["properties"]): Edn =>
  properties === null
    ? null
    : { _tag: "Map", entries: properties.map(([key, value]) => [keyword(key), value]) }

const ednBlock = (block: ExportedBlock): Edn =>
  map([
    ["block/id", { _tag: "Uuid", value: block.id }],
    ["block/properties", ednProperties(block.properties)],
    ["block/format", keyword("markdown")],
    ["block/content", block.content],
    ["block/children", vector(block.children.map(ednBlock))],
  ])

export const ednOf = (pages: ReadonlyArray<ExportedPage>): string =>
  `${printEdn(
    map([
      ["version", 1],
      [
        "blocks",
        vector(
          pages.map((page) =>
            map([
              ["block/id", { _tag: "Uuid", value: page.id }],
              ["block/page-name", page.title],
              ["block/properties", ednProperties(page.properties)],
              ["block/format", keyword("markdown")],
              ["block/children", vector(page.children.map(ednBlock))],
            ]),
          ),
        ),
      ],
    ]),
    "",
  )}\n`

interface JsonBlock {
  readonly id: string
  readonly properties: Record<string, string> | null
  readonly format: "markdown"
  readonly content: string
  readonly children: ReadonlyArray<JsonBlock>
}

const jsonProperties = (properties: ExportedBlock["properties"]) =>
  properties === null ? null : Object.fromEntries(properties)

const jsonBlock = (block: ExportedBlock): JsonBlock => ({
  id: block.id,
  properties: jsonProperties(block.properties),
  format: "markdown",
  content: block.content,
  children: block.children.map(jsonBlock),
})

export const jsonOf = (pages: ReadonlyArray<ExportedPage>): string =>
  JSON.stringify({
    version: 1,
    blocks: pages.map((page) => ({
      id: page.id,
      "page-name": page.title,
      properties: jsonProperties(page.properties),
      format: "markdown",
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
  readonly children?: ReadonlyArray<RoamBlock>
}

export const roamJsonOf = (pages: ReadonlyArray<ExportedPage>, referenced: ReadonlySet<string>) => {
  const roamString = (block: ExportedBlock) =>
    joinProperties(
      block.content,
      (block.properties ?? []).filter(([key]) => key !== "collapsed"),
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
    ...(block.children.length > 0 ? { children: block.children.map(roamBlock) } : {}),
  })
  return JSON.stringify(
    pages.map((page) => ({
      title: page.title,
      children: page.children.map(roamBlock),
    })),
  )
}
