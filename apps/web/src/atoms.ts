import { Effect, Equal, Layer, Option, Schema, Stream } from "effect"
import { AsyncResult, Atom, Reactivity } from "effect/reactivity"
import type { WorkerError } from "effect/workers/WorkerError"
import type { Command, Page } from "@seqno/domain"
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

export const openGraph = appRuntime
  .fn((source: GraphSource) =>
    Effect.gen(function* () {
      const locations = yield* GraphLocations
      const location = yield* GraphSource.match(source, {
        PickFolder: () => locations.pickFolder,
        Demo: () => locations.demo,
        Recent: ({ name }) => locations.reopen(name),
      })
      const core = yield* CoreClient
      const opened = yield* core.OpenGraph({ graph: location.name })
      yield* Reactivity.invalidate(pagesKey)
      return opened
    }),
  )
  .pipe(Atom.keepAlive)

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

export const rightSidebarOpen = Atom.make(true).pipe(Atom.keepAlive)

export const search = Atom.family((query: string) =>
  appRuntime.atom(
    Stream.unwrap(Effect.map(Effect.service(CoreClient), (core) => core.WatchQuery({ query }))),
  ),
)
