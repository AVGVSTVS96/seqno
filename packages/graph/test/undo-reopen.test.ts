import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { LocalUpdate } from "@seqno/graph"
import { nth, openGraph, outline, seedPage } from "./support.ts"

describe("undo after reopening", () => {
  it.effect("undoes only the edit made after merging this device's own saved files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const before = yield* openGraph("7")
        const { pageId, ids } = yield* seedPage(before, "Garden Plan", ["Beds run north", "Water"])
        const files: Array<LocalUpdate> = []
        yield* before.flush((update) => Effect.sync(() => void files.push(update)))

        const reopened = yield* openGraph("7")
        yield* reopened.merge(files.map(({ bytes }) => bytes))
        yield* reopened.dispatch({
          _tag: "EditText",
          blockId: nth(ids, 0),
          from: 14,
          to: 14,
          insert: "!",
        })
        assert.deepStrictEqual(outline(yield* reopened.page(pageId)), ["Beds run north!", "Water"])

        yield* reopened.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* reopened.page(pageId)), ["Beds run north", "Water"])
        yield* reopened.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* reopened.page(pageId)), ["Beds run north", "Water"])
        assert.deepStrictEqual(
          (yield* reopened.pages).map((page) => page.title),
          ["Garden Plan"],
        )
      }),
    ),
  )
})
