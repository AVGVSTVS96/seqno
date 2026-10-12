import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createdPage, nth, openGraph, seedPage } from "./support.ts"

describe("changes since a version", () => {
  it.effect(
    "name the pages touched since then, and the blocks whose old page the index knows",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const graph = yield* openGraph("1")
          yield* seedPage(graph, "Untouched", ["calm"])
          const edited = yield* seedPage(graph, "Edited", ["draft"])
          const from = yield* seedPage(graph, "From", ["leaving", "staying"])
          const to = yield* seedPage(graph, "To", ["anchor"])
          const gone = yield* seedPage(graph, "Gone", ["bye"])
          const since = yield* graph.version
          yield* graph.dispatch({
            _tag: "EditText",
            blockId: nth(edited.ids, 0),
            from: 5,
            to: 5,
            insert: "ed",
          })
          yield* graph.dispatch({
            _tag: "MoveBlocks",
            blockIds: [nth(from.ids, 0)],
            parentId: null,
            after: nth(to.ids, 0),
          })
          yield* graph.dispatch({ _tag: "DeletePage", pageId: gone.pageId })
          const created = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title: "New" }))
          const changed = Option.getOrThrow(yield* graph.changedSince(since))
          assert.deepStrictEqual(
            [...changed.pages].toSorted(),
            [edited.pageId, to.pageId, gone.pageId, created].toSorted(),
          )
          assert.deepStrictEqual(
            [nth(edited.ids, 0), nth(from.ids, 0)].map((block) => changed.blocks.has(block)),
            [true, true],
          )
        }),
      ),
  )

  it.effect("are unknown for a version the graph does not hold, or for no version at all", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        yield* seedPage(graph, "Notes", ["one"])
        assert.deepStrictEqual(
          [yield* graph.changedSince(new Map([["999", 3]])), yield* graph.changedSince(new Map())],
          [Option.none(), Option.none()],
        )
      }),
    ),
  )
})
