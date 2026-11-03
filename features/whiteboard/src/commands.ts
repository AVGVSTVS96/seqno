import {
  SHAPE_KEY,
  patchShape,
  shapeProps,
  type BlockId,
  type Command,
  type PageId,
  type Vec,
} from "@seqno/domain"
import { add, round, sub, type Bounds } from "./geometry.ts"
import { isLocked, withMembers, type Item, type Scene } from "./model.ts"
import { handlesOf, type Copied } from "./clipboard.ts"
import { isGhost } from "./preview.ts"

export type Raw = Readonly<Record<string, unknown>>

const setShape = (blockId: BlockId, value: string): Command => ({
  _tag: "SetProperty",
  target: { _tag: "BlockTarget", blockId },
  key: SHAPE_KEY,
  value,
})

export const patch = (item: Item, change: Raw): Command =>
  setShape(item.block.id, patchShape(item.block, change))

export interface Draft {
  readonly id?: BlockId
  readonly raw: Raw
  readonly text: string
}

const draftOf = ({ id, raw, text }: Draft) => ({
  ...(id === undefined ? {} : { id }),
  text,
  props: shapeProps(raw),
  children: [],
})

const lastRoot = (scene: Scene): BlockId | undefined =>
  scene.items.findLast((item) => !isGhost(item.block.id))?.block.id

export const create = (
  pageId: PageId,
  scene: Scene,
  drafts: ReadonlyArray<Draft>,
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

const movedHandles = (scene: Scene, item: Item, moving: ReadonlySet<BlockId>): Raw => {
  if (item.shape.type !== "line") return {}
  const { start, end } = item.shape.handles
  const kept = (bindTo: BlockId | undefined) =>
    bindTo !== undefined && moving.has(bindTo) ? bindTo : undefined
  if (kept(start.bindTo) === start.bindTo && kept(end.bindTo) === end.bindTo) return {}
  const ends = scene.ends.get(item.block.id)
  const local = (at: Vec | undefined, fallback: Vec) =>
    at === undefined ? fallback : roundVec(sub(at, item.shape.point))
  return {
    handles: {
      start: handleRaw(local(ends?.[0], start.point), kept(start.bindTo)),
      end: handleRaw(local(ends?.[1], end.point), kept(end.bindTo)),
    },
  }
}

export const translate = (
  scene: Scene,
  items: ReadonlyArray<Item>,
  delta: Vec,
): ReadonlyArray<Command> => {
  const moving = new Set(items.map((item) => item.block.id))
  return items.map((item) =>
    patch(item, {
      point: roundVec(add(item.shape.point, delta)),
      ...movedHandles(scene, item, moving),
    }),
  )
}

const vecIn = (value: unknown): Vec | undefined =>
  Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number"
    ? [value[0], value[1]]
    : undefined

export const copiesAt = (copied: ReadonlyArray<Copied>, at: Vec): Vec => {
  const points = copied.flatMap(({ raw }) => {
    const point = raw["type"] === "group" ? undefined : vecIn(raw["point"])
    return point === undefined ? [] : [point]
  })
  if (points.length === 0) return [0, 0]
  return sub(at, [Math.min(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y))])
}

export const clones = (
  copied: ReadonlyArray<Copied>,
  delta: Vec,
  fresh: ReadonlyArray<BlockId>,
): ReadonlyArray<Draft> => {
  const ids = new Map(
    copied.flatMap(({ id }, index) => {
      const made = fresh[index]
      return made === undefined ? [] : [[id.toLowerCase(), made] as const]
    }),
  )
  const mapped = (value: unknown) =>
    typeof value === "string" ? ids.get(value.toLowerCase()) : undefined
  return copied.flatMap(({ id, raw, text }) => {
    const own = mapped(id)
    if (own === undefined) return []
    const { id: _id, index: _index, refs: _refs, ...rest } = raw
    const children = raw["children"]
    const handles = handlesOf(raw["handles"]).map(([name, handle]) => {
      const { bindTo, bindingId: _bindingId, ...kept } = handle
      const target = mapped(bindTo)
      return [name, target === undefined ? kept : { ...kept, bindTo: target }] as const
    })
    return [
      {
        id: own,
        text,
        raw: {
          ...rest,
          point: roundVec(add(vecIn(raw["point"]) ?? [0, 0], delta)),
          ...(handles.length === 0 ? {} : { handles: Object.fromEntries(handles) }),
          ...(Array.isArray(children)
            ? { children: children.flatMap((child) => mapped(child) ?? []) }
            : {}),
        },
      },
    ]
  })
}

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
        ...(shape.type === "text" ? { isSizeLocked: false } : {}),
      }
    }
  }
}

