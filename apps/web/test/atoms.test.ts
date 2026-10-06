import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { RpcTest } from "effect/rpc"
import { BlockId, Command, PageId, type Block, type GraphEvent, type Page } from "@seqno/domain"
import { CommandRejected, CoreClient, CoreRpcs, type PageTree } from "@seqno/rpc"
import {
  appLayer,
  favorites,
  journals,
  openGraph,
  pageNamed,
  type AppServices,
} from "../src/atoms.ts"
import { GraphLocations, type GraphLocation } from "../src/graph-locations.ts"

const pageOf = (id: string, title: string, journalDay: number | null, favorite: boolean): Page => ({
  id: PageId.make(id),
  name: title.toLowerCase(),
  title,
  journalDay,
  props: favorite ? { favorite: "true" } : {},
})

const inbox = pageOf("01920000-0000-7000-8000-0000000000a1", "Inbox", null, true)
const older = pageOf("01920000-0000-7000-8000-0000000000a2", "Oct 5th, 2026", 20261005, false)
const today = pageOf("01920000-0000-7000-8000-0000000000a3", "Oct 6th, 2026", 20261006, false)

const blockOf = (id: string, parent: string | null, text: string, collapsed: boolean): Block => ({
  id: BlockId.make(id),
  pageId: inbox.id,
  parentId: parent === null ? null : BlockId.make(parent),
  text,
  collapsed,
  props: {},
})

const parentBlock = blockOf("01920000-0000-7000-8000-000000000001", null, "parent", false)
const childBlock = blockOf("01920000-0000-7000-8000-000000000002", parentBlock.id, "child", false)
const siblingBlock = blockOf("01920000-0000-7000-8000-000000000003", null, "sibling", false)

const FakeCore = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const tree = yield* SubscriptionRef.make<PageTree>({
      page: inbox,
      blocks: [parentBlock, childBlock, siblingBlock],
    })
    const change = (update: (current: Block) => Block, blockId: BlockId) =>
      Effect.map(
        SubscriptionRef.updateAndGet(tree, (current) => ({
          ...current,
          blocks: current.blocks.map((candidate) =>
            candidate.id === blockId ? update(candidate) : candidate,
          ),
        })),
        (current): ReadonlyArray<GraphEvent> =>
          current.blocks
            .filter((candidate) => candidate.id === blockId)
            .map((changed) => ({
              _tag: "BlockUpserted",
              block: changed,
              createdAt: 1,
              updatedAt: 2,
            })),
      )
    const rejected: Effect.Effect<ReadonlyArray<GraphEvent>, CommandRejected> = Effect.fail(
      new CommandRejected({ reason: "not in the fake core" }),
    )
    return CoreRpcs.of({
      OpenGraph: ({ graph }) => Effect.succeed({ graph, pages: [inbox, older, today] }),
      Dispatch: ({ command }) =>
        Command.match(command, {
          EditText: ({ blockId, from, to, insert }) =>
            change(
              (current) => ({
                ...current,
                text: current.text.slice(0, from) + insert + current.text.slice(to),
              }),
              blockId,
            ),
          SetCollapsed: ({ blockId, collapsed }) =>
            change((current) => ({ ...current, collapsed }), blockId),
          CreatePage: () => rejected,
          RenamePage: () => rejected,
          DeletePage: () => rejected,
          InsertBlock: () => rejected,
          SplitBlock: () => rejected,
          MergeWithPrevious: () => rejected,
          Indent: () => rejected,
          Outdent: () => rejected,
          MoveBlocks: () => rejected,
          DeleteBlocks: () => rejected,
          SetProperty: () => rejected,
          Undo: () => rejected,
          Redo: () => rejected,
        }),
      GetPages: () => Effect.succeed([inbox, older, today]),
      GetPage: () => SubscriptionRef.get(tree),
      GetBlock: () => Effect.succeed(parentBlock),
      WatchPage: () => SubscriptionRef.changes(tree),
      WatchQuery: () => Stream.empty,
    })
  }),
)

const TestCore = Layer.effect(CoreClient, RpcTest.makeClient(CoreRpcs)).pipe(
  Layer.provide(FakeCore),
)

const inBrowser = (name: string): GraphLocation => ({ _tag: "OpfsGraph", name })

const DemoLocations = Layer.succeed(GraphLocations, {
  recent: Effect.succeed([]),
  pickFolder: Effect.succeed(inBrowser("notes")),
  demo: Effect.succeed(inBrowser("demo")),
  reopen: (name) => Effect.succeed(inBrowser(name)),
})

const testRegistry = () =>
  AtomRegistry.make({
    initialValues: [
      [appLayer, Layer.merge(TestCore, DemoLocations) satisfies Layer.Layer<AppServices>],
    ],
  })

const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))

describe("app atoms", () => {
  it.effect("opens a graph and derives journals, favorites and pages by name", () =>
    Effect.gen(function* () {
      const registry = testRegistry()
      registry.mount(journals)
      registry.mount(favorites)
      registry.set(openGraph, { _tag: "Demo" })
      yield* settle
      const opened = registry.get(openGraph)
      assert.deepStrictEqual(AsyncResult.isSuccess(opened) ? opened.value : null, {
        graph: "demo",
        pages: [inbox, older, today],
      })
      assert.deepStrictEqual(
        registry.get(journals).map((page) => page.title),
        ["Oct 6th, 2026", "Oct 5th, 2026"],
      )
      assert.deepStrictEqual(
        registry.get(favorites).map((page) => page.title),
        ["Inbox"],
      )
      registry.mount(pageNamed("inbox"))
      yield* settle
      const found = registry.get(pageNamed("inbox"))
      assert.deepStrictEqual(AsyncResult.isSuccess(found) ? found.value : null, Option.some(inbox))
    }),
  )
})
