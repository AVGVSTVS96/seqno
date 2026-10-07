import { expect, test } from "vitest"
import type { GraphEvent } from "@seqno/domain"
import { historyFocus, historyStep, textEnd } from "../src/history.ts"
import { block, id, pageId } from "./fake-core.ts"

const upserted = (n: number, text: string): GraphEvent => ({
  _tag: "BlockUpserted",
  block: block(n, text),
  createdAt: 1,
  updatedAt: 1,
})

const deleted = (n: number): GraphEvent => ({ _tag: "BlockDeleted", blockId: id(n), pageId })

test("puts the caret where undone typing was", () => {
  expect(historyFocus([upserted(2, "hello world")], [block(2, "hello XYZworld")])).toEqual({
    blockId: id(2),
    caret: 6,
  })
  expect(historyFocus([upserted(2, "")], [block(1, "abc"), block(2, "def")])).toEqual({
    blockId: id(2),
    caret: 0,
  })
})

test("edits the block a removed block was split from", () => {
  expect(historyFocus([upserted(1, "abc"), deleted(2)], [block(1, "abc"), block(2, "")])).toEqual({
    blockId: id(1),
    caret: textEnd,
  })
})

test("falls back to the row above when only deletions come back", () => {
  expect(historyFocus([deleted(3)], [block(1, "a"), block(2, "b"), block(3, "c")])).toEqual({
    blockId: id(2),
    caret: textEnd,
  })
  expect(historyFocus([deleted(1)], [block(1, "")])).toBe(null)
})

const press = (key: string, shiftKey = false) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey,
})

test("reads undo and redo keys whatever the shift state does to the key", () => {
  expect(
    [press("z"), press("Z", true), press("z", true), press("y"), press("x")].map(historyStep),
  ).toEqual(["Undo", "Redo", "Redo", "Redo", null])
})
