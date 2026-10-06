import { assert, describe, it } from "@effect/vitest"
import { BrowserCrypto } from "@effect/platform-browser"
import { Effect, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { RpcTest } from "effect/rpc"
import type { PageId } from "@seqno/domain"
import { CoreRpcs, GraphUnavailable } from "@seqno/rpc"
import { GraphLocations } from "../locations.ts"
import { StubCore } from "../stub-core.ts"

const DemoOnly = Layer.succeed(GraphLocations, {
  resolve: (graph) =>
    graph === "demo"
      ? Effect.succeed({ _tag: "OpfsGraph" as const, name: graph })
      : Effect.fail(new GraphUnavailable({ graph, reason: "no location stored for this graph" })),
})

const Core = StubCore.pipe(Layer.provide([DemoOnly, BrowserCrypto.layer]))

const octoberSixth = Date.UTC(2026, 9, 6, 12)

const openDemo = Effect.gen(function* () {
  yield* TestClock.setTime(octoberSixth)
  const core = yield* RpcTest.makeClient(CoreRpcs)
  const opened = yield* core.OpenGraph({ graph: "demo" })
  const pageIdOf = (title: string): PageId => {
    const page = opened.pages.find((candidate) => candidate.title === title)
    assert.isDefined(page)
    return page.id
  }
  return { core, opened, pageIdOf }
})

const texts = (blocks: ReadonlyArray<{ readonly text: string }>) =>
  blocks.map((block) => block.text)

describe("stub core over the RPC test transport", () => {
  it.effect("opens the demo graph with today's journal first", () =>
    Effect.gen(function* () {
      const { opened } = yield* openDemo
      assert.deepStrictEqual(
        opened.pages.map((page) => [page.title, page.name, page.journalDay, page.props]),
        [
          ["Oct 6th, 2026", "oct 6th, 2026", 20261006, {}],
          ["Getting started", "getting started", null, { favorite: "true" }],
          ["Ideas", "ideas", null, {}],
        ],
      )
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )

  it.effect("reports a graph with no stored location as unavailable", () =>
    Effect.gen(function* () {
      const core = yield* RpcTest.makeClient(CoreRpcs)
      const error = yield* Effect.flip(core.OpenGraph({ graph: "elsewhere" }))
      assert.deepStrictEqual(
        [error._tag, error.reason],
        ["GraphUnavailable", "no location stored for this graph"],
      )
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )

  it.effect("inserts after a sibling's subtree, edits it, and streams each version", () =>
    Effect.gen(function* () {
      const { core, pageIdOf } = yield* openDemo
      const pageId = pageIdOf("Getting started")
      const before = yield* core.GetPage({ pageId })
      const first = before.blocks[0]
      assert.isDefined(first)
      const versions = yield* Effect.forkChild(
        core.WatchPage({ pageId }).pipe(
          Stream.map((tree) => texts(tree.blocks)),
          Stream.take(3),
          Stream.runCollect,
        ),
      )
      yield* Effect.yieldNow
      const [inserted] = yield* core.Dispatch({
        command: { _tag: "InsertBlock", pageId, parentId: null, after: first.id, text: "new" },
      })
      assert.strictEqual(inserted?._tag, "BlockUpserted")
      const blockId = inserted?._tag === "BlockUpserted" ? inserted.block.id : first.id
      yield* core.Dispatch({
        command: { _tag: "EditText", blockId, from: 3, to: 3, insert: " idea" },
      })
      assert.deepStrictEqual(yield* Fiber.join(versions), [
        [
          "seqno is a local-first outliner",
          "Every block is markdown source",
          "Click a block to edit it",
          "Search lives in the left sidebar, tagged #seqno",
        ],
        [
          "seqno is a local-first outliner",
          "Every block is markdown source",
          "Click a block to edit it",
          "new",
          "Search lives in the left sidebar, tagged #seqno",
        ],
        [
          "seqno is a local-first outliner",
          "Every block is markdown source",
          "Click a block to edit it",
          "new idea",
          "Search lives in the left sidebar, tagged #seqno",
        ],
      ])
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )

  it.effect("deletes a block together with its children", () =>
    Effect.gen(function* () {
      const { core, pageIdOf } = yield* openDemo
      const pageId = pageIdOf("Getting started")
      const [first] = (yield* core.GetPage({ pageId })).blocks
      assert.isDefined(first)
      const events = yield* core.Dispatch({
        command: { _tag: "DeleteBlocks", blockIds: [first.id] },
      })
      assert.deepStrictEqual(
        events.map((event) => event._tag),
        ["BlockDeleted", "BlockDeleted", "BlockDeleted"],
      )
      assert.deepStrictEqual(texts((yield* core.GetPage({ pageId })).blocks), [
        "Search lives in the left sidebar, tagged #seqno",
      ])
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )

  it.effect("keeps a live search in step with edits", () =>
    Effect.gen(function* () {
      const { core, pageIdOf } = yield* openDemo
      const results = yield* Effect.forkChild(
        core.WatchQuery({ query: "ONE BLOCK" }).pipe(
          Stream.map((result) => (result._tag === "BlockRows" ? texts(result.blocks) : [])),
          Stream.take(2),
          Stream.runCollect,
        ),
      )
      yield* Effect.yieldNow
      yield* core.Dispatch({
        command: {
          _tag: "InsertBlock",
          pageId: pageIdOf("Ideas"),
          parentId: null,
          text: "One block more",
        },
      })
      assert.deepStrictEqual(yield* Fiber.join(results), [
        ["A page with one block"],
        ["One block more", "A page with one block"],
      ])
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )

  it.effect("rejects commands that only @seqno/graph implements", () =>
    Effect.gen(function* () {
      const { core, pageIdOf } = yield* openDemo
      const [first] = (yield* core.GetPage({ pageId: pageIdOf("Ideas") })).blocks
      assert.isDefined(first)
      const error = yield* Effect.flip(
        core.Dispatch({ command: { _tag: "Indent", blockIds: [first.id] } }),
      )
      assert.deepStrictEqual(
        [error._tag, error._tag === "CommandRejected" && error.reason],
        ["CommandRejected", "Indent is not in the stub core; @seqno/graph implements it"],
      )
    }).pipe(Effect.scoped, Effect.provide(Core)),
  )
})
