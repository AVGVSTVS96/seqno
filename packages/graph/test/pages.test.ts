import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { BlockId, JournalDay, normalizePageName, type PageId } from "@seqno/domain"
import { journalPageId } from "@seqno/graph"
import { createdPage, format, nth, openGraph, outline, seedPage } from "./support.ts"

type Opened = Effect.Success<ReturnType<typeof openGraph>>

const flushed = (graph: Opened) =>
  Effect.map(
    graph.flush(() => Effect.void),
    (update) => Option.toArray(Option.map(update, ({ bytes }) => bytes)),
  )

const sync = (...graphs: ReadonlyArray<Opened>) =>
  Effect.gen(function* () {
    for (let round = 0; round < 4; round++) {
      const sent = yield* Effect.forEach(graphs, flushed)
      if (sent.every((bytes) => bytes.length === 0)) return
      for (const [at, graph] of graphs.entries()) {
        yield* graph.merge(sent.flatMap((bytes, from) => (from === at ? [] : bytes)))
      }
    }
  })

const view = (graph: Opened) =>
  Effect.gen(function* () {
    const pages = (yield* graph.pages).toSorted((a, b) => (a.title < b.title ? -1 : 1))
    return yield* Effect.forEach(pages, (page) =>
      Effect.map(graph.page(page.id), (tree) => [page.title, ...outline(tree)]),
    )
  })

const pageOf = (graph: Opened, pageId: PageId) => Effect.map(graph.page(pageId), outline)

const twoDevices = Effect.gen(function* () {
  const left = yield* openGraph("1")
  const x = yield* seedPage(left, "X", ["a", "b", "  b1", "c"])
  const y = yield* seedPage(left, "Y", ["y"])
  const z = yield* seedPage(left, "Z", ["z"])
  const right = yield* openGraph("2", { snapshot: yield* left.snapshot })
  yield* flushed(left)
  const [a, b, b1] = [nth(x.ids, 0), nth(x.ids, 1), nth(x.ids, 2)]
  return { left, right, x, y, z, a, b, b1, yy: nth(y.ids, 0), zz: nth(z.ids, 0) }
})

const moveTo = (graph: Opened, blockId: BlockId, after: BlockId) =>
  graph.dispatch({ _tag: "MoveBlocks", blockIds: [blockId], parentId: null, after })

