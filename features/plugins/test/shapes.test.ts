import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { BlockId, PageId, type Block, type Page } from "@seqno/domain"
import { blockJson, changedBlock, numberOf, pageJson } from "../src/shapes.ts"

const pageId = Schema.decodeUnknownSync(PageId)("019a0000-0000-7000-8000-000000000001")
const first = Schema.decodeUnknownSync(BlockId)("019a0000-0000-7000-8000-000000000002")
const child = Schema.decodeUnknownSync(BlockId)("019a0000-0000-7000-8000-000000000003")

const page: Page = { id: pageId, name: "tasks", title: "Tasks", journalDay: null, props: {} }

const blocks: ReadonlyArray<Block> = [
  {
    id: first,
    pageId,
    parentId: null,
    text: "TODO [#A] Water the beds",
    collapsed: false,
    props: { "due-date": "today" },
  },
  { id: child, pageId, parentId: first, text: "Bed 2", collapsed: false, props: {} },
]

describe("blockJson", () => {
  it("gives Logseq's file-graph block: content with property lines, marker, children as uuids", () => {
    const [top] = blocks
    if (top === undefined) throw new Error("no block")
    expect(blockJson({ page, blocks }, top, false)).toEqual({
      id: numberOf(first),
      uuid: first,
      content: "TODO [#A] Water the beds\ndue-date:: today",
      format: "markdown",
      page: { id: numberOf(pageId) },
      parent: { id: numberOf(pageId) },
      left: { id: numberOf(pageId) },
      properties: { dueDate: "today" },
      collapsed: false,
      level: 1,
      marker: "TODO",
      priority: "A",
      children: [["uuid", child]],
    })
  })
})

describe("changedBlock", () => {
  it("gives DB.onChanged's block: its marker and camelCased properties, parent by number", () => {
    const [, bed] = blocks
    if (bed === undefined) throw new Error("no block")
    expect(
      changedBlock({ ...bed, text: "DONE Bed 2", props: { "done-ms": "1762171200000" } }),
    ).toEqual({
      id: numberOf(child),
      uuid: child,
      content: "DONE Bed 2\ndone-ms:: 1762171200000",
      format: "markdown",
      page: { id: numberOf(pageId) },
      parent: { id: numberOf(first) },
      properties: { doneMs: "1762171200000" },
      marker: "DONE",
    })
  })
})

describe("pageJson", () => {
  it("names the page in lower case and keeps its title as originalName", () => {
    expect(pageJson(page)).toEqual({
      id: numberOf(pageId),
      uuid: pageId,
      name: "tasks",
      originalName: "Tasks",
      "journal?": false,
      journalDay: null,
      properties: {},
      format: "markdown",
      file: null,
    })
  })
})
