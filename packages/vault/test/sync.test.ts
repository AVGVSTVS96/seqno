import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { LoroDoc } from "loro-crdt"
import { Storage, makeFakeCloud, snapshotName, type PlaceholderStyle } from "@seqno/vault"
import { makeDevice } from "./device.ts"

const cloudOf = (placeholders: PlaceholderStyle, autoDownload: boolean, deliverChance = 1) =>
  makeFakeCloud({ seed: 7, placeholders, autoDownload, deliverChance })

const pair = (
  cloud: ReturnType<typeof makeFakeCloud>,
  members = ["mac", "ipad"],
  macCompactsAfter = 1_000_000,
) =>
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
  it.effect(
    "names each file by its peer and first op counter and merges it on another device",
    () =>
      Effect.gen(function* () {
        const cloud = cloudOf("dataless", true)
        const { mac, ipad } = yield* pair(cloud)
        assert.strictEqual(yield* mac.type("hello"), "updates/mac/1-0.loro")
        assert.strictEqual(yield* mac.type(" world"), "updates/mac/1-5.loro")
        cloud.settle()
        const report = yield* ipad.sync
        assert.deepStrictEqual(report.merged, ["updates/mac/1-0.loro", "updates/mac/1-5.loro"])
        assert.deepStrictEqual(report.waiting, [])
        assert.strictEqual(ipad.text(), "hello world")
      }),
  )

  it.effect("rejects bytes that hold more than one peer's ops, or no Loro update at all", () =>
    Effect.gen(function* () {
      const { mac } = yield* pair(cloudOf("dataless", true))
      const mixed = new LoroDoc()
      mixed.setPeerId("9")
      mixed.getText("body").insert(0, "x")
      mixed.commit()
      mixed.setPeerId("8")
      mixed.getText("body").insert(0, "y")
      mixed.commit()
      const foreign = yield* Effect.flip(mac.vault.writeUpdate(mixed.export({ mode: "update" })))
      assert.strictEqual(foreign.reason, "an update file holds one peer's ops, found peers [8, 9]")
      const garbage = yield* Effect.flip(mac.vault.writeUpdate(new Uint8Array([1, 2, 3])))
      assert.strictEqual(garbage.reason, "bytes are not a Loro update")
    }),
  )

  it.effect("refuses to overwrite an existing update file when a peer id is reused", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const first = yield* makeDevice({
        id: "mac",
        peer: "1",
        members: ["mac"],
        storage: cloud.layer("mac"),
      })
      const reinstall = yield* makeDevice({
        id: "mac",
        peer: "1",
        members: ["mac"],
        storage: cloud.layer("mac"),
      })
      yield* first.type("kept")
      const error = yield* Effect.flip(reinstall.type("lost"))
      assert.strictEqual(error._tag, "UpdateRejected")
      cloud.settle()
      assert.deepStrictEqual(cloud.files(), ["updates/mac/1-0.loro"])
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
        assert.deepStrictEqual(before.waiting, ["updates/mac/1-0.loro"])
        assert.deepStrictEqual(before.merged, [])
        assert.strictEqual(ipad.text(), "")
        cloud.settle()
        const after = yield* ipad.sync
        assert.deepStrictEqual(after.merged, ["updates/mac/1-0.loro"])
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
      assert.deepStrictEqual(report.merged, ["updates/mac/1-0.loro"])
      assert.deepStrictEqual(report.waiting, ["updates/mac/40.loro"])
      assert.strictEqual(ipad.text(), "hello")
    }),
  )
})

const tokens = (text: string) => text.match(/[a-c]\d+/g)?.toSorted() ?? []

