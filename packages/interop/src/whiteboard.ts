import { Option, Result, Schema } from "effect"
import {
  SHAPE_KEY,
  TYPE_KEY,
  WHITEBOARD_PAGE,
  WHITEBOARD_SHAPE,
  assetTypeOf,
  isShapeBlock,
  shapeRaw,
  wordsField,
  wordsFields,
  wordsIn,
} from "@seqno/domain"
import type { Block, BlockId, Page, PageId, Props } from "@seqno/domain"
import { propertyValue } from "@seqno/export"
import {
  entriesOf,
  fromJson,
  hashOrder,
  mapEntries,
  itemsOf,
  keyword,
  list,
  map,
  murmurChars,
  printEdn,
  readEdn,
  textOf,
  toJson,
  uuid,
} from "./edn.ts"
import type { Edn } from "./edn.ts"
import { blockContent, contentBlock } from "./outline.ts"

type Raw = Readonly<Record<string, unknown>>

const TLDRAW_PAGE = "logseq.tldraw.page"
const CREATED = "created-at"
const UPDATED = "updated-at"
const SHAPES_INDEX = "shapes-index"
const FIELDS = "logseq.whiteboard.fields"

const PAGE_FIELDS = new Set([
  "block/uuid",
  "block/properties",
  "block/updated-at",
  "block/created-at",
  "block/type",
  "block/name",
  "block/original-name",
])

const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decodeText = Schema.decodeUnknownOption(Schema.String)
const decodeNumber = Schema.decodeUnknownOption(Schema.Finite)
const decodeArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

const decodeRaw = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

const recordOf = (value: unknown): Raw => Option.getOrElse(decodeRecord(value), () => ({}))
const textIn = (value: unknown): string | undefined => Option.getOrUndefined(decodeText(value))

const arrayOf = (value: unknown): readonly unknown[] =>
  Option.getOrElse(decodeArray(value), () => [])

const TIMES = [
  ["block/created-at", CREATED],
  ["block/updated-at", UPDATED],
] as const

const stamps = (fields: ReadonlyMap<string, Edn>): Props =>
  Object.fromEntries(
    TIMES.flatMap(([field, key]) => {
      const value = fields.get(field)

      return typeof value === "number" ? [[key, String(value)]] : []
    }),
  )

interface ShapeEntry {
  readonly id: string | undefined
  readonly shape: Raw
  readonly stamps: Props
}

interface NormalEntry {
  readonly id: string | undefined
  readonly parent: string | undefined
  readonly left: string | undefined
  readonly content: string
  readonly collapsed: boolean
  readonly stamps: Props
}

export interface Whiteboard {
  readonly title: string | undefined
  readonly props: Props
  readonly uuid: string | undefined
  readonly bindings: Raw
  readonly assets: readonly unknown[]
  readonly shapes: readonly ShapeEntry[]
  readonly normals: readonly NormalEntry[]
}

const propertyText = (value: Edn): string =>
  textOf(value) ??
  (typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : itemsOf(value)
        .map((item) => textOf(item) ?? printEdn(item))
        .join(", "))

const refUuid = (value: Edn | undefined): string | undefined =>
  textOf(entriesOf(value ?? null).get("block/uuid")) ?? undefined

const zIndex = (entry: ShapeEntry) => Option.getOrUndefined(decodeNumber(entry.shape["index"]))

const byIndex = (a: ShapeEntry, b: ShapeEntry) => {
  const left = zIndex(a)
  const right = zIndex(b)

  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1
  }

  return left - right
}

