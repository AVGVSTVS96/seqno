import { assert, describe, it } from "vitest"
import { BlockId, PageId, shapeProps } from "@seqno/domain"
import type { Block } from "@seqno/domain"
import { clipboardHtml, copiedOf, readClipboard } from "../src/clipboard.ts"
import { clones, copiesAt } from "../src/commands.ts"
import { freshId } from "../src/ids.ts"
import { itemsOf, sceneOf } from "../src/model.ts"

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

const shapeOf = (raw: Readonly<Record<string, unknown>>) => JSON.stringify(raw)

describe("clipboard", () => {
  it("carries copied shapes, their words and the bindings between them in Logseq's format", () => {
    const blocks = [
      block(1, { type: "box", point: [0, 0], size: [100, 100], id: "old", index: 3 }, "Plan"),
      block(2, { type: "box", point: [300, 0], size: [100, 100] }),
      block(
        3,
        {
          type: "line",
          point: [0, 0],
          handles: {
            start: { point: [0, 0], bindTo: id(1), bindingId: "stale" },
            end: { point: [1, 1], bindTo: id(2) },
          },
        },
        "to do",
      ),
      block(4, { type: "logseq-portal", point: [0, 200], size: [400, 320] }, "[[Harvest log]]"),
    ]

    const scene = sceneOf(itemsOf(blocks), new Map())

    const copied = copiedOf(
      scene,
      scene.items.filter((item) => item.block.id !== id(2)),
    )

    const html = clipboardHtml(copied)
    const inner = decodeURIComponent(html)
    assert.match(inner, /^<whiteboard-tldr>.*<\/whiteboard-tldr>$/u)
    assert.include(inner, '"label":"Plan"')
    assert.include(inner, '"blockType":"P","pageId":"Harvest log"')

    const pasted = clones(readClipboard(html), [10, 10], [id(11), id(13), id(14)])
    assert.deepStrictEqual(
      pasted.map((draft) => [draft.id, draft.text]),
      [
        [id(11), "Plan"],
        [id(13), "to do"],
        [id(14), "[[Harvest log]]"],
      ],
    )
    assert.strictEqual(
      shapeOf(pasted[0]?.raw ?? {}),
      '{"type":"box","point":[10,10],"size":[100,100]}',
    )
    assert.strictEqual(
      shapeOf(pasted[1]?.raw ?? {}),
      `{"type":"line","point":[10,10],"handles":{"start":{"id":"start","canBind":true,"point":[104,50],"bindTo":"${id(11)}"},"end":{"id":"end","canBind":true,"point":[296,50]}}}`,
    )
  })

  it("reads shapes copied in Logseq, through the page wrapper a browser adds", () => {
    const tldr = {
      shapes: [
        { id: "a", type: "text", text: "Hello", point: [40, 60], size: [80, 20], index: 1 },
        {
          id: "l",
          type: "line",
          label: "",
          point: [0, 0],
          handles: {
            start: { id: "start", canBind: true, point: [0, 0], bindingId: "b1" },
            end: { id: "end", canBind: true, point: [50, 50], bindingId: "b2" },
          },
        },
      ],
      assets: [],
      bindings: {
        b1: { id: "b1", type: "line", fromId: "l", toId: "a", handleId: "start" },
        b2: { id: "b2", type: "line", fromId: "l", toId: "elsewhere", handleId: "end" },
      },
    }

    const html = `<meta charset="utf-8">${encodeURIComponent(`<whiteboard-tldr>${JSON.stringify(tldr)}</whiteboard-tldr>`)}`
    const copied = readClipboard(html)
    const pasted = clones(copied, copiesAt(copied, [100, 100]), [id(21), id(22)])
    assert.deepStrictEqual(
      pasted.map((draft) => [draft.text, shapeOf(draft.raw)]),
      [
        ["Hello", '{"type":"text","point":[140,160],"size":[80,20]}'],
        [
          "",
          `{"type":"line","point":[100,100],"handles":{"start":{"id":"start","canBind":true,"point":[0,0],"bindTo":"${id(21)}"},"end":{"id":"end","canBind":true,"point":[50,50]}}}`,
        ],
      ],
    )
    assert.deepStrictEqual(readClipboard("<b>not a board</b>"), [])
  })

  it("makes UUIDv7 ids that sort by time", () => {
    const early = freshId(1_700_000_000_000)
    const late = freshId(1_700_000_000_001)
    assert.match(early, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    assert.isTrue(early < late)
  })
})
