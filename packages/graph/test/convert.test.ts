import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { BlockId, JournalDay, PageId, type GraphEvent } from "@seqno/domain"
import { compareConverted, convertOneTree, journalPageId, journalsByDay } from "@seqno/graph"
import { WebCrypto, createdBlock, format, nth, openGraphAs, seedPage } from "./support.ts"

type Opened = Effect.Success<ReturnType<typeof openGraphAs>>

const flushed = (graph: Opened) =>
  Effect.map(
    graph.flush(() => Effect.void),
    (update) => Option.toArray(Option.map(update, ({ bytes }) => bytes)),
  )

const day = Schema.decodeUnknownSync(JournalDay)(20261011)
const journalId = Schema.decodeUnknownSync(PageId)("01920000-0000-7000-8000-000000000001")
const journalBlock = Schema.decodeUnknownSync(BlockId)("01920000-0000-7000-8000-0000000000a1")

const oneBlockPage = (id: PageId, title: string, journalDay: JournalDay | null) => ({
  page: { id, name: title.toLowerCase(), title, journalDay, props: {} },
  blocks: [
    { id: journalBlock, pageId: id, parentId: null, text: title, collapsed: false, props: {} },
  ],
})

const oneTreeGraph = Effect.gen(function* () {
  const left = yield* openGraphAs("v1", "1")
  yield* left.load([
    {
      page: {
        id: journalId,
        name: "oct 11th, 2026",
        title: "Oct 11th, 2026",
        journalDay: day,
        props: {},
      },
      blocks: [
        {
          id: journalBlock,
          pageId: journalId,
          parentId: null,
          text: "today",
          collapsed: true,
          props: { mood: "ok" },
        },
      ],
    },
  ])
  const notes = yield* seedPage(left, "Notes", ["one", "  two", "    three", "four"])
  yield* left.dispatch({
    _tag: "SetProperty",
    target: { _tag: "PageTarget", pageId: notes.pageId },
    key: "alias",
    value: "jottings",
  })
  yield* left.dispatch({
    _tag: "SetProperty",
    target: { _tag: "BlockTarget", blockId: nth(notes.ids, 1) },
    key: "status",
    value: "doing",
  })
  yield* left.dispatch({ _tag: "DeleteBlocks", blockIds: [nth(notes.ids, 3)] })
  const gone = yield* seedPage(left, "Gone", ["bye"])
  yield* left.dispatch({ _tag: "DeletePage", pageId: gone.pageId })
  const right = yield* openGraphAs("v1", "2", { snapshot: yield* left.snapshot })
  yield* seedPage(right, "Shared", ["from right"])
  yield* seedPage(left, "shared", ["from left"])
  yield* left.merge(yield* flushed(right))
  const typed = createdBlock(
    yield* left.dispatch({
      _tag: "InsertBlock",
      pageId: notes.pageId,
      parentId: null,
      text: "five",
    }),
  )
  yield* left.dispatch({ _tag: "EditText", blockId: typed, from: 4, to: 4, insert: "!" })
  return left
})

const everything = (graph: Opened) =>
  Effect.gen(function* () {
    const pages = (yield* graph.pages).toSorted((a, b) => (a.title < b.title ? -1 : 1))
    return yield* Effect.forEach(pages, (page) => graph.pageEvents(page.id))
  })

const renamed = (
  events: ReadonlyArray<ReadonlyArray<GraphEvent>>,
  from: PageId,
  to: PageId,
): unknown => JSON.parse(JSON.stringify(events).replaceAll(from, to))

describe.runIf(format === "v2")("converting one tree to a tree per page", () => {
  it.effect("keeps every live page and block, with ids, props, nesting and times", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const v1 = yield* oneTreeGraph
        const converted = yield* convertOneTree([yield* v1.snapshot])
        const v2 = yield* openGraphAs("v2", "3", { snapshot: converted.snapshot })
        const before = yield* everything(v1)
        assert.deepStrictEqual(
          before.map((events) => events.filter((event) => event._tag === "BlockUpserted").length),
          [4, 1, 2],
        )
        assert.deepStrictEqual(
          yield* everything(v2),
          renamed(before, journalId, journalPageId(day)),
        )
        assert.deepStrictEqual([converted.pages, converted.blocks], [3, 7])
      }),
    ),
  )

  it.effect(
    "writes the same ops for the same graph, so two devices converting it add nothing twice",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const v1 = yield* oneTreeGraph
          const bytes = yield* v1.snapshot
          const first = yield* convertOneTree([bytes])
          const second = yield* convertOneTree([bytes])
          assert.deepStrictEqual(second.snapshot, first.snapshot)
          const v2 = yield* openGraphAs("v2", "3", { snapshot: first.snapshot })
          const version = yield* v2.version
          assert.deepStrictEqual(yield* v2.merge([second.snapshot]), [])
          assert.deepStrictEqual(yield* v2.version, version)
        }),
      ),
  )

  it.effect(
    "checking a converted snapshot against its one-tree files names the pages that differ",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const v1 = yield* oneTreeGraph
          const files = [yield* v1.snapshot]
          const converted = yield* convertOneTree(files)
          assert.deepStrictEqual(yield* compareConverted(files, [converted.snapshot]), {
            pages: 3,
            blocks: 7,
            different: [],
          })
          const notes = (yield* v1.pages).find((page) => page.title === "Notes")
          const first = notes === undefined ? undefined : (yield* v1.page(notes.id)).blocks[0]
          if (first === undefined) return assert.fail("Notes has no blocks")
          yield* v1.dispatch({
            _tag: "EditText",
            blockId: first.id,
            from: 0,
            to: 0,
            insert: "just ",
          })
          yield* seedPage(v1, "Later", ["new"])
          assert.deepStrictEqual(
            yield* compareConverted([yield* v1.snapshot], [converted.snapshot]),
            {
              pages: 4,
              blocks: 8,
              different: ["Later", "Notes"],
            },
          )
        }).pipe(Effect.provide(WebCrypto)),
      ),
  )

  it("gives each day's first journal its day's id, and leaves other pages alone", () => {
    const later = Schema.decodeUnknownSync(PageId)("01920000-0000-7000-8000-000000000009")
    const notes = Schema.decodeUnknownSync(PageId)("01920000-0000-7000-8000-000000000005")
    const pages = [
      oneBlockPage(later, "Oct 11th, 2026", day),
      oneBlockPage(journalId, "Monday notes", day),
      oneBlockPage(notes, "Notes", null),
    ]
    assert.deepStrictEqual(
      journalsByDay(pages).map((tree) => [tree.page.id, tree.blocks[0]?.pageId]),
      [
        [later, later],
        [journalPageId(day), journalPageId(day)],
        [notes, notes],
      ],
    )
  })
})
