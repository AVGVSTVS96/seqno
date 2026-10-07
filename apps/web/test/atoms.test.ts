import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import { KeyValueStore } from "effect/persistence"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { RpcTest } from "effect/rpc"
import { BlockId, Command, PageId, type Block, type GraphEvent, type Page } from "@seqno/domain"
import { CommandRejected, CoreClient, CoreRpcs, type PageTree } from "@seqno/rpc"
import {
  appLayer,
  favorites,
  journals,
  lastGraph,
  leftSidebarOpen,
  openGraph,
  pageNamed,
  prefersDark,
  resolvedTheme,
  rightSidebar,
  settingsLayer,
  startingGraph,
  theme,
  toggleFavorite,
  type AppServices,
} from "../src/atoms.ts"
import { GraphLocations, type GraphLocation } from "../src/graph-locations.ts"

const pageOf = (id: string, title: string, journalDay: number | null): Page => ({
  id: PageId.make(id),
  name: title.toLowerCase(),
  title,
  journalDay,
  props: {},
})

const inbox = pageOf("01920000-0000-7000-8000-0000000000a1", "Inbox", null)
const older = pageOf("01920000-0000-7000-8000-0000000000a2", "Oct 5th, 2026", 20261005)
const today = pageOf("01920000-0000-7000-8000-0000000000a3", "Oct 6th, 2026", 20261006)

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
          InsertBlocks: () => rejected,
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
      Search: () => Effect.succeed({ pages: [], blocks: [] }),
      WatchBlockRefCounts: () => Stream.empty,
      WatchBlockReferences: () => Stream.empty,
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
  resume: (name) => Effect.succeed(inBrowser(name)),
  forget: () => Effect.void,
  assets: () => Effect.succeed(new Map()),
})

const testRegistry = (entries = new Map<string, string>()) =>
  AtomRegistry.make({
    initialValues: [
      [appLayer, Layer.merge(TestCore, DemoLocations) satisfies Layer.Layer<AppServices>],
      [settingsLayer, KeyValueStore.layerStorage(() => memoryStorage(entries))],
    ],
  })

const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))

describe("app atoms", () => {
  it.effect("opens a graph and derives journals, favorites and pages by name", () =>
    Effect.gen(function* () {
      const entries = new Map<string, string>()
      const registry = testRegistry(entries)
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
      assert.deepStrictEqual(registry.get(favorites), [])
      registry.set(toggleFavorite, "inbox")
      yield* settle
      assert.deepStrictEqual(
        [registry.get(favorites).map((page) => page.title), entries.get("seqno.favorites")],
        [["Inbox"], '{"demo":["inbox"]}'],
      )
      registry.set(toggleFavorite, "inbox")
      yield* settle
      assert.deepStrictEqual(registry.get(favorites), [])
      registry.mount(pageNamed("inbox"))
      yield* settle
      const found = registry.get(pageNamed("inbox"))
      assert.deepStrictEqual(AsyncResult.isSuccess(found) ? found.value : null, Option.some(inbox))
    }),
  )

  it.effect("remembers the opened graph, so the next start resumes it instead of the demo", () =>
    Effect.gen(function* () {
      const entries = new Map<string, string>()
      const first = testRegistry(entries)
      assert.deepStrictEqual(startingGraph(first.get(lastGraph)), { _tag: "Demo" })
      first.mount(openGraph)
      first.set(openGraph, { _tag: "PickFolder" })
      yield* settle
      assert.strictEqual(entries.get("seqno.lastGraph"), '"notes"')
      const next = testRegistry(entries)
      assert.deepStrictEqual(startingGraph(next.get(lastGraph)), { _tag: "Resume", name: "notes" })
      next.mount(openGraph)
      next.set(openGraph, startingGraph(next.get(lastGraph)))
      yield* settle
      const opened = next.get(openGraph)
      assert.strictEqual(AsyncResult.isSuccess(opened) ? opened.value.graph : null, "notes")
    }),
  )
})

const memoryStorage = (entries: Map<string, string>): Storage => ({
  get length() {
    return entries.size
  },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  key: (index) => [...entries.keys()][index] ?? null,
  removeItem: (key) => {
    entries.delete(key)
  },
  setItem: (key, value) => {
    entries.set(key, value)
  },
})

const settingsRegistry = (entries: Map<string, string>, systemDark = false) =>
  AtomRegistry.make({
    initialValues: [
      [settingsLayer, KeyValueStore.layerStorage(() => memoryStorage(entries))],
      [prefersDark, systemDark],
    ],
  })

describe("app settings", () => {
  it("theme and the left sidebar start as system and closed, and persist as JSON", () => {
    const entries = new Map<string, string>()
    const first = settingsRegistry(entries)
    assert.strictEqual(first.get(theme), "system")
    assert.strictEqual(first.get(leftSidebarOpen), false)
    first.set(theme, "dark")
    first.set(leftSidebarOpen, true)
    assert.deepStrictEqual(Object.fromEntries(entries), {
      "seqno.theme": '"dark"',
      "seqno.leftSidebar": "true",
    })
    const reopened = settingsRegistry(entries)
    assert.strictEqual(reopened.get(theme), "dark")
    assert.strictEqual(reopened.get(leftSidebarOpen), true)
  })

  it("the system theme resolves through the color scheme preference", () => {
    const registry = settingsRegistry(new Map([["seqno.theme", '"system"']]), true)
    registry.mount(resolvedTheme)
    assert.strictEqual(registry.get(resolvedTheme), "dark")
    registry.set(prefersDark, false)
    assert.strictEqual(registry.get(resolvedTheme), "light")
    registry.set(theme, "dark")
    assert.strictEqual(registry.get(resolvedTheme), "dark")
  })
})

describe("right sidebar", () => {
  it("opens items newest first without duplicates, closes, toggles and clears", () => {
    const registry = AtomRegistry.make()
    const alpha = { _tag: "Page", name: "alpha" } as const
    const block = { _tag: "Block", blockId: parentBlock.id } as const
    registry.set(rightSidebar, { _tag: "Open", item: alpha })
    registry.set(rightSidebar, { _tag: "Open", item: block })
    registry.set(rightSidebar, { _tag: "Open", item: { _tag: "Page", name: "Alpha" } })
    assert.deepStrictEqual(registry.get(rightSidebar), {
      open: true,
      items: [{ _tag: "Page", name: "Alpha" }, block],
    })
    registry.set(rightSidebar, { _tag: "Close", item: block })
    registry.set(rightSidebar, { _tag: "Toggle" })
    assert.deepStrictEqual(registry.get(rightSidebar), {
      open: false,
      items: [{ _tag: "Page", name: "Alpha" }],
    })
    registry.set(rightSidebar, { _tag: "Clear" })
    assert.deepStrictEqual(registry.get(rightSidebar), { open: false, items: [] })
  })
})
