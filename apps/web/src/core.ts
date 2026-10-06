import { BrowserWorker } from "@effect/platform-browser"
import { Context, Layer } from "effect"
import { RpcClient, type RpcClientError, type RpcGroup } from "effect/rpc"
import type { WorkerError } from "effect/workers/WorkerError"
import { CoreRpcs } from "@seqno/rpc"

export class Core extends Context.Service<
  Core,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CoreRpcs>, RpcClientError.RpcClientError>
>()("@seqno/web/Core") {}

const callsSharingTheWorker = Number.MAX_SAFE_INTEGER

const spawnCoreWorker = () =>
  new Worker(new URL("./worker/main.ts", import.meta.url), { type: "module", name: "seqno-core" })

export const WorkerCore: Layer.Layer<Core, WorkerError> = Layer.effect(
  Core,
  RpcClient.make(CoreRpcs),
).pipe(
  Layer.provide(RpcClient.layerProtocolWorker({ size: 1, concurrency: callsSharingTheWorker })),
  Layer.provide(BrowserWorker.layer(spawnCoreWorker)),
)
