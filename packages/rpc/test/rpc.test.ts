import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Option, Ref, Stream, SubscriptionRef } from "effect"
import { RpcTest } from "effect/rpc"
import {
  BlockId,
  Command,
  PageId,
  normalizePageName,
  type GraphEvent,
  type Page,
} from "@seqno/domain"
import { CommandRejected, CoreRpcs, GraphNotOpen, PageNotFound, type PageTree } from "@seqno/rpc"

const pageId = PageId.make("01920000-0000-7000-8000-0000000000aa")
const blockId = BlockId.make("01920000-0000-7000-8000-000000000001")

type Applied = Effect.Effect<ReadonlyArray<GraphEvent>, CommandRejected>

const InMemoryCore = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const opened = yield* Ref.make(false)
    const tree = yield* SubscriptionRef.make(Option.none<PageTree>())
    const whenOpen = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.flatMap(Ref.get(opened), (isOpen): Effect.Effect<A, E | GraphNotOpen> =>
        isOpen ? effect : Effect.fail(new GraphNotOpen()),
      )
    const findPage = (id: PageId) =>
      Effect.flatMap(SubscriptionRef.get(tree), (current) =>
        Option.match(
          Option.filter(current, (found) => found.page.id === id),
          {
            onNone: () => Effect.fail(new PageNotFound({ pageId: id })),
            onSome: Effect.succeed,
          },
        ),
      )
    const rejected: Applied = Effect.fail(
      new CommandRejected({ reason: "not in the in-memory core" }),
    )
    const apply = (command: Command) =>
      Command.match(command, {
        CreatePage: ({ title }): Applied => {
          const page: Page = {
            id: pageId,
            name: normalizePageName(title),
            title,
            journalDay: null,
            props: {},
          }
          return Effect.as(SubscriptionRef.set(tree, Option.some({ page, blocks: [] })), [
            { _tag: "PageUpserted" as const, page },
          ])
        },
        InsertBlock: ({ pageId: target, parentId, text }): Applied =>
          Effect.flatMap(findPage(target), (current) => {
            const block = {
              id: blockId,
              pageId: target,
              parentId,
              text,
              collapsed: false,
              props: {},
            }
            return Effect.as(
              SubscriptionRef.set(
                tree,
                Option.some({ ...current, blocks: [...current.blocks, block] }),
              ),
              [{ _tag: "BlockUpserted" as const, block, createdAt: 1, updatedAt: 1 }],
            )
          }).pipe(Effect.mapError(() => new CommandRejected({ reason: "page does not exist" }))),
        RenamePage: () => rejected,
        DeletePage: () => rejected,
        EditText: () => rejected,
        SplitBlock: () => rejected,
        MergeWithPrevious: () => rejected,
        Indent: () => rejected,
        Outdent: () => rejected,
        MoveBlocks: () => rejected,
        DeleteBlocks: () => rejected,
        SetCollapsed: () => rejected,
        SetProperty: () => rejected,
        Undo: () => rejected,
        Redo: () => rejected,
      })
    return CoreRpcs.of({
      OpenGraph: ({ graph }) => Effect.as(Ref.set(opened, true), { graph, pages: [] }),
      Dispatch: ({ command }) => whenOpen(apply(command)),
      GetPages: () =>
        whenOpen(
          Effect.map(SubscriptionRef.get(tree), (current) =>
            Option.match(current, { onNone: () => [], onSome: (found) => [found.page] }),
          ),
        ),
      GetPage: ({ pageId: id }) => whenOpen(findPage(id)),
      GetBlock: () => Effect.fail(new GraphNotOpen()),
      WatchPage: ({ pageId: id }) =>
        Stream.unwrap(
          whenOpen(
            Effect.as(
              findPage(id),
              SubscriptionRef.changes(tree).pipe(
                Stream.filter(Option.isSome),
                Stream.map((current) => current.value),
              ),
            ),
          ),
        ),
      WatchQuery: () => Stream.empty,
      Search: () => whenOpen(Effect.succeed({ pages: [], blocks: [] })),
    })
  }),
)

const client = RpcTest.makeClient(CoreRpcs)

describe("CoreRpcs over the in-memory transport", () => {
  it.effect("refuses commands before a graph is open", () =>
    Effect.gen(function* () {
      const core = yield* client
      const error = yield* Effect.flip(core.Dispatch({ command: { _tag: "Undo" } }))
      assert.strictEqual(error._tag, "GraphNotOpen")
    }).pipe(Effect.scoped, Effect.provide(InMemoryCore)),
  )

  it.effect("creates a page, inserts a block and reads both back", () =>
    Effect.gen(function* () {
      const core = yield* client
      assert.deepStrictEqual(yield* core.OpenGraph({ graph: "notes" }), {
        graph: "notes",
        pages: [],
      })
      const events = yield* core.Dispatch({ command: { _tag: "CreatePage", title: "Project X" } })
      assert.deepStrictEqual(events, [
        {
          _tag: "PageUpserted",
          page: { id: pageId, name: "project x", title: "Project X", journalDay: null, props: {} },
        },
      ])
      yield* core.Dispatch({
        command: { _tag: "InsertBlock", pageId, parentId: null, text: "first [[idea]]" },
      })
      const tree = yield* core.GetPage({ pageId })
      assert.deepStrictEqual(
        tree.blocks.map((block) => block.text),
        ["first [[idea]]"],
      )
      assert.deepStrictEqual(
        (yield* core.GetPages()).map((page) => page.name),
        ["project x"],
      )
    }).pipe(Effect.scoped, Effect.provide(InMemoryCore)),
  )

  it.effect("streams the page tree as it changes", () =>
    Effect.gen(function* () {
      const core = yield* client
      yield* core.OpenGraph({ graph: "notes" })
      yield* core.Dispatch({ command: { _tag: "CreatePage", title: "Inbox" } })
      const updates = yield* Effect.forkChild(
        core.WatchPage({ pageId }).pipe(
          Stream.map((tree) => tree.blocks.length),
          Stream.take(2),
          Stream.runCollect,
        ),
      )
      yield* Effect.yieldNow
      yield* core.Dispatch({ command: { _tag: "InsertBlock", pageId, parentId: null, text: "a" } })
      assert.deepStrictEqual(yield* Fiber.join(updates), [0, 1])
    }).pipe(Effect.scoped, Effect.provide(InMemoryCore)),
  )

  it.effect("reports a missing page as PageNotFound", () =>
    Effect.gen(function* () {
      const core = yield* client
      yield* core.OpenGraph({ graph: "notes" })
      const other = PageId.make("01920000-0000-7000-8000-0000000000bb")
      const error = yield* Effect.flip(core.GetPage({ pageId: other }))
      assert.deepStrictEqual(
        [error._tag, error._tag === "PageNotFound" && error.pageId],
        ["PageNotFound", other],
      )
    }).pipe(Effect.scoped, Effect.provide(InMemoryCore)),
  )
})
