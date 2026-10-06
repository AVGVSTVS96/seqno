import { Effect, Layer, Stream } from "effect"
import { Atom } from "effect/reactivity"
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

export const dispatchAtom = coreRuntime.fn(
  (command: Command) => Effect.flatMap(CoreClient, (client) => client.Dispatch({ command })),
  { concurrent: true },
)
