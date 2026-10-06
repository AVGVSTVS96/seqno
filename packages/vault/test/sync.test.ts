import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { LoroDoc } from "loro-crdt"
import { makeFakeCloud, type PlaceholderStyle } from "@seqno/vault"
import { makeDevice } from "./device.ts"

const cloudOf = (placeholders: PlaceholderStyle, autoDownload: boolean, deliverChance = 1) =>
  makeFakeCloud({ seed: 7, placeholders, autoDownload, deliverChance })

const pair = (cloud: ReturnType<typeof makeFakeCloud>, members = ["mac", "ipad"], macCompactsAfter = 1_000_000) =>
  Effect.all({
    mac: makeDevice({
      id: "mac",
      peer: "1",
      members,
      storage: cloud.layer("mac"),
      compactAfterFiles: macCompactsAfter,
    }),
    ipad: makeDevice({ id: "ipad", peer: "2", members, storage: cloud.layer("ipad") }),
  })

describe("update files", () => {
  it.effect("names each file by its first op counter and merges it on another device", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const { mac, ipad } = yield* pair(cloud)
      assert.strictEqual(yield* mac.type("hello"), "updates/mac/0.loro")
      assert.strictEqual(yield* mac.type(" world"), "updates/mac/5.loro")
      cloud.settle()
      const report = yield* ipad.sync
      assert.deepStrictEqual(report.merged, ["updates/mac/0.loro", "updates/mac/5.loro"])
      assert.deepStrictEqual(report.waiting, [])
      assert.strictEqual(ipad.text(), "hello world")
    }),
  )

  it.effect("rejects bytes that are not this device's own Loro update", () =>
    Effect.gen(function* () {
      const { mac } = yield* pair(cloudOf("dataless", true))
      const stranger = new LoroDoc()
      stranger.setPeerId("9")
      stranger.getText("body").insert(0, "x")
      stranger.commit()
      const foreign = yield* Effect.flip(mac.vault.writeUpdate(stranger.export({ mode: "update" })))
      assert.strictEqual(foreign.reason, "an update file holds only peer 1's own ops, found peers [9]")
      const garbage = yield* Effect.flip(mac.vault.writeUpdate(new Uint8Array([1, 2, 3])))
      assert.strictEqual(garbage.reason, "bytes are not a Loro update")
    }),
  )

  it.effect("refuses to overwrite an existing update file when a peer id is reused", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const first = yield* makeDevice({ id: "mac", peer: "1", members: ["mac"], storage: cloud.layer("mac") })
      const reinstall = yield* makeDevice({ id: "mac", peer: "1", members: ["mac"], storage: cloud.layer("mac") })
      yield* first.type("kept")
      const error = yield* Effect.flip(reinstall.type("lost"))
      assert.strictEqual(error._tag, "UpdateRejected")
      cloud.settle()
      assert.deepStrictEqual(cloud.files(), ["updates/mac/0.loro"])
    }),
  )
})

describe("files that are not downloaded yet", () => {
  for (const placeholders of ["dataless", "stub", "silent"] as const) {
    it.effect(`waits for a ${placeholders} placeholder instead of reading it as empty`, () =>
      Effect.gen(function* () {
        const cloud = cloudOf(placeholders, false)
        const { mac, ipad } = yield* pair(cloud)
        yield* mac.type("hello")
        cloud.settle()
        const before = yield* ipad.sync
        assert.deepStrictEqual(before.waiting, ["updates/mac/0.loro"])
        assert.deepStrictEqual(before.merged, [])
        assert.strictEqual(ipad.text(), "")
        cloud.settle()
        const after = yield* ipad.sync
        assert.deepStrictEqual(after.merged, ["updates/mac/0.loro"])
        assert.strictEqual(ipad.text(), "hello")
      }),
    )
  }

  it.effect("keeps retrying a truncated file and never merges it", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const { mac, ipad } = yield* pair(cloud)
      yield* mac.type("hello")
      const whole = mac.doc.export({ mode: "update" })
      cloud.put("updates/mac/40.loro", whole.slice(0, whole.length - 3))
      cloud.settle()
      const report = yield* ipad.sync
      assert.deepStrictEqual(report.merged, ["updates/mac/0.loro"])
      assert.deepStrictEqual(report.waiting, ["updates/mac/40.loro"])
      assert.strictEqual(ipad.text(), "hello")
    }),
  )
})

