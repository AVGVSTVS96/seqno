import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Clock, Effect, Equal, Layer, Option, Schema } from "effect"
import type { KeyValueStore } from "effect/persistence"
import { AsyncResult, Atom, Reactivity } from "effect/reactivity"
import type { WorkerError } from "effect/workers/WorkerError"
import { BlockId, normalizePageName, type Command, type Page } from "@seqno/domain"
import { editRequest, pageListKey } from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"
import { WorkerCore } from "./core.ts"
import { BrowserGraphLocations, GraphLocations } from "./graph-locations.ts"

export type AppServices = CoreClient | GraphLocations

export const appLayer = Atom.make<Layer.Layer<AppServices, WorkerError>>(
  Layer.merge(WorkerCore, BrowserGraphLocations),
).pipe(Atom.keepAlive)

export const appRuntime = Atom.runtime((get) => get(appLayer))

const pagesKey = pageListKey

export const GraphSource = Schema.TaggedUnion({
  PickFolder: {},
  Demo: {},
  Recent: { name: Schema.NonEmptyString },
  Resume: { name: Schema.NonEmptyString },
})
export type GraphSource = typeof GraphSource.Type

export const settingsLayer = Atom.make<Layer.Layer<KeyValueStore.KeyValueStore>>(
  BrowserKeyValueStore.layerLocalStorage,
).pipe(Atom.keepAlive)

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

export const lastGraph = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.lastGraph",
  schema: Schema.NullOr(Schema.NonEmptyString),
  defaultValue: (): string | null => null,
}).pipe(Atom.keepAlive)

export const graphsOpenedAt = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.graphsOpenedAt",
  schema: Schema.Record(Schema.String, Schema.Finite),
  defaultValue: (): Readonly<Record<string, number>> => ({}),
}).pipe(Atom.keepAlive)

export const startingGraph = (last: string | null): GraphSource =>
  last === null ? { _tag: "Demo" } : { _tag: "Resume", name: last }

export const recentGraphs = appRuntime.atom(
  Effect.flatMap(Effect.service(GraphLocations), (locations) => locations.recent),
)

export const forgetGraph = appRuntime.fn((name: string, get) =>
  Effect.flatMap(Effect.service(GraphLocations), (locations) => locations.forget(name)).pipe(
    Effect.tap(() => Effect.sync(() => get.refresh(recentGraphs))),
  ),
)

export const graphLocked = Atom.make(Option.none<string>()).pipe(Atom.keepAlive)

export const attemptedGraph = Atom.make<string | null>(null).pipe(Atom.keepAlive)

export const openGraph = appRuntime
  .fn((source: GraphSource, get) =>
    Effect.gen(function* () {
      const locations = yield* GraphLocations
      const location = yield* GraphSource.match(source, {
        PickFolder: () => locations.pickFolder,
        Demo: () => locations.demo,
        Recent: ({ name }) => locations.reopen(name),
        Resume: ({ name }) => locations.resume(name),
      })
      const core = yield* CoreClient
      const graph = location.name
      get.set(attemptedGraph, graph)
      const opened = yield* core.OpenGraph({ graph }).pipe(
        Effect.catchTag("GraphLocked", () =>
          Effect.suspend(() => {
            get.set(graphLocked, Option.some(graph))
            return core.OpenGraph({ graph, wait: true })
          }).pipe(Effect.ensuring(Effect.sync(() => get.set(graphLocked, Option.none())))),
        ),
      )
      const now = yield* Clock.currentTimeMillis
      get.set(lastGraph, graph)
      get.set(graphsOpenedAt, { ...get.registry.get(graphsOpenedAt), [graph]: now })
      yield* Reactivity.invalidate(pagesKey)
      return opened
    }),
  )
  .pipe(Atom.keepAlive)

const noAssets: ReadonlyMap<string, string> = new Map()

const graphAssets = appRuntime.atom((get) =>
  Option.match(AsyncResult.value(get(openGraph)), {
    onNone: () => Effect.succeed(noAssets),
    onSome: ({ graph }) =>
      Effect.acquireRelease(
        Effect.flatMap(Effect.service(GraphLocations), (locations) => locations.assets(graph)),
        (assets) => Effect.sync(() => assets.forEach((url) => URL.revokeObjectURL(url))),
      ),
  }),
)

export const assetResolver = Atom.make((get) => {
  const assets = AsyncResult.getOrElse(get(graphAssets), () => noAssets)
  return (path: string) => assets.get(path.replace(/^(?:\.{1,2}\/|\/)+/, ""))
})

export const dispatch = appRuntime.fn(
  (command: Command) =>
    Effect.gen(function* () {
      const core = yield* CoreClient
      const events = yield* core.Dispatch({ command })
      if (events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")) {
        yield* Reactivity.invalidate(pagesKey)
      }
      return events
    }),
  { concurrent: true },
)

export const createPage = appRuntime.fn((title: string, get) =>
  Effect.gen(function* () {
    const core = yield* CoreClient
    const created = yield* core.Dispatch({ command: { _tag: "CreatePage", title } })
    const page = created.flatMap((event) => (event._tag === "PageUpserted" ? [event.page] : []))[0]
    if (page !== undefined) {
      const inserted = yield* core.Dispatch({
        command: { _tag: "InsertBlock", pageId: page.id, parentId: null, text: "" },
      })
      const first = inserted.flatMap((event) =>
        event._tag === "BlockUpserted" ? [event.block.id] : [],
      )[0]
      if (first !== undefined) get.set(editRequest, { blockId: first, caret: 0 })
    }
    yield* Reactivity.invalidate(pagesKey)
    return normalizePageName(title)
  }),
)

