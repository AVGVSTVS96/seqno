import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { GraphEvent } from "@seqno/domain"
import type { LocalUpdate } from "@seqno/graph"
import { createdBlock, nth, openGraph, outline, seedPage } from "./support.ts"

const upsertOrder = (events: ReadonlyArray<GraphEvent>) =>
  events.flatMap((event) =>
    event._tag === "PageUpserted"
      ? [`page ${event.page.title}`]
      : event._tag === "BlockUpserted"
        ? [event.block.text]
        : [],
  )

describe("reopening a graph", () => {
  it.effect("sends a parent's BlockUpserted before an older block moved under it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const before = yield* openGraph("7")
        const { pageId, ids } = yield* seedPage(before, "Demo", ["Welcome", "Getting started"])
        const parent = createdBlock(
          yield* before.dispatch({
            _tag: "InsertBlock",
            pageId,
            parentId: null,
            after: nth(ids, 0),
            text: "New parent",
          }),
        )
        yield* before.dispatch({ _tag: "Indent", blockIds: [nth(ids, 1)] })
        const files: Array<LocalUpdate> = []
        yield* before.flush((update) => Effect.sync(() => void files.push(update)))

        const reopened = yield* openGraph("7")
        const events = yield* reopened.merge(files.map(({ bytes }) => bytes))
        assert.deepStrictEqual(upsertOrder(events), [
          "page Demo",
          "Welcome",
          "New parent",
          "Getting started",
        ])
        assert.deepStrictEqual(
          events.flatMap((event) =>
            event._tag === "BlockUpserted" && event.block.text === "Getting started"
              ? [event.block.parentId]
              : [],
          ),
          [parent],
        )
        assert.deepStrictEqual(outline(yield* reopened.page(pageId)), [
          "Welcome",
          "New parent",
          "  Getting started",
        ])
      }),
    ),
  )
})
