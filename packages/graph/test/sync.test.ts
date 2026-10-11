import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { GraphEvent } from "@seqno/domain"
import type { LocalUpdate } from "@seqno/graph"
import { createdBlock, nth, openGraph, outline, seedPage } from "./support.ts"

const flushed = (graph: Effect.Success<ReturnType<typeof openGraph>>) =>
  Effect.map(
    graph.flush(() => Effect.void),
    (update) => Option.toArray(Option.map(update, ({ bytes }) => bytes)),
  )

describe("concurrent edits", () => {
  it.effect("two devices editing the same page converge to the same outline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        const { pageId, ids } = yield* seedPage(origin, "Shared", ["a", "b", "c"])
        const snapshot = yield* origin.snapshot
        const left = yield* openGraph("2", { snapshot })
        const right = yield* openGraph("3", { snapshot })
        const [a, b, c] = [nth(ids, 0), nth(ids, 1), nth(ids, 2)]

        yield* left.dispatch({ _tag: "EditText", blockId: a, from: 1, to: 1, insert: " left" })
        yield* left.dispatch({ _tag: "Indent", blockIds: [b] })
        yield* left.dispatch({
          _tag: "InsertBlock",
          pageId,
          parentId: null,
          after: c,
          text: "from left",
        })
        yield* right.dispatch({ _tag: "EditText", blockId: a, from: 0, to: 0, insert: "right " })
        yield* right.dispatch({ _tag: "DeleteBlocks", blockIds: [c] })
        yield* right.dispatch({
          _tag: "SetProperty",
          target: { _tag: "BlockTarget", blockId: b },
          key: "owner",
          value: "right",
        })

        const fromLeft = yield* flushed(left)
        const fromRight = yield* flushed(right)
        const leftEvents = yield* left.merge(fromRight)
        yield* right.merge(fromLeft)

        assert.deepStrictEqual(
          leftEvents.flatMap((event) => (event._tag === "BlockDeleted" ? [event.blockId] : [])),
          [c],
        )
        assert.deepStrictEqual(
          leftEvents.flatMap((event) =>
            event._tag === "BlockUpserted" && event.block.id === a ? [event.block.text] : [],
          ),
          ["right a left"],
        )
        const expected = ["right a left", "  b", "from left"]
        assert.deepStrictEqual(outline(yield* left.page(pageId)), expected)
        assert.deepStrictEqual(outline(yield* right.page(pageId)), expected)
        assert.deepStrictEqual(yield* left.page(pageId), yield* right.page(pageId))
        assert.deepStrictEqual((yield* left.block(b)).props, { owner: "right" })
        assert.deepStrictEqual(yield* left.version, yield* right.version)
      }),
    ),
  )

  it.effect("concurrent property writes on different keys both survive", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        const { ids } = yield* seedPage(origin, "Props", ["task"])
        const snapshot = yield* origin.snapshot
        const left = yield* openGraph("2", { snapshot })
        const right = yield* openGraph("3", { snapshot })
        const target = { _tag: "BlockTarget", blockId: nth(ids, 0) } as const
        yield* left.dispatch({ _tag: "SetProperty", target, key: "status", value: "doing" })
        yield* right.dispatch({ _tag: "SetProperty", target, key: "due", value: "friday" })
        yield* left.merge(yield* flushed(right))
        yield* right.merge(yield* flushed(left))
        assert.deepStrictEqual((yield* left.block(nth(ids, 0))).props, {
          status: "doing",
          due: "friday",
        })
        assert.deepStrictEqual((yield* right.block(nth(ids, 0))).props, {
          status: "doing",
          due: "friday",
        })
      }),
    ),
  )
})

const sameNamePages = Effect.gen(function* () {
  const left = yield* openGraph("1")
  const right = yield* openGraph("2")
  const fromLeft = yield* seedPage(left, "Groceries", ["milk"])
  const fromRight = yield* seedPage(right, "groceries", ["eggs"])
  const [winner, loser] = [fromLeft, fromRight].toSorted((a, b) => (a.pageId < b.pageId ? -1 : 1))
  if (winner === undefined || loser === undefined) return assert.fail("two pages were seeded")
  const [first, second] = winner === fromLeft ? ["milk", "eggs"] : ["eggs", "milk"]
  const [winnerGraph, loserGraph] = winner === fromLeft ? [left, right] : [right, left]
  return { left, right, winner, loser, first, second, winnerGraph, loserGraph }
})

