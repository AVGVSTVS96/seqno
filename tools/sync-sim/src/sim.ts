import { createHash } from "node:crypto"
import { Clock, Crypto, Effect, Option } from "effect"
import { DeviceId } from "@seqno/domain"
import { FakeICloud, type CloudDeviceConfig, type CloudStats } from "./cloud.ts"
import { Graphs, Vaults, type Replica, type VaultStats, type VaultSync } from "./ports.ts"
import { createRng } from "./rng.ts"
import { Scheduler } from "./scheduler.ts"
import { at, HOUR, MINUTE, sameBytes } from "./util.ts"
import { Coverage, covers, vvEqual, vvMax, type Span, type VV } from "./vv.ts"
import { createIntent, Workload, type Counts, type Intent } from "./workload.ts"

export interface SimConfig {
  readonly seed: number
  readonly ops: number
  readonly devices: number
  readonly hours: number
  readonly compaction: boolean
}

export interface CatchUp {
  readonly device: number
  readonly offlineH: number
  readonly catchUpMs: number
  readonly publishMs: number
  readonly filesImported: number
  readonly bytesImported: number
  readonly interrupted: boolean
}

export interface Violations {
  lostCoverage: number
  ackUnsound: number
  multiWriter: number
  placeholderRead: number
  diverged: number
  lostOps: number
  bootstrap: number
  noConvergence: number
}

export interface SeedResult {
  readonly seed: number
  readonly ok: boolean
  readonly problems: ReadonlyArray<string>
  readonly violations: Violations
  readonly quiescenceToConvergeMs: number
  readonly catchUps: ReadonlyArray<CatchUp>
  readonly files: {
    readonly peakCount: number
    readonly peakBytes: number
    readonly finalCount: number
    readonly finalBytes: number
  }
  readonly ops: Counts
  readonly cloud: CloudStats
  readonly vaults: VaultStats
  readonly snapshotsWritten: number
  readonly sameSnapshotFromTwoDevices: number
  readonly finalBlocks: number
  readonly cpuMs: number
}

const kinds: readonly [CloudDeviceConfig, ...CloudDeviceConfig[]] = [
  { style: "dataless", autoDownload: true },
  { style: "dataless", autoDownload: true },
  { style: "dataless", autoDownload: false },
  { style: "stub", autoDownload: false },
]

const simClock = (millis: () => number): Clock.Clock => {
  const nanos = () => BigInt(millis()) * 1_000_000n
  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: () => Effect.die(new Error("a simulated device never sleeps; the scheduler owns time")),
  }
}

const deterministicCrypto = (bytes: (size: number) => Uint8Array): Crypto.Crypto =>
  Crypto.make({
    randomBytes: bytes,
    digest: () => Effect.die(new Error("the sim's id minting never digests")),
  })

const checkIntent = (oracle: Replica, intent: Intent) =>
  Effect.gen(function* () {
    const problems: string[] = []
    const pages = new Set<string>(intent.pages)
    for (const id of [...intent.pages, ...intent.blocks]) {
      const fate = yield* oracle.fate(id)
      if (fate._tag === "Missing") {
        problems.push(`created node ${id} missing`)
      } else if (fate._tag === "Deleted" && !intent.explicitlyDeleted.has(fate.top)) {
        problems.push(`node ${id} deleted without a delete op (top ${fate.top})`)
      } else if (fate._tag === "Alive" && !pages.has(fate.root)) {
        problems.push(`node ${id} not under a page (root ${fate.root})`)
      }
    }
    for (const [token, blockId] of intent.tokens) {
      const block = yield* oracle.block(blockId)
      if (Option.isNone(block)) {
        continue
      }
      const text = block.value.text
      const first = text.indexOf(token)
      const count = first < 0 ? 0 : text.indexOf(token, first + 1) < 0 ? 1 : 2
      const dead = intent.deadTokens.has(token)
      if (dead ? count !== 0 : count !== 1) {
        problems.push(`token ${token} in ${blockId}: found ${count}, deleted=${dead}`)
      }
    }
    return problems
  })

interface Tracking {
  readonly device: number
  readonly start: number
  readonly offlineMs: number
  readonly target: VV
  readonly published: VV
  readonly files0: number
  readonly bytes0: number
  caughtUp?: number
  files?: number
  bytes?: number
  publishedAt?: number
  interrupted?: boolean
}

