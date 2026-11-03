import { Option } from "effect"
import {
  otherShapeOf,
  shapeOf,
  type Block,
  type BlockId,
  type LineShape,
  type Shape,
  type Vec,
} from "@seqno/domain"
import {
  BINDING_GAP,
  add,
  boundsOfPoints,
  boxBounds,
  contains,
  distanceToPolyline,
  distanceToSegment,
  ellipseEdge,
  expand,
  rectEdge,
  toward,
  union,
  type Bounds,
} from "./geometry.ts"

export interface Unsupported {
  readonly type: "unsupported"
  readonly kind: string
  readonly point: Vec
  readonly size: Vec
  readonly url?: string
  readonly rotation?: number
  readonly isLocked?: boolean
}

export type Drawable = Shape | Unsupported

export interface Item {
  readonly block: Block
  readonly shape: Drawable
}

export type Line = typeof LineShape.Type

export type Measured = ReadonlyMap<BlockId, Vec>

export interface Scene {
  readonly items: ReadonlyArray<Item>
  readonly byId: ReadonlyMap<BlockId, Item>
  readonly bounds: ReadonlyMap<BlockId, Bounds>
  readonly ends: ReadonlyMap<BlockId, readonly [Vec, Vec]>
  readonly measured: Measured
  readonly members: ReadonlyMap<BlockId, ReadonlyArray<BlockId>>
  readonly groupOf: ReadonlyMap<BlockId, BlockId>
}

const unsupported = (block: Block): ReadonlyArray<Item> =>
  Option.match(otherShapeOf(block), {
    onNone: () => [],
    onSome: (other) => [
      {
        block,
        shape: {
          type: "unsupported",
          kind: other.type,
          point: other.point,
          size: other.size ?? [320, 180],
          ...(other.url === undefined ? {} : { url: other.url }),
          ...(other.rotation === undefined ? {} : { rotation: other.rotation }),
          ...(other.isLocked === undefined ? {} : { isLocked: other.isLocked }),
        },
      },
    ],
  })

export const itemsOf = (blocks: ReadonlyArray<Block>): ReadonlyArray<Item> =>
  blocks
    .filter((block) => block.parentId === null)
    .flatMap((block) =>
      Option.match(shapeOf(block), {
        onSome: (shape) => [{ block, shape }],
        onNone: () => unsupported(block),
      }),
    )

export const PORTAL_HEADER = 40

export const COLLAPSED_PORTAL = 40

const strokePoints = (
  shape: Drawable & { readonly points: ReadonlyArray<ReadonlyArray<number>> },
) => shape.points.map(([x = 0, y = 0]): Vec => [shape.point[0] + x, shape.point[1] + y])

export const absolutePoints = strokePoints

export const sizeOfItem = (item: Item, measured: Measured): Vec => {
  const { shape } = item
  const seen = measured.get(item.block.id)
  if (shape.type === "logseq-portal") {
    if (shape.collapsed === true) return [shape.size[0], seen?.[1] ?? COLLAPSED_PORTAL]
    if (seen !== undefined && shape.isAutoResizing !== false) return [shape.size[0], seen[1]]
    return [shape.size[0], Math.max(shape.size[1], PORTAL_HEADER)]
  }
  if (shape.type === "text" && shape.isSizeLocked !== false && seen !== undefined) return seen
  return "size" in shape ? shape.size : [0, 0]
}

const ownBounds = (item: Item, measured: Measured): Bounds => {
  const { shape } = item
  switch (shape.type) {
    case "line":
      return boundsOfPoints([
        add(shape.point, shape.handles.start.point),
        add(shape.point, shape.handles.end.point),
      ])
    case "pencil":
    case "highlighter":
      return shape.points.length === 0
        ? boxBounds(shape.point, [0, 0])
        : boundsOfPoints(strokePoints(shape))
    default:
      return boxBounds(shape.point, sizeOfItem(item, measured))
  }
}

const edgeOf = (item: Item, box: Bounds, from: Vec): Vec =>
  item.shape.type === "ellipse" ? ellipseEdge(box, from) : rectEdge(box, from)

