import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createRng } from "../src/rng.ts"
import { FakeICloud } from "../src/cloud.ts"
import { Scheduler } from "../src/scheduler.ts"
import { runJob } from "../src/suite.ts"

const quietCloud = (sched: Scheduler, style: "dataless" | "stub") =>
  new FakeICloud(
    sched,
    createRng(7),
    { conflictCopyRate: 0, downloadFailRate: 0, evictEveryMs: 1e12, evictFraction: 0 },
    [
      { style: "dataless", autoDownload: false },
      { style, autoDownload: false },
    ],
    {
      onServerWrite: () => undefined,
      onServerDelete: () => undefined,
      onDeviceWrite: () => undefined,
      onDeviceRemove: () => undefined,
      onViewChange: () => undefined,
    },
  )

const job = {
  ops: 200,
  devices: 5,
  hours: 12,
  compaction: true,
  bug: null,
  vault: "stand-in",
} as const

describe("fake iCloud", () => {
  it.effect("shows another device's file as dataless until it is downloaded", () =>
    Effect.gen(function* () {
      const sched = new Scheduler()
      const cloud = quietCloud(sched, "dataless")
      yield* cloud.fs(0).write("updates/d0/0.loro", new Uint8Array([1, 2, 3]))
      yield* sched.runUntil(3_600_000)
      const reader = cloud.fs(1)
      assert.deepStrictEqual(yield* reader.list("updates/d0"), ["0.loro"])
      assert.deepStrictEqual(
        yield* reader.stat("updates/d0/0.loro"),
        Option.some({ size: 3, mtime: 0, dataless: true }),
      )
      const refused = yield* Effect.flip(reader.read("updates/d0/0.loro"))
      assert.strictEqual(refused._tag, "NotDownloaded")
      yield* sched.runUntil(7_200_000)
      assert.deepStrictEqual([...(yield* reader.read("updates/d0/0.loro"))], [1, 2, 3])
    }),
  )

  it.effect("lists an old-iOS placeholder only as its .icloud stub", () =>
    Effect.gen(function* () {
      const sched = new Scheduler()
      const cloud = quietCloud(sched, "stub")
      yield* cloud.fs(0).write("seen/d0.json", new TextEncoder().encode("{}"))
      yield* sched.runUntil(3_600_000)
      const reader = cloud.fs(1)
      assert.deepStrictEqual(yield* reader.list("seen"), [".d0.json.icloud"])
      assert.deepStrictEqual(yield* reader.stat("seen/d0.json"), Option.none())
      yield* reader.download("seen/.d0.json.icloud")
      yield* sched.runUntil(7_200_000)
      assert.deepStrictEqual(yield* reader.list("seen"), ["d0.json"])
    }),
  )
})

describe("simulated seeds", () => {
  it.effect(
    "five devices converge with no violation and match the oracle",
    () =>
      Effect.gen(function* () {
        const result = yield* runJob({ ...job, seed: 3 })
        assert.deepStrictEqual(result.violations, {
          lostCoverage: 0,
          ackUnsound: 0,
          multiWriter: 0,
          placeholderRead: 0,
          diverged: 0,
          lostOps: 0,
          bootstrap: 0,
          noConvergence: 0,
        })
        assert.isTrue(result.ok)
        assert.isAbove(result.quiescenceToConvergeMs, 0)
      }),
    60_000,
  )

  it.effect(
    "the same seed replays to the same outcome",
    () =>
      Effect.gen(function* () {
        const first = yield* runJob({ ...job, seed: 11 })
        const second = yield* runJob({ ...job, seed: 11 })
        assert.strictEqual(first.seed, 11)
        assert.isTrue(first.ok)
        assert.deepStrictEqual({ ...first, cpuMs: 0 }, { ...second, cpuMs: 0 })
      }),
    60_000,
  )

  it.effect(
    "the real @seqno/vault converges through the fake iCloud with no violation",
    () =>
      Effect.gen(function* () {
        const result = yield* runJob({ ...job, seed: 3, ops: 600, hours: 24, vault: "real" })
        assert.deepStrictEqual(result.violations, {
          lostCoverage: 0,
          ackUnsound: 0,
          multiWriter: 0,
          placeholderRead: 0,
          diverged: 0,
          lostOps: 0,
          bootstrap: 0,
          noConvergence: 0,
        })
        assert.isTrue(result.ok)
        assert.strictEqual(result.snapshotsWritten, 1)
        assert.deepStrictEqual([result.files.peakCount, result.files.finalCount], [113, 53])
      }),
    60_000,
  )

  it.effect(
    "a vault that treats placeholders as empty files is caught",
    () =>
      Effect.gen(function* () {
        const result = yield* runJob({ ...job, seed: 3, bug: "placeholder-as-empty" })
        assert.isFalse(result.ok)
        assert.isAbove(result.violations.diverged + result.violations.noConvergence, 0)
      }),
    60_000,
  )
})