const titles = (graph: Effect.Success<ReturnType<typeof openGraph>>) =>
  Effect.map(graph.pages, (pages) => pages.map((page) => `${page.title} ${page.id}`))

describe("two pages with one name", () => {
  it.effect("merge into the older page on every device, blocks of both in order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, winner, loser, first, second } = yield* sameNamePages
        const fromLeft = yield* flushed(left)
        const fromRight = yield* flushed(right)
        const leftEvents = yield* left.merge(fromRight)
        yield* right.merge(fromLeft)
        yield* left.merge(yield* flushed(right))
        yield* right.merge(yield* flushed(left))

        const expected = [first, second]
        assert.deepStrictEqual(outline(yield* left.page(winner.pageId)), expected)
        assert.deepStrictEqual(outline(yield* right.page(winner.pageId)), expected)
        assert.deepStrictEqual(yield* titles(left), yield* titles(right))
        assert.strictEqual((yield* left.pages).length, 1)
        assert.strictEqual((yield* Effect.flip(left.page(loser.pageId)))._tag, "PageNotFound")
        assert.deepStrictEqual(
          leftEvents.flatMap((event) =>
            GraphEvent.match(event, {
              PageUpserted: ({ page }) => (page.id === loser.pageId ? [event._tag] : []),
              PageDeleted: () => [],
              BlockUpserted: ({ block }) => (block.pageId === loser.pageId ? [event._tag] : []),
              BlockMoved: ({ pageId }) => (pageId === loser.pageId ? [event._tag] : []),
              BlockDeleted: () => [],
            }),
          ),
          [],
        )
      }),
    ),
  )

  it.effect(
    "a block added to the merged-away page before its device heard of the merge moves too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { winner, loser, first, second, winnerGraph, loserGraph } = yield* sameNamePages
          yield* winnerGraph.merge(yield* flushed(loserGraph))
          yield* loserGraph.dispatch({
            _tag: "InsertBlock",
            pageId: loser.pageId,
            parentId: null,
            after: nth(loser.ids, 0),
            text: "bread",
          })
          yield* winnerGraph.merge(yield* flushed(loserGraph))
          yield* loserGraph.merge(yield* flushed(winnerGraph))
          yield* winnerGraph.merge(yield* flushed(loserGraph))

          const expected = [first, second, "bread"]
          assert.deepStrictEqual(outline(yield* winnerGraph.page(winner.pageId)), expected)
          assert.deepStrictEqual(outline(yield* loserGraph.page(winner.pageId)), expected)
          assert.deepStrictEqual(yield* titles(winnerGraph), yield* titles(loserGraph))
          assert.strictEqual((yield* loserGraph.pages).length, 1)
        }),
      ),
  )
})

describe("undoing a delete", () => {
  it.effect("brings back the same blocks, with what another device typed into them meanwhile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const left = yield* openGraph("1")
        const { pageId, ids } = yield* seedPage(left, "Undo delete", ["a", "b", "  b1", "c"])
        const right = yield* openGraph("2", { snapshot: yield* left.snapshot })
        const [b, b1] = [nth(ids, 1), nth(ids, 2)]
        yield* flushed(left)

        const deleted = yield* left.dispatch({ _tag: "DeleteBlocks", blockIds: [b] })
        assert.deepStrictEqual(
          deleted.map((event) => (event._tag === "BlockDeleted" ? event.blockId : event._tag)),
          [b, b1],
        )
        assert.deepStrictEqual(outline(yield* left.page(pageId)), ["a", "c"])
        yield* right.dispatch({ _tag: "EditText", blockId: b1, from: 2, to: 2, insert: " typed" })
        yield* left.merge(yield* flushed(right))
        assert.deepStrictEqual(outline(yield* left.page(pageId)), ["a", "c"])

        const restored = yield* left.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(
          restored.map((event) => (event._tag === "BlockUpserted" ? event.block.text : event._tag)),
          ["b", "b1 typed"],
        )
        yield* right.merge(yield* flushed(left))
        const expected = ["a", "b", "  b1 typed", "c"]
        assert.deepStrictEqual(outline(yield* left.page(pageId)), expected)
        assert.deepStrictEqual(outline(yield* right.page(pageId)), expected)
        assert.strictEqual((yield* left.block(b1)).text, "b1 typed")
      }),
    ),
  )

  it.effect("brings back a deleted page and its blocks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { pageId } = yield* seedPage(graph, "Gone", ["a", "  a1"])
        const deleted = yield* graph.dispatch({ _tag: "DeletePage", pageId })
        assert.deepStrictEqual(
          deleted.map((event) => event._tag),
          ["BlockDeleted", "BlockDeleted", "PageDeleted"],
        )
        assert.deepStrictEqual((yield* graph.pages).length, 0)
        const restored = yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(
          restored.map((event) => event._tag),
          ["PageUpserted", "BlockUpserted", "BlockUpserted"],
        )
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a", "  a1"])
      }),
    ),
  )
})

