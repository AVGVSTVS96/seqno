import { assert, describe, it } from "vitest"
import { BlockId, PageId, shapeProps, type Block, type Command } from "@seqno/domain"
import {
  brushed,
  changesOf,
  defaultStyles,
  itemsOf,
  sceneOf,
  selectionBounds,
  topHit,
  type Gesture,
} from "../src/index.ts"

const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")
const id = (n: number) => BlockId.make(`01920000-0000-7000-8000-${n.toString().padStart(12, "0")}`)

const block = (n: number, raw: Readonly<Record<string, unknown>>): Block => ({
  id: id(n),
  pageId,
  parentId: null,
  text: "",
  collapsed: false,
  props: shapeProps(raw),
})

const sceneFrom = (blocks: ReadonlyArray<Block>) => sceneOf(itemsOf(blocks), new Map())

const shapes = (commands: ReadonlyArray<Command>): ReadonlyArray<Record<string, unknown>> =>
  commands.flatMap((command) =>
    command._tag === "SetProperty" && command.value !== null ? [JSON.parse(command.value)] : [],
  )

const rotating = (
  ids: ReadonlyArray<BlockId>,
  pivot: readonly [number, number],
  start: readonly [number, number],
  to: readonly [number, number],
  snap = false,
): Gesture => ({
  _tag: "Rotating",
  corner: "top-right",
  ids,
  pivot,
  from: start,
  start,
  to,
  snap,
})

describe("rotation", () => {
  it("turns one shape about its own center, keeping its point", () => {
    const scene = sceneFrom([block(1, { type: "box", point: [0, 0], size: [100, 100] })])
    const [shape] = shapes(
      changesOf(pageId, scene, rotating([id(1)], [50, 50], [150, 50], [50, 150]), defaultStyles),
    )
    assert.deepInclude(shape, { point: [0, 0], rotation: Math.PI / 2 })
  })

  it("with Shift, snaps the turn and the starting angle to 15 degrees", () => {
    const scene = sceneFrom([
      block(1, { type: "box", point: [0, 0], size: [100, 100], rotation: 0.1 }),
    ])
    const fifty = (50 * Math.PI) / 180
    const to = [50 + 100 * Math.cos(fifty), 50 + 100 * Math.sin(fifty)] as const
    const [shape] = shapes(
      changesOf(pageId, scene, rotating([id(1)], [50, 50], [150, 50], to, true), defaultStyles),
    )
    assert.closeTo(Number(shape?.["rotation"]), Math.PI / 4, 1e-12)
  })

  it("turns several shapes about their common center, each orbiting it", () => {
    const scene = sceneFrom([
      block(1, { type: "box", point: [0, 0], size: [100, 100] }),
      block(2, { type: "box", point: [200, 0], size: [100, 100] }),
    ])
    const moved = shapes(
      changesOf(
        pageId,
        scene,
        rotating([id(1), id(2)], [150, 50], [300, 50], [0, 50.000001]),
        defaultStyles,
      ),
    )
    assert.deepInclude(moved[0], { point: [200, 0] })
    assert.deepInclude(moved[1], { point: [0, 0] })
  })

  it("resizes a rotated shape along its own axes, pinning the opposite edge", () => {
    const scene = sceneFrom([
      block(1, { type: "box", point: [0, 0], size: [200, 100], rotation: Math.PI / 2 }),
    ])
    const gesture: Gesture = {
      _tag: "Resizing",
      handle: "right",
      from: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      to: [100, 250],
      ids: [id(1)],
      keepRatio: false,
      rotation: Math.PI / 2,
    }
    const [shape] = shapes(changesOf(pageId, scene, gesture, defaultStyles))
    assert.deepInclude(shape, { point: [-50, 50], size: [300, 100] })
  })

  it("hits, brushes and boxes a rotated shape by where it is drawn", () => {
    const scene = sceneFrom([
      block(1, { type: "box", point: [0, 0], size: [200, 20], rotation: Math.PI / 2 }),
      block(2, { type: "box", point: [400, 0], size: [10, 10] }),
    ])
    assert.strictEqual(topHit(scene, [100, 100], 1)?.block.id, id(1))
    assert.strictEqual(topHit(scene, [190, 10], 1), null)
    const brush = (from: readonly [number, number], to: readonly [number, number]) =>
      brushed(scene, { _tag: "Brushing", from, to, keep: [] })
    assert.deepStrictEqual(brush([80, 60], [120, 80]), [id(1)])
    assert.deepStrictEqual(brush([150, 0], [190, 15]), [])
    const box = selectionBounds(scene, [id(1), id(2)])
    assert.closeTo(box?.minY ?? 0, -90, 1e-9)
    assert.closeTo(box?.maxY ?? 0, 110, 1e-9)
  })

  it("stops a bound connector at the rotated edge, 4px out", () => {
    const scene = sceneFrom([
      block(1, { type: "box", point: [0, 0], size: [100, 100], rotation: Math.PI / 4 }),
      block(2, { type: "box", point: [400, 0], size: [100, 100] }),
      block(3, {
        type: "line",
        point: [0, 0],
        handles: {
          start: { point: [0, 0], bindTo: id(1) },
          end: { point: [1, 1], bindTo: id(2) },
        },
      }),
    ])
    const [start] = scene.ends.get(id(3)) ?? []
    assert.closeTo(start?.[0] ?? 0, 50 + 50 * Math.SQRT2 + 4, 1e-9)
    assert.closeTo(start?.[1] ?? 0, 50, 1e-9)
  })
})