const shrunk = (scene: Scene, gone: Set<BlockId>): ReadonlyArray<Command> =>
  [...scene.members].flatMap(([group, members]) => {
    if (gone.has(group)) return []
    const left = members.filter((id) => !gone.has(id))
    if (left.length === members.length) return []
    const item = scene.byId.get(group)
    if (left.length > 1 && item !== undefined) return [patch(item, { children: left })]
    gone.add(group)
    return []
  })

export const remove = (scene: Scene, ids: ReadonlyArray<BlockId>): ReadonlyArray<Command> => {
  const gone = new Set(
    withMembers(scene, ids).filter((id) => {
      const item = scene.byId.get(id)
      return ids.includes(id) || (item !== undefined && !isLocked(item))
    }),
  )
  const kept = shrunk(scene, gone)
  const [first, ...rest] = [...gone]
  if (first === undefined) return []
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
  return [...kept, ...freed, { _tag: "DeleteBlocks", blockIds: [first, ...rest] }]
}

const groupsIn = (scene: Scene, ids: ReadonlyArray<BlockId>) => [
  ...new Set(
    withMembers(scene, ids).flatMap((id) =>
      scene.byId.get(id)?.shape.type === "group" ? [id] : (scene.groupOf.get(id) ?? []),
    ),
  ),
]

const raised = (order: ReadonlyArray<BlockId>, movers: ReadonlyArray<BlockId>, top: BlockId) => {
  const stack = [...order, top]
  const moves = movers
    .toSorted((a, b) => stack.indexOf(b) - stack.indexOf(a))
    .flatMap((id): ReadonlyArray<Command> => {
      const index = stack.indexOf(id)
      const next = stack[index + 1]
      if (index === -1 || next === undefined || movers.includes(next)) return []
      stack[index] = next
      stack[index + 1] = id
      return next === top
        ? []
        : [{ _tag: "MoveBlocks", blockIds: [id], parentId: null, after: next }]
    })
  return { moves, below: stack[stack.indexOf(top) - 1] }
}

export const group = (
  pageId: PageId,
  scene: Scene,
  ids: ReadonlyArray<BlockId>,
  groupId: BlockId,
): ReadonlyArray<Command> => {
  const groups = groupsIn(scene, ids)
  const leaves = withMembers(scene, ids).filter((id) => scene.byId.get(id)?.shape.type !== "group")
  const [first, ...rest] = groups
  const removed: ReadonlyArray<Command> =
    first === undefined ? [] : [{ _tag: "DeleteBlocks", blockIds: [first, ...rest] }]
  if (leaves.length < 2) return removed
  const order = scene.items
    .map((item) => item.block.id)
    .filter((id) => !groups.includes(id) && !isGhost(id))
  const { moves, below } = raised(order, leaves, groupId)
  const made: Command = {
    _tag: "InsertBlocks",
    pageId,
    parentId: null,
    ...(below === undefined ? {} : { after: below }),
    blocks: [
      draftOf({
        id: groupId,
        text: "",
        raw: { type: "group", point: [0, 0], size: [0, 0], children: leaves },
      }),
    ],
  }
  return [...removed, ...moves, made]
}

export const ungroup = (
  scene: Scene,
  ids: ReadonlyArray<BlockId>,
): { readonly commands: ReadonlyArray<Command>; readonly members: ReadonlyArray<BlockId> } => {
  const [first, ...rest] = groupsIn(scene, ids)
  if (first === undefined) return { commands: [], members: [] }
  return {
    commands: [{ _tag: "DeleteBlocks", blockIds: [first, ...rest] }],
    members: [first, ...rest].flatMap((id) => scene.members.get(id) ?? []),
  }
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