export const pages = appRuntime
  .atom(Effect.flatMap(Effect.service(CoreClient), (core) => core.GetPages()))
  .pipe(appRuntime.factory.withReactivity(pagesKey))

const pageList = (select: (all: ReadonlyArray<Page>) => ReadonlyArray<Page>) =>
  Atom.make((get) =>
    Option.getOrElse(Option.map(AsyncResult.value(get(pages)), select), () => []),
  ).pipe(Atom.withEquality(Equal.equals))

export const journals = pageList((all) =>
  all
    .filter((page) => page.journalDay !== null)
    .toSorted((left, right) => (right.journalDay ?? 0) - (left.journalDay ?? 0)),
)

export const allPages = pageList((all) =>
  all.toSorted((left, right) => left.name.localeCompare(right.name)),
)

export const favoriteNames = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.favorites",
  schema: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  defaultValue: (): Readonly<Record<string, ReadonlyArray<string>>> => ({}),
}).pipe(Atom.keepAlive)

const openedGraph = (read: <A>(atom: Atom.Atom<A>) => A) =>
  Option.map(AsyncResult.value(read(openGraph)), (opened) => opened.graph)

export const favorites = Atom.make((get): ReadonlyArray<Page> => {
  const names = Option.match(openedGraph(get), {
    onNone: () => [],
    onSome: (graph) => get(favoriteNames)[graph] ?? [],
  })
  const byName = new Map(
    Option.getOrElse(AsyncResult.value(get(pages)), () => []).map((page) => [page.name, page]),
  )
  return names.flatMap((name) => byName.get(name) ?? [])
}).pipe(Atom.withEquality(Equal.equals))

export const toggleFavorite = Atom.writable(
  () => null,
  (ctx, name: string) =>
    Option.map(
      openedGraph((atom) => ctx.get(atom)),
      (graph) => {
        const all = ctx.get(favoriteNames)
        const mine = all[graph] ?? []
        ctx.set(favoriteNames, {
          ...all,
          [graph]: mine.includes(name) ? mine.filter((other) => other !== name) : [...mine, name],
        })
      },
    ),
)

export const pageNamed = Atom.family((name: string) =>
  Atom.make((get) =>
    AsyncResult.map(get(pages), (all) =>
      Option.fromNullishOr(all.find((page) => page.name === name)),
    ),
  ),
)

export const ThemeChoice = Schema.Literals(["light", "dark", "system"])
export type ThemeChoice = typeof ThemeChoice.Type

export const theme = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.theme",
  schema: ThemeChoice,
  defaultValue: (): ThemeChoice => "system",
}).pipe(Atom.keepAlive)

export const prefersDark = Atom.make(false).pipe(Atom.keepAlive)

export const resolvedTheme = Atom.make((get): "light" | "dark" => {
  const choice = get(theme)
  if (choice !== "system") return choice
  return get(prefersDark) ? "dark" : "light"
})

export const leftSidebarOpen = Atom.kvs({
  runtime: settingsRuntime,
  key: "seqno.leftSidebar",
  schema: Schema.Boolean,
  defaultValue: () => true,
}).pipe(Atom.keepAlive)

export const searchOpen = Atom.make(false).pipe(Atom.keepAlive)

export const SidebarItem = Schema.TaggedUnion({
  Page: { name: Schema.String },
  Block: { blockId: BlockId },
  Help: {},
})
export type SidebarItem = typeof SidebarItem.Type

export const SidebarAction = Schema.TaggedUnion({
  Open: { item: SidebarItem },
  Close: { item: SidebarItem },
  Toggle: {},
  Clear: {},
})
export type SidebarAction = typeof SidebarAction.Type

export interface RightSidebar {
  readonly open: boolean
  readonly items: ReadonlyArray<SidebarItem>
}

export const sidebarItemKey = (item: SidebarItem) =>
  SidebarItem.match(item, {
    Page: ({ name }) => `page:${normalizePageName(name)}`,
    Block: ({ blockId }) => `block:${blockId}`,
    Help: () => "help",
  })

const without = (items: ReadonlyArray<SidebarItem>, item: SidebarItem) =>
  items.filter((other) => sidebarItemKey(other) !== sidebarItemKey(item))

const sidebarAfter = (state: RightSidebar, action: SidebarAction): RightSidebar =>
  SidebarAction.match(action, {
    Open: ({ item }) => ({ open: true, items: [item, ...without(state.items, item)] }),
    Close: ({ item }) => ({ ...state, items: without(state.items, item) }),
    Toggle: () => ({ ...state, open: !state.open }),
    Clear: () => ({ open: false, items: [] }),
  })

const sidebarState = Atom.make<RightSidebar>({ open: false, items: [] }).pipe(Atom.keepAlive)

export const rightSidebar = Atom.writable(
  (get) => get(sidebarState),
  (ctx, action: SidebarAction) =>
    ctx.set(sidebarState, sidebarAfter(ctx.get(sidebarState), action)),
).pipe(Atom.keepAlive)
