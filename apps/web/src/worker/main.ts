import { BrowserCrypto, BrowserRuntime, BrowserWorkerRunner } from "@effect/platform-browser"
import { Effect, Layer, Scheduler } from "effect"
import { RpcServer } from "effect/rpc"
import { initSync } from "loro-crdt/web/loro_wasm.js"
import loroWasm from "loro-crdt/web/loro_wasm_bg.wasm?url"
import { Background } from "@seqno/graph"
import { CoreRpcs, PageRpcs } from "@seqno/rpc"
import { BrowserDevice, BrowserGraphPlaces } from "./browser.ts"
import { RealCore } from "./core.ts"
import { BrowserGraphLocations } from "./locations.ts"
import { layerWebLocks } from "./lock.ts"

const Loro = Layer.effectDiscard(
  Effect.promise(async () => {
    initSync({ module: await WebAssembly.compileStreaming(fetch(loroWasm)) })
  }),
)

const Handlers = RealCore.pipe(
  Layer.provide(BrowserGraphPlaces),
  Layer.provide(BrowserDevice),
  Layer.provide(BrowserGraphLocations),
  Layer.provide(layerWebLocks),
  Layer.provide(BrowserCrypto.layer),
  Layer.provide(Loro),
)

const Protocol = RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(BrowserWorkerRunner.layer))

const Server = RpcServer.layer(CoreRpcs.merge(PageRpcs)).pipe(
  Layer.provide(Handlers),
  Layer.provide(Protocol),
)

const tasksAt = (priority: TaskPriority) =>
  new Scheduler.MixedScheduler("async", (task) => {
    let live = true
    void scheduler.postTask(
      () => {
        if (live) task()
      },
      { priority },
    )
    return () => {
      live = false
    }
  })

BrowserRuntime.runMain(
  Layer.launch(Server).pipe(
    Effect.provideService(Scheduler.Scheduler, tasksAt("user-visible")),
    Effect.provideService(Background, tasksAt("background")),
  ),
)
