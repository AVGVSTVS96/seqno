import { BrowserWorker } from "@effect/platform-browser"
import { Layer } from "effect"
import { RpcClient } from "effect/rpc"
import type { WorkerError } from "effect/workers/WorkerError"
import { CoreClient, CoreRpcs } from "@seqno/rpc"

const callsSharingTheWorker = Number.MAX_SAFE_INTEGER

const spawnCoreWorker = () =>
  new Worker(new URL("./worker/main.ts", import.meta.url), { type: "module", name: "seqno-core" })

export const WorkerCore: Layer.Layer<CoreClient, WorkerError> = Layer.effect(
  CoreClient,
  RpcClient.make(CoreRpcs),
).pipe(
  Layer.provide(RpcClient.layerProtocolWorker({ size: 1, concurrency: callsSharingTheWorker })),
  Layer.provide(BrowserWorker.layer(spawnCoreWorker)),
)
