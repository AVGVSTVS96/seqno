import { BrowserWorker } from "@effect/platform-browser"
import { Effect, Layer, Stream } from "effect"
import { RpcClient } from "effect/rpc"
import type { WorkerError } from "effect/workers/WorkerError"
import { CoreClient, CoreRpcs, PageClient, PageRpcs, tabLock } from "@seqno/rpc"

const callsSharingTheWorker = Number.MAX_SAFE_INTEGER

const spawnCoreWorker = () =>
  new SharedWorker(new URL("./worker/main.ts", import.meta.url), {
    type: "module",
    name: "seqno-core",
  })

const WorkerProtocol = RpcClient.layerProtocolWorker({
  size: 1,
  concurrency: callsSharingTheWorker,
}).pipe(Layer.provide(BrowserWorker.layer(spawnCoreWorker)))

export const WorkerCore: Layer.Layer<CoreClient, WorkerError> = Layer.effect(
  CoreClient,
  RpcClient.make(CoreRpcs),
).pipe(Layer.provide(WorkerProtocol))

export const WorkerPages: Layer.Layer<PageClient, WorkerError> = Layer.effect(
  PageClient,
  RpcClient.make(PageRpcs),
).pipe(Layer.provide(WorkerProtocol))

const holdForThisTab = (name: string) =>
  Effect.callback<void>((resume) => {
    void navigator.locks.request(name, () => {
      resume(Effect.void)
      return new Promise<never>(() => {})
    })
  })

export const attachTab = Stream.unwrap(
  Effect.gen(function* () {
    const tab = crypto.randomUUID()
    yield* holdForThisTab(tabLock(tab))
    const core = yield* CoreClient
    return core.Attach({ tab })
  }),
)
