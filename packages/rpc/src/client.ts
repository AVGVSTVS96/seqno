import { Context } from "effect"
import type { RpcClient, RpcClientError, RpcGroup } from "effect/rpc"
import type { CoreRpcs } from "./rpcs.ts"

export class CoreClient extends Context.Service<
  CoreClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CoreRpcs>, RpcClientError.RpcClientError>
>()("@seqno/rpc/CoreClient") {}
