import { BrowserWorker } from "@effect/platform-browser"
import { Effect, Layer, Stream } from "effect"
import { RpcClient } from "effect/rpc"
import type { WorkerError } from "effect/workers/WorkerError"
import {
  AssetClient,
  AssetRpcs,
  CoreClient,
  CoreRpcs,
  GitClient,
  GitRpcs,
  PageClient,
  PageRpcs,
  tabLock,
} from "@seqno/rpc"

declare global {
  // TypeScript's DOM types don't have this option yet: https://github.com/whatwg/html/pull/11600
  interface WorkerOptions {
    readonly extendedLifetime?: boolean
  }
}

const callsSharingTheWorker = Number.MAX_SAFE_INTEGER

const spawnCoreWorker = () =>
  new SharedWorker(new URL("./worker/main.ts", import.meta.url), {
    type: "module",
    name: "seqno-core",
    extendedLifetime: true,
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

export const WorkerAssets: Layer.Layer<AssetClient, WorkerError> = Layer.effect(
  AssetClient,
  RpcClient.make(AssetRpcs),
).pipe(Layer.provide(WorkerProtocol))

export const WorkerGit: Layer.Layer<GitClient, WorkerError> = Layer.effect(
  GitClient,
  RpcClient.make(GitRpcs),
).pipe(Layer.provide(WorkerProtocol))

const holdForThisTab = (name: string) =>
  Effect.callback<void>((resume) => {
    void navigator.locks.request(name, () => {
      resume(Effect.void)
      return new Promise<void>((release) =>
        addEventListener("pagehide", (event) => {
          if (!event.persisted) release()
        }),
      )
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