export const readWhiteboard = (text: string): Result.Result<Whiteboard, string> =>
  Result.map(readEdn(text), (edn) => {
    const top = entriesOf(edn)
    const page = entriesOf(itemsOf(top.get("pages"))[0] ?? null)
    const pageProps = entriesOf(page.get("block/properties") ?? null)
    const tldrawEdn = pageProps.get(TLDRAW_PAGE)
    const legacy = textOf(pageProps.get(TYPE_KEY)) === WHITEBOARD_PAGE

    const tldraw = recordOf(
      toJson(tldrawEdn ?? (legacy ? (page.get("block/properties") ?? null) : null)),
    )

    const pageUuid = textOf(page.get("block/uuid")) ?? undefined
    const shapes: ShapeEntry[] = []
    const normals: NormalEntry[] = []

    for (const item of itemsOf(top.get("blocks"))) {
      const fields = entriesOf(item)
      const props = entriesOf(fields.get("block/properties") ?? null)

      if (textOf(props.get(TYPE_KEY)) === WHITEBOARD_SHAPE) {
        const shapeEdn = props.get(SHAPE_KEY)
        const shape = recordOf(toJson(shapeEdn ?? fields.get("block/properties") ?? null))
        shapes.push({
          id: textIn(shape["id"]) ?? textOf(fields.get("block/uuid")) ?? undefined,
          shape,
          stamps: stamps(fields),
        })
      } else {
        normals.push({
          id: textOf(fields.get("block/uuid")) ?? undefined,
          parent: refUuid(fields.get("block/parent")),
          left: refUuid(fields.get("block/left")),
          content: textOf(fields.get("block/content")) ?? "",
          collapsed: fields.get("block/collapsed?") === true,
          stamps: stamps(fields),
        })
      }
    }

    const tldrawId = textIn(tldraw["id"])
    const extra = [...page].filter(([key]) => !PAGE_FIELDS.has(key))

    return {
      title: textOf(page.get("block/original-name")) ?? textOf(page.get("block/name")) ?? undefined,
      props: {
        [TYPE_KEY]: WHITEBOARD_PAGE,
        ...Object.fromEntries(
          [...pageProps].map(([key, value]) => [
            key,
            key === TYPE_KEY
              ? WHITEBOARD_PAGE
              : key === TLDRAW_PAGE
                ? JSON.stringify(tldraw)
                : propertyText(value),
          ]),
        ),
        ...(Object.keys(tldraw).length === 0 || pageProps.has(TLDRAW_PAGE)
          ? {}
          : { [TLDRAW_PAGE]: JSON.stringify(tldraw) }),
        ...(pageUuid !== undefined && pageUuid !== tldrawId ? { id: pageUuid } : {}),
        ...(extra.length === 0 ? {} : { [FIELDS]: printEdn(map(extra)).trimStart() }),
        ...stamps(page),
      },
      uuid: pageUuid ?? tldrawId,
      bindings: recordOf(tldraw["bindings"]),
      assets: arrayOf(tldraw["assets"]),
      shapes: shapes.toSorted(byIndex),
      normals,
    }
  })

const treeOrder = (
  normals: readonly NormalEntry[],
  root: string | undefined,
): readonly NormalEntry[] => {
  const known = new Set(normals.flatMap((entry) => (entry.id === undefined ? [] : [entry.id])))

  const parentOf = (entry: NormalEntry) =>
    entry.parent !== undefined && known.has(entry.parent) && entry.parent !== entry.id
      ? entry.parent
      : root

  const groups = Map.groupBy(normals, parentOf)
  const placed = new Set<NormalEntry>()

  const walk = (parent: string | undefined): readonly NormalEntry[] => {
    const siblings = groups.get(parent) ?? []
    const chain: NormalEntry[] = []
    let left = parent

    for (;;) {
      const next = siblings.find((entry) => entry.left === left && !placed.has(entry))

      if (next === undefined) {
        break
      }

      placed.add(next)
      chain.push(next)
      left = next.id
    }

    for (const entry of siblings) {
      if (!placed.has(entry)) {
        placed.add(entry)
        chain.push(entry)
      }
    }

    return chain.flatMap((entry) => [entry, ...(entry.id === undefined ? [] : walk(entry.id))])
  }

  const ordered = walk(root)

  return [...ordered, ...normals.filter((entry) => !placed.has(entry))]
}

const withoutKey = (raw: Raw, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(raw).filter(([name]) => name !== key))

const importShape = (
  entry: ShapeEntry,
  board: Whiteboard,
  resolve: (logseqId: string | undefined) => BlockId | undefined,
): { readonly text: string; readonly shape: Record<string, unknown> } => {
  const type = textIn(entry.shape["type"])
  const words = wordsField(type)
  const shape: Record<string, unknown> = { ...entry.shape }

  if (words !== null) {
    delete shape[words]
  }

  const handles = decodeRecord(shape["handles"])

  if (Option.isSome(handles)) {
    shape["handles"] = Object.fromEntries(
      Object.entries(handles.value).map(([name, handle]) => {
        const raw = recordOf(handle)
        const binding = recordOf(board.bindings[textIn(raw["bindingId"]) ?? ""])
        const target = resolve(textIn(binding["toId"]))

        return [name, target === undefined ? raw : { ...raw, bindTo: target }]
      }),
    )
  }

  const children = shape["children"]

  if (Array.isArray(children)) {
    shape["children"] = children.map((child) => {
      const written = textIn(child)

      return written === undefined ? child : (resolve(written) ?? child)
    })
  }

  const assetId = textIn(shape["assetId"])
  const asset = board.assets.map(recordOf).find((item) => textIn(item["id"]) === assetId)
  const src = asset === undefined ? undefined : textIn(asset["src"])

  if (src !== undefined && shape["src"] === undefined) {
    shape["src"] = src
  }

  return { text: wordsIn(entry.shape), shape }
}

