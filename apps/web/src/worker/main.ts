import { BrowserCrypto, BrowserRuntime, BrowserWorkerRunner } from "@effect/platform-browser"
import { Effect, Layer, Scheduler } from "effect"
import { RpcServer } from "effect/rpc"
import { initSync } from "loro-crdt/web/loro_wasm.js"
import loroWasm from "loro-crdt/web/loro_wasm_bg.wasm?url"
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

const nested = (left: number, started: number) =>
  left === 0
    ? console.log(
        `seqno-t ${Date.now()} 20 nested timeouts ${Math.round(performance.now() - started)}ms`,
      )
    : setTimeout(() => nested(left - 1, started), 0)
nested(20, performance.now())

let tick = performance.now()
setInterval(() => {
  const now = performance.now()
  if (now - tick > 150) console.log(`seqno-t ${Date.now()} lag ${Math.round(now - tick - 50)}ms`)
  tick = now
}, 50)

const channel = new MessageChannel()
const queued: Array<() => void> = []
channel.port1.addEventListener("message", () => queued.shift()?.())
channel.port1.start()

// Timers nested past five levels wait at least 4 ms each: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-initialisation-steps
const nextTask = (task: () => void) => {
  let live = true
  queued.push(() => {
    if (live) task()
  })
  channel.port2.postMessage(null)
  return () => {
    live = false
  }
}

BrowserRuntime.runMain(
  Layer.launch(Server).pipe(
    Effect.provideService(Scheduler.Scheduler, new Scheduler.MixedScheduler("async", nextTask)),
  ),
)
