import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Effect, Equal, Layer, Option, Schema } from "effect"
import type { KeyValueStore } from "effect/persistence"
import { AsyncResult, Atom, Reactivity } from "effect/reactivity"
import type { WorkerError } from "effect/workers/WorkerError"
import { BlockId, normalizePageName, type Command, type Page } from "@seqno/domain"
import { CoreClient } from "@seqno/rpc"
import { WorkerCore } from "./core.ts"
import { BrowserGraphLocations, GraphLocations } from "./graph-locations.ts"

export type AppServices = CoreClient | GraphLocations

export const appLayer = Atom.make<Layer.Layer<AppServices, WorkerError>>(
  Layer.merge(WorkerCore, BrowserGraphLocations),
).pipe(Atom.keepAlive)

export const appRuntime = Atom.runtime((get) => get(appLayer))

const pagesKey = ["pages"]

export const GraphSource = Schema.TaggedUnion({
  PickFolder: {},
  Demo: {},
  Recent: { name: Schema.NonEmptyString },
})
export type GraphSource = typeof GraphSource.Type

export const recentGraphs = appRuntime.atom(
  Effect.flatMap(Effect.service(GraphLocations), (locations) => locations.recent),
)

export const graphLocked = Atom.make(Option.none<string>()).pipe(Atom.keepAlive)

export const openGraph = appRuntime
  .fn((source: GraphSource, get) =>
    Effect.gen(function* () {
      const locations = yield* GraphLocations
      const location = yield* GraphSource.match(source, {
        PickFolder: () => locations.pickFolder,
        Demo: () => locations.demo,
        Recent: ({ name }) => locations.reopen(name),
      })
      const core = yield* CoreClient
      const graph = location.name
      const opened = yield* core.OpenGraph({ graph }).pipe(
        Effect.catchTag("GraphLocked", () =>
          Effect.suspend(() => {
            get.set(graphLocked, Option.some(graph))
            return core.OpenGraph({ graph, wait: true })
          }).pipe(Effect.ensuring(Effect.sync(() => get.set(graphLocked, Option.none())))),
        ),
      )
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

export const favorites = pageList((all) => all.filter((page) => page.props["favorite"] === "true"))

export const pageNamed = Atom.family((name: string) =>
  Atom.make((get) =>
    AsyncResult.map(get(pages), (all) =>
      Option.fromNullishOr(all.find((page) => page.name === name)),
    ),
  ),
)

export const settingsLayer = Atom.make<Layer.Layer<KeyValueStore.KeyValueStore>>(
  BrowserKeyValueStore.layerLocalStorage,
).pipe(Atom.keepAlive)

const settingsRuntime = Atom.runtime((get) => get(settingsLayer))

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