export const runSeed = (cfg: SimConfig) =>
  Effect.gen(function* () {
    const cpuStart = performance.now()
    const graphs = yield* Graphs
    const vaults = yield* Vaults
    const rng = createRng(cfg.seed)
    const sched = new Scheduler()
    const problems: string[] = []
    const violations: Violations = {
      lostCoverage: 0,
      ackUnsound: 0,
      multiWriter: 0,
      placeholderRead: 0,
      diverged: 0,
      lostOps: 0,
      bootstrap: 0,
      noConvergence: 0,
    }
    const fail = (kind: keyof Violations, message: string) => {
      violations[kind]++
      if (problems.length < 12) {
        problems.push(`${kind}: ${message}`)
      }
    }
    const deviceIds = Array.from({ length: cfg.devices }, (_, i) => DeviceId.make(`d${i}`))
    const ownerOf = (path: string) => /^updates\/d(\d+)\//.exec(path)?.[1]

    const serverTruth = new Map<string, Uint8Array>()
    const spans = new Map<string, Span>()
    const everOnServer = new Coverage()
    const writers = new Map<string, number>()
    const cloudSizes = new Map<string, number>()
    const files = { count: 0, bytes: 0, peakCount: 0, peakBytes: 0 }
    const exported: Uint8Array[] = []
    const removals: Array<{ readonly device: number; readonly path: string }> = []
    const snapshotContent = new Map<string, number>()
    let flushedVV: VV = {}
    let snapshotsWritten = 0
    let sameSnapshotFromTwoDevices = 0

    const trackCloud = (path: string, size: number | undefined) => {
      const before = cloudSizes.get(path)
      if (size === undefined) {
        cloudSizes.delete(path)
      } else {
        cloudSizes.set(path, size)
      }
      files.count += Number(size !== undefined) - Number(before !== undefined)
      files.bytes += (size ?? 0) - (before ?? 0)
      files.peakCount = Math.max(files.peakCount, files.count)
      files.peakBytes = Math.max(files.peakBytes, files.bytes)
    }
    const recordWriter = (path: string, device: number) => {
      const writer = writers.get(path)
      if (writer === undefined) {
        writers.set(path, device)
      } else if (writer !== device) {
        fail("multiWriter", `${path} written by ${writer} and ${device}`)
      }
    }
    const spanOf = (bytes: Uint8Array): Span =>
      Option.getOrElse(graphs.blobSpan(bytes, false), () => ({ start: {}, end: {} }))

    const passPending: boolean[] = Array.from({ length: cfg.devices }, () => false)
    let schedulePass: (device: number, delay: number) => void = () => undefined

    const cloud = new FakeICloud(
      sched,
      rng.fork(),
      { conflictCopyRate: 0.01, downloadFailRate: 0.03, evictEveryMs: 45 * MINUTE, evictFraction: 0.3 },
      Array.from({ length: cfg.devices }, () => rng.pick(kinds)),
      {
        onServerWrite: (path, bytes, owner, conflictCopy) => {
          trackCloud(path, bytes.length)
          if (conflictCopy) {
            recordWriter(path, owner)
          }
          const prior = serverTruth.get(path)
          if (path.endsWith(".loro")) {
            if (prior !== undefined && !sameBytes(prior, bytes)) {
              fail("multiWriter", `${path} rewritten with different bytes`)
            }
            const span = spanOf(bytes)
            spans.set(path, span)
            everOnServer.add(span)
          }
          serverTruth.set(path, bytes)
        },
        onServerDelete: (path) => {
          trackCloud(path, undefined)
          if (!path.endsWith(".loro")) {
            return
          }
          const now = new Coverage()
          for (const p of cloud.server.keys()) {
            const span = spans.get(p)
            if (span !== undefined) {
              now.add(span)
            }
          }
          const missing = everOnServer.missingFrom(now)
          if (missing.length > 0) {
            fail("lostCoverage", `after deleting ${path} the server no longer holds ${missing.slice(0, 3).join(" ")}`)
          }
        },
        onDeviceWrite: (device, path, bytes) => {
          recordWriter(path, device)
          if (path.startsWith("updates/") && ownerOf(path) === String(device)) {
            exported.push(bytes)
            flushedVV = vvMax(flushedVV, spanOf(bytes).end)
          }
          if (path.startsWith("snapshots/")) {
            snapshotsWritten++
            const content = createHash("sha256").update(bytes).digest("hex")
            const writer = snapshotContent.get(content)
            if (writer === undefined) {
              snapshotContent.set(content, device)
            } else if (writer !== device) {
              sameSnapshotFromTwoDevices++
            }
          }
        },
        onDeviceRemove: (device, path) => {
          recordWriter(path, device)
          if (path.startsWith("updates/") && path.endsWith(".loro")) {
            removals.push({ device, path })
          }
        },
        onViewChange: (device) => schedulePass(device, 2_000),
      },
    )

    const skews = deviceIds.map(() => ({
      skew: rng.range(-2 * HOUR, 2 * HOUR),
      jumpAt: rng.range(0, cfg.hours * HOUR),
      jump: rng.range(-3 * HOUR, HOUR),
    }))
    const clocks = skews.map((s) =>
      simClock(() => Math.floor(sched.now + s.skew + (sched.now >= s.jumpAt ? s.jump : 0))),
    )
    const cryptos = deviceIds.map(() => {
      const bytes = rng.fork()
      return deterministicCrypto(bytes.bytes)
    })
    const onDevice =
      (d: number) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(Clock.Clock, at(clocks, d)),
          Effect.provideService(Crypto.Crypto, at(cryptos, d)),
        )

    const replicas: Replica[] = []
    const syncs: VaultSync[] = []
    for (let d = 0; d < cfg.devices; d++) {
      const replica = yield* onDevice(d)(graphs.open({ deviceId: at(deviceIds, d), peer: d + 1 }))
      replicas.push(replica)
      syncs.push(
        yield* onDevice(d)(
          vaults.attach(
            {
              deviceId: at(deviceIds, d),
              members: deviceIds,
              compaction: cfg.compaction,
              compactAfterFiles: 100 + 20 * d,
              compactMinIntervalMs: 60 * MINUTE,
              snapshotImportDelayMs: 10 * MINUTE,
              seenMinIntervalMs: 15_000,
            },
            cloud.fs(d),
            replica,
          ),
        ),
      )
    }
    const replica = (d: number) => at(replicas, d)
    const versions = Effect.forEach(replicas, (r) => r.version)

    const checkRemovals = Effect.gen(function* () {
      if (removals.length === 0) {
        return
      }
      const now = yield* versions
      for (const { device, path } of removals.splice(0)) {
        const span = spans.get(path) ?? spanOf(serverTruth.get(path) ?? new Uint8Array(0))
        now.forEach((vv, other) => {
          if (!covers(vv, span.end)) {
            fail("ackUnsound", `device ${device} deleted ${path} before device ${other} merged it`)
          }
        })
      }
    })

    const trackings: Tracking[] = []
    const inLongOffline: boolean[] = Array.from({ length: cfg.devices }, () => false)
    const longOfflineStart: number[] = Array.from({ length: cfg.devices }, () => 0)
    let quiescent = false

    const serverVV = () => {
      let vv: VV = {}
      for (const path of cloud.server.keys()) {
        const span = spans.get(path)
        if (span !== undefined) {
          vv = vvMax(vv, span.end)
        }
      }
      return vv
    }

    const afterPass = (d: number) =>
      Effect.gen(function* () {
        const all = yield* versions
        const mine = at(all, d)
        const stats = yield* at(syncs, d).stats
        for (const t of trackings) {
          if (t.device === d && t.caughtUp === undefined && covers(mine, t.target)) {
            t.caughtUp = sched.now
            t.files = stats.importedFiles - t.files0
            t.bytes = stats.importedBytes - t.bytes0
          }
          if (
            t.publishedAt === undefined &&
            all.every((vv, other) => inLongOffline[other] === true || covers(vv, t.published))
          ) {
            t.publishedAt = sched.now
          }
        }
      })

    schedulePass = (d, delay) => {
      if (passPending[d] === true) {
        return
      }
      passPending[d] = true
      sched.after(
        delay,
        Effect.gen(function* () {
          passPending[d] = false
          const outcome = yield* onDevice(d)(at(syncs, d).pass)
          yield* checkRemovals
          yield* afterPass(d)
          if (outcome.wakeInMs !== null) {
            schedulePass(d, outcome.wakeInMs)
          }
        }),
      )
    }

    const periodic = (d: number) =>
      sched.soon(2 * MINUTE, () => {
        schedulePass(d, 0)
        periodic(d)
      })
    deviceIds.forEach((_, d) => periodic(d))

    const IDLE_FLUSH = 5_000
    const MAX_FLUSH_DELAY = 60_000
    const pendingOps = deviceIds.map(() => 0)
    const firstOpAt = deviceIds.map(() => 0)
    const lastOpAt = deviceIds.map(() => 0)
    const batchMax = deviceIds.map(() => rng.int(20, 60))
    const flush = (d: number) =>
      Effect.suspend(() => {
        pendingOps[d] = 0
        return onDevice(d)(at(syncs, d).flush)
      })
    const noteOp = (d: number) =>
      Effect.suspend(() => {
        if (at(pendingOps, d) === 0) {
          firstOpAt[d] = sched.now
        }
        lastOpAt[d] = sched.now
        pendingOps[d] = at(pendingOps, d) + 1
        if (at(pendingOps, d) >= at(batchMax, d)) {
          return flush(d)
        }
        sched.at(
          Math.min(sched.now + IDLE_FLUSH, at(firstOpAt, d) + MAX_FLUSH_DELAY),
          Effect.suspend(() =>
            at(pendingOps, d) > 0 &&
            (sched.now - at(lastOpAt, d) >= IDLE_FLUSH || sched.now - at(firstOpAt, d) >= MAX_FLUSH_DELAY)
              ? flush(d)
              : Effect.void,
          ),
        )
        return Effect.void
      })

    const comeBack = (d: number) =>
      Effect.gen(function* () {
        inLongOffline[d] = false
        cloud.setOnline(d, true)
        const stats = yield* at(syncs, d).stats
        const version = yield* replica(d).version
        const peer = replica(d).peer
        trackings.push({
          device: d,
          start: sched.now,
          offlineMs: sched.now - at(longOfflineStart, d),
          target: serverVV(),
          published: { [peer]: version[peer] ?? 0 },
          files0: stats.importedFiles,
          bytes0: stats.importedBytes,
        })
      })

    const cycle = (d: number) =>
      sched.soon(rng.exp(3 * HOUR), () => {
        if (quiescent) {
          return
        }
        if (inLongOffline[d] !== true) {
          cloud.setOnline(d, false)
        }
        sched.soon(rng.exp(20 * MINUTE), () => {
          if (quiescent) {
            return
          }
          if (inLongOffline[d] !== true) {
            cloud.setOnline(d, true)
          }
          cycle(d)
        })
      })
    deviceIds.forEach((_, d) => cycle(d))

    const longOfflineDevices = rng.chance(0.5) ? 2 : 1
    for (let i = 0; i < longOfflineDevices; i++) {
      const d = rng.int(0, cfg.devices - 1)
      const start = rng.chance(0.25) ? 0 : rng.range(0.05, 0.6) * cfg.hours * HOUR
      const length = rng.range(12, 36) * HOUR
      sched.soon(start, () => {
        if (quiescent || inLongOffline[d] === true) {
          return
        }
        inLongOffline[d] = true
        longOfflineStart[d] = sched.now
        for (const t of trackings) {
          if (t.device === d && (t.caughtUp === undefined || t.publishedAt === undefined)) {
            t.interrupted = true
          }
        }
        cloud.setOnline(d, false)
        sched.at(
          start + length,
          Effect.suspend(() => (inLongOffline[d] === true ? comeBack(d) : Effect.void)),
        )
      })
    }

    const intent = createIntent()
    const workload = new Workload(rng.fork(), intent)
    const seedPages = rng.int(4, 10)
    for (let i = 0; i < seedPages; i++) {
      yield* onDevice(0)(workload.apply(replica(0), 0, "createPage"))
      for (let j = 0; j < 4; j++) {
        yield* onDevice(0)(workload.apply(replica(0), 0, "createBlock"))
      }
    }
    yield* flush(0)

    let quiescenceAt = 0
    let convergedAt: number | undefined
    let finishAt = Number.POSITIVE_INFINITY

    const watch = (): void =>
      sched.after(
        MINUTE,
        Effect.gen(function* () {
          const all = yield* versions
          if (cloud.idle && all.every((vv) => vvEqual(vv, flushedVV))) {
            convergedAt = sched.now
            finishAt = sched.now + 12 * HOUR
          } else if (sched.now - quiescenceAt > 24 * HOUR) {
            fail("noConvergence", "devices not converged 24h after quiescence")
            finishAt = sched.now
          } else {
            watch()
          }
        }),
      )

    const beginQuiescence = Effect.gen(function* () {
      quiescent = true
      quiescenceAt = sched.now
      for (let d = 0; d < cfg.devices; d++) {
        if (inLongOffline[d] === true) {
          yield* comeBack(d)
        } else {
          cloud.setOnline(d, true)
        }
        yield* flush(d)
      }
      watch()
    })

    const shortGap = 2_000
    const longGap = Math.max(10_000, ((cfg.hours * HOUR) / cfg.ops - 0.9 * shortGap) / 0.1)
    let device = 0
    let done = 0
    const nextOp = (): void =>
      sched.after(
        rng.chance(0.9) ? rng.exp(shortGap) : rng.exp(longGap),
        Effect.gen(function* () {
          if (rng.chance(0.03)) {
            device = rng.int(0, cfg.devices - 1)
          }
          const kind = workload.pickKind()
          if (kind === "cyclePair") {
            const other = (device + rng.int(1, cfg.devices - 1)) % cfg.devices
            if (yield* onDevice(device)(workload.cyclePair(replica(device), replica(other)))) {
              yield* noteOp(device)
              yield* noteOp(other)
              done += 2
            }
          } else if (yield* onDevice(device)(workload.apply(replica(device), device, kind))) {
            yield* noteOp(device)
            done++
          }
          if (done < cfg.ops) {
            nextOp()
          } else {
            yield* beginQuiescence
          }
        }),
      )
    nextOp()

    yield* sched.runWhile(() => sched.now < finishAt)

    const oracle = yield* onDevice(0)(graphs.open({ deviceId: DeviceId.make("oracle"), peer: 999_001 }))
    yield* oracle.importBlobs(exported)
    const target = yield* oracle.version
    if (!vvEqual(target, flushedVV)) {
      fail("lostOps", "oracle could not apply every exported update")
    }
    const reference = yield* oracle.canonical
    for (let d = 0; d < cfg.devices; d++) {
      const r = replica(d)
      const vv = yield* r.version
      const own = vv[r.peer] ?? 0
      if ((target[r.peer] ?? 0) !== own) {
        fail("lostOps", `device ${d} made ${own} ops, only ${target[r.peer] ?? 0} were exported`)
      }
      if (!vvEqual(vv, target)) {
        fail("diverged", `device ${d} version differs from oracle`)
      } else if ((yield* r.canonical) !== reference) {
        fail("diverged", `device ${d} state differs from oracle`)
      }
    }
    for (const problem of yield* checkIntent(oracle, intent)) {
      fail("lostOps", problem)
    }

    const fresh = yield* onDevice(0)(graphs.open({ deviceId: DeviceId.make("fresh"), peer: 999_002 }))
    yield* fresh.importBlobs([...cloud.server].filter(([p]) => p.endsWith(".loro")).map(([, f]) => f.bytes))
    if (!vvEqual(yield* fresh.version, target) || (yield* fresh.canonical) !== reference) {
      fail("bootstrap", "a new device reading only the cloud files does not reach the oracle state")
    }
    if (cloud.stats.datalessReads + cloud.stats.stubReads > 0) {
      fail(
        "placeholderRead",
        `devices read ${cloud.stats.datalessReads} dataless files and ${cloud.stats.stubReads} .icloud stubs`,
      )
    }

    const vaultStats = yield* Effect.forEach(syncs, (s) => s.stats)
    const result: SeedResult = {
      seed: cfg.seed,
      ok: Object.values(violations).every((v) => v === 0),
      problems,
      violations,
      quiescenceToConvergeMs: convergedAt === undefined ? -1 : convergedAt - quiescenceAt,
      catchUps: trackings.map((t) => ({
        device: t.device,
        offlineH: Number((t.offlineMs / HOUR).toFixed(2)),
        catchUpMs: t.caughtUp === undefined ? -1 : t.caughtUp - t.start,
        publishMs: t.publishedAt === undefined ? -1 : t.publishedAt - t.start,
        filesImported: t.files ?? -1,
        bytesImported: t.bytes ?? -1,
        interrupted: t.interrupted === true,
      })),
      files: {
        peakCount: files.peakCount,
        peakBytes: files.peakBytes,
        finalCount: files.count,
        finalBytes: files.bytes,
      },
      ops: intent.counts,
      cloud: { ...cloud.stats },
      vaults: vaultStats.reduce(
        (acc, s) => ({
          importedFiles: acc.importedFiles + s.importedFiles,
          importedBytes: acc.importedBytes + s.importedBytes,
          placeholdersSeen: acc.placeholdersSeen + s.placeholdersSeen,
        }),
        { importedFiles: 0, importedBytes: 0, placeholdersSeen: 0 },
      ),
      snapshotsWritten,
      sameSnapshotFromTwoDevices,
      finalBlocks: yield* oracle.liveNodes,
      cpuMs: Math.round(performance.now() - cpuStart),
    }
    return result
  }).pipe(Effect.scoped)