describe("delays and reordering", () => {
  it.effect("two devices typing through a slow, reordering cloud end up identical", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", false, 0.3)
      const { mac, ipad } = yield* pair(cloud)
      for (let round = 0; round < 10; round++) {
        yield* mac.type(`a${round} `)
        yield* ipad.type(`b${round} `)
        cloud.step()
        yield* mac.sync
        cloud.step()
        yield* ipad.sync
      }
      for (let round = 0; round < 4; round++) {
        cloud.settle()
        yield* mac.sync
        yield* ipad.sync
      }
      assert.strictEqual(mac.text(), ipad.text())
      assert.deepStrictEqual(mac.text().match(/[ab]\d/g)?.sort(), [
        "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9",
        "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9",
      ])
    }),
  )
})

describe("compaction", () => {
  it.effect("deletes update files only after another device confirms the covering snapshot", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const { mac, ipad } = yield* pair(cloud, ["mac", "ipad"], 2)
      yield* mac.type("a")
      yield* mac.type("b")
      cloud.settle()
      yield* ipad.sync
      cloud.settle()

      const compacted = yield* mac.sync
      assert.strictEqual(compacted.written.length, 1)
      assert.deepStrictEqual(compacted.deleted, [])
      const snapshot = compacted.written[0] ?? ""
      cloud.settle()
      assert.deepStrictEqual(cloud.files(), [
        "seen/ipad.json",
        "seen/mac.json",
        snapshot,
        "updates/mac/0.loro",
        "updates/mac/1.loro",
      ])

      yield* ipad.sync
      cloud.settle()
      const collected = yield* mac.sync
      assert.deepStrictEqual(collected.deleted, ["updates/mac/0.loro", "updates/mac/1.loro"])
      cloud.settle()
      assert.deepStrictEqual(cloud.files(), ["seen/ipad.json", "seen/mac.json", snapshot])

      const phone = yield* makeDevice({
        id: "phone",
        peer: "3",
        members: ["mac", "ipad", "phone"],
        storage: cloud.layer("phone"),
      })
      const opened = yield* phone.sync
      assert.deepStrictEqual(opened.merged, [snapshot])
      assert.strictEqual(phone.text(), "ab")
    }),
  )

  it.effect("a member that has not merged yet blocks every deletion", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const { mac, ipad } = yield* pair(cloud, ["mac", "ipad", "phone"], 2)
      yield* mac.type("a")
      yield* mac.type("b")
      cloud.settle()
      yield* ipad.sync
      cloud.settle()
      yield* mac.sync
      cloud.settle()
      yield* ipad.sync
      cloud.settle()
      const report = yield* mac.sync
      assert.deepStrictEqual(report.deleted, [])
      cloud.settle()
      assert.deepStrictEqual(
        cloud.files().filter((path) => path.startsWith("updates/")),
        ["updates/mac/0.loro", "updates/mac/1.loro"],
      )
    }),
  )

  it.effect("removes a conflict copy of its own seen file and merges conflict copies of updates", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const { mac, ipad } = yield* pair(cloud)
      yield* mac.type("hi")
      cloud.settle()
      yield* mac.sync
      yield* ipad.sync
      cloud.settle()
      cloud.put("seen/mac 2.json", new TextEncoder().encode("{}"))
      cloud.put("updates/mac/0 2.loro", mac.doc.export({ mode: "update" }))
      cloud.settle()
      const report = yield* mac.sync
      assert.deepStrictEqual(report.deleted, ["seen/mac 2.json"])
      const merged = yield* ipad.sync
      assert.deepStrictEqual(merged.waiting, [])
      assert.strictEqual(ipad.text(), "hi")
    }),
  )
})