const keptId = (written: string | undefined, id: BlockId): Props =>
  written === undefined || written.toLowerCase() === id ? {} : { id: written }

export const whiteboardBlocks = (
  board: Whiteboard,
  pageId: PageId,
  idFor: (written: string | undefined) => BlockId,
): readonly Block[] => {
  const seqnoIds = new Map<string, BlockId>()

  const assign = (written: string | undefined) => {
    const id = idFor(written)

    if (written !== undefined && !seqnoIds.has(written.toLowerCase())) {
      seqnoIds.set(written.toLowerCase(), id)
    }

    return id
  }

  const shapeIds = board.shapes.map((entry) => assign(entry.id))

  const normals = treeOrder(board.normals, board.uuid).map((entry) => {
    const outline = contentBlock(entry.content)
    const written = outline.props["id"] ?? entry.id

    return { entry, outline, written, id: assign(written) }
  })

  const resolve = (logseqId: string | undefined) =>
    logseqId === undefined ? undefined : seqnoIds.get(logseqId.toLowerCase())

  const shapes = board.shapes.map((entry, index): Block => {
    const id = shapeIds[index] ?? idFor(undefined)
    const { text, shape } = importShape(entry, board, resolve)

    return {
      id,
      pageId,
      parentId: null,
      text,
      collapsed: false,
      props: {
        [TYPE_KEY]: WHITEBOARD_SHAPE,
        [SHAPE_KEY]: JSON.stringify(shape),
        ...keptId(entry.id, id),
        ...entry.stamps,
      },
    }
  })

  const blocks = normals.map(({ entry, outline, written, id }): Block => ({
    id,
    pageId,
    parentId: resolve(entry.parent) ?? null,
    text: outline.text,
    collapsed: outline.collapsed || entry.collapsed,
    props: { ...outline.props, ...keptId(written, id), ...entry.stamps },
  }))

  return [...shapes, ...blocks]
}

export const clonedWhiteboard = (board: Whiteboard, freshId: () => string): Whiteboard => {
  const ids = new Map(
    board.shapes.flatMap((entry) =>
      entry.id === undefined ? [] : [[entry.id, freshId()] as const],
    ),
  )

  const bindings: Record<string, unknown> = {}

  const rebound = (line: string | undefined, handle: unknown) => {
    const raw = recordOf(handle)
    const binding = recordOf(board.bindings[textIn(raw["bindingId"]) ?? ""])
    const from = ids.get(textIn(binding["fromId"]) ?? "")
    const to = ids.get(textIn(binding["toId"]) ?? "")

    if (from === undefined || to === undefined || from !== line) {
      return handle
    }

    const id = freshId()
    bindings[id] = { ...binding, id, fromId: from, toId: to }

    return { ...raw, bindingId: id }
  }

  const shapes = board.shapes.map((entry): ShapeEntry => {
    const id = entry.id === undefined ? freshId() : (ids.get(entry.id) ?? freshId())
    const handles = decodeRecord(entry.shape["handles"])

    return {
      ...entry,
      id,
      stamps: {},
      shape: {
        ...entry.shape,
        id,
        ...(Option.isSome(handles)
          ? {
              handles: Object.fromEntries(
                Object.entries(handles.value).map(([name, handle]) => [name, rebound(id, handle)]),
              ),
            }
          : {}),
      },
    }
  })

  return { ...board, uuid: undefined, bindings, shapes, normals: [] }
}

const derivedUuid = (seed: string) => {
  const hex = [0, 1, 2, 3]
    .map((salt) => (murmurChars(`${salt}:${seed}`) >>> 0).toString(16).padStart(8, "0"))
    .join("")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 17), 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const timeFields = (props: Props): ReadonlyArray<readonly [string, Edn]> =>
  TIMES.flatMap(([field, key]) => {
    const value = props[key]

    return value !== undefined && /^\d+$/.test(value) ? [[field, Number(value)] as const] : []
  })

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const sortedMap = (fields: ReadonlyArray<readonly [string, Edn]>): Edn =>
  map(fields.toSorted(([a], [b]) => byName(a, b)))

const PULLED_ARRAY_MAP = 6

const ref = (id: string): Edn => map([["block/uuid", uuid(id)]])

