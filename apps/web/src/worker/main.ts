import { BrowserCrypto, BrowserRuntime, BrowserWorkerRunner } from "@effect/platform-browser"
import { Layer } from "effect"
import { RpcServer } from "effect/rpc"
import { CoreRpcs } from "@seqno/rpc"
import { BrowserGraphLocations } from "./locations.ts"
import { StubCore } from "./stub-core.ts"

const Handlers = StubCore.pipe(
  Layer.provide(BrowserGraphLocations),
  Layer.provide(BrowserCrypto.layer),
)

const Protocol = RpcServer.layerProtocolWorkerRunner.pipe(Layer.provide(BrowserWorkerRunner.layer))

const Server = RpcServer.layer(CoreRpcs).pipe(Layer.provide(Handlers), Layer.provide(Protocol))

BrowserRuntime.runMain(Layer.launch(Server))
