import {
  SHAPE_KEY,
  patchShape,
  shapeRaw,
  shapeProps,
  type BlockId,
  type Command,
  type PageId,
  type Vec,
} from "@seqno/domain"
import { add, round, sub, type Bounds } from "./geometry.ts"
import type { Item, Scene } from "./model.ts"

export type Raw = Readonly<Record<string, unknown>>

const setShape = (blockId: BlockId, value: string): Command => ({
  _tag: "SetProperty",
  target: { _tag: "BlockTarget", blockId },
  key: SHAPE_KEY,
  value,
})

export const patch = (item: Item, change: Raw): Command =>
  setShape(item.block.id, patchShape(item.block, change))

const draftOf = ({ raw, text }: { readonly raw: Raw; readonly text: string }) => ({
  text,
  props: shapeProps(raw),
  children: [],
})

const lastRoot = (scene: Scene): BlockId | undefined => scene.items.at(-1)?.block.id

export const create = (
  pageId: PageId,
  scene: Scene,
  drafts: ReadonlyArray<{ readonly raw: Raw; readonly text: string }>,
): Command | null => {
  const [first, ...rest] = drafts
  if (first === undefined) return null
  const after = lastRoot(scene)
  return {
    _tag: "InsertBlocks",
    pageId,
    parentId: null,
    ...(after === undefined ? {} : { after }),
    blocks: [draftOf(first), ...rest.map(draftOf)],
  }
}

const roundVec = ([x, y]: Vec): Vec => [round(x), round(y)]

const handleRaw = (point: Vec, bindTo: BlockId | undefined): Raw =>
  bindTo === undefined ? { point } : { point, bindTo }

const movedHandles = (item: Item, moving: ReadonlySet<BlockId>): Raw => {
  if (item.shape.type !== "line") return {}
  const { start, end } = item.shape.handles
  const kept = (bindTo: BlockId | undefined) =>
    bindTo !== undefined && moving.has(bindTo) ? bindTo : undefined
  if (kept(start.bindTo) === start.bindTo && kept(end.bindTo) === end.bindTo) return {}
  return {
    handles: {
      start: handleRaw(start.point, kept(start.bindTo)),
      end: handleRaw(end.point, kept(end.bindTo)),
    },
  }
}

export const translate = (items: ReadonlyArray<Item>, delta: Vec): ReadonlyArray<Command> => {
  const moving = new Set(items.map((item) => item.block.id))
  return items.map((item) =>
    patch(item, { point: roundVec(add(item.shape.point, delta)), ...movedHandles(item, moving) }),
  )
}

export const duplicate = (
  pageId: PageId,
  scene: Scene,
  items: ReadonlyArray<Item>,
  delta: Vec,
): Command | null =>
  create(
    pageId,
    scene,
    items.map((item) => {
      const point = roundVec(add(item.shape.point, delta))
      const ends = scene.ends.get(item.block.id)
      const handles =
        item.shape.type === "line" && ends !== undefined
          ? {
              handles: {
                start: { point: roundVec(sub(add(ends[0], delta), point)) },
                end: { point: roundVec(sub(add(ends[1], delta), point)) },
              },
            }
          : {}
      return { raw: { ...shapeRaw(item.block), point, ...handles }, text: item.block.text }
    }),
  )

export const scaleInto = (item: Item, from: Bounds, to: Bounds, own: Bounds): Raw => {
  const sx = (to.maxX - to.minX) / Math.max(1, from.maxX - from.minX)
  const sy = (to.maxY - to.minY) / Math.max(1, from.maxY - from.minY)
  const map = ([x, y]: Vec): Vec => [to.minX + (x - from.minX) * sx, to.minY + (y - from.minY) * sy]
  const { shape } = item
  switch (shape.type) {
    case "line": {
      const start = map(add(shape.point, shape.handles.start.point))
      const end = map(add(shape.point, shape.handles.end.point))
      const point: Vec = [Math.min(start[0], end[0]), Math.min(start[1], end[1])]
      return {
        point: roundVec(point),
        handles: {
          start: handleRaw(roundVec(sub(start, point)), shape.handles.start.bindTo),
          end: handleRaw(roundVec(sub(end, point)), shape.handles.end.bindTo),
        },
      }
    }
    case "pencil":
    case "highlighter": {
      const topLeft = map(shape.point)
      return {
        point: roundVec(topLeft),
        points: shape.points.map(([x = 0, y = 0, ...rest]) => [
          round(x * sx),
          round(y * sy),
          ...rest,
        ]),
      }
    }
    default: {
      const [minX, minY] = map([own.minX, own.minY])
      const [maxX, maxY] = map([own.maxX, own.maxY])
      return {
        point: roundVec([minX, minY]),
        size: roundVec([Math.max(1, maxX - minX), Math.max(1, maxY - minY)]),
      }
    }
  }
}

export const remove = (scene: Scene, ids: ReadonlyArray<BlockId>): ReadonlyArray<Command> => {
  const [first, ...rest] = ids
  if (first === undefined) return []
  const gone = new Set(ids)
  const freed = scene.items.flatMap((item) => {
    if (item.shape.type !== "line" || gone.has(item.block.id)) return []
    const { start, end } = item.shape.handles
    const ends = scene.ends.get(item.block.id)
    if (ends === undefined) return []
    const lost = (handle: typeof start) => handle.bindTo !== undefined && gone.has(handle.bindTo)
    if (!lost(start) && !lost(end)) return []
    const point = item.shape.point
    const free = (handle: typeof start, at: Vec) =>
      lost(handle) ? { point: roundVec(sub(at, point)) } : handleRaw(handle.point, handle.bindTo)
    return [patch(item, { handles: { start: free(start, ends[0]), end: free(end, ends[1]) } })]
  })
  return [...freed, { _tag: "DeleteBlocks", blockIds: [first, ...rest] }]
}

export type Order = "front" | "forward" | "backward" | "back"

export const reorder = (
  scene: Scene,
  ids: ReadonlyArray<BlockId>,
  order: Order,
): Command | null => {
  const chosen = new Set(ids)
  const picked = scene.items.filter((item) => chosen.has(item.block.id))
  const [first, ...rest] = picked.map((item) => item.block.id)
  if (first === undefined) return null
  const others = scene.items.filter((item) => !chosen.has(item.block.id))
  const firstIndex = scene.items.findIndex((item) => chosen.has(item.block.id))
  const lastIndex = scene.items.findLastIndex((item) => chosen.has(item.block.id))
  const blockIds: readonly [BlockId, ...Array<BlockId>] = [first, ...rest]
  const after = (() => {
    switch (order) {
      case "front":
        return others.at(-1)?.block.id
      case "back":
        return null
      case "forward":
        return (
          scene.items.slice(lastIndex + 1).find((item) => !chosen.has(item.block.id))?.block.id ??
          others.at(-1)?.block.id
        )
      case "backward": {
        const below = scene.items.slice(0, firstIndex).filter((item) => !chosen.has(item.block.id))
        return below.length <= 1 ? null : below.at(-2)?.block.id
      }
    }
  })()
  if (after === undefined) return null
  return after === null
    ? { _tag: "MoveBlocks", blockIds, parentId: null }
    : { _tag: "MoveBlocks", blockIds, parentId: null, after }
}

export const editText = (blockId: BlockId, before: string, after: string): Command | null => {
  if (before === after) return null
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1
  }
  let tail = 0
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }
  return {
    _tag: "EditText",
    blockId,
    from: start,
    to: before.length - tail,
    insert: after.slice(start, after.length - tail),
  }
}
