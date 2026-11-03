import type { BlockId, Command, PageId, Vec } from "@seqno/domain"
import { copiedOf } from "./clipboard.ts"
import { clones, create, patch, remove, scaleInto, translate, type Raw } from "./commands.ts"
import { boundsOfPoints, overlaps, round, sub, union, type Bounds } from "./geometry.ts"
import { hits, isLocked, itemsOf, sceneOf, type Item, type Scene } from "./model.ts"
import { applyLocally, isGhost } from "./preview.ts"
import { newShape, type ShapeTool, type Styles } from "./tools.ts"

export type Corner = "top-left" | "top-right" | "bottom-right" | "bottom-left"
export type Edge = "top" | "right" | "bottom" | "left"
export type ResizeHandle = Corner | Edge

export type Gesture =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Panning"; readonly last: Vec }
  | {
      readonly _tag: "Brushing"
      readonly from: Vec
      readonly to: Vec
      readonly keep: ReadonlyArray<BlockId>
    }
  | {
      readonly _tag: "Translating"
      readonly from: Vec
      readonly to: Vec
      readonly ids: ReadonlyArray<BlockId>
      readonly copy: ReadonlyArray<BlockId> | null
    }
  | {
      readonly _tag: "Resizing"
      readonly handle: ResizeHandle
      readonly from: Bounds
      readonly to: Vec
      readonly ids: ReadonlyArray<BlockId>
      readonly keepRatio: boolean
    }
  | { readonly _tag: "Creating"; readonly tool: ShapeTool; readonly from: Vec; readonly to: Vec }
  | {
      readonly _tag: "Connecting"
      readonly from: Vec
      readonly to: Vec
      readonly start: BlockId | null
      readonly end: BlockId | null
    }
  | {
      readonly _tag: "MovingEnd"
      readonly line: BlockId
      readonly end: "start" | "end"
      readonly to: Vec
      readonly bind: BlockId | null
    }
  | {
      readonly _tag: "Drawing"
      readonly tool: "pencil" | "highlighter"
      readonly points: ReadonlyArray<Vec>
    }
  | { readonly _tag: "Erasing"; readonly ids: ReadonlyArray<BlockId>; readonly last: Vec }

export const idle: Gesture = { _tag: "Idle" }

export const DRAG_THRESHOLD = 3

const picked = (scene: Scene, ids: ReadonlyArray<BlockId>) =>
  ids.flatMap((id) => {
    const item = scene.byId.get(id)
    return item === undefined || isLocked(item) ? [] : [item]
  })

export const selectionBounds = (scene: Scene, ids: ReadonlyArray<BlockId>): Bounds | null =>
  union(ids.flatMap((id) => scene.bounds.get(id) ?? []))

const resized = (gesture: Extract<Gesture, { _tag: "Resizing" }>): Bounds => {
  const { from, to, handle, keepRatio } = gesture
  const box = { ...from }
  const [x, y] = to
  const west = handle === "left" || handle === "top-left" || handle === "bottom-left"
  const east = handle === "right" || handle === "top-right" || handle === "bottom-right"
  const north = handle === "top" || handle === "top-left" || handle === "top-right"
  const south = handle === "bottom" || handle === "bottom-left" || handle === "bottom-right"
  let minX = west ? Math.min(x, box.maxX - 1) : box.minX
  let maxX = east ? Math.max(x, box.minX + 1) : box.maxX
  let minY = north ? Math.min(y, box.maxY - 1) : box.minY
  let maxY = south ? Math.max(y, box.minY + 1) : box.maxY
  const ratio = (from.maxX - from.minX) / Math.max(1, from.maxY - from.minY)
  if (keepRatio && (west || east) && !(north || south)) {
    const next = (maxX - minX) / ratio
    const middle = (from.minY + from.maxY) / 2
    minY = middle - next / 2
    maxY = middle + next / 2
  }
  if (keepRatio && (north || south) && !(west || east)) {
    const next = (maxY - minY) * ratio
    const middle = (from.minX + from.maxX) / 2
    minX = middle - next / 2
    maxX = middle + next / 2
  }
  if (keepRatio && (west || east) && (north || south)) {
    const width = maxX - minX
    const height = maxY - minY
    if (width / ratio > height) {
      const next = width / ratio
      if (north) minY = maxY - next
      else maxY = minY + next
    } else {
      const next = height * ratio
      if (west) minX = maxX - next
      else maxX = minX + next
    }
  }
  return { minX, minY, maxX, maxY }
}

const brushBox = (from: Vec, to: Vec) => boundsOfPoints([from, to])

export const brushed = (scene: Scene, gesture: Extract<Gesture, { _tag: "Brushing" }>) => {
  const box = brushBox(gesture.from, gesture.to)
  const inside = scene.items
    .filter((item) => {
      const own = scene.bounds.get(item.block.id)
      return own !== undefined && overlaps(box, own)
    })
    .map((item) => item.block.id)
  return [...new Set([...gesture.keep, ...inside])]
}

export const brushOf = (gesture: Gesture): Bounds | null =>
  gesture._tag === "Brushing" ? brushBox(gesture.from, gesture.to) : null

const relative = (points: ReadonlyArray<Vec>): { readonly point: Vec; readonly rest: Raw } => {
  const box = boundsOfPoints(points)
  const point: Vec = [round(box.minX), round(box.minY)]
  return {
    point,
    rest: { points: points.map(([x, y]) => [round(x - point[0]), round(y - point[1]), 0.5]) },
  }
}

