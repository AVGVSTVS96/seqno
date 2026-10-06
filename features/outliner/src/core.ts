import { Context, Effect, Layer, Stream } from "effect"
import { Atom } from "effect/reactivity"
import type { RpcClient, RpcClientError, RpcGroup } from "effect/rpc"
import type { BlockId, Command, PageId } from "@seqno/domain"
import type { CoreRpcs } from "@seqno/rpc"

export class CoreClient extends Context.Service<
  CoreClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CoreRpcs>, RpcClientError.RpcClientError>
>()("@seqno/outliner/CoreClient") {}

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

export const dispatchAtom = coreRuntime.fn(
  (command: Command) => Effect.flatMap(CoreClient, (client) => client.Dispatch({ command })),
  { concurrent: true },
)