const lineEnds = (
  line: Line,
  byId: ReadonlyMap<BlockId, Item>,
  bounds: ReadonlyMap<BlockId, Bounds>,
): readonly [Vec, Vec] => {
  const anchor = (handle: Line["handles"]["start"]) => {
    const target = handle.bindTo === undefined ? undefined : byId.get(handle.bindTo)
    const box = handle.bindTo === undefined ? undefined : bounds.get(handle.bindTo)
    return target === undefined || box === undefined
      ? { point: add(line.point, handle.point), target: null }
      : { point: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] satisfies Vec, target }
  }
  const start = anchor(line.handles.start)
  const end = anchor(line.handles.end)
  const clip = (own: typeof start, other: typeof start): Vec => {
    if (own.target === null) return own.point
    const box = bounds.get(own.target.block.id)
    if (box === undefined) return own.point
    const edge = edgeOf(own.target, box, other.point)
    return toward(edge, other.point, BINDING_GAP)
  }
  return [clip(start, end), clip(end, start)]
}

const membership = (items: ReadonlyArray<Item>, byId: ReadonlyMap<BlockId, Item>) => {
  const written = new Map<string, BlockId>()
  for (const item of items) {
    written.set(item.block.id, item.block.id)
    const own = item.block.props["id"]
    if (own !== undefined) written.set(own.toLowerCase(), item.block.id)
  }
  const members = new Map<BlockId, ReadonlyArray<BlockId>>()
  const groupOf = new Map<BlockId, BlockId>()
  for (const item of items) {
    if (item.shape.type !== "group") continue
    const ids = item.shape.children.flatMap((child) => {
      const id = written.get(child.toLowerCase())
      const member = id === undefined ? undefined : byId.get(id)
      return member === undefined || member.shape.type === "group" || groupOf.has(member.block.id)
        ? []
        : [member.block.id]
    })
    members.set(item.block.id, ids)
    for (const id of ids) groupOf.set(id, item.block.id)
  }
  return { members, groupOf }
}

export const sceneOf = (items: ReadonlyArray<Item>, measured: Measured): Scene => {
  const byId = new Map(items.map((item) => [item.block.id, item]))
  const { members, groupOf } = membership(items, byId)
  const bounds = new Map<BlockId, Bounds>()
  for (const item of items) {
    if (item.shape.type !== "line" && item.shape.type !== "group") {
      bounds.set(item.block.id, ownBounds(item, measured))
    }
  }
  const groupBounds = () => {
    for (const [group, ids] of members) {
      const box = union(ids.flatMap((id) => bounds.get(id) ?? []))
      if (box === null) bounds.delete(group)
      else bounds.set(group, box)
    }
  }
  groupBounds()
  const ends = new Map<BlockId, readonly [Vec, Vec]>()
  for (const item of items) {
    if (item.shape.type === "line") {
      const both = lineEnds(item.shape, byId, bounds)
      ends.set(item.block.id, both)
      bounds.set(item.block.id, boundsOfPoints(both))
    }
  }
  groupBounds()
  return { items, byId, bounds, ends, measured, members, groupOf }
}

export const GROUP_PADDING = 8

export const withMembers = (scene: Scene, ids: ReadonlyArray<BlockId>): ReadonlyArray<BlockId> => [
  ...new Set(ids.flatMap((id) => [id, ...(scene.members.get(id) ?? [])])),
]

export const outermost = (scene: Scene, id: BlockId): BlockId => scene.groupOf.get(id) ?? id

export const LINE_TOLERANCE = 8

export const hits = (scene: Scene, item: Item, point: Vec, zoom: number): boolean => {
  const tolerance = LINE_TOLERANCE / zoom
  const { shape } = item
  if (shape.type === "line") {
    const both = scene.ends.get(item.block.id)
    return both !== undefined && distanceToSegment(point, both[0], both[1]) <= tolerance
  }
  if (shape.type === "pencil" || shape.type === "highlighter") {
    const width = shape.strokeWidth ?? 2
    return distanceToPolyline(point, strokePoints(shape)) <= Math.max(tolerance, width * 2)
  }
  const box = scene.bounds.get(item.block.id)
  return box !== undefined && contains(expand(box, 1 / zoom), point)
}

export const topHit = (scene: Scene, point: Vec, zoom: number): Item | null =>
  scene.items.findLast((item) => hits(scene, item, point, zoom)) ?? null

export const isLocked = (item: Item) => item.shape.isLocked === true

export const isInteractive = (item: Item) => item.shape.type === "video"

export const ratioLocked = (scene: Scene, ids: ReadonlyArray<BlockId>) => {
  const [only, ...rest] = ids
  const item = only === undefined || rest.length > 0 ? undefined : scene.byId.get(only)
  return (
    item !== undefined &&
    "isAspectRatioLocked" in item.shape &&
    item.shape.isAspectRatioLocked === true
  )
}
