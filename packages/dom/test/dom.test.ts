import { BlockId, PageId } from "@seqno/domain"
import { describe, expect, it } from "vitest"
import { logseq, names, refsSelf } from "../src/index.ts"

const blockId = BlockId.make("01920000-0000-7000-8000-000000000001")

describe("logseq", () => {
  it("puts the seqno name first, then Logseq's names, id and attributes", () => {
    expect(logseq("seqno-bullet", { blockId, folded: true, numbered: true })).toEqual({
      className: "seqno-bullet bullet-container bullet-closed as-order-list typed-list",
      id: "dot-01920000-0000-7000-8000-000000000001",
      blockid: "01920000-0000-7000-8000-000000000001",
    })
    expect(logseq("seqno-bullet", { blockId, folded: false, numbered: false }).className).toBe(
      "seqno-bullet bullet-container",
    )
  })

  it("names a block row as Logseq does", () => {
    const block = {
      id: blockId,
      pageId: PageId.make("01920000-0000-7000-8000-0000000000aa"),
      parentId: null,
      text: "TODO water the [[projects/greenhouse]] #design",
      collapsed: true,
      props: {},
    }
    expect(
      logseq("seqno-row", {
        block,
        level: 2,
        hasChildren: true,
        childRefs: '["ana"]',
        folded: true,
        selected: false,
      }),
    ).toEqual({
      className: "seqno-row ls-block 01920000-0000-7000-8000-000000000001",
      id: "ls-block-01920000-0000-7000-8000-000000000001",
      blockid: "01920000-0000-7000-8000-000000000001",
      "data-refs": '["ana"]',
      level: 2,
      haschild: "true",
      "data-refs-self": '["todo", "projects/greenhouse", "projects", "design"]',
      "data-collapsed": true,
    })
  })
})

describe("palette and page menu", () => {
  it("name the palette, its search box and the page title's menu as Logseq's cmdk and context menu", () => {
    expect(logseq("seqno-palette").className).toBe(
      "seqno-palette ui__modal-panel cp__cmdk__modal cp__cmdk",
    )
    expect(logseq("seqno-palette-search")).toEqual({
      className: "seqno-palette-search",
      id: "search",
    })
    expect(logseq("seqno-page-menu")).toEqual({
      className: "seqno-page-menu menu-links-wrapper",
      id: "custom-context-menu",
    })
  })
})

describe("names", () => {
  it("joins the tokens that are set", () => {
    expect(names("a", false, null, undefined, "", "b")).toBe("a b")
  })
})

describe("refsSelf", () => {
  it("lists marker, priority, refs with namespace parents and visible property keys", () => {
    expect(
      refsSelf("DONE [#A] see ((6512bd43-d9ca-4f3e-9a2b-000000000001))\nowner:: [[Ana]]"),
    ).toBe('["done", "a", "6512bd43-d9ca-4f3e-9a2b-000000000001", "ana", "owner"]')
  })
})

describe("plugin names", () => {
  it("names a plugin's fenced code renderer as Logseq's hook-ui-fenced-code does", () => {
    expect(
      [
        logseq("seqno-fenced-code", true),
        logseq("seqno-fenced-code", false),
        logseq("seqno-fenced-code-source"),
        logseq("seqno-fenced-code-result", false),
        logseq("seqno-fenced-code-result", true),
        logseq("seqno-fenced-code-actions"),
        logseq("seqno-fenced-code-action"),
      ].map((made) => made.className),
    ).toEqual([
      "seqno-fenced-code ui-fenced-code-wrap is-active",
      "seqno-fenced-code ui-fenced-code-wrap",
      "seqno-fenced-code-source ui-fenced-code-editor",
      "seqno-fenced-code-result ui-fenced-code-result not-edit",
      "seqno-fenced-code-result ui-fenced-code-result",
      "seqno-fenced-code-actions actions",
      "seqno-fenced-code-action ui__button",
    ])
  })
})
