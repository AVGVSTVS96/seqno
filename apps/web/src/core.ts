import { BrowserWorker } from "@effect/platform-browser"
import { Effect, Exit, Layer, Stream } from "effect"
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
  SaveState,
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

interface Sends {
  readonly inFlight: number
  readonly answered: number
}

const sending = { next: 0, now: { inFlight: 0, answered: 0 }, listeners: new Set<() => void>() }

const change = (next: (now: Sends) => Sends) => {
  sending.now = next(sending.now)
  for (const listener of sending.listeners) listener()
}

export const sends = {
  get: (): Sends => sending.now,
  subscribe: (listener: () => void) => {
    sending.listeners.add(listener)
    return () => sending.listeners.delete(listener)
  },
}

const sent = <A, E, R>(send: (seq: number) => Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    sending.next += 1
    const seq = sending.next
    change((now) => ({ ...now, inFlight: now.inFlight + 1 }))
    return Effect.onExit(send(seq), (exit) =>
      Effect.sync(() =>
        change((now) => ({
          inFlight: now.inFlight - 1,
          answered: Exit.hasInterrupts(exit) ? now.answered : Math.max(now.answered, seq),
        })),
      ),
    )
  })

export const shownSaveState = (worker: SaveState, { inFlight, answered }: Sends) =>
  worker._tag === "Failed"
    ? worker
    : inFlight === 0 && worker._tag === "Saved" && (worker.through ?? answered) >= answered
      ? SaveState.cases.Saved.make({})
      : SaveState.cases.Unsaved.make({})

export const WorkerCore: Layer.Layer<CoreClient, WorkerError> = Layer.effect(
  CoreClient,
  Effect.map(RpcClient.make(CoreRpcs), (client) =>
    CoreClient.of({
      ...client,
      Dispatch: (payload, options) => sent((seq) => client.Dispatch({ ...payload, seq }, options)),
      DispatchAll: (payload, options) =>
        sent((seq) => client.DispatchAll({ ...payload, seq }, options)),
    }),
  ),
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
