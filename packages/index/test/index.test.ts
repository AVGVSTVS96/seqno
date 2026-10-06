import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option, Queue, Stream } from "effect"
import { BlockId, PageId, normalizePageName, type GraphEvent, type Props } from "@seqno/domain"
import { Index, type LiveQuery, type Sqlite } from "@seqno/index"
import { layerNode } from "@seqno/index/node"
import { layerWasmMemory } from "@seqno/index/wasm"

const pageId = (n: number) => PageId.make(`01920000-0000-7000-8000-1${String(n).padStart(11, "0")}`)
const blockId = (n: number) =>
  BlockId.make(`01920000-0000-7000-8000-2${String(n).padStart(11, "0")}`)

const upsertPage = (
  id: PageId,
  title: string,
  props: Props = {},
  journalDay: number | null = null,
): GraphEvent => ({
  _tag: "PageUpserted",
  page: { id, name: normalizePageName(title), title, journalDay, props },
})

const upsertBlock = (
  id: BlockId,
  page: PageId,
  text: string,
  options: {
    readonly parentId?: BlockId
    readonly props?: Props
    readonly updatedAt?: number
  } = {},
): GraphEvent => ({
  _tag: "BlockUpserted",
  block: {
    id,
    pageId: page,
    parentId: options.parentId ?? null,
    text,
    collapsed: false,
    props: options.props ?? {},
  },
  createdAt: 1_000,
  updatedAt: options.updatedAt ?? 1_000,
})

const project = pageId(1)
const journal = pageId(2)
const notes = pageId(3)

const graph: ReadonlyArray<GraphEvent> = [
  upsertPage(project, "Project", { alias: "proj" }),
  upsertPage(journal, "Oct 6th, 2026", {}, 20261006),
  upsertPage(notes, "Notes"),
  upsertBlock(blockId(1), project, "self link [[Project]]"),
  upsertBlock(blockId(2), journal, "worked on [[Project]]"),
  upsertBlock(blockId(3), journal, "child mentions [[project]]", { parentId: blockId(2) }),
  upsertBlock(blockId(4), journal, "#proj standup"),
  upsertBlock(blockId(5), notes, "see [[Project]]"),
  upsertBlock(blockId(6), notes, "tagged by property", { props: { tags: "Project, Other" } }),
  upsertBlock(blockId(7), notes, "Deploy the app on Friday"),
  upsertBlock(blockId(8), notes, "deployment checklist", { parentId: blockId(7) }),
]

const todos: LiveQuery = {
  sql: "SELECT count(*), (SELECT value FROM meta WHERE key = 'stamp') FROM tasks WHERE status = 'todo'",
  params: [],
  reads: ["task.status"],
}

const ids = (hits: ReadonlyArray<{ readonly blockId: BlockId }>) => hits.map((hit) => hit.blockId)

const usingIndex =
  (sqlite: Layer.Layer<Sqlite, unknown>) =>
  <A, E, R>(body: (index: Index["Service"]) => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      return yield* body(yield* Index)
    }).pipe(Effect.provide(Index.layer.pipe(Layer.provide(sqlite))))

const drivers = [
  ["node:sqlite", () => layerNode()],
  ["sqlite-wasm", () => layerWasmMemory],
] as const

