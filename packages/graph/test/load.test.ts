import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { BlockId, PageId } from "@seqno/domain"
import { openGraph } from "./support.ts"

const pageId = Schema.decodeUnknownSync(PageId)("01920000-0000-7000-8000-000000000001")
const parent = Schema.decodeUnknownSync(BlockId)("01920000-0000-7000-8000-0000000000a1")
const child = Schema.decodeUnknownSync(BlockId)("01920000-0000-7000-8000-0000000000a2")

const imported = {
  page: {
    id: pageId,
    name: "oct 6th, 2026",
    title: "Oct 6th, 2026",
    journalDay: 20261006,
    props: { icon: "sun" },
  },
  blocks: [
    { id: parent, pageId, parentId: null, text: "plan", collapsed: true, props: { status: "on" } },
    { id: child, pageId, parentId: parent, text: "see [[Ideas]]", collapsed: false, props: {} },
  ],
}

describe("load", () => {
  it.effect("keeps the ids, journal day, props and nesting it is given", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const events = yield* graph.load([imported])
        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ["PageUpserted", "BlockUpserted", "BlockUpserted"],
        )
        assert.deepStrictEqual(yield* graph.page(pageId), imported)
        assert.deepStrictEqual(yield* graph.block(child), imported.blocks[1])
      }),
    ),
  )

  it.effect(
    "seeding the same pages on two devices writes the same ops, so merging adds nothing",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const left = yield* openGraph("1")
          const right = yield* openGraph("2")
          const fromLeft = yield* left.seed([imported])
          const fromRight = yield* right.seed([imported])
          if (Option.isNone(fromLeft.update) || Option.isNone(fromRight.update)) {
            return assert.fail("an empty graph seeds under its own writer")
          }
          assert.deepStrictEqual(fromLeft.update.value.bytes, fromRight.update.value.bytes)
          assert.notStrictEqual(fromLeft.update.value.peer, "1")
          assert.deepStrictEqual(yield* left.merge([fromRight.update.value.bytes]), [])
          assert.deepStrictEqual(yield* left.page(pageId), imported)
          assert.deepStrictEqual(yield* left.flush(() => Effect.void), Option.none())
          yield* left.dispatch({
            _tag: "EditText",
            blockId: child,
            from: 0,
            to: 0,
            insert: "go ",
          })
          const own = yield* left.flush(() => Effect.void)
          assert.deepStrictEqual(
            Option.map(own, (update) => update.peer),
            Option.some("1"),
          )
        }),
      ),
  )

  it.effect("cannot be undone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        yield* graph.load([imported])
        assert.deepStrictEqual(yield* graph.dispatch({ _tag: "Undo" }), [])
        assert.deepStrictEqual(
          (yield* graph.pages).map((page) => page.title),
          ["Oct 6th, 2026"],
        )
      }),
    ),
  )
})
