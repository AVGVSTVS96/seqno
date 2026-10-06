import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Storage, layerDirectoryHandle, layerOpfs } from "@seqno/vault"
import { makeDevice } from "./device.ts"

const freshGraph = Effect.acquireRelease(
  Effect.sync(() => `graph-${crypto.randomUUID()}`),
  (graph) =>
    Effect.promise(async () =>
      (await navigator.storage.getDirectory()).removeEntry(graph, { recursive: true }),
    ),
)

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("OPFS storage", () => {
  it.effect("writes, lists, overwrites, reads and removes files in nested folders", () =>
    Effect.gen(function* () {
      const graph = yield* freshGraph
      const storage = yield* Effect.provide(Storage, layerOpfs(graph))
      yield* storage.write("updates/mac/0.loro", new Uint8Array([1, 2, 3]))
      yield* storage.write("seen/mac.json", new TextEncoder().encode('{"v":1}'))
      yield* storage.write("seen/mac.json", new TextEncoder().encode('{"v":2}'))
      assert.deepStrictEqual(yield* storage.list("updates"), [{ _tag: "Directory", name: "mac" }])
      assert.deepStrictEqual(yield* storage.list("seen"), [
        { _tag: "File", name: "mac.json", placeholder: false },
      ])
      assert.strictEqual(text(yield* storage.read("seen/mac.json")), '{"v":2}')
      assert.deepStrictEqual([...(yield* storage.read("updates/mac/0.loro"))], [1, 2, 3])
      yield* storage.remove("updates/mac/0.loro")
      yield* storage.remove("updates/mac/0.loro")
      assert.deepStrictEqual(yield* storage.list("updates/mac"), [])
      assert.deepStrictEqual(yield* storage.list("snapshots"), [])
      const missing = yield* Effect.flip(storage.read("updates/mac/0.loro"))
      assert.deepStrictEqual(
        [missing._tag, missing.path],
        ["FileUnavailable", "updates/mac/0.loro"],
      )
    }),
  )

  it.effect("opens a granted directory handle the way a picked folder is opened", () =>
    Effect.gen(function* () {
      const graph = yield* freshGraph
      const folder = yield* Effect.promise(async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(graph, { create: true }),
      )
      const storage = yield* Effect.provide(Storage, layerDirectoryHandle(folder))
      yield* storage.write("seen/mac.json", new TextEncoder().encode("{}"))
      assert.strictEqual(text(yield* storage.read("seen/mac.json")), "{}")
    }),
  )

  it.effect("two devices sync, compact and bootstrap a third through one OPFS folder", () =>
    Effect.gen(function* () {
      const graph = yield* freshGraph
      const storage = yield* Layer.build(layerOpfs(graph)).pipe(
        Effect.map((context) => Layer.succeedContext(context)),
      )
      const members = ["mac", "ipad"]
      const mac = yield* makeDevice({
        id: "mac",
        peer: "1",
        members,
        storage,
        compactAfterFiles: 2,
      })
      const ipad = yield* makeDevice({ id: "ipad", peer: "2", members, storage })
      yield* mac.type("hello ")
      yield* mac.type("opfs")
      yield* ipad.sync
      assert.strictEqual(ipad.text(), "hello opfs")
      const compacted = yield* mac.sync
      assert.strictEqual(compacted.written.length, 1)
      yield* ipad.sync
      const collected = yield* mac.sync
      assert.deepStrictEqual(collected.deleted, ["updates/mac/0.loro", "updates/mac/6.loro"])
      const phone = yield* makeDevice({ id: "phone", peer: "3", members, storage })
      yield* phone.sync
      assert.strictEqual(phone.text(), "hello opfs")
    }),
  )
})
