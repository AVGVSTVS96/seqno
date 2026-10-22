import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import {
  BlockId,
  PageId,
  isWhiteboard,
  otherShapeOf,
  patchShape,
  portalTarget,
  portalText,
  shapeOf,
  shapeProps,
  type Block,
} from "@seqno/domain"

const shapeBlock = (raw: Readonly<Record<string, unknown>>, text = ""): Block => ({
  id: BlockId.make("01920000-0000-7000-8000-000000000001"),
  pageId: PageId.make("01920000-0000-7000-8000-0000000000aa"),
  parentId: null,
  text,
  collapsed: false,
  props: shapeProps(raw),
})

describe("whiteboard shapes", () => {
  it("reads a box from its block's properties", () => {
    const block = shapeBlock({ type: "box", point: [10, 20], size: [100, 50], fill: "red" })
    assert.deepStrictEqual(block.props, {
      "ls-type": "whiteboard-shape",
      "logseq.tldraw.shape": '{"type":"box","point":[10,20],"size":[100,50],"fill":"red"}',
    })
    assert.deepStrictEqual(
      shapeOf(block),
      Option.some({ type: "box", point: [10, 20], size: [100, 50], fill: "red" }),
    )
  })

  it("keeps shapes seqno doesn't draw readable as their box", () => {
    const block = shapeBlock({ type: "tweet", point: [1, 2], size: [300, 200], url: "https://x" })
    assert.isTrue(Option.isNone(shapeOf(block)))
    assert.deepStrictEqual(
      otherShapeOf(block),
      Option.some({ type: "tweet", point: [1, 2], size: [300, 200], url: "https://x" }),
    )
  })

  it("patches a shape without losing fields seqno doesn't know", () => {
    const block = shapeBlock({ type: "text", point: [0, 0], size: [10, 10], lineHeight: 1.2 })
    assert.strictEqual(
      patchShape(block, { point: [5, 6] }),
      '{"type":"text","point":[5,6],"size":[10,10],"lineHeight":1.2}',
    )
  })

  it("reads a portal's page or block from its text", () => {
    assert.deepStrictEqual(
      portalTarget("[[Project X]]"),
      Option.some({ _tag: "PagePortal", name: "Project X" }),
    )
    assert.deepStrictEqual(
      portalTarget("((6334A1B2-0000-4000-8000-000000000001))"),
      Option.some({ _tag: "BlockPortal", uuid: "6334a1b2-0000-4000-8000-000000000001" }),
    )
    assert.deepStrictEqual(portalTarget("plain words"), Option.none())
    assert.strictEqual(portalText({ _tag: "PagePortal", name: "Inbox" }), "[[Inbox]]")
  })

  it("knows a whiteboard page by its ls-type", () => {
    const page = {
      id: PageId.make("01920000-0000-7000-8000-0000000000aa"),
      name: "board",
      title: "Board",
      journalDay: null,
    }
    assert.isTrue(isWhiteboard({ ...page, props: { "ls-type": "whiteboard-page" } }))
    assert.isFalse(isWhiteboard({ ...page, props: {} }))
  })
})
