import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option, Stream } from "effect"
import type { GraphEvent, PageId } from "@seqno/domain"
import { nth, openGraph, outline, seedPage } from "./support.ts"

const upserted = (events: ReadonlyArray<GraphEvent>) =>
  events
    .flatMap((event) =>
      event._tag === "BlockUpserted"
        ? [`${event.block.pageId} ${event.block.parentId} ${event.block.text}`]
        : event._tag === "PageUpserted"
          ? [`page ${event.page.title}`]
          : [],
    )
    .toSorted()

describe("restoring an edit log into an empty graph", () => {
  it.effect("finds a block by its page before walking every page, and by a stale page after", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        const others = yield* Effect.forEach(
          Array.from({ length: 50 }, (_, at) => `Page ${at}`),
          (title) => Effect.map(seedPage(origin, title, ["note"]), ({ pageId }) => pageId),
        )
        const { pageId, ids } = yield* seedPage(origin, "Deep", ["outer", "  inner"])
        const elsewhere = nth(others, 0)
        const snapshot = yield* origin.snapshot
        const reopened = Effect.tap(openGraph("2"), (graph) => graph.restore([snapshot]))
        const now = (graph: Effect.Success<typeof reopened>, page: PageId) =>
          Exit.map(Effect.runSyncExit(graph.block(nth(ids, 1), page)), (block) => block.text)

        assert.deepStrictEqual(now(yield* reopened, pageId), Exit.succeed("inner"))
        const stale = yield* reopened
        assert.strictEqual(Exit.isSuccess(now(stale, elsewhere)), false)
        assert.strictEqual((yield* stale.block(nth(ids, 1), elsewhere)).text, "inner")
      }),
    ),
  )

  it.effect("reads back the same pages and blocks a merge would report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        const { pageId } = yield* seedPage(origin, "Garden", ["beds", "  tomatoes", "paths"])
        yield* seedPage(origin, "Tools", ["spade"])
        const snapshot = yield* origin.snapshot

        const merged = yield* openGraph("2")
        const events = yield* merged.merge([snapshot])
        const restored = yield* openGraph("3")
        yield* restored.restore([snapshot])
        const everything = yield* Stream.runCollect(restored.everything)

        assert.deepStrictEqual(upserted(everything.flat()), upserted(events))
        assert.deepStrictEqual(
          outline(yield* restored.page(pageId)),
          outline(yield* merged.page(pageId)),
        )
      }),
    ),
  )

  it.effect("merges two pages with one name, as a merge does", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const phone = yield* openGraph("1")
        const laptop = yield* openGraph("2")
        yield* seedPage(phone, "Oct 10th, 2026", ["from the phone"])
        yield* seedPage(laptop, "Oct 10th, 2026", ["from the laptop"])
        const updates = [
          ...Option.toArray(yield* phone.flush(() => Effect.void)),
          ...Option.toArray(yield* laptop.flush(() => Effect.void)),
        ].map(({ bytes }) => bytes)

        const restored = yield* openGraph("3")
        yield* restored.restore(updates)
        const pages = yield* restored.pages
        assert.deepStrictEqual(
          pages.map((page) => page.title),
          ["Oct 10th, 2026"],
        )
        const [page] = pages
        assert.deepStrictEqual(
          outline(yield* restored.page(page?.id ?? assert.fail("no page"))).toSorted(),
          ["from the laptop", "from the phone"],
        )
      }),
    ),
  )

  it.effect("a graph that already holds ops merges instead", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* openGraph("1")
        yield* seedPage(origin, "Garden", ["beds"])
        const restored = yield* openGraph("2")
        yield* seedPage(restored, "Tools", ["spade"])
        yield* restored.restore([yield* origin.snapshot])
        assert.deepStrictEqual((yield* restored.pages).map((page) => page.title).toSorted(), [
          "Garden",
          "Tools",
        ])
      }),
    ),
  )
})
