import { Effect, Layer, Stream } from "effect"
import { Atom, Reactivity } from "effect/reactivity"
import { normalizePageName, type BlockId, type Command, type PageId } from "@seqno/domain"
import { CoreClient } from "@seqno/rpc"
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

const dispatched = (command: Command) =>
  Effect.flatMap(CoreClient, (client) => client.Dispatch({ command })).pipe(
    Effect.tap((events) =>
      events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")
        ? Reactivity.invalidate(pageListKey)
        : Effect.void,
    ),
  )

export const dispatchAtom = coreRuntime.fn(dispatched, { concurrent: true })

export const editRequest = Atom.make<Editing | null>(null).pipe(Atom.keepAlive)

export const historyAtom = coreRuntime
  .fn(
    (step: HistoryStep, get) =>
      Effect.tap(dispatched({ _tag: step }), (events) =>
        Effect.sync(() => {
          const focus = historyFocus(events, [])
          if (focus !== null) get.set(editRequest, focus)
        }),
      ),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive)
