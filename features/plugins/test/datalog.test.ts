import { Order, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { BlockId, PageId } from "@seqno/domain"
import type { Block, Page } from "@seqno/domain"
import { createLogseqDb, readEdn } from "../src/datalog.ts"
import type { Plain } from "../src/datalog.ts"
import { keywordInput, resolveInput } from "../src/inputs.ts"
import type { InputContext } from "../src/inputs.ts"
import { numberOf } from "../src/shapes.ts"

const pageId = (n: number) =>
  Schema.decodeUnknownSync(PageId)(
    `0190a000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`,
  )

const blockId = (n: number) =>
  Schema.decodeUnknownSync(BlockId)(
    `0190b000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`,
  )

const page = (n: number, title: string, props: Record<string, string> = {}): Page => ({
  id: pageId(n),
  name: title.toLowerCase(),
  title,
  journalDay: null,
  props,
})

const block = (
  n: number,
  on: Page,
  text: string,
  parent: number | null = null,
  props: Record<string, string> = {},
): Block => ({
  id: blockId(n),
  pageId: on.id,
  parentId: parent === null ? null : blockId(parent),
  text,
  collapsed: false,
  props,
})

const garden = page(1, "Garden", { tags: "plants" })
const notes = page(2, "Notes")

const files = [
  {
    page: garden,
    path: "pages/Garden.md",
    blocks: [
      block(1, garden, "TODO water the [[Tomatoes]] #outside"),
      block(2, garden, "check the soil", 1, { id: "6650a1b2-0000-4000-8000-000000000001" }),
      block(3, garden, "DONE plant beans", null, { "sown-on": "[[May 1st, 2026]]" }),
    ],
  },
  {
    page: notes,
    path: "pages/Notes.md",
    blocks: [block(4, notes, "see ((6650a1b2-0000-4000-8000-000000000001))")],
  },
]

const byJson = Order.mapInput(Order.String, (row: Plain) => JSON.stringify(row))

const sorted = (rows: Plain) => (Array.isArray(rows) ? rows.toSorted(byJson) : rows)

describe(createLogseqDb, () => {
  const db = createLogseqDb(files)

  it("answers a pull with an :in input in Logseq's file-graph keys", () => {
    expect(
      db.query(
        "[:find (pull ?b [:block/content :block/marker {:block/page [:block/original-name]}]) :in $ ?name :where [?p :block/name ?name] [?b :block/page ?p] [?b :block/marker]]",
        ["garden"],
      ),
    ).toEqual([
      [
        {
          content: "TODO water the [[Tomatoes]] #outside",
          marker: "TODO",
          page: { "original-name": "Garden" },
        },
      ],
      [
        {
          content: "DONE plant beans\nsown-on:: [[May 1st, 2026]]",
          marker: "DONE",
          page: { "original-name": "Garden" },
        },
      ],
    ])
  })

  it("finds tuples, scalars, aggregates and collection inputs", () => {
    expect(
      sorted(
        db.query(
          '[:find ?content ?ref :where [?b :block/content ?content] [?b :block/refs ?r] [?r :block/original-name ?ref] [(clojure.string/starts-with? ?content "TODO")]]',
          [],
        ),
      ),
    ).toEqual([
      ["TODO water the [[Tomatoes]] #outside", "TODO"],
      ["TODO water the [[Tomatoes]] #outside", "Tomatoes"],
      ["TODO water the [[Tomatoes]] #outside", "outside"],
    ])
    expect(db.query("[:find (count ?b) . :where [?b :block/content]]", [])).toBe(4)
    expect(
      db.query(
        "[:find [?c ...] :in $ [?m ...] :where [?b :block/marker ?m] [?b :block/content ?c]]",
        [["TODO", "DOING"]],
      ),
    ).toEqual(["TODO water the [[Tomatoes]] #outside"])
  })

  it("keeps a Logseq id:: as the block's uuid, so ((refs)) and #uuid literals reach it", () => {
    expect(
      db.query(
        '[:find ?c . :where [?b :block/uuid #uuid "6650a1b2-0000-4000-8000-000000000001"] [?b :block/content ?c]]',
        [],
      ),
    ).toBe("check the soil\nid:: 6650a1b2-0000-4000-8000-000000000001")
    expect(
      db.query(
        '[:find ?c . :where [?t :block/uuid #uuid "6650a1b2-0000-4000-8000-000000000001"] [?b :block/refs ?t] [?b :block/content ?c]]',
        [],
      ),
    ).toBe("see ((6650a1b2-0000-4000-8000-000000000001))")
  })

  it("gives children their parents' refs as path-refs, and typed properties", () => {
    expect(
      sorted(
        db.query(
          '[:find [?n ...] :where [?b :block/content "check the soil\\nid:: 6650a1b2-0000-4000-8000-000000000001"] [?b :block/path-refs ?p] [?p :block/name ?n]]',
          [],
        ),
      ),
    ).toEqual(["garden", "outside", "todo", "tomatoes"])
    expect(
      db.query("[:find ?v . :where [?b :block/properties ?props] [(get ?props :sown-on) ?v]]", []),
    ).toEqual(["May 1st, 2026"])
    expect(
      db.query(
        '[:find ?t . :where [?p :block/name "garden"] [?p :block/tags ?tag] [?tag :block/name ?t]]',
        [],
      ),
    ).toBe("plants")
  })

  it("updates one page in place, keeping refs from other pages to its blocks", () => {
    const [first] = files

    if (first === undefined) {
      return
    }

    db.update([
      {
        page: first.page,
        blocks: [
          block(1, garden, "DOING water the [[Tomatoes]]"),
          block(2, garden, "check the soil", 1, { id: "6650a1b2-0000-4000-8000-000000000001" }),
        ],
      },
    ])
    expect(db.query("[:find [?m ...] :where [?b :block/marker ?m]]", [])).toEqual(["DOING"])
    expect(
      db.query(
        '[:find ?c . :where [?t :block/uuid #uuid "6650a1b2-0000-4000-8000-000000000001"] [?b :block/refs ?t] [?b :block/content ?c]]',
        [],
      ),
    ).toBe("see ((6650a1b2-0000-4000-8000-000000000001))")
    expect(
      db.query('[:find ?b . :where [?b :block/content "DOING water the [[Tomatoes]]"]]', []),
    ).toBe(numberOf(blockId(1)))
  })
})

describe(resolveInput, () => {
  const context: InputContext = {
    now: new Date(2026, 10, 3, 15, 30),
    currentPage: "Garden",
    currentBlock: { eid: 7, parent: 3, page: "notes" },
  }

  const resolve = resolveInput(context, (text) => readEdn([text])[0])

  it("resolves Logseq's keyword inputs", () => {
    expect(resolve(":today")).toBe(20_261_103)
    expect(resolve(":-7d")).toBe(20_261_027)
    expect(resolve(":+1m")).toBe(20_261_203)
    expect(resolve(":7d-before")).toBe(20_261_027)
    expect(resolve(":current-page")).toBe("garden")
    expect(resolve(":current-block")).toBe(7)
    expect(keywordInput("today-1200", context)).toBe(new Date(2026, 10, 3, 12).getTime())
    expect(keywordInput("-1d-end", context)).toBe(new Date(2026, 10, 2, 23, 59, 59, 999).getTime())
  })

  it("reads other strings as EDN, page refs as their lower-case name, and passes the rest", () => {
    expect(resolve('"[[Tomatoes]]"')).toBe("tomatoes")
    expect(resolve('"plain"')).toBe("plain")
    expect(resolve(5)).toBe(5)
  })
})