const VALID_KEY = /^[^\s"|^(){}#,][^\s"|^(){},]*$/u
const HEADING = /^(#{1,6})[ \t]/
const PAGE_OWN = new Set([TYPE_KEY, TLDRAW_PAGE, "id", FIELDS, CREATED, UPDATED])

const typedValue = (key: string, raw: string): Edn => {
  const value = propertyValue(key, raw)

  return typeof value === "object" ? { _tag: "Set", items: value } : value
}

const typedEntries = (props: Props): ReadonlyArray<readonly [string, Edn]> =>
  Object.entries(props)
    .filter(([key]) => VALID_KEY.test(key))
    .map(([key, raw]) => [key, typedValue(key, raw)] as const)

const blockProperties = (text: string, props: Props): Edn => {
  const level = HEADING.exec(text)?.[1]?.length

  return map([
    ...(level === undefined ? [] : [["heading", level] as const]),
    ...typedEntries(props),
  ])
}

interface Binding {
  readonly id: string
  readonly raw: Raw
}

const logseqIdOf = (block: Block) => block.props["id"] ?? block.id

export const renderWhiteboard = (page: Page, blocks: readonly Block[]): string => {
  const tldraw = Option.getOrElse(decodeRaw(page.props[TLDRAW_PAGE]), (): Raw => ({}))
  const pageUuid = page.props["id"] ?? textIn(tldraw["id"]) ?? page.id
  const byId = new Map<string, Block>(blocks.map((block) => [block.id, block]))
  const shapes = blocks.filter(isShapeBlock)
  const shapeById = new Map<string, Block>(shapes.map((block) => [block.id, block]))
  const normals = blocks.filter((block) => !isShapeBlock(block))
  const original = recordOf(tldraw["bindings"])
  const originalAssets = arrayOf(tldraw["assets"]).map(recordOf)
  const usedBindings = new Set<string>()
  const created: Binding[] = []
  const usedAssets = new Set<string>()
  const newAssets: Raw[] = []

  const handleOut = (shapeId: string, name: string, handle: unknown): Raw => {
    const merged: Raw = { id: name, canBind: true, ...recordOf(handle) }
    const raw = withoutKey(merged, "bindTo")
    const target = shapeById.get(textIn(merged["bindTo"]) ?? "")
    const bindingId = textIn(raw["bindingId"])

    if (target === undefined) {
      if (bindingId !== undefined) {
        usedBindings.add(bindingId)
      }

      return raw
    }

    const toId = logseqIdOf(target)
    const before = recordOf(original[bindingId ?? ""])

    if (bindingId !== undefined && textIn(before["toId"]) === toId) {
      usedBindings.add(bindingId)

      return raw
    }

    const id = derivedUuid(`${shapeId}/${name}/${toId}`)
    created.push({
      id,
      raw: {
        id,
        type: "line",
        fromId: shapeId,
        toId,
        handleId: name,
        point: [0.5, 0.5],
        distance: 4,
      },
    })

    return { ...raw, bindingId: id }
  }

  const assetOut = (shapeId: string, shape: Record<string, unknown>) => {
    const src = textIn(shape["src"])

    if (src === undefined) {
      return
    }

    const assetId = textIn(shape["assetId"])
    const asset = originalAssets.find((item) => textIn(item["id"]) === assetId)
    delete shape["src"]

    if (assetId !== undefined && asset !== undefined && textIn(asset["src"]) === src) {
      usedAssets.add(assetId)

      return
    }

    const id =
      assetId !== undefined && asset === undefined ? assetId : derivedUuid(`${shapeId}/${src}`)

    shape["assetId"] = id
    newAssets.push({
      id,
      type: assetTypeOf(shape["type"]),
      src,
      size: shape["size"] ?? [0, 0],
    })
  }

  const shapeOut = (block: Block, index: number): Edn => {
    const raw = shapeRaw(block)
    const type = textIn(raw["type"])
    const id = logseqIdOf(block)
    const shape: Record<string, unknown> = { ...raw, id, index }

    if (Option.isNone(decodeNumber(raw["nonce"]))) {
      shape["nonce"] = 1
    }

    Object.assign(shape, wordsFields(type, block.text))
    const handles = decodeRecord(raw["handles"])

    if (Option.isSome(handles)) {
      shape["handles"] = Object.fromEntries(
        Object.entries(handles.value).map(([name, handle]) => [name, handleOut(id, name, handle)]),
      )
    }

    assetOut(id, shape)
    const children = raw["children"]

    if (Array.isArray(children)) {
      shape["children"] = children.map((child) => {
        const member = shapeById.get(textIn(child) ?? "")

        return member === undefined ? child : logseqIdOf(member)
      })
    }

    return sortedMap([
      ...timeFields(block.props),
      [
        "block/properties",
        map([
          [TYPE_KEY, keyword(WHITEBOARD_SHAPE)],
          [SHAPE_KEY, fromJson(shape)],
        ]),
      ],
    ])
  }

  const normalOut = (block: Block, left: string): Edn => {
    const logseqId = logseqIdOf(block)
    const parent = block.parentId === null ? undefined : byId.get(block.parentId)
    const { [CREATED]: _created, [UPDATED]: _updated, id: _id, ...shown } = block.props

    return sortedMap([
      ...(block.collapsed ? [["block/collapsed?", true] as const] : []),
      [
        "block/content",
        blockContent({ text: block.text, props: shown, collapsed: block.collapsed }),
      ],
      ...timeFields(block.props),
      ["block/format", keyword("markdown")],
      ["block/left", ref(left)],
      ["block/parent", ref(parent === undefined ? pageUuid : logseqIdOf(parent))],
      ["block/properties", blockProperties(block.text, shown)],
      ["block/uuid", uuid(logseqId)],
    ])
  }

  const shapeBlocks = shapes.map(shapeOut)
  const present = new Set(shapes.map(logseqIdOf))
  const previous = new Map<string, string>()

  const normalBlocks = normals.map((block) => {
    const parent = block.parentId !== null && byId.has(block.parentId) ? block.parentId : null
    const parentUuid = parent === null ? pageUuid : logseqIdOf(byId.get(parent) ?? block)
    const left = previous.get(parent ?? "") ?? parentUuid
    previous.set(parent ?? "", logseqIdOf(block))

    return normalOut(block, left)
  })

  const bindings = [
    ...Object.entries(original)
      .map(([id, raw]): Binding => ({ id, raw: recordOf(raw) }))
      .filter(
        ({ id, raw }) =>
          usedBindings.has(id) ||
          (present.has(textIn(raw["fromId"]) ?? "") && present.has(textIn(raw["toId"]) ?? "")),
      ),
    ...created,
  ]

  const assets = [
    ...originalAssets.filter((item) => usedAssets.has(textIn(item["id"]) ?? "")),
    ...newAssets,
  ]

  const order = list(shapes.map((block) => logseqIdOf(block)))

  const base: Record<string, unknown> =
    Object.keys(tldraw).length > 0
      ? { ...tldraw }
      : { id: pageUuid, name: page.name, bindings: {}, nonce: 1, assets: [], [SHAPES_INDEX]: [] }

  base["bindings"] = Object.fromEntries(bindings.map(({ id, raw }) => [id, raw]))
  base["assets"] = assets

  const tldrawEdn: Edn = {
    _tag: "Map",
    entries: mapEntries(fromJson(base)).map(([key, value]) => [
      key,
      textOf(key) === SHAPES_INDEX ? order : value,
    ]),
  }

  const own = Object.entries(page.props).filter(
    ([key]) => key === TYPE_KEY || key === TLDRAW_PAGE || !PAGE_OWN.has(key),
  )

  const properties: Edn = map([
    ...own.map(([key, raw]): readonly [string, Edn] =>
      key === TYPE_KEY
        ? [key, keyword(WHITEBOARD_PAGE)]
        : key === TLDRAW_PAGE
          ? [key, tldrawEdn]
          : [key, typedValue(key, raw)],
    ),
    ...(page.props[TLDRAW_PAGE] === undefined ? [[TLDRAW_PAGE, tldrawEdn] as const] : []),
  ])

  const fields = Result.getOrElse(readEdn(page.props[FIELDS] ?? "{}"), (): Edn => null)

  const pageEntries: ReadonlyArray<readonly [Edn, Edn]> = [
    ...mapEntries(
      map([
        ["block/uuid", uuid(pageUuid)],
        ["block/properties", properties],
        ...timeFields(page.props),
        ["block/type", "whiteboard"],
        ["block/name", page.name],
        ["block/original-name", page.title],
      ]),
    ),
    ...mapEntries(fields),
  ]

  const pageEdn: Edn = {
    _tag: "Map",
    entries:
      pageEntries.length > PULLED_ARRAY_MAP
        ? hashOrder(pageEntries, true)
        : pageEntries.toSorted(([a], [b]) => byName(textOf(a) ?? "", textOf(b) ?? "")),
  }

  const file = map([
    ["blocks", list([...shapeBlocks, ...normalBlocks])],
    ["pages", list([pageEdn])],
  ])

  return printEdn(file).trimStart()
}
