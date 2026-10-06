import { DatabaseSync } from "node:sqlite"
import { Result } from "effect"
import { describe, expect, it } from "vitest"
import {
  compileQuery,
  parseDataviewQuery,
  parseLogseqQuery,
  SCHEMA,
  type Query,
  type QueryContext,
} from "../src/index.ts"

interface PageRow {
  readonly name: string
  readonly day: number | null
  readonly aliases?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly props?: ReadonlyArray<readonly [string, string]>
}

interface BlockRow {
  readonly id: string
  readonly page: number
  readonly parent?: string
  readonly content: string
  readonly task?: {
    readonly status: string | null
    readonly priority?: string
    readonly deadline?: number
  }
  readonly refs?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly props?: ReadonlyArray<readonly [string, string]>
  readonly updated?: number
}

const OLD = Date.UTC(2026, 8, 1)
const TODAY = 20261006

const PAGES: ReadonlyArray<PageRow> = [
  { name: "Projects/Alpha", day: null, tags: ["work"], props: [["type", "project"]] },
  { name: "Database", day: null, aliases: ["db"] },
  { name: "Oct 5th, 2026", day: 20261005 },
  { name: "Oct 1st, 2026", day: 20261001 },
]

const BLOCKS: ReadonlyArray<BlockRow> = [
  {
    id: "spec",
    page: 1,
    content: "TODO write spec [[Database]]",
    task: { status: "todo" },
    refs: ["database"],
  },
  {
    id: "draft",
    page: 1,
    parent: "spec",
    content: "DOING draft schema",
    task: { status: "doing" },
  },
  {
    id: "review",
    page: 1,
    parent: "draft",
    content: "TODO review indexes",
    task: { status: "todo" },
  },
  {
    id: "ship",
    page: 3,
    content: "NOW [#A] ship release #database",
    task: { status: "now", priority: "a" },
    refs: ["database"],
    tags: ["database"],
  },
  { id: "notes", page: 3, content: "notes about deploy", updated: Date.UTC(2026, 9, 5, 12) },
  {
    id: "fix",
    page: 4,
    content: "DONE deploy fix\nDEADLINE: <2026-10-08 Thu>",
    task: { status: "done", deadline: 20261008 },
  },
  { id: "rating", page: 2, content: "rating:: 5", props: [["rating", "5"]] },
  { id: "call", page: 4, content: "TODO call [[DB]]", task: { status: "todo" }, refs: ["db"] },
]

const numeric = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : null)

const open = () => {
  const db = new DatabaseSync(":memory:")
  db.exec(SCHEMA)
  PAGES.forEach((p, i) => {
    const rid = i + 1
    const name = p.name.toLowerCase()
    db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?, ?)").run(
      rid,
      `page-${rid}`,
      p.name,
      name,
      p.day,
    )
    db.prepare("INSERT INTO page_names VALUES (?, ?, 0)").run(name, rid)
    for (const a of p.aliases ?? [])
      db.prepare("INSERT INTO page_names VALUES (?, ?, 1)").run(a, rid)
    for (const t of p.tags ?? []) db.prepare("INSERT INTO page_tags VALUES (?, ?)").run(rid, t)
    const parts = name.split("/")
    for (let n = 1; n < parts.length; n++)
      db.prepare("INSERT INTO page_ns VALUES (?, ?)").run(rid, parts.slice(0, n).join("/"))
    for (const [k, v] of p.props ?? [])
      db.prepare("INSERT INTO page_props VALUES (?, ?, ?, ?)").run(rid, k, v, numeric(v))
  })
  BLOCKS.forEach((b, i) => {
    const rid = i + 1
    const parent = b.parent === undefined ? null : BLOCKS.findIndex((x) => x.id === b.parent) + 1
    db.prepare("INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      rid,
      b.id,
      b.page,
      parent,
      b.content,
      OLD,
      b.updated ?? OLD,
    )
    db.prepare("INSERT INTO fts(rowid, content) VALUES (?, ?)").run(rid, b.content)
    if (b.task) {
      db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)").run(
        rid,
        b.task.status,
        b.task.priority ?? null,
        null,
        b.task.deadline ?? null,
      )
    }
    for (const r of b.refs ?? [])
      db.prepare("INSERT INTO refs VALUES (?, ?, ?)").run(rid, r, b.tags?.includes(r) ? 1 : 0)
    for (const [k, v] of b.props ?? [])
      db.prepare("INSERT INTO props VALUES (?, ?, ?, ?)").run(rid, k, v, numeric(v))
  })
  return db
}

