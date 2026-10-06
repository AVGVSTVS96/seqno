import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { layerNode, nodeStorage } from "@seqno/vault/node"
import { makeDevice } from "./device.ts"

const tempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-vault-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

const namesIn = (root: string, dir: string) =>
  Effect.promise(async () => (await readdir(join(root, dir))).toSorted())

describe("node storage", () => {
  it.effect("writes through a temp file and leaves only the final name behind", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const storage = nodeStorage(root)
      yield* storage.write("seen/mac.json", new TextEncoder().encode('{"v":1}'))
      yield* storage.write("seen/mac.json", new TextEncoder().encode('{"v":2}'))
      assert.deepStrictEqual(yield* namesIn(root, "seen"), ["mac.json"])
      assert.strictEqual(new TextDecoder().decode(yield* storage.read("seen/mac.json")), '{"v":2}')
    }),
  )

  it.effect("lists a missing folder as empty and reports a missing file as unavailable", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const storage = nodeStorage(root)
      assert.deepStrictEqual(yield* storage.list("updates"), [])
      const error = yield* Effect.flip(storage.read("updates/mac/0.loro"))
      assert.deepStrictEqual([error._tag, error.path], ["FileUnavailable", "updates/mac/0.loro"])
      yield* storage.remove("updates/mac/0.loro")
    }),
  )
})

describe("two devices sharing a folder on disk", () => {
  it.effect("sync, compact once confirmed, and let a new device open from the snapshot", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const members = ["mac", "ipad"]
      const mac = yield* makeDevice({
        id: "mac",
        peer: "1",
        members,
        storage: layerNode(root),
        compactAfterFiles: 2,
      })
      const ipad = yield* makeDevice({ id: "ipad", peer: "2", members, storage: layerNode(root) })

      yield* mac.type("one ")
      yield* mac.type("two")
      yield* ipad.type("!")
      yield* ipad.sync
      assert.strictEqual(ipad.text().length, 8)
      assert.deepStrictEqual(yield* namesIn(root, "updates/mac"), ["0.loro", "4.loro"])

      const compacted = yield* mac.sync
      assert.strictEqual(mac.text(), ipad.text())
      assert.strictEqual(compacted.written.length, 1)
      assert.deepStrictEqual(compacted.deleted, [])

      yield* ipad.sync
      const collected = yield* mac.sync
      assert.deepStrictEqual(collected.deleted, ["updates/mac/0.loro", "updates/mac/4.loro"])
      assert.deepStrictEqual(yield* namesIn(root, "updates/mac"), [])
      assert.deepStrictEqual(yield* namesIn(root, "seen"), ["ipad.json", "mac.json"])

      const phone = yield* makeDevice({ id: "phone", peer: "3", members, storage: layerNode(root) })
      yield* phone.sync
      assert.strictEqual(phone.text(), mac.text())
    }),
  )

  it.effect("treats an .icloud stub as not downloaded and never reads it", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const ipad = yield* makeDevice({
        id: "ipad",
        peer: "2",
        members: ["ipad"],
        storage: layerNode(root),
      })
      yield* Effect.promise(async () => {
        await mkdir(join(root, "updates/mac"), { recursive: true })
        await writeFile(join(root, "updates/mac/.0.loro.icloud"), "<plist/>")
      })
      const report = yield* ipad.sync
      assert.deepStrictEqual(report.waiting, ["updates/mac/0.loro"])
      assert.deepStrictEqual(report.merged, [])
      assert.strictEqual(ipad.text(), "")
    }),
  )
})
