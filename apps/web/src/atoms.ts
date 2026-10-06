import { Effect, Equal, Layer, Option, Schema, Stream } from "effect"
import { AsyncResult, Atom, Reactivity } from "effect/reactivity"
import type { WorkerError } from "effect/workers/WorkerError"
import type { Block, BlockId, Command, Page, PageId } from "@seqno/domain"
import { Core, WorkerCore } from "./core.ts"
import { BrowserGraphLocations, GraphLocations } from "./graph-locations.ts"

export type AppServices = Core | GraphLocations

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
      const core = yield* Core
      const opened = yield* core.OpenGraph({ graph: location.name })
      yield* Reactivity.invalidate(pagesKey)
      return opened
    }),
  )
  .pipe(Atom.keepAlive)

export const dispatch = appRuntime.fn(
  (command: Command) =>
    Effect.gen(function* () {
      const core = yield* Core
      const events = yield* core.Dispatch({ command })
      if (events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")) {
        yield* Reactivity.invalidate(pagesKey)
      }
      return events
    }),
  { concurrent: true },
)

export const pages = appRuntime
  .atom(Effect.flatMap(Effect.service(Core), (core) => core.GetPages()))
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

export const pageTree = Atom.family((pageId: PageId) =>
  appRuntime.atom(
    Stream.unwrap(Effect.map(Effect.service(Core), (core) => core.WatchPage({ pageId }))),
  ),
)

export interface Row {
  readonly blockId: BlockId
  readonly depth: number
  readonly hasChildren: boolean
  readonly collapsed: boolean
}

export const visibleRows = (blocks: ReadonlyArray<Block>): ReadonlyArray<Row> => {
  const depths = new Map<BlockId, number>()
  const hidden = new Set<BlockId>()
  return blocks.flatMap((block, index) => {
    const parentDepth = block.parentId === null ? -1 : (depths.get(block.parentId) ?? -1)
    depths.set(block.id, parentDepth + 1)
    const parentHidden = block.parentId !== null && hidden.has(block.parentId)
    const parentCollapsed =
      block.parentId !== null &&
      blocks.some((other) => other.id === block.parentId && other.collapsed)
    if (parentHidden || parentCollapsed) {
      hidden.add(block.id)
      return []
    }
    const hasChildren = blocks[index + 1]?.parentId === block.id
    return [{ blockId: block.id, depth: parentDepth + 1, hasChildren, collapsed: block.collapsed }]
  })
}

export const rows = Atom.family((pageId: PageId) =>
  Atom.make((get) =>
    Option.getOrElse(
      Option.map(AsyncResult.value(get(pageTree(pageId))), (tree) => visibleRows(tree.blocks)),
      () => [],
    ),
  ).pipe(Atom.withEquality(Equal.equals)),
)

export const block = Atom.family((key: { readonly pageId: PageId; readonly blockId: BlockId }) =>
  Atom.make((get) =>
    Option.flatMap(AsyncResult.value(get(pageTree(key.pageId))), (tree) =>
      Option.fromNullishOr(tree.blocks.find((candidate) => candidate.id === key.blockId)),
    ),
  ).pipe(Atom.withEquality(Equal.equals)),
)

export const focusedBlock = Atom.make(Option.none<BlockId>()).pipe(Atom.keepAlive)

export const rightSidebarOpen = Atom.make(true).pipe(Atom.keepAlive)

export const search = Atom.family((query: string) =>
  appRuntime.atom(
    Stream.unwrap(Effect.map(Effect.service(Core), (core) => core.WatchQuery({ query }))),
  ),
)