const db = open()

const label = (q: Query, rid: unknown) =>
  q.find === "blocks" ? BLOCKS[Number(rid) - 1]?.id : PAGES[Number(rid) - 1]?.name

const rows = (parsed: Result.Result<Query, unknown>, ctx: QueryContext = { today: TODAY }) => {
  const query = Result.getOrThrow(parsed)
  const compiled = Result.getOrThrow(compileQuery(query, ctx))
  return db
    .prepare(compiled.sql)
    .all(...compiled.params)
    .map((row) => {
      const [rid, ...shown] = Object.values(row)
      return [label(query, rid), ...shown]
    })
}

const ids = (text: string, ctx?: QueryContext) =>
  rows(parseLogseqQuery(text), ctx).map(([id]) => id)

describe("compiled SQL returns the right blocks from a real SQLite index", () => {
  it.each([
    ["tasks by status", "(task todo)", ["call", "spec", "review"]],
    [
      "negated recursive ancestor",
      "(and (task todo) (not (under (task doing))))",
      ["call", "spec"],
    ],
    [
      "page reference matches aliases and nested blocks",
      "[[Database]]",
      ["ship", "call", "spec", "draft", "review"],
    ],
    ["journal day window", "(between -7d today)", ["ship", "notes", "fix", "call"]],
    ["property value", "(property rating 5)", ["rating"]],
    ["numeric property comparison", "(property rating > 3)", ["rating"]],
    ["numeric property comparison that misses", "(property rating > 7)", []],
    ["full text", '"deploy"', ["notes", "fix"]],
    ["full text without a task", '(and "deploy" (not (task.status)))', ["notes"]],
    ["deadline in the next week", "(between task.deadline today +7d)", ["fix"]],
    ["updated since yesterday", "(updated >= -1d)", ["notes"]],
    [
      "sort with nulls last, then limit",
      "(and (task todo doing now) (sort-by priority asc) (limit 2))",
      ["ship", "call"],
    ],
    ["tag", "(tag database)", ["ship"]],
  ])("%s", (_, text, expected) => expect(ids(text)).toEqual(expected))

  it("pages queries return pages", () => {
    expect(ids("(page-tags work)")).toEqual(["Projects/Alpha"])
    expect(ids("(pages (namespace projects))")).toEqual(["Projects/Alpha"])
    expect(ids("(pages (has-block (task now)))")).toEqual(["Oct 5th, 2026"])
    expect(ids("(page-property type project)")).toEqual(["Projects/Alpha"])
  })

  it("@page and @block resolve from the context", () => {
    expect(ids("(and (ref @page) (task todo))", { today: TODAY, page: "database" })).toEqual([
      "call",
      "spec",
    ])
    expect(ids("(child-of (id @block))", { today: TODAY, block: "spec" })).toEqual(["draft"])
  })

  it("table views return the shown columns next to each row", () => {
    expect(
      rows(parseDataviewQuery("TABLE task.status, page WHERE task.status IN (todo, doing)")),
    ).toEqual([
      ["call", "todo", "oct 1st, 2026"],
      ["spec", "todo", "projects/alpha"],
      ["draft", "doing", "projects/alpha"],
      ["review", "todo", "projects/alpha"],
    ])
  })
})

const compileError = (text: string, ctx: QueryContext) => {
  const compiled = Result.flatMap(parseDataviewQuery(text), (q) => compileQuery(q, ctx))
  return Result.isFailure(compiled) ? compiled.failure.message : "compiled"
}

describe("queries that can't run fail with a plain message", () => {
  it("@page outside a page", () => {
    expect(compileError("LIST WHERE ref = @page", { today: TODAY })).toBe(
      "@page is only available inside a page",
    )
  })

  it("block fields in a pages query", () => {
    expect(compileError("LIST PAGES WHERE task.status = todo", { today: TODAY })).toBe(
      "task.status is a block field; wrap it in a block condition to use it in a pages query",
    )
  })

  it("text search in a pages query", () => {
    expect(compileError('LIST PAGES WHERE TEXT MATCHES "deploy"', { today: TODAY })).toBe(
      "text search needs a block; use it inside a block condition",
    )
  })
})
