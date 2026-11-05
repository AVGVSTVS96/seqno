import type { Block, BlockId, Command, PageId, Vec } from "@seqno/domain"
import { copiedOf } from "./clipboard.ts"
import { clones, create, patch, remove, scaleInto, translate } from "./commands.ts"
import type { Raw } from "./commands.ts"
import {
  angleOf,
  boundsOfPoints,
  centerOf,
  clampRadians,
  cornersOf,
  encloses,
  length,
  overlaps,
  polygonsOverlap,
  rotateAround,
  round,
  snapRadians,
  sub,
  union,
} from "./geometry.ts"
import type { Bounds } from "./geometry.ts"
import { hits, isLocked, itemsOf, rotationOf, outermost, sceneOf, withMembers } from "./model.ts"
import type { Item, Scene } from "./model.ts"
import { applyLocally, isGhost } from "./preview.ts"
import { newShape } from "./tools.ts"
import type { ShapeTool, Styles } from "./tools.ts"

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
      readonly keep: readonly BlockId[]
    }
  | {
      readonly _tag: "Translating"
      readonly from: Vec
      readonly to: Vec
      readonly ids: readonly BlockId[]
      readonly copy: readonly BlockId[] | null
    }
  | {
      readonly _tag: "Resizing"
      readonly handle: ResizeHandle
      readonly from: Bounds
      readonly to: Vec
      readonly ids: readonly BlockId[]
      readonly keepRatio: boolean
      readonly rotation: number
    }
  | {
      readonly _tag: "Rotating"
      readonly corner: Corner
      readonly ids: readonly BlockId[]
      readonly pivot: Vec
      readonly from: Vec
      readonly start: Vec | null
      readonly to: Vec
      readonly snap: boolean
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
      readonly points: readonly Vec[]
    }
  | { readonly _tag: "Erasing"; readonly ids: readonly BlockId[]; readonly last: Vec }

export const idle: Gesture = { _tag: "Idle" }

export const DRAG_THRESHOLD = 3

const picked = (scene: Scene, ids: readonly BlockId[]) =>
  withMembers(scene, ids).flatMap((id) => {
    const item = scene.byId.get(id)

    return item === undefined || isLocked(item) ? [] : [item]
  })

export const selectionBounds = (scene: Scene, ids: readonly BlockId[]): Bounds | null => {
  const [only, ...rest] = ids

  return only !== undefined && rest.length === 0
    ? (scene.bounds.get(only) ?? null)
    : union(ids.flatMap((id) => scene.turned.get(id) ?? []))
}

export const ROTATE_THRESHOLD = 5

export const canRotate = (scene: Scene, ids: readonly BlockId[]) => {
  const items = ids.flatMap((id) => scene.byId.get(id) ?? [])

  return (
    items.some((item) => !isLocked(item)) &&
    items.every((item) => item.shape.type !== "line" && item.shape.type !== "logseq-portal")
  )
}

const anchorOf = (box: Bounds, handle: ResizeHandle): Vec => {
  const [cx, cy] = centerOf(box)

  return [
    handle.endsWith("left") ? box.maxX : handle.endsWith("right") ? box.minX : cx,
    handle.startsWith("top") ? box.maxY : handle.startsWith("bottom") ? box.minY : cy,
  ]
}

const resized = (gesture: Extract<Gesture, { _tag: "Resizing" }>): Bounds => {
  const { from, handle, rotation } = gesture

  if (rotation === 0) {
    return resizedBox({ ...gesture, to: gesture.to })
  }

  const pivot = centerOf(from)
  const next = resizedBox({ ...gesture, to: rotateAround(gesture.to, pivot, -rotation) })
  const anchor = anchorOf(from, handle)

  const [dx, dy] = sub(
    rotateAround(anchor, centerOf(next), rotation),
    rotateAround(anchor, pivot, rotation),
  )

  return { minX: next.minX - dx, minY: next.minY - dy, maxX: next.maxX - dx, maxY: next.maxY - dy }
}

const resizedBox = ({
  from,
  to,
  handle,
  keepRatio,
}: {
  readonly from: Bounds
  readonly to: Vec
  readonly handle: ResizeHandle
  readonly keepRatio: boolean
}): Bounds => {
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

      if (north) {
        minY = maxY - next
      } else {
        maxY = minY + next
      }
    } else {
      const next = height * ratio

      if (west) {
        minX = maxX - next
      } else {
        maxX = minX + next
      }
    }
  }

  return { minX, minY, maxX, maxY }
}

const rotated = (
  scene: Scene,
  items: readonly Item[],
  pivot: Vec,
  turn: number,
  snap: boolean,
): readonly Command[] =>
  items.flatMap((item) => {
    const box = scene.bounds.get(item.block.id)

    if (box === undefined || item.shape.type === "group" || item.shape.type === "line") {
      return []
    }

    const start = rotationOf(item)
    const middle = centerOf(box)
    const [dx, dy] = sub(rotateAround(middle, pivot, turn), middle)

    return [
      patch(item, {
        point: [round(item.shape.point[0] + dx), round(item.shape.point[1] + dy)],
        rotation: clampRadians(start + turn + (snap ? snapRadians(start) - start : 0)),
      }),
    ]
  })

export const turnOf = (gesture: Extract<Gesture, { _tag: "Rotating" }>) => {
  if (gesture.start === null) {
    return 0
  }

  const turn = angleOf(gesture.pivot, gesture.to) - angleOf(gesture.pivot, gesture.start)

  return gesture.snap ? snapRadians(turn) : turn
}

export const rotationStarted = (gesture: Extract<Gesture, { _tag: "Rotating" }>, at: Vec) =>
  gesture.start ?? (length(sub(at, gesture.from)) > ROTATE_THRESHOLD ? at : null)