describe.each(drivers)("%s", (_driver, sqlite) => {
  it.effect("indexes tasks, refs, props and the tree so plain SQL can read them", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(
          [
            upsertPage(notes, "Notes"),
            upsertBlock(blockId(1), notes, "TODO [#A] ship #release\nSCHEDULED: <2026-10-07 Wed>", {
              props: { owner: "[[Ana]]", Estimate: "3" },
            }),
            upsertBlock(blockId(2), notes, "notes on `#not-a-tag`", { parentId: blockId(1) }),
          ],
          "v1",
        )
        assert.deepStrictEqual(
          yield* index.query(
            "SELECT b.id, t.status, t.priority, t.scheduled, t.deadline FROM tasks t JOIN blocks b ON b.rid = t.block",
          ),
          [[blockId(1), "todo", "a", 20261007, null]],
        )
        assert.deepStrictEqual(yield* index.query("SELECT target, tag FROM refs ORDER BY target"), [
          ["ana", 0],
          ["release", 1],
        ])
        assert.deepStrictEqual(
          yield* index.query("SELECT key, value, num FROM props ORDER BY key"),
          [
            ["estimate", "3", 3],
            ["owner", "ana", null],
          ],
        )
        assert.deepStrictEqual(
          yield* index.query("SELECT c.id, p.id FROM blocks c JOIN blocks p ON p.rid = c.parent"),
          [[blockId(2), blockId(1)]],
        )
      }),
    ),
  )

  it.effect("finds backlinks by name, alias, tag and tag property, newest journal first", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        assert.deepStrictEqual(yield* index.backlinks(project), [
          { blockId: blockId(2), pageId: journal, text: "worked on [[Project]]" },
          { blockId: blockId(3), pageId: journal, text: "child mentions [[project]]" },
          { blockId: blockId(4), pageId: journal, text: "#proj standup" },
          { blockId: blockId(5), pageId: notes, text: "see [[Project]]" },
          { blockId: blockId(6), pageId: notes, text: "tagged by property" },
        ])
      }),
    ),
  )

  it.effect("keeps backlinks current through edits, subtree deletes and renames", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        yield* index.apply(
          [
            upsertBlock(blockId(5), notes, "see [[Notes]] instead"),
            { _tag: "BlockDeleted", blockId: blockId(2), pageId: journal },
            upsertPage(project, "Launch"),
            upsertBlock(blockId(9), notes, "ready for [[launch]]"),
          ],
          "v2",
        )
        assert.deepStrictEqual(yield* index.backlinks(project), [
          { blockId: blockId(9), pageId: notes, text: "ready for [[launch]]" },
        ])
        assert.deepStrictEqual(yield* index.query("SELECT count(*) FROM blocks WHERE page = 2"), [
          [1],
        ])
      }),
    ),
  )

  it.effect("finds unlinked mentions of a page's name and aliases, skipping linked ones", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(
          [
            ...graph,
            upsertBlock(blockId(9), notes, "the project plan needs a review"),
            upsertBlock(blockId(10), journal, "PROJ budget, and [[Project]] linked too"),
            upsertBlock(blockId(11), project, "this project page mentions itself"),
            upsertBlock(blockId(12), notes, "projection is a different word"),
          ],
          "v1",
        )
        assert.deepStrictEqual(yield* index.unlinkedReferences(project), [
          { blockId: blockId(9), pageId: notes, text: "the project plan needs a review" },
        ])
        assert.deepStrictEqual(yield* index.unlinkedReferences(pageId(99)), [])
      }),
    ),
  )

  it.effect("counts backlinks and reads first and last edit times per page", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(
          [...graph, upsertBlock(blockId(9), notes, "edited later", { updatedAt: 5_000 })],
          "v1",
        )
        const stats = yield* index.pageStats
        assert.deepStrictEqual(
          stats.toSorted((left, right) => left.pageId.localeCompare(right.pageId)),
          [
            { pageId: project, backlinks: 5, created: 1_000, updated: 1_000 },
            { pageId: journal, backlinks: 0, created: 1_000, updated: 1_000 },
            { pageId: notes, backlinks: 0, created: 1_000, updated: 5_000 },
          ],
        )
      }),
    ),
  )

  it.effect("lists names that are referenced but have no page, titled as written", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(
          [
            ...graph,
            upsertBlock(blockId(9), journal, "sowed tomatoes #Greenhouse", { updatedAt: 3_000 }),
            upsertBlock(blockId(10), notes, "see [[Seed Inventory]] and #greenhouse."),
            upsertBlock(blockId(11), notes, "```css\na {\n  color: #3a7d44;\n}\n```"),
            upsertBlock(blockId(12), notes, "#+BEGIN_QUERY\n{}\n#+END_QUERY"),
          ],
          "v1",
        )
        assert.deepStrictEqual(yield* index.referencedPages, [
          { name: "greenhouse", title: "Greenhouse", backlinks: 2, created: 1_000, updated: 3_000 },
          { name: "other", title: "other", backlinks: 1, created: 1_000, updated: 1_000 },
          {
            name: "seed inventory",
            title: "Seed Inventory",
            backlinks: 1,
            created: 1_000,
            updated: 1_000,
          },
        ])
        yield* index.apply([upsertPage(pageId(4), "Greenhouse")], "v2")
        assert.deepStrictEqual(
          (yield* index.referencedPages).map((page) => page.name),
          ["other", "seed inventory"],
        )
      }),
    ),
  )

  it.live("live backlinks wake for the page's own refs and aliases, not for other edits", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        const updates = yield* Stream.toQueue(index.watchBacklinks(notes), {
          capacity: "unbounded",
        })
        assert.deepStrictEqual(yield* Queue.take(updates), [])
        yield* index.apply([upsertBlock(blockId(9), journal, "plain words about notes")], "v2")
        yield* index.apply([upsertBlock(blockId(10), journal, "see [[Project]] again")], "v3")
        yield* Effect.sleep("20 millis")
        assert.strictEqual(yield* Queue.size(updates), 0)
        yield* index.apply([upsertBlock(blockId(9), journal, "about [[Notes]]")], "v4")
        assert.deepStrictEqual(ids(yield* Queue.take(updates)), [blockId(9)])
        yield* index.apply([upsertPage(notes, "Notes", { alias: "jottings" })], "v5")
        yield* index.apply([upsertBlock(blockId(11), project, "#jottings")], "v6")
        assert.deepStrictEqual(ids(yield* Queue.take(updates)), [blockId(9), blockId(11)])
      }).pipe(Effect.scoped),
    ),
  )

  it.live("live backlinks reach a name that has no page yet", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        const updates = yield* Stream.toQueue(index.watchBacklinksToName("Visual Check"), {
          capacity: "unbounded",
        })
        assert.deepStrictEqual(yield* Queue.take(updates), [])
        yield* index.apply([upsertBlock(blockId(9), notes, "needs a #[[visual check]]")], "v2")
        assert.deepStrictEqual(yield* Queue.take(updates), [
          { blockId: blockId(9), pageId: notes, text: "needs a #[[visual check]]" },
        ])
      }).pipe(Effect.scoped),
    ),
  )

  it.live("live unlinked references and page stats follow text edits", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        const unlinked = yield* Stream.toQueue(index.watchUnlinkedReferences(notes), {
          capacity: "unbounded",
        })
        const stats = yield* Stream.toQueue(index.watchPageStats, { capacity: "unbounded" })
        const updatedNotes = (all: ReadonlyArray<{ readonly pageId: PageId; updated: unknown }>) =>
          all.find((stat) => stat.pageId === notes)?.updated
        assert.deepStrictEqual(yield* Queue.take(unlinked), [])
        assert.strictEqual(updatedNotes(yield* Queue.take(stats)), 1_000)
        yield* index.apply(
          [upsertBlock(blockId(7), notes, "Deploy on Friday", { updatedAt: 7_000 })],
          "v2",
        )
        assert.strictEqual(updatedNotes(yield* Queue.take(stats)), 7_000)
        yield* Effect.sleep("20 millis")
        assert.strictEqual(yield* Queue.size(unlinked), 0)
        yield* index.apply([upsertBlock(blockId(9), journal, "check the notes later")], "v3")
        assert.deepStrictEqual(yield* Queue.take(unlinked), [
          { blockId: blockId(9), pageId: journal, text: "check the notes later" },
        ])
      }).pipe(Effect.scoped),
    ),
  )

  it.effect("searches blocks by word prefix and pages by name or alias", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        const found = yield* index.search("deploy")
        assert.deepStrictEqual(found.pages, [])
        assert.deepStrictEqual(found.blocks.map((hit) => hit.text).toSorted(), [
          "Deploy the app on Friday",
          "deployment checklist",
        ])
        assert.deepStrictEqual((yield* index.search("PROJ")).pages, [
          { pageId: project, title: "Project" },
        ])
        assert.deepStrictEqual(yield* index.search("oct 6"), {
          pages: [{ pageId: journal, title: "Oct 6th, 2026" }],
          blocks: [],
        })
        assert.deepStrictEqual(yield* index.search('app "fri'), {
          pages: [],
          blocks: [{ blockId: blockId(7), pageId: notes, text: "Deploy the app on Friday" }],
        })
      }),
    ),
  )

  it.effect("moves a whole subtree when its root moves to another page", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        yield* index.apply(
          [{ _tag: "BlockMoved", blockId: blockId(7), pageId: project, parentId: blockId(1) }],
          "v2",
        )
        assert.deepStrictEqual(
          yield* index.query(
            "SELECT b.id, p.name_lc, parent.id FROM blocks b JOIN pages p ON p.rid = b.page JOIN blocks parent ON parent.rid = b.parent WHERE b.content LIKE '%deploy%' ORDER BY b.rid",
          ),
          [
            [blockId(7), "project", blockId(1)],
            [blockId(8), "project", blockId(7)],
          ],
        )
      }),
    ),
  )

  it.effect("deleting a page removes its blocks from every table", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(graph, "v1")
        yield* index.apply([{ _tag: "PageDeleted", pageId: notes }], "v2")
        assert.deepStrictEqual(
          yield* index.query(
            "SELECT (SELECT count(*) FROM blocks), (SELECT count(*) FROM refs), (SELECT count(*) FROM props), (SELECT count(*) FROM pages), (SELECT count(*) FROM fts WHERE fts MATCH 'deploy')",
          ),
          [[4, 4, 0, 2, 0]],
        )
      }),
    ),
  )

  it.effect("rejects a batch whose blocks arrive before their page, and keeps the old state", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply([upsertPage(notes, "Notes")], "v1")
        const error = yield* index
          .apply(
            [upsertBlock(blockId(1), notes, "fine"), upsertBlock(blockId(2), journal, "orphan")],
            "v2",
          )
          .pipe(Effect.flip)
        assert.strictEqual(
          error.message,
          `page ${journal} is not indexed: send its PageUpserted before its blocks`,
        )
        assert.deepStrictEqual(yield* index.stamp, Option.some("v1"))
        assert.deepStrictEqual(yield* index.query("SELECT count(*) FROM blocks"), [[0]])
      }),
    ),
  )

  it.effect("reports bad SQL as an IndexError", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        const error = yield* index.query("SELECT * FROM nope").pipe(Effect.flip)
        assert.strictEqual(error._tag, "IndexError")
        assert.include(error.message, "no such table: nope")
      }),
    ),
  )

  it.live("re-runs a live query only when a key it reads changes", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply(
          [upsertPage(notes, "Notes"), upsertBlock(blockId(1), notes, "TODO a")],
          "v1",
        )
        const results = yield* Stream.toQueue(index.watch(todos), { capacity: "unbounded" })
        assert.deepStrictEqual(yield* Queue.take(results), [[1, "v1"]])
        yield* index.apply([upsertBlock(blockId(2), notes, "plain text")], "v2")
        yield* index.apply([upsertBlock(blockId(1), notes, "TODO a, edited")], "v3")
        yield* Effect.sleep("20 millis")
        yield* index.apply([upsertBlock(blockId(2), notes, "TODO plain text")], "v4")
        assert.deepStrictEqual(yield* Queue.take(results), [[2, "v4"]])
      }).pipe(Effect.scoped),
    ),
  )

  it.live("wakes a keyed live query only for its own value", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        yield* index.apply([upsertPage(notes, "Notes")], "v1")
        const release = yield* Stream.toQueue(
          index.watch({
            sql: "SELECT count(*), (SELECT value FROM meta WHERE key = 'stamp') FROM refs WHERE target = 'release' AND tag = 1",
            params: [],
            reads: ["tag:release"],
          }),
          { capacity: "unbounded" },
        )
        assert.deepStrictEqual(yield* Queue.take(release), [[0, "v1"]])
        yield* index.apply([upsertBlock(blockId(1), notes, "#other")], "v2")
        yield* Effect.sleep("20 millis")
        yield* index.apply([upsertBlock(blockId(1), notes, "#other #release")], "v3")
        assert.deepStrictEqual(yield* Queue.take(release), [[1, "v3"]])
      }).pipe(Effect.scoped),
    ),
  )

  it.live("rebuild replaces everything, stamps the result and refreshes live queries", () =>
    usingIndex(sqlite())((index) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* index.stamp, Option.none())
        yield* index.apply(graph, "v1")
        yield* index.apply([upsertBlock(blockId(9), notes, "TODO old")], "v2")
        const results = yield* Stream.toQueue(index.watch(todos), { capacity: "unbounded" })
        assert.deepStrictEqual(yield* Queue.take(results), [[1, "v2"]])
        yield* index.rebuild(
          Stream.fromIterable([
            upsertPage(journal, "Oct 6th, 2026", {}, 20261006),
            upsertBlock(blockId(20), journal, "TODO x"),
            upsertBlock(blockId(21), journal, "TODO y", { parentId: blockId(20) }),
          ]),
          "v9",
        )
        assert.deepStrictEqual(yield* Queue.take(results), [[2, "v9"]])
        assert.deepStrictEqual(yield* index.stamp, Option.some("v9"))
        assert.deepStrictEqual(yield* index.query("SELECT name_lc FROM pages"), [["oct 6th, 2026"]])
      }).pipe(Effect.scoped),
    ),
  )
})

describe("node:sqlite file", () => {
  it.effect("keeps its stamp across reopen, and starts empty when the schema version differs", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), "seqno-index-"))
      const path = join(dir, "index.sqlite3")
      const reopened = () => usingIndex(layerNode(path))
      yield* reopened()((index) => index.apply(graph, "v1"))
      assert.deepStrictEqual(yield* reopened()((index) => index.stamp), Option.some("v1"))
      assert.deepStrictEqual(
        yield* reopened()((index) => index.query("SELECT count(*) FROM blocks")),
        [[8]],
      )
      const raw = new DatabaseSync(path)
      raw.exec("PRAGMA user_version = 999")
      raw.close()
      assert.deepStrictEqual(yield* reopened()((index) => index.stamp), Option.none())
      assert.deepStrictEqual(
        yield* reopened()((index) => index.query("SELECT count(*) FROM blocks")),
        [[0]],
      )
      rmSync(dir, { recursive: true })
    }),
  )
})