describe("persistence", () => {
  it.effect(
    "flushes only new local ops, keeps them on a failed write, and reopens from the files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const graph = yield* openGraph("7")
          const { pageId } = yield* seedPage(graph, "Saved", ["one"])
          const files: Array<LocalUpdate> = []
          const save = (update: LocalUpdate) => Effect.sync(() => void files.push(update))

          const first = yield* graph.flush(save)
          assert.deepStrictEqual(
            Option.map(first, ({ peer, start }) => [peer, start]),
            Option.some(["7", 0]),
          )
          assert.deepStrictEqual(yield* graph.flush(save), Option.none())

          yield* graph.dispatch({ _tag: "InsertBlock", pageId, parentId: null, text: "zero" })
          const failed = yield* Effect.flip(graph.flush(() => Effect.fail("disk full")))
          assert.strictEqual(failed, "disk full")
          const second = yield* graph.flush(save)
          assert.deepStrictEqual(
            Option.map(second, ({ start }) => start),
            Option.map(first, ({ end }) => end),
          )

          const reopened = yield* openGraph("7", { updates: files.map(({ bytes }) => bytes) })
          assert.deepStrictEqual(outline(yield* reopened.page(pageId)), ["zero", "one"])
          yield* reopened.dispatch({ _tag: "CreatePage", title: "Later" })
          const third = yield* reopened.flush(save)
          assert.deepStrictEqual(
            Option.map(third, ({ start }) => start),
            Option.map(second, ({ end }) => end),
          )
        }),
      ),
  )
  it.effect("an empty graph that merges its own saved files continues after them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("7")
        yield* seedPage(graph, "Saved", ["one"])
        const files: Array<LocalUpdate> = []
        const save = (update: LocalUpdate) => Effect.sync(() => void files.push(update))
        const first = yield* graph.flush(save)

        const reopened = yield* openGraph("7")
        yield* reopened.merge(files.map(({ bytes }) => bytes))
        assert.deepStrictEqual(yield* reopened.flush(save), Option.none())
        yield* reopened.dispatch({ _tag: "CreatePage", title: "Later" })
        const next = yield* reopened.flush(save)
        assert.deepStrictEqual(
          Option.map(next, ({ start }) => start),
          Option.map(first, ({ end }) => end),
        )
      }),
    ),
  )
})

describe("lazy open", () => {
  it.effect("lists pages at once and resolves blocks on pages it has not read yet", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        const pages = yield* Effect.forEach(["Alpha", "Beta", "Gamma"], (title) =>
          seedPage(origin, title, [`${title} root`, `  ${title} child`]),
        )
        const snapshot = yield* origin.snapshot
        const graph = yield* openGraph("2", { snapshot })
        assert.deepStrictEqual(
          (yield* graph.pages).map((page) => page.title),
          ["Alpha", "Beta", "Gamma"],
        )
        const gamma = nth(pages, 2)
        const child = nth(gamma.ids, 1)
        assert.deepStrictEqual(yield* graph.block(child), {
          id: child,
          pageId: gamma.pageId,
          parentId: nth(gamma.ids, 0),
          text: "Gamma child",
          collapsed: false,
          props: {},
        })
        const edited = yield* graph.dispatch({
          _tag: "EditText",
          blockId: nth(nth(pages, 1).ids, 0),
          from: 0,
          to: 4,
          insert: "B",
        })
        assert.strictEqual(createdBlock(edited), nth(nth(pages, 1).ids, 0))
        yield* graph.loaded
        assert.deepStrictEqual(outline(yield* graph.page(nth(pages, 1).pageId)), [
          "B root",
          "  Beta child",
        ])
      }),
    ),
  )
})