const brushBox = (from: Vec, to: Vec) => boundsOfPoints([from, to])

export const brushed = (scene: Scene, gesture: Extract<Gesture, { _tag: "Brushing" }>) => {
  const box = brushBox(gesture.from, gesture.to)

  const inside = scene.items
    .filter((item) => {
      const own = scene.bounds.get(item.block.id)
      const turned = scene.turned.get(item.block.id)

      if (item.shape.type === "group" || own === undefined || turned === undefined) {
        return false
      }

      const r = rotationOf(item)

      return r === 0
        ? overlaps(box, own)
        : encloses(box, turned) || polygonsOverlap(cornersOf(box, 0), cornersOf(own, r))
    })
    .map((item) => outermost(scene, item.block.id))

  return [...new Set([...gesture.keep, ...inside])]
}

export const brushOf = (gesture: Gesture): Bounds | null =>
  gesture._tag === "Brushing" ? brushBox(gesture.from, gesture.to) : null

const relative = (points: readonly Vec[]): { readonly point: Vec; readonly rest: Raw } => {
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
): readonly Command[] => {
  switch (gesture._tag) {
    case "Translating": {
      const delta = sub(gesture.to, gesture.from)

      if (delta[0] === 0 && delta[1] === 0) {
        return []
      }

      if (gesture.copy !== null) {
        const copied = copiedOf(scene, picked(scene, gesture.ids))
        const made = create(pageId, scene, clones(copied, delta, gesture.copy))

        return made === null ? [] : [made]
      }

      return settle(scene, translate(scene, picked(scene, gesture.ids), delta))
    }

    case "Rotating": {
      return gesture.start === null
        ? []
        : settle(
            scene,
            rotated(
              scene,
              picked(scene, gesture.ids),
              gesture.pivot,
              turnOf(gesture),
              gesture.snap,
            ),
          )
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

      if (made === null) {
        return []
      }

      const drawn = sceneOf(itemsOf(applyLocally(blocksOf(scene), [made])), scene.measured)
      const line = drawn.items.find((item) => isGhost(item.block.id))
      const ends = line === undefined ? undefined : drawn.ends.get(line.block.id)
      const settled = ends === undefined ? made : draft(ends[0], ends[1])

      return settled === null ? [] : [settled]
    }

    case "MovingEnd": {
      const item = scene.byId.get(gesture.line)

      if (item === undefined || item.shape.type !== "line") {
        return []
      }

      const ends = scene.ends.get(gesture.line)

      if (ends === undefined) {
        return []
      }

      const { start, end } = item.shape.handles
      const from = gesture.end === "start" ? gesture.to : ends[0]
      const to = gesture.end === "end" ? gesture.to : ends[1]
      const startBind = gesture.end === "start" ? gesture.bind : (start.bindTo ?? null)
      const endBind = gesture.end === "end" ? gesture.bind : (end.bindTo ?? null)
      const raw = lineRaw(from, to, startBind, endBind, styles)

      return settle(scene, [patch(item, { point: raw["point"], handles: raw["handles"] })])
    }

    case "Drawing": {
      if (gesture.points.length < 2) {
        return []
      }

      const { point, rest } = relative(gesture.points)

      const made = create(pageId, scene, [
        { raw: newShape(gesture.tool, point, [0, 0], styles, rest), text: "" },
      ])

      return made === null ? [] : [made]
    }

    case "Erasing": {
      return remove(scene, gesture.ids)
    }

    default: {
      return []
    }
  }
}

const blocksOf = (scene: Scene) => scene.items.map((item) => item.block)

const sameHandles = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const rerouteLines = (after: Scene, moved: (line: Item) => boolean): readonly Command[] =>
  after.items.flatMap((item) => {
    if (item.shape.type !== "line") {
      return []
    }

    const { start, end } = item.shape.handles
    const ends = after.ends.get(item.block.id)

    if (!moved(item) || ends === undefined) {
      return []
    }

    const local = (at: Vec): Vec => [
      round(at[0] - item.shape.point[0]),
      round(at[1] - item.shape.point[1]),
    ]

    const handle = (at: Vec, bindTo: BlockId | undefined) =>
      bindTo === undefined ? { point: local(at) } : { point: local(at), bindTo }

    const next = { start: handle(ends[0], start.bindTo), end: handle(ends[1], end.bindTo) }

    return sameHandles(next, item.shape.handles) ? [] : [patch(item, { handles: next })]
  })

const boundTo = (line: Item, ids: (id: BlockId) => boolean) =>
  line.shape.type === "line" &&
  [line.shape.handles.start.bindTo, line.shape.handles.end.bindTo].some(
    (id) => id !== undefined && ids(id),
  )

export const settle = (scene: Scene, commands: readonly Command[]): readonly Command[] => {
  if (commands.length === 0) {
    return commands
  }

  const touched = new Set(
    commands.flatMap((command) =>
      command._tag === "SetProperty" && command.target._tag === "BlockTarget"
        ? [command.target.blockId]
        : [],
    ),
  )

  const after = sceneOf(itemsOf(applyLocally(blocksOf(scene), commands)), scene.measured)

  return [
    ...commands,
    ...rerouteLines(
      after,
      (line) => touched.has(line.block.id) || boundTo(line, (id) => touched.has(id)),
    ),
  ]
}

export const rerouted = (blocks: readonly Block[]): readonly Block[] =>
  applyLocally(
    blocks,
    rerouteLines(sceneOf(itemsOf(blocks), new Map()), (line) => boundTo(line, () => true)),
  )

export const erasedAt = (scene: Scene, point: Vec, zoom: number): readonly BlockId[] =>
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
