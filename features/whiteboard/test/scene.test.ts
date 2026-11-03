import { assert, describe, it } from "vitest"
import { BlockId, PageId, shapeProps, type Block } from "@seqno/domain"
import {
  changesOf,
  fitBounds,
  itemsOf,
  remove,
  reorder,
  sceneOf,
  topHit,
  translate,
  zoomAt,
  defaultStyles,
} from "../src/index.ts"

const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")
const id = (n: number) => BlockId.make(`01920000-0000-7000-8000-${n.toString().padStart(12, "0")}`)

const block = (n: number, raw: Readonly<Record<string, unknown>>, text = ""): Block => ({
  id: id(n),
  pageId,
  parentId: null,
  text,
  collapsed: false,
  props: shapeProps(raw),
})

const box = (n: number, point: [number, number]) =>
  block(n, { type: "box", point, size: [100, 100] })

const arrow = (n: number, from: number, to: number) =>
  block(n, {
    type: "line",
    point: [0, 0],
    handles: { start: { point: [0, 0], bindTo: id(from) }, end: { point: [1, 1], bindTo: id(to) } },
  })

const sceneFrom = (blocks: ReadonlyArray<Block>) => sceneOf(itemsOf(blocks), new Map())

describe("scene", () => {
  it("clips a bound connector to both shapes' edges with a 4px gap", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [300, 0]), arrow(3, 1, 2)])
    assert.deepStrictEqual(scene.ends.get(id(3)), [
      [104, 50],
      [296, 50],
    ])
  })

  it("hits the topmost shape under the pointer", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [50, 50])])
    assert.strictEqual(topHit(scene, [60, 60], 1)?.block.id, id(2))
    assert.strictEqual(topHit(scene, [10, 10], 1)?.block.id, id(1))
    assert.strictEqual(topHit(scene, [500, 500], 1), null)
  })

  it("leaves non-shape blocks off the canvas", () => {
    const plain: Block = { ...box(1, [0, 0]), props: {} }
    assert.deepStrictEqual(sceneFrom([plain]).items, [])
  })
})

describe("camera", () => {
  it("zooms around the pointer, keeping the point under it still", () => {
    const camera = zoomAt({ x: 0, y: 0, zoom: 1 }, [100, 100], 2)
    assert.deepStrictEqual(camera, { x: -50, y: -50, zoom: 2 })
  })

  it("fits a drawing with 100px padding, never above 100%", () => {
    const camera = fitBounds(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { width: 800, height: 600 },
    )
    assert.deepStrictEqual(camera, { x: 350, y: 250, zoom: 1 })
  })
})

describe("commands", () => {
  it("moves shapes by rewriting their point, and a connector moved alone keeps the ends it was drawn with", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [300, 0]), arrow(3, 1, 2)])
    const arrowItem = scene.byId.get(id(3))
    assert.isDefined(arrowItem)
    if (arrowItem === undefined) return
    const [moved] = translate(scene, [arrowItem], [8, 16])
    assert.deepStrictEqual(moved, {
      _tag: "SetProperty",
      target: { _tag: "BlockTarget", blockId: id(3) },
      key: "logseq.tldraw.shape",
      value:
        '{"type":"line","point":[8,16],"handles":{"start":{"point":[104,50]},"end":{"point":[296,50]}}}',
    })
  })

  it("writes a bound connector's drawn ends back when its shape moves", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [300, 0]), arrow(3, 1, 2)])
    const commands = changesOf(
      pageId,
      scene,
      { _tag: "Translating", from: [0, 0], to: [0, 200], ids: [id(2)], copy: null },
      defaultStyles,
    )
    assert.deepStrictEqual(
      commands.map((command) => (command._tag === "SetProperty" ? command.value : null)),
      [
        '{"type":"box","point":[300,200],"size":[100,100]}',
        '{"type":"line","point":[0,0],"handles":{"start":{"point":[103.33,85.55],"bindTo":"01920000-0000-7000-8000-000000000001"},"end":{"point":[296.67,214.45],"bindTo":"01920000-0000-7000-8000-000000000002"}}}',
      ],
    )
  })

  it("frees connector ends where their shape is deleted", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [300, 0]), arrow(3, 1, 2)])
    assert.deepStrictEqual(remove(scene, [id(2)]), [
      {
        _tag: "SetProperty",
        target: { _tag: "BlockTarget", blockId: id(3) },
        key: "logseq.tldraw.shape",
        value:
          '{"type":"line","point":[0,0],"handles":{"start":{"point":[0,0],"bindTo":"01920000-0000-7000-8000-000000000001"},"end":{"point":[296,50]}}}',
      },
      { _tag: "DeleteBlocks", blockIds: [id(2)] },
    ])
  })

  it("brings a shape to the front by moving its block last", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [10, 0]), box(3, [20, 0])])
    assert.deepStrictEqual(reorder(scene, [id(1)], "front"), {
      _tag: "MoveBlocks",
      blockIds: [id(1)],
      parentId: null,
      after: id(3),
    })
    assert.deepStrictEqual(reorder(scene, [id(3)], "back"), {
      _tag: "MoveBlocks",
      blockIds: [id(3)],
      parentId: null,
    })
  })

  it("copies the dragged shapes when Alt is held, keeping a connector bound to a copied shape", () => {
    const scene = sceneFrom([box(1, [0, 0]), box(2, [300, 0]), arrow(3, 1, 2)])
    const [made] = changesOf(
      pageId,
      scene,
      {
        _tag: "Translating",
        from: [0, 0],
        to: [0, 200],
        ids: [id(1), id(3)],
        copy: [id(11), id(13)],
      },
      defaultStyles,
    )
    assert.deepStrictEqual(made, {
      _tag: "InsertBlocks",
      pageId,
      parentId: null,
      after: id(3),
      blocks: [
        {
          id: id(11),
          text: "",
          props: {
            "ls-type": "whiteboard-shape",
            "logseq.tldraw.shape": '{"type":"box","point":[0,200],"size":[100,100]}',
          },
          children: [],
        },
        {
          id: id(13),
          text: "",
          props: {
            "ls-type": "whiteboard-shape",
            "logseq.tldraw.shape": `{"type":"line","point":[0,200],"handles":{"start":{"point":[104,50],"bindTo":"${id(11)}"},"end":{"point":[296,50]}}}`,
          },
          children: [],
        },
      ],
    })
  })

  it("creates a dragged rectangle as a block after the topmost shape", () => {
    const scene = sceneFrom([box(1, [0, 0])])
    const [made] = changesOf(
      pageId,
      scene,
      { _tag: "Creating", tool: "box", from: [200, 150], to: [40, 0] },
      defaultStyles,
    )
    assert.deepStrictEqual(made, {
      _tag: "InsertBlocks",
      pageId,
      parentId: null,
      after: id(1),
      blocks: [
        {
          text: "",
          props: {
            "ls-type": "whiteboard-shape",
            "logseq.tldraw.shape":
              '{"type":"box","point":[40,0],"stroke":"","fill":"","strokeType":"line","opacity":1,"scaleLevel":"md","size":[160,150],"borderRadius":2,"noFill":false,"strokeWidth":2,"fontWeight":400,"italic":false}',
          },
          children: [],
        },
      ],
    })
  })
})