describe("delays and reordering", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it.effect(
      `seed ${seed}: three devices typing and compacting through a slow cloud converge`,
      () =>
        Effect.gen(function* () {
          const cloud = makeFakeCloud({
            seed,
            placeholders: "dataless",
            autoDownload: false,
            deliverChance: 0.3,
          })
          const members = ["mac", "ipad", "phone"]
          const devices = yield* Effect.forEach(members, (id, index) =>
            makeDevice({
              id,
              peer: `${index + 1}`,
              members,
              storage: cloud.layer(id),
              compactAfterFiles: 4,
            }),
          )
          for (let round = 0; round < 12; round++) {
            for (const [index, device] of devices.entries()) {
              yield* device.type(`${"abc"[index]}${round} `)
              cloud.step()
              yield* device.sync
            }
          }
          for (let round = 0; round < 6; round++) {
            cloud.settle()
            for (const device of devices) yield* device.sync
          }
          const fresh = yield* makeDevice({
            id: "laptop",
            peer: "4",
            members,
            storage: cloud.layer("laptop"),
          })
          for (let round = 0; round < 3; round++) {
            cloud.settle()
            yield* fresh.sync
          }
          const expected = ["a", "b", "c"].flatMap((prefix) =>
            Array.from({ length: 12 }, (_, round) => `${prefix}${round}`),
          )
          assert.deepStrictEqual(
            [...devices, fresh].map((device) => tokens(device.text())),
            [expected, expected, expected, expected].map((list) => list.toSorted()),
          )
          assert.deepStrictEqual(new Set(devices.map((device) => device.text())).size, 1)
          assert.strictEqual(fresh.text(), devices[0]?.text())
          const files = cloud.files()
          assert.strictEqual(files.filter((path) => path.startsWith("snapshots/")).length, 1)
          assert.isBelow(files.filter((path) => path.startsWith("updates/")).length, 36)
        }),
    )
  }
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
        "updates/mac/1-0.loro",
        "updates/mac/1-1.loro",
      ])
      const unconfirmed = yield* mac.sync
      assert.deepStrictEqual(unconfirmed.deleted, [])

      yield* ipad.sync
      cloud.settle()
      const collected = yield* mac.sync
      assert.deepStrictEqual(collected.deleted, ["updates/mac/1-0.loro", "updates/mac/1-1.loro"])
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

  it.effect(
    "a new device opens from the newest snapshot the seen files list, and checks the older one after",
    () =>
      Effect.gen(function* () {
        const cloud = cloudOf("dataless", true)
        const doc = new LoroDoc()
        doc.setPeerId("1")
        doc.getText("body").insert(0, "old")
        doc.commit()
        const older = doc.export({ mode: "snapshot" })
        doc.getText("body").insert(3, " new")
        doc.commit()
        const newer = doc.export({ mode: "snapshot" })
        const [olderName, newerName] = yield* Effect.promise(() =>
          Promise.all([snapshotName("mac", older), snapshotName("mac", newer)]),
        )
        cloud.put(`snapshots/${olderName}`, older)
        cloud.put(`snapshots/${newerName}`, newer)
        cloud.put(
          "seen/mac.json",
          new TextEncoder().encode(
            JSON.stringify({
              vv: { "1": 7 },
              verified: [],
              snapshots: [
                [olderName, { "1": 3 }],
                [newerName, { "1": 7 }],
              ],
            }),
          ),
        )
        cloud.settle()
        const reads: Array<string> = []
        const recording = Layer.effect(
          Storage,
          Effect.map(Effect.service(Storage), (storage) =>
            Storage.of({
              ...storage,
              read: (path) =>
                Effect.andThen(
                  Effect.sync(() => reads.push(path)),
                  storage.read(path),
                ),
            }),
          ),
        ).pipe(Layer.provide(cloud.layer("phone")))
        const phone = yield* makeDevice({
          id: "phone",
          peer: "3",
          members: ["mac", "phone"],
          storage: recording,
        })
        const opened = yield* phone.sync
        const openReads = reads.filter((path) => path.startsWith("snapshots/"))
        yield* phone.sync
        cloud.settle()
        const seen = yield* Effect.provide(
          Effect.flatMap(Effect.service(Storage), (storage) => storage.read("seen/phone.json")),
          cloud.layer("mac"),
        )
        assert.deepStrictEqual(
          [opened.merged, openReads, phone.text(), JSON.parse(new TextDecoder().decode(seen))],
          [
            [`snapshots/${newerName}`],
            [`snapshots/${newerName}`],
            "old new",
            { vv: { "1": 7 }, verified: [olderName, newerName].toSorted(), snapshots: [] },
          ],
        )
      }),
  )

  it.effect("a snapshot written under a former peer id stays this device's own", () =>
    Effect.gen(function* () {
      const cloud = cloudOf("dataless", true)
      const before = new LoroDoc()
      before.setPeerId("1")
      before.getText("body").insert(0, "old")
      before.commit()
      const bytes = before.export({ mode: "snapshot" })
      const name = yield* Effect.promise(() => snapshotName("1", bytes))
      cloud.put(`snapshots/${name}`, bytes)
      const mac = yield* makeDevice({
        id: "mac",
        peer: "7",
        formerPeers: ["1"],
        members: ["mac", "ipad"],
        storage: cloud.layer("mac"),
      })
      yield* mac.sync
      cloud.settle()
      const seen = yield* Effect.provide(
        Effect.flatMap(Effect.service(Storage), (storage) => storage.read("seen/mac.json")),
        cloud.layer("ipad"),
      )
      assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(seen)), {
        vv: { "1": 3 },
        verified: [],
        snapshots: [[name, { "1": 3 }]],
      })
      assert.strictEqual(mac.text(), "old")
    }),
  )

  for (const synced of [false, true]) {
    it.effect(
      synced
        ? "a lone device in a synced folder keeps its update files, since no one can confirm its snapshot"
        : "a lone device in a local-only folder compacts and deletes its own update files",
      () =>
        Effect.gen(function* () {
          const cloud = cloudOf("dataless", true)
          const mac = yield* makeDevice({
            id: "mac",
            peer: "1",
            synced,
            members: ["mac"],
            storage: cloud.layer("mac"),
            compactAfterFiles: 2,
          })
          yield* mac.type("a")
          yield* mac.type("b")
          const compacted = yield* mac.sync
          const collected = yield* mac.sync
          cloud.settle()
          const snapshot = compacted.written[0] ?? ""
          assert.deepStrictEqual(
            [collected.deleted, cloud.files()],
            synced
              ? [
                  [],
                  [
                    snapshot,
                    "seen/mac.json",
                    "updates/mac/1-0.loro",
                    "updates/mac/1-1.loro",
                  ].toSorted(),
                ]
              : [
                  ["updates/mac/1-0.loro", "updates/mac/1-1.loro"],
                  ["seen/mac.json", snapshot].toSorted(),
                ],
          )
          const phone = yield* makeDevice({
            id: "phone",
            peer: "3",
            members: ["mac", "phone"],
            storage: cloud.layer("phone"),
          })
          yield* phone.sync
          assert.strictEqual(phone.text(), "ab")
        }),
    )
  }

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
        ["updates/mac/1-0.loro", "updates/mac/1-1.loro"],
      )
    }),
  )

  it.effect(
    "removes a conflict copy of its own seen file and merges conflict copies of updates",
    () =>
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
