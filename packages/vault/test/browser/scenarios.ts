import { Effect, Layer, type Scope } from "effect"
import { Storage, layerDirectoryHandle, layerOpfs } from "@seqno/vault"
import { makeDevice } from "../device.ts"

const freshGraph = Effect.acquireRelease(
  Effect.sync(() => `graph-${crypto.randomUUID()}`),
  (graph) =>
    Effect.promise(async () =>
      (await navigator.storage.getDirectory()).removeEntry(graph, { recursive: true }),
    ),
)

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const storageRoundTrip = Effect.gen(function* () {
  const storage = yield* Effect.provide(Storage, layerOpfs(yield* freshGraph))
  yield* storage.write("updates/mac/0.loro", new Uint8Array([1, 2, 3]))
  yield* storage.write("seen/mac.json", encode('{"v":1}'))
  yield* storage.write("seen/mac.json", encode('{"v":2}'))
  const listed = { updates: yield* storage.list("updates"), seen: yield* storage.list("seen") }
  const read = {
    seen: decode(yield* storage.read("seen/mac.json")),
    update: [...(yield* storage.read("updates/mac/0.loro"))],
  }
  yield* storage.remove("updates/mac/0.loro")
  yield* storage.remove("updates/mac/0.loro")
  const missing = yield* Effect.flip(storage.read("updates/mac/0.loro"))
  return {
    listed,
    read,
    afterRemove: yield* storage.list("updates/mac"),
    neverCreated: yield* storage.list("snapshots"),
    missing: { tag: missing._tag, path: missing.path },
  }
})

const grantedHandle = Effect.gen(function* () {
  const graph = yield* freshGraph
  const folder = yield* Effect.promise(async () =>
    (await navigator.storage.getDirectory()).getDirectoryHandle(graph, { create: true }),
  )
  const storage = yield* Effect.provide(Storage, layerDirectoryHandle(folder))
  yield* storage.write("seen/mac.json", encode("{}"))
  return decode(yield* storage.read("seen/mac.json"))
})

const threeDevices = Effect.gen(function* () {
  const context = yield* Layer.build(layerOpfs(yield* freshGraph))
  const storage = Layer.succeedContext(context)
  const members = ["mac", "ipad"]
  const mac = yield* makeDevice({ id: "mac", peer: "1", members, storage, compactAfterFiles: 2 })
  const ipad = yield* makeDevice({ id: "ipad", peer: "2", members, storage })
  yield* mac.type("hello ")
  yield* mac.type("opfs")
  yield* ipad.sync
  const ipadText = ipad.text()
  const compacted = yield* mac.sync
  yield* ipad.sync
  const collected = yield* mac.sync
  const phone = yield* makeDevice({ id: "phone", peer: "3", members, storage })
  yield* phone.sync
  return {
    ipadText,
    snapshotsWritten: compacted.written.length,
    deleted: collected.deleted,
    phoneText: phone.text(),
  }
})

const scenario =
  <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  (): Promise<unknown> =>
    Effect.runPromise(Effect.scoped(effect))

const scenarios: Record<string, () => Promise<unknown>> = {
  storageRoundTrip: scenario(storageRoundTrip),
  grantedHandle: scenario(grantedHandle),
  threeDevices: scenario(threeDevices),
}

Object.assign(globalThis, { vaultScenario: (name: string) => scenarios[name]?.() })
