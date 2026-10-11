import { Effect, Layer, Stream } from "effect"
import { Atom, Reactivity } from "effect/reactivity"
import {
  normalizePageName,
  type BlockId,
  type Command,
  type GraphEvent,
  type PageId,
} from "@seqno/domain"
import { CommandRejected, CoreClient } from "@seqno/rpc"
import { historyFocus, type Editing, type HistoryStep } from "./history.ts"

export const coreLayer = Atom.make<Layer.Layer<CoreClient>>(
  Layer.effect(CoreClient)(
    Effect.die("No CoreClient: provide one by setting coreLayer in the atom registry"),
  ),
).pipe(Atom.keepAlive)

export const coreRuntime = Atom.runtime((get) => get(coreLayer))

export const pageTreeAtom = Atom.family((pageId: PageId) =>
  coreRuntime.atom(Stream.unwrap(Effect.map(CoreClient, (client) => client.WatchPage({ pageId })))),
)

export const blockRefCountsAtom = coreRuntime.atom(
  Stream.unwrap(Effect.map(CoreClient, (client) => client.WatchBlockRefCounts())),
)

export const queryAtom = Atom.family((query: string) =>
  coreRuntime.atom(Stream.unwrap(Effect.map(CoreClient, (client) => client.WatchQuery({ query })))),
)

export const blockReferencesAtom = Atom.family((uuid: string) =>
  coreRuntime.atom(
    Stream.unwrap(Effect.map(CoreClient, (client) => client.WatchBlockReferences({ uuid }))),
  ),
)

export const blockAtom = Atom.family((blockId: BlockId) =>
  coreRuntime.atom(Effect.flatMap(CoreClient, (client) => client.GetBlock({ blockId }))),
)

export const pageNamedAtom = Atom.family((name: string) =>
  coreRuntime.atom(
    Effect.flatMap(CoreClient, (client) =>
      Effect.map(client.GetPages(), (pages) =>
        pages.find((page) => page.name === normalizePageName(name)),
      ),
    ),
  ),
)

export const pageListKey: ReadonlyArray<string> = ["pages"]

const invalidatePageList = (events: ReadonlyArray<GraphEvent>) =>
  events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")
    ? Reactivity.invalidate(pageListKey)
    : Effect.void

export interface Rejection {
  readonly count: number
  readonly reason: string
}

export const rejectionAtom = Atom.make<Rejection>({ count: 0, reason: "" }).pipe(Atom.keepAlive)

export const reportRejection = <A, E, R>(effect: Effect.Effect<A, E, R>, get: Atom.FnContext) =>
  Effect.tapError(effect, (error) =>
    error instanceof CommandRejected
      ? Effect.sync(() =>
          get.set(rejectionAtom, { count: get(rejectionAtom).count + 1, reason: error.reason }),
        )
      : Effect.void,
  )

const dispatched = (command: Command, get: Atom.FnContext) =>
  Effect.flatMap(CoreClient, (client) => client.Dispatch({ command })).pipe(
    Effect.tap(invalidatePageList),
    (effect) => reportRejection(effect, get),
  )

export const dispatchAtom = coreRuntime.fn(dispatched, { concurrent: true })

export const dispatchAllAtom = coreRuntime.fn(
  (commands: ReadonlyArray<Command>, get) =>
    Effect.flatMap(CoreClient, (client) => client.DispatchAll({ commands })).pipe(
      Effect.tap(invalidatePageList),
      (effect) => reportRejection(effect, get),
    ),
  { concurrent: true },
)

export const editRequest = Atom.make<Editing | null>(null).pipe(Atom.keepAlive)

export const historyAtom = coreRuntime
  .fn(
    (step: HistoryStep, get) =>
      Effect.tap(dispatched({ _tag: step }, get), (events) =>
        Effect.sync(() => {
          const focus = historyFocus(events, [])
          if (focus !== null) get.set(editRequest, focus)
        }),
      ),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive)
