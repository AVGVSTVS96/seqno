import { Effect, Layer, Stream } from "effect"
import { Atom, Reactivity } from "effect/reactivity"
import { normalizePageName, type BlockId, type Command, type PageId } from "@seqno/domain"
import { CoreClient } from "@seqno/rpc"

export const coreRuntime = Atom.runtime(
  Layer.effect(CoreClient)(
    Effect.die("No CoreClient: provide one by setting coreRuntime.layer in the atom registry"),
  ),
)

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

export const dispatchAtom = coreRuntime.fn(
  (command: Command) =>
    Effect.flatMap(CoreClient, (client) => client.Dispatch({ command })).pipe(
      Effect.tap((events) =>
        events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")
          ? Reactivity.invalidate(pageListKey)
          : Effect.void,
      ),
    ),
  { concurrent: true },
)

export interface Editing {
  readonly blockId: BlockId
  readonly caret: number
}

export const editRequest = Atom.make<Editing | null>(null).pipe(Atom.keepAlive)
