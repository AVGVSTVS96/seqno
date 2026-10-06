import { assert, describe, it } from "@effect/vitest"
import { BlockId, PageId, type Block, type Page } from "@seqno/domain"
import {
  crumbLabel,
  groupByPage,
  listValues,
  outermost,
  pageRows,
  timestamp,
  trailOf,
  visibleProps,
  visibleRows,
} from "../src/ui/pages/model.ts"
import { groupsOf, highlight } from "../src/ui/search/model.ts"

const pageId = (n: number) => PageId.make(`01920000-0000-7000-8000-1${String(n).padStart(11, "0")}`)
const blockId = (n: number) =>
  BlockId.make(`01920000-0000-7000-8000-2${String(n).padStart(11, "0")}`)

const pageOf = (n: number, title: string, journalDay: number | null = null): Page => ({
  id: pageId(n),
  name: title.toLowerCase(),
  title,
  journalDay,
  props: {},
})

const blockOf = (n: number, page: number, text: string, parent: number | null = null): Block => ({
  id: blockId(n),
  pageId: pageId(page),
  parentId: parent === null ? null : blockId(parent),
  text,
  collapsed: false,
  props: {},
})

const garden = pageOf(1, "Garden Plan")
const reading = pageOf(2, "Reading List")
const today = pageOf(3, "Oct 6th, 2026", 20261006)

describe("linked references", () => {
  it("groups references by page in the order the core sent them", () => {
    assert.deepStrictEqual(
      groupByPage([
        { blockId: blockId(1), pageId: today.id },
        { blockId: blockId(2), pageId: garden.id },
        { blockId: blockId(3), pageId: today.id },
      ]),
      [
        { pageId: today.id, blockIds: [blockId(1), blockId(3)] },
        { pageId: garden.id, blockIds: [blockId(2)] },
      ],
    )
  })

  it("walks a block's parents for its breadcrumb and drops blocks inside other hits", () => {
    const blocks = [
      blockOf(1, 2, "Books to finish"),
      blockOf(2, 2, "*Soil Science*, borrowed", 1),
      blockOf(3, 2, "due back on [[Oct 20th, 2026]]", 2),
    ]
    const trail = trailOf(blocks)
    assert.deepStrictEqual(
      trail(blockId(3)).map((block) => crumbLabel(block.text)),
      ["Books to finish", "*Soil Science*, borrowed"],
    )
    assert.deepStrictEqual(outermost([blockId(3), blockId(1)], trail), [blockId(1)])
  })

  it("strips markup from breadcrumb labels and keeps the first line", () => {
    assert.strictEqual(
      crumbLabel("## Move into [[projects/Greenhouse]]\nsecond"),
      "Move into projects/Greenhouse",
    )
    assert.strictEqual(
      crumbLabel("**Bold** and ==marked== #[[visual check]]"),
      "Bold and marked #visual check",
    )
  })
})

describe("all pages", () => {
  const rows = pageRows(
    [reading, garden, today],
    [
      { pageId: garden.id, backlinks: 3, created: 1_000, updated: 9_000 },
      { pageId: today.id, backlinks: 0, created: 2_000, updated: 5_000 },
    ],
  )

  it("sorts by a column, filters by title and hides journals on request", () => {
    const titles = (
      sort: "title" | "backlinks" | "updated",
      descending: boolean,
      journals = true,
    ) =>
      visibleRows(rows, { sort: { column: sort, descending }, filter: "", journals }).map(
        (row) => row.page.title,
      )
    assert.deepStrictEqual(titles("title", false), ["Garden Plan", "Oct 6th, 2026", "Reading List"])
    assert.deepStrictEqual(titles("updated", true), [
      "Garden Plan",
      "Oct 6th, 2026",
      "Reading List",
    ])
    assert.deepStrictEqual(titles("backlinks", true, false), ["Garden Plan", "Reading List"])
    assert.deepStrictEqual(
      visibleRows(rows, {
        sort: { column: "title", descending: false },
        filter: " PLAN ",
        journals: true,
      }).map((row) => row.page.title),
      ["Garden Plan"],
    )
  })

  it("prints times as Logseq does and leaves pages without blocks blank", () => {
    assert.strictEqual(timestamp(new Date(2026, 9, 6, 9, 5).getTime()), "2026-10-06 09:05")
    assert.strictEqual(timestamp(null), "")
  })
})

describe("page properties", () => {
  it("hides Logseq's bookkeeping properties and splits list values", () => {
    assert.deepStrictEqual(
      visibleProps({
        alias: "Allotment",
        favorite: "true",
        "logseq.order-list-type": "number",
        plot: "14B",
      }),
      [
        ["alias", "Allotment"],
        ["plot", "14B"],
      ],
    )
    assert.deepStrictEqual(listValues("[[design]], #fixtures, , visual check"), [
      "design",
      "fixtures",
      "visual check",
    ])
  })
})

describe("search palette", () => {
  it("marks every query word wherever it appears, ignoring case", () => {
    assert.deepStrictEqual(
      highlight("Seed orders go on the [[Seed Inventory]] page.", "seed inv"),
      [
        { text: "Seed", mark: true },
        { text: " orders go on the [[", mark: false },
        { text: "Seed", mark: true },
        { text: " ", mark: false },
        { text: "Inv", mark: true },
        { text: "entory]] page.", mark: false },
      ],
    )
  })

  it("offers to create a missing page, lists nodes with their page and recent pages", () => {
    const groups = groupsOf({
      query: "gar",
      hits: {
        pages: [garden],
        blocks: [blockOf(7, 2, "for the Garden Plan", 6)],
        ancestors: [blockOf(6, 2, "**Books** to finish")],
      },
      pages: [garden, reading, today],
      stats: [
        { pageId: garden.id, backlinks: 3, created: 1, updated: 2 },
        { pageId: reading.id, backlinks: 1, created: 1, updated: 3 },
      ],
      expanded: new Set(),
    })
    assert.deepStrictEqual(
      groups.map((group) => [
        group.title,
        group.items.map((item) =>
          item._tag === "Create"
            ? `create ${item.title}`
            : item._tag === "Page"
              ? `page ${item.page.title}`
              : `block ${item.crumbs.join(" / ")}: ${item.block.text}`,
        ),
      ]),
      [
        [null, ["create gar"]],
        [
          "Nodes",
          ["page Garden Plan", "block Reading List / Books to finish: for the Garden Plan"],
        ],
        ["Recently updated", ["page Garden Plan"]],
      ],
    )
  })

  it("skips Create when the query names a page or an alias, and caps recent pages at five", () => {
    const pages = [
      { ...garden, props: { alias: "Allotment" } },
      ...[4, 5, 6, 7, 8, 9].map((n) => pageOf(n, `Page ${n}`)),
    ]
    const groups = groupsOf({
      query: "allotment",
      hits: { pages: [], blocks: [], ancestors: [] },
      pages,
      stats: pages.map((page, at) => ({ pageId: page.id, backlinks: 0, created: 0, updated: at })),
      expanded: new Set(),
    })
    assert.deepStrictEqual(groups, [])
    const recent = groupsOf({
      query: "",
      hits: { pages: [], blocks: [], ancestors: [] },
      pages,
      stats: pages.map((page, at) => ({ pageId: page.id, backlinks: 0, created: 0, updated: at })),
      expanded: new Set(),
    })
    assert.deepStrictEqual(
      recent.map((group) => [group.title, group.total, group.items.length]),
      [["Recently updated", 7, 5]],
    )
  })
})
