import potpack from "potpack"
import { shapeRaw } from "@seqno/domain"
import type { BlockId, Command, Vec } from "@seqno/domain"
import { patch } from "./commands.ts"
import { vecIn } from "./raw.ts"
import type { Raw } from "./raw.ts"
import { add, sub, union } from "./geometry.ts"
import type { Bounds } from "./geometry.ts"
import { settle } from "./gestures.ts"
import type { Item, Scene } from "./model.ts"

export type Align = "left" | "centerHorizontal" | "right" | "top" | "centerVertical" | "bottom"

export type Distribute = "horizontal" | "vertical"

export type Flip = "horizontal" | "vertical"

interface Unit {
  readonly id: BlockId
  readonly bounds: Bounds
}

const unitsOf = (scene: Scene, ids: readonly BlockId[]): readonly Unit[] =>
  ids.flatMap((id) => {
    const bounds = scene.bounds.get(id)

    return bounds === undefined ? [] : [{ id, bounds }]
  })

const width = (box: Bounds) => box.maxX - box.minX
const height = (box: Bounds) => box.maxY - box.minY
const centerOf = (box: Bounds): Vec => [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]

const shifted = (scene: Scene, id: BlockId, delta: Vec, extra: Raw): readonly Command[] => {
  const own = scene.byId.get(id)

  if (own === undefined) {
    return []
  }

  const still = delta[0] === 0 && delta[1] === 0
  const point = (item: Item) => (still ? {} : { point: add(item.shape.point, delta) })
  const members = (scene.members.get(id) ?? []).flatMap((member) => scene.byId.get(member) ?? [])
  const mine = { ...point(own), ...extra }

  return [
    ...(Object.keys(mine).length === 0 ? [] : [patch(own, mine)]),
    ...(still ? [] : members.map((item) => patch(item, point(item)))),
  ]
}

const placed = (
  scene: Scene,
  targets: ReadonlyArray<readonly [Unit, Vec]>,
  extra: (unit: Unit) => Raw = () => ({}),
): readonly Command[] =>
  settle(
    scene,
    targets.flatMap(([unit, next]) =>
      shifted(scene, unit.id, sub(next, [unit.bounds.minX, unit.bounds.minY]), extra(unit)),
    ),
  )

const aligned = (own: Bounds, common: Bounds, type: Align): Vec => {
  const { minX, minY } = own
  const [midX, midY] = centerOf(common)

  switch (type) {
    case "top": {
      return [minX, common.minY]
    }

    case "centerVertical": {
      return [minX, midY - height(own) / 2]
    }

    case "bottom": {
      return [minX, common.maxY - height(own)]
    }

    case "left": {
      return [common.minX, minY]
    }

    case "centerHorizontal": {
      return [midX - width(own) / 2, minY]
    }

    case "right": {
      return [common.maxX - width(own), minY]
    }
  }
}

export const align = (scene: Scene, ids: readonly BlockId[], type: Align): readonly Command[] => {
  const units = unitsOf(scene, ids)
  const common = union(units.map(({ bounds }) => bounds))

  if (units.length < 2 || common === null) {
    return []
  }

  return placed(
    scene,
    units.map((unit) => [unit, aligned(unit.bounds, common, type)] as const),
  )
}

export const distribute = (
  scene: Scene,
  ids: readonly BlockId[],
  type: Distribute,
): readonly Command[] => {
  const units = unitsOf(scene, ids)
  const common = union(units.map(({ bounds }) => bounds))

  if (units.length < 2 || common === null) {
    return []
  }

  const axis = type === "horizontal" ? 0 : 1
  const lo = (box: Bounds) => (axis === 0 ? box.minX : box.minY)
  const hi = (box: Bounds) => (axis === 0 ? box.maxX : box.maxY)
  const length = (box: Bounds) => hi(box) - lo(box)
  const center = (unit: Unit) => centerOf(unit.bounds)[axis]

  const at = (unit: Unit, value: number): readonly [Unit, Vec] => [
    unit,
    axis === 0 ? [value, unit.bounds.minY] : [unit.bounds.minX, value],
  ]

  const span = units.reduce((sum, unit) => sum + length(unit.bounds), 0)
  const gaps = units.length - 1

  if (span > length(common)) {
    const first = units.toSorted((a, b) => lo(a.bounds) - lo(b.bounds))[0]
    const last = units.toSorted((a, b) => hi(b.bounds) - hi(a.bounds))[0]

    if (first === undefined || last === undefined) {
      return []
    }

    const step = (center(last) - center(first)) / gaps
    const start = center(first) + step

    return placed(
      scene,
      units
        .filter((unit) => unit !== first && unit !== last)
        .toSorted((a, b) => center(a) - center(b))
        .map((unit, index) => at(unit, start + step * index - length(unit.bounds) / 2)),
    )
  }

  const step = (length(common) - span) / gaps
  let next = lo(common)

  return placed(
    scene,
    units
      .toSorted((a, b) => center(a) - center(b))
      .map((unit) => {
        const target = at(unit, next)
        next += length(unit.bounds) + step

        return target
      }),
  )
}

export const packed = (units: readonly Unit[]): ReadonlyMap<BlockId, Vec> => {
  const common = union(units.map(({ bounds }) => bounds))

  if (common === null) {
    return new Map()
  }

  const boxes = units.map((unit) => ({
    id: unit.id,
    w: width(unit.bounds) + 16,
    h: height(unit.bounds) + 16,
    x: unit.bounds.minX,
    y: unit.bounds.minY,
  }))

  potpack(boxes)

  return new Map(boxes.map(({ id, x, y }) => [id, [x + common.minX, y + common.minY]]))
}

const boundLine = (item: Item | undefined) =>
  item?.shape.type === "line" &&
  (item.shape.handles.start.bindTo !== undefined || item.shape.handles.end.bindTo !== undefined)

export const pack = (scene: Scene, ids: readonly BlockId[]): readonly Command[] => {
  const units = unitsOf(scene, ids)
  const moving = units.filter((unit) => !boundLine(scene.byId.get(unit.id)))
  const next = packed(moving)

  return placed(
    scene,
    moving.flatMap((unit) => {
      const point = next.get(unit.id)

      return point === undefined ? [] : [[unit, point] as const]
    }),
  )
}

const FLIPS_SCALE = new Set(["box", "ellipse", "polygon", "pdf", "iframe", "logseq-portal"])

const scaleOf = (item: Item): Vec => vecIn(shapeRaw(item.block)["scale"]) ?? [1, 1]

export const flip = (
  scene: Scene,
  ids: readonly BlockId[],
  direction: Flip,
): readonly Command[] => {
  const units = unitsOf(scene, ids)
  const common = union(units.map(({ bounds }) => bounds))

  if (units.length < 2 || common === null) {
    return []
  }

  return placed(
    scene,
    units.map((unit): readonly [Unit, Vec] => [
      unit,
      direction === "horizontal"
        ? [common.minX + (common.maxX - unit.bounds.maxX), unit.bounds.minY]
        : [unit.bounds.minX, common.minY + (common.maxY - unit.bounds.maxY)],
    ]),
    (unit) => {
      const item = scene.byId.get(unit.id)

      if (item === undefined) {
        return {}
      }

      const type = item.shape.type === "unsupported" ? item.shape.kind : item.shape.type

      if (!FLIPS_SCALE.has(type)) {
        return {}
      }

      const [sx, sy] = scaleOf(item)

      return { scale: direction === "horizontal" ? [-sx, 1] : [1, -sy] }
    },
  )
}
