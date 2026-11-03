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
import { portalScale } from "./tools.ts"
import {
  BINDING_GAP,
  add,
  boundsOfPoints,
  boxBounds,
  centerOf,
  contains,
  distanceToPolyline,
  distanceToSegment,
  ellipseEdge,
  expand,
  rectEdge,
  rotateAround,
  rotatedBox,
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
  readonly turned: ReadonlyMap<BlockId, Bounds>
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
  if (shape.type === "tweet") {
    const width = Math.min(Math.max(shape.size[0], 300), 550)
    return [width, seen === undefined || seen[1] === 0 ? shape.size[1] : seen[1]]
  }
  if (shape.type === "html" && shape.size[1] === 0 && seen !== undefined) {
    return [shape.size[0], seen[1] * portalScale[shape.scaleLevel ?? "md"]]
  }
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

export const rotationOf = (item: Item) =>
  item.shape.type === "line" || item.shape.type === "group" ? 0 : (item.shape.rotation ?? 0)

const edgeOf = (item: Item, box: Bounds, from: Vec): Vec => {
  const r = rotationOf(item)
  const middle = centerOf(box)
  const local = rotateAround(from, middle, -r)
  const edge = item.shape.type === "ellipse" ? ellipseEdge(box, local) : rectEdge(box, local)
  return rotateAround(edge, middle, r)
}

const turnedBounds = (item: Item, box: Bounds): Bounds => {
  const r = rotationOf(item)
  if (r === 0) return box
  const { shape } = item
  if (shape.type === "pencil" || shape.type === "highlighter") {
    const middle = centerOf(box)
    return boundsOfPoints(strokePoints(shape).map((point) => rotateAround(point, middle, r)))
  }
  if (shape.type === "ellipse") {
    const [cx, cy] = centerOf(box)
    const rx = (box.maxX - box.minX) / 2
    const ry = (box.maxY - box.minY) / 2
    const halfWidth = Math.hypot(rx * Math.cos(r), ry * Math.sin(r))
    const halfHeight = Math.hypot(rx * Math.sin(r), ry * Math.cos(r))
    return {
      minX: cx - halfWidth,
      minY: cy - halfHeight,
      maxX: cx + halfWidth,
      maxY: cy + halfHeight,
    }
  }
  return rotatedBox(box, r)
}

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
  const turned = new Map<BlockId, Bounds>()
  for (const item of items) {
    if (item.shape.type !== "line" && item.shape.type !== "group") {
      const box = ownBounds(item, measured)
      bounds.set(item.block.id, box)
      turned.set(item.block.id, turnedBounds(item, box))
    }
  }
  const groupBounds = () => {
    for (const [group, ids] of members) {
      const box = union(ids.flatMap((id) => turned.get(id) ?? []))
      if (box === null) {
        bounds.delete(group)
        turned.delete(group)
      } else {
        bounds.set(group, box)
        turned.set(group, box)
      }
    }
  }
  groupBounds()
  const ends = new Map<BlockId, readonly [Vec, Vec]>()
  for (const item of items) {
    if (item.shape.type === "line") {
      const both = lineEnds(item.shape, byId, bounds)
      ends.set(item.block.id, both)
      bounds.set(item.block.id, boundsOfPoints(both))
      turned.set(item.block.id, boundsOfPoints(both))
    }
  }
  groupBounds()
  return { items, byId, bounds, turned, ends, measured, members, groupOf }
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
  const box = scene.bounds.get(item.block.id)
  if (box === undefined) return false
  const local = rotateAround(point, centerOf(box), -rotationOf(item))
  if (shape.type === "pencil" || shape.type === "highlighter") {
    const width = shape.strokeWidth ?? 2
    return distanceToPolyline(local, strokePoints(shape)) <= Math.max(tolerance, width * 2)
  }
  return contains(expand(box, 1 / zoom), local)
}

export const topHit = (scene: Scene, point: Vec, zoom: number): Item | null =>
  scene.items.findLast((item) => hits(scene, item, point, zoom)) ?? null

export const isLocked = (item: Item) => item.shape.isLocked === true

const INTERACTIVE = new Set(["video", "youtube", "tweet", "iframe", "html", "pdf"])

export const isInteractive = (item: Item) => INTERACTIVE.has(item.shape.type)

export const ratioLocked = (scene: Scene, ids: ReadonlyArray<BlockId>) => {
  const [only, ...rest] = ids
  const item = only === undefined || rest.length > 0 ? undefined : scene.byId.get(only)
  return (
    item !== undefined &&
    (item.shape.type === "youtube" ||
      ("isAspectRatioLocked" in item.shape && item.shape.isAspectRatioLocked === true))
  )
}