export const lineRaw = (
  from: Vec,
  to: Vec,
  start: BlockId | null,
  end: BlockId | null,
  styles: Styles,
) => {
  const point: Vec = [round(Math.min(from[0], to[0])), round(Math.min(from[1], to[1]))]
  const handle = (at: Vec, bindTo: BlockId | null) => {
    const local: Vec = [round(at[0] - point[0]), round(at[1] - point[1])]
    return bindTo === null ? { point: local } : { point: local, bindTo }
  }
  return newShape("line", point, [0, 0], styles, {
    handles: { start: handle(from, start), end: handle(to, end) },
  })
}

export const changesOf = (
  pageId: PageId,
  scene: Scene,
  gesture: Gesture,
  styles: Styles,
): ReadonlyArray<Command> => {
  switch (gesture._tag) {
    case "Translating": {
      const delta = sub(gesture.to, gesture.from)
      if (delta[0] === 0 && delta[1] === 0) return []
      if (gesture.copy !== null) {
        const copied = copiedOf(scene, picked(scene, gesture.ids))
        const made = create(pageId, scene, clones(copied, delta, gesture.copy))
        return made === null ? [] : [made]
      }
      return settle(scene, translate(scene, picked(scene, gesture.ids), delta))
    }
    case "Resizing": {
      const to = resized(gesture)
      return settle(
        scene,
        picked(scene, gesture.ids).flatMap((item) => {
          const own = scene.bounds.get(item.block.id)
          return own === undefined ? [] : [patch(item, scaleInto(item, gesture.from, to, own))]
        }),
      )
    }
    case "Creating": {
      const box = brushBox(gesture.from, gesture.to)
      const made = create(pageId, scene, [
        {
          raw: newShape(
            gesture.tool,
            [round(box.minX), round(box.minY)],
            [round(box.maxX - box.minX), round(box.maxY - box.minY)],
            styles,
          ),
          text: "",
        },
      ])
      return made === null ? [] : [made]
    }
    case "Connecting": {
      const draft = (from: Vec, to: Vec) =>
        create(pageId, scene, [
          { raw: lineRaw(from, to, gesture.start, gesture.end, styles), text: "" },
        ])
      const made = draft(gesture.from, gesture.to)
      if (made === null) return []
      const drawn = sceneOf(itemsOf(applyLocally(blocksOf(scene), [made])), scene.measured)
      const line = drawn.items.find((item) => isGhost(item.block.id))
      const ends = line === undefined ? undefined : drawn.ends.get(line.block.id)
      const settled = ends === undefined ? made : draft(ends[0], ends[1])
      return settled === null ? [] : [settled]
    }
    case "MovingEnd": {
      const item = scene.byId.get(gesture.line)
      if (item === undefined || item.shape.type !== "line") return []
      const ends = scene.ends.get(gesture.line)
      if (ends === undefined) return []
      const { start, end } = item.shape.handles
      const from = gesture.end === "start" ? gesture.to : ends[0]
      const to = gesture.end === "end" ? gesture.to : ends[1]
      const startBind = gesture.end === "start" ? gesture.bind : (start.bindTo ?? null)
      const endBind = gesture.end === "end" ? gesture.bind : (end.bindTo ?? null)
      const raw = lineRaw(from, to, startBind, endBind, styles)
      return settle(scene, [patch(item, { point: raw["point"], handles: raw["handles"] })])
    }
    case "Drawing": {
      if (gesture.points.length < 2) return []
      const { point, rest } = relative(gesture.points)
      const made = create(pageId, scene, [
        { raw: newShape(gesture.tool, point, [0, 0], styles, rest), text: "" },
      ])
      return made === null ? [] : [made]
    }
    case "Erasing":
      return remove(scene, gesture.ids)
    default:
      return []
  }
}

const blocksOf = (scene: Scene) => scene.items.map((item) => item.block)

const sameHandles = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const settle = (scene: Scene, commands: ReadonlyArray<Command>): ReadonlyArray<Command> => {
  if (commands.length === 0) return commands
  const touched = new Set(
    commands.flatMap((command) =>
      command._tag === "SetProperty" && command.target._tag === "BlockTarget"
        ? [command.target.blockId]
        : [],
    ),
  )
  const after = sceneOf(itemsOf(applyLocally(blocksOf(scene), commands)), scene.measured)
  const fixes = after.items.flatMap((item) => {
    if (item.shape.type !== "line") return []
    const { start, end } = item.shape.handles
    const bound = [start.bindTo, end.bindTo].some((id) => id !== undefined && touched.has(id))
    const ends = after.ends.get(item.block.id)
    if ((!bound && !touched.has(item.block.id)) || ends === undefined) return []
    const local = (at: Vec): Vec => [
      round(at[0] - item.shape.point[0]),
      round(at[1] - item.shape.point[1]),
    ]
    const handle = (at: Vec, bindTo: BlockId | undefined) =>
      bindTo === undefined ? { point: local(at) } : { point: local(at), bindTo }
    const next = { start: handle(ends[0], start.bindTo), end: handle(ends[1], end.bindTo) }
    return sameHandles(next, item.shape.handles) ? [] : [patch(item, { handles: next })]
  })
  return [...commands, ...fixes]
}

export const erasedAt = (scene: Scene, point: Vec, zoom: number): ReadonlyArray<BlockId> =>
  scene.items
    .filter((item) => !isLocked(item) && hits(scene, item, point, zoom))
    .map((item) => item.block.id)

export const bindTarget = (
  scene: Scene,
  point: Vec,
  zoom: number,
  except: BlockId | null,
): Item | null =>
  scene.items.findLast(
    (item) =>
      item.block.id !== except &&
      item.shape.type !== "line" &&
      item.shape.type !== "pencil" &&
      item.shape.type !== "highlighter" &&
      hits(scene, item, point, zoom),
  ) ?? null