describe.runIf(format === "v2")("pages in their own trees", () => {
  it.effect("today's journal from two devices lands in one tree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const day = Schema.decodeUnknownSync(JournalDay)(20261012)
        const id = journalPageId(day)
        assert.strictEqual(id, "00002026-1012-7000-8000-000000000000")
        const left = yield* openGraph("1")
        const right = yield* openGraph("2")
        const today = (blockId: string, text: string) => ({
          page: {
            id,
            name: normalizePageName("Oct 12th, 2026"),
            title: "Oct 12th, 2026",
            journalDay: day,
            props: {},
          },
          blocks: [
            {
              id: Schema.decodeUnknownSync(BlockId)(blockId),
              pageId: id,
              parentId: null,
              text,
              collapsed: false,
              props: {},
            },
          ],
        })
        yield* left.load([today("01920000-0000-7000-8000-0000000000a1", "from left")])
        yield* right.load([today("01920000-0000-7000-8000-0000000000a2", "from right")])
        yield* sync(left, right)
        const expected = [["Oct 12th, 2026", "from left", "from right"]]
        assert.deepStrictEqual(yield* view(left), expected)
        assert.deepStrictEqual(yield* view(right), expected)
        assert.deepStrictEqual(
          (yield* left.pages).map((page) => page.id),
          [id],
        )
      }),
    ),
  )

  it.effect(
    "a block moved to another page keeps what another device typed and added under it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { left, right, x, y, b, b1, yy } = yield* twoDevices
          yield* moveTo(left, b, yy)
          yield* right.dispatch({ _tag: "EditText", blockId: b, from: 1, to: 1, insert: " edited" })
          yield* right.dispatch({
            _tag: "InsertBlock",
            pageId: x.pageId,
            parentId: b,
            after: b1,
            text: "b2",
          })
          yield* sync(left, right)
          for (const graph of [left, right]) {
            assert.deepStrictEqual(yield* pageOf(graph, y.pageId), [
              "y",
              "b edited",
              "  b1",
              "  b2",
            ])
            assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "c"])
            assert.strictEqual((yield* graph.block(b)).pageId, y.pageId)
          }
        }),
      ),
  )

  it.effect("two devices moving one block to two pages end with one copy", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, b, yy, zz } = yield* twoDevices
        yield* moveTo(left, b, yy)
        yield* moveTo(right, b, zz)
        yield* sync(left, right)
        const seen = yield* view(left)
        assert.deepStrictEqual(yield* view(right), seen)
        assert.strictEqual(seen.flat().filter((line) => line === "b").length, 1)
        assert.strictEqual(seen.flat().filter((line) => line === "  b1").length, 1)
      }),
    ),
  )

  it.effect("a move wins over a delete, an indent or a move of the same block made meanwhile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const meanwhile of ["delete", "indent", "reorder"] as const) {
          const { left, right, x, y, a, b, yy } = yield* twoDevices
          yield* moveTo(left, b, yy)
          if (meanwhile === "delete") yield* right.dispatch({ _tag: "DeleteBlocks", blockIds: [b] })
          if (meanwhile === "indent") yield* right.dispatch({ _tag: "Indent", blockIds: [b] })
          if (meanwhile === "reorder") {
            yield* right.dispatch({
              _tag: "MoveBlocks",
              blockIds: [b],
              parentId: null,
              after: nth(x.ids, 3),
            })
          }
          yield* sync(left, right)
          for (const graph of [left, right]) {
            assert.deepStrictEqual(yield* pageOf(graph, y.pageId), ["y", "b", "  b1"])
            assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "c"])
          }
          assert.strictEqual((yield* left.block(a)).text, "a")
        }
      }),
    ),
  )

  it.effect(
    "a parent and its child moved to two pages at once each land where they were sent",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { left, right, x, y, z, b, b1, yy, zz } = yield* twoDevices
          yield* moveTo(left, b, yy)
          yield* moveTo(right, b1, zz)
          yield* sync(left, right)
          for (const graph of [left, right]) {
            assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "c"])
            assert.deepStrictEqual(yield* pageOf(graph, y.pageId), ["y", "b"])
            assert.deepStrictEqual(yield* pageOf(graph, z.pageId), ["z", "b1"])
          }
        }),
      ),
  )

  it.effect(
    "two blocks on two pages moved under each other at once end up one under the other",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { left, right, b, yy } = yield* twoDevices
          yield* left.dispatch({ _tag: "MoveBlocks", blockIds: [b], parentId: yy })
          yield* right.dispatch({ _tag: "MoveBlocks", blockIds: [yy], parentId: b })
          yield* sync(left, right)
          const seen = yield* view(left)
          assert.deepStrictEqual(yield* view(right), seen)
          const lines = seen.flat().map((line) => line.trim())
          assert.deepStrictEqual(
            ["a", "b", "b1", "c", "y", "z"].map(
              (text) => lines.filter((line) => line === text).length,
            ),
            [1, 1, 1, 1, 1, 1],
          )
        }),
      ),
  )

  it.effect("undo across pages brings a block back with what another device typed into it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, x, y, b, yy } = yield* twoDevices
        yield* moveTo(left, b, yy)
        yield* sync(left, right)
        yield* right.dispatch({ _tag: "EditText", blockId: b, from: 1, to: 1, insert: "!" })
        yield* sync(left, right)
        yield* left.dispatch({ _tag: "Undo" })
        yield* sync(left, right)
        for (const graph of [left, right]) {
          assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "b!", "  b1", "c"])
          assert.deepStrictEqual(yield* pageOf(graph, y.pageId), ["y"])
        }
        yield* left.dispatch({ _tag: "Redo" })
        yield* sync(left, right)
        for (const graph of [left, right]) {
          assert.deepStrictEqual(yield* pageOf(graph, y.pageId), ["y", "b!", "  b1"])
          assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "c"])
        }
      }),
    ),
  )

  it.effect("a block moved away and back sits on its first page again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, x, y, a, b, yy } = yield* twoDevices
        yield* moveTo(left, b, yy)
        const back = yield* moveTo(left, b, a)
        assert.deepStrictEqual(
          back.map((event) => (event._tag === "BlockMoved" ? event.pageId : event._tag)),
          [x.pageId, x.pageId],
        )
        yield* sync(left, right)
        for (const graph of [left, right]) {
          assert.deepStrictEqual(yield* pageOf(graph, x.pageId), ["a", "b", "  b1", "c"])
          assert.deepStrictEqual(yield* pageOf(graph, y.pageId), ["y"])
        }
      }),
    ),
  )

  it.effect("a block found by id on a page this device has not read follows its move", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, y, b, b1, yy } = yield* twoDevices
        yield* moveTo(left, b, yy)
        const fresh = yield* openGraph("3", { snapshot: yield* left.snapshot })
        assert.deepStrictEqual(yield* fresh.block(b1), {
          id: b1,
          pageId: y.pageId,
          parentId: b,
          text: "b1",
          collapsed: false,
          props: {},
        })
      }),
    ),
  )

  it.effect("two pages renamed to one name on two devices merge into one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, y, z } = yield* twoDevices
        yield* left.dispatch({ _tag: "RenamePage", pageId: y.pageId, title: "Same" })
        yield* right.dispatch({ _tag: "RenamePage", pageId: z.pageId, title: "same" })
        yield* sync(left, right)
        const [first, second] = y.pageId < z.pageId ? ["y", "z"] : ["z", "y"]
        for (const graph of [left, right]) {
          const same = (yield* graph.pages).filter((page) => page.name === "same")
          assert.strictEqual(same.length, 1)
          assert.deepStrictEqual(yield* pageOf(graph, nth(same, 0).id), [first, second])
        }
        const merged = nth(
          (yield* left.pages).filter((page) => page.name === "same"),
          0,
        )
        yield* left.dispatch({
          _tag: "InsertBlock",
          pageId: merged.id,
          parentId: null,
          after: second === "z" ? nth(z.ids, 0) : nth(y.ids, 0),
          text: "last",
        })
        assert.deepStrictEqual(yield* pageOf(left, merged.id), [first, second, "last"])
      }),
    ),
  )

  it.effect("a page deleted on one device comes back on undo with the other's edits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, y, yy } = yield* twoDevices
        yield* left.dispatch({ _tag: "DeletePage", pageId: y.pageId })
        yield* right.dispatch({ _tag: "EditText", blockId: yy, from: 1, to: 1, insert: "es" })
        yield* sync(left, right)
        assert.strictEqual(
          (yield* right.pages).some((page) => page.id === y.pageId),
          false,
        )
        const restored = yield* left.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(
          restored.map((event) => event._tag),
          ["PageUpserted", "BlockUpserted"],
        )
        yield* sync(left, right)
        assert.deepStrictEqual(yield* pageOf(right, y.pageId), ["yes"])
      }),
    ),
  )

  it.effect("creating a page and undoing it leaves no page behind", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const created = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title: "Draft" }))
        const undone = yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(undone, [{ _tag: "PageDeleted", pageId: created }])
        assert.deepStrictEqual(yield* graph.pages, [])
      }),
    ),
  )
})
