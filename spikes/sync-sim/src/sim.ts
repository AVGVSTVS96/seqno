import { createHash } from "node:crypto"
import { decodeImportBlobMeta, LoroDoc, LoroText, type LoroTree, type TreeID } from "loro-crdt"
import { generateGraph, type Graph } from "../../shared/fixture/src/index.ts"
import { Drive, type DriveDeviceConfig, type DriveStats } from "./drive.ts"
import { SyncEngine, type Bug, type EngineStats } from "./engine.ts"
import { createRng } from "./rng.ts"
import { Scheduler } from "./scheduler.ts"
import { Coverage, covers, vvEqual, vvMax, vvOf, type Span, type VV } from "./vv.ts"
import { alive, createIntent, Workload, type Intent } from "./workload.ts"

const MIN = 60_000
const HOUR = 60 * MIN

export interface SimConfig {
  readonly seed: number
  readonly ops: number
  readonly devices: number
  readonly hours: number
  readonly compaction: boolean
  readonly bug: Bug | undefined
  readonly base: "small" | "fixture"
}

export interface CatchUp {
  readonly device: number
  readonly offlineH: number
  readonly catchUpMs: number
  readonly publishMs: number
  readonly filesImported: number
  readonly bytesImported: number
  readonly cpuMs: number
  /** Went into another long offline stretch before catching up, so its catch-up time would measure that instead. */
  readonly interrupted: boolean
}

export interface Violations {
  lostCoverage: number
  ackUnsound: number
  multiWriter: number
  placeholderAsData: number
  diverged: number
  lostOps: number
  bootstrap: number
  noConvergence: number
}

export interface SeedResult {
  readonly seed: number
  readonly ok: boolean
  readonly problems: readonly string[]
  readonly violations: Violations
  readonly quiescenceToConvergeMs: number
  readonly catchUps: readonly CatchUp[]
  readonly files: {
    readonly peakCount: number
    readonly peakBytes: number
    readonly finalCount: number
    readonly finalBytes: number
    readonly series: readonly (readonly [hours: number, files: number, bytes: number])[]
  }
  readonly ops: Intent["counts"]
  readonly drive: DriveStats
  readonly engines: EngineStats
  readonly finalBlocks: number
  readonly docSnapshotBytes: number
  /** Byte-identical snapshots written by two different devices: name collisions if names hashed content only. */
  readonly sameSnapshotFromTwoDevices: number
  readonly cpuMs: number
}

const kinds = {
  mac: { style: "dataless", autoDownload: true },
  web: { style: "dataless", autoDownload: true },
  ios: { style: "dataless", autoDownload: false },
  "ios-stub": { style: "stub", autoDownload: false },
} as const

const sameBytes = (a: Uint8Array, b: Uint8Array) => a === b || (a.length === b.length && a.every((v, i) => v === b[i]))

const canonical = (doc: LoroDoc) =>
  JSON.stringify(doc.toJSON(), (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  )

const spanOfBlob = (bytes: Uint8Array): Span => {
  const meta = decodeImportBlobMeta(bytes, false)
  return { start: meta.mode === "snapshot" ? {} : vvOf(meta.partialStartVersionVector), end: vvOf(meta.partialEndVersionVector) }
}

/** Checks the final merged document against what every device intended. */
const checkIntent = (doc: LoroDoc, intent: Intent): string[] => {
  const tree: LoroTree = doc.getTree("blocks")
  const problems: string[] = []
  const pages = new Set(intent.pages)
  const topOfDeleted = (id: TreeID) => {
    let cur = id
    for (;;) {
      const parent = tree.getNodeByID(cur)!.parent()
      if (!parent || !tree.has(parent.id)) return cur
      cur = parent.id
    }
  }
  for (const id of [...intent.pages, ...intent.blocks]) {
    if (!tree.has(id)) problems.push(`created node ${id} missing`)
    else if (tree.isNodeDeleted(id)) {
      const top = topOfDeleted(id)
      if (!intent.explicitlyDeleted.has(top)) problems.push(`node ${id} deleted without a delete op (top ${top})`)
    } else if (!pages.has(id)) {
      let cur = tree.getNodeByID(id)
      let steps = 0
      while (cur?.parent() && steps++ < 100_000) cur = cur.parent()
      if (!cur || !pages.has(cur.id)) problems.push(`block ${id} not under a page (root ${cur?.id}, steps ${steps})`)
    }
  }
  const texts = new Map<TreeID, string>()
  for (const [token, block] of intent.tokens) {
    if (!alive(tree, block)) continue
    let text = texts.get(block)
    if (text === undefined) texts.set(block, (text = String(tree.getNodeByID(block)!.data.get("src") ?? "")))
    const first = text.indexOf(token)
    const count = first < 0 ? 0 : text.indexOf(token, first + 1) < 0 ? 1 : 2
    if (intent.deadTokens.has(token) ? count !== 0 : count !== 1)
      problems.push(`token ${token} in ${block}: found ${count}, deleted=${intent.deadTokens.has(token)}`)
  }
  return problems
}

let fixture: Graph | undefined

/** The shared 50k-block graph, imported by device 0 as if it were migrating an existing Logseq folder. */
const loadFixture = (doc: LoroDoc, intent: Intent) => {
  fixture ??= generateGraph()
  const tree = doc.getTree("blocks")
  const nodes = new Map<string, TreeID>()
  for (const page of fixture.pages) {
    const node = tree.createNode()
    node.data.set("name", page.name)
    nodes.set(page.id, node.id)
    intent.pages.push(node.id)
  }
  for (const block of fixture.blocks) {
    const node = tree.createNode(nodes.get(block.parentId ?? block.pageId)!)
    node.data.setContainer("src", new LoroText()).insert(0, block.content)
    nodes.set(block.id, node.id)
    intent.blocks.push(node.id)
  }
  doc.commit()
}

export const runSeed = (cfg: SimConfig): SeedResult => {
  const cpuStart = performance.now()
  const rng = createRng(cfg.seed)
  const sched = new Scheduler()
  const problems: string[] = []
  const violations: Violations = {
    lostCoverage: 0,
    ackUnsound: 0,
    multiWriter: 0,
    placeholderAsData: 0,
    diverged: 0,
    lostOps: 0,
    bootstrap: 0,
    noConvergence: 0,
  }
  const fail = (kind: keyof Violations, message: string) => {
    violations[kind]++
    if (problems.length < 12) problems.push(`${kind}: ${message}`)
  }

  const serverTruth = new Map<string, Uint8Array>()
  const cloudSizes = new Map<string, number>()
  const cloud = { count: 0, bytes: 0, peakCount: 0, peakBytes: 0 }
  const trackCloud = (path: string, size: number | undefined) => {
    const before = cloudSizes.get(path)
    if (size === undefined) cloudSizes.delete(path)
    else cloudSizes.set(path, size)
    cloud.count += Number(size !== undefined) - Number(before !== undefined)
    cloud.bytes += (size ?? 0) - (before ?? 0)
    cloud.peakCount = Math.max(cloud.peakCount, cloud.count)
    cloud.peakBytes = Math.max(cloud.peakBytes, cloud.bytes)
  }
  const spans = new Map<string, Span>()
  const everOnServer = new Coverage()
  const writers = new Map<string, number>()
  const recordWriter = (path: string, device: number) => {
    const w = writers.get(path)
    if (w === undefined) writers.set(path, device)
    else if (w !== device) fail("multiWriter", `${path} written by ${w} and ${device}`)
  }

  const exported: Uint8Array[] = []
  let flushedVV: VV = {}

  const deviceConfigs: DriveDeviceConfig[] = Array.from({ length: cfg.devices }, () => ({
    ...kinds[rng.pick(["mac", "web", "ios", "ios-stub"] as const)],
    clockSkewMs: rng.range(-2 * HOUR, 2 * HOUR),
    clockJumpAt: rng.range(0, cfg.hours * HOUR),
    clockJumpMs: rng.range(-3 * HOUR, HOUR),
  }))

  const engines: SyncEngine[] = []
  const passPending: boolean[] = new Array(cfg.devices).fill(false)
  const syncCpu: number[] = new Array(cfg.devices).fill(0)

  const drive = new Drive(
    sched,
    rng.fork(),
    { conflictCopyRate: 0.01, downloadFailRate: 0.03, evictEveryMs: 45 * MIN, evictFraction: 0.3 },
    deviceConfigs,
    {
      onServerWrite: (path, bytes, owner, conflictCopy) => {
        trackCloud(path, bytes.length)
        if (conflictCopy) recordWriter(path, owner)
        const prior = serverTruth.get(path)
        if (path.endsWith(".loro")) {
          if (prior && !sameBytes(prior, bytes)) fail("multiWriter", `${path} rewritten with different bytes`)
          const span = spanOfBlob(bytes)
          spans.set(path, span)
          everOnServer.add(span)
        }
        serverTruth.set(path, bytes)
      },
      onServerDelete: (path) => {
        trackCloud(path, undefined)
        if (!path.endsWith(".loro")) return
        const now = new Coverage()
        for (const p of drive.server.keys()) if (p.endsWith(".loro")) now.add(spans.get(p)!)
        const missing = everOnServer.missingFrom(now)
        if (missing.length > 0) fail("lostCoverage", `after deleting ${path} the server no longer holds ${missing.slice(0, 3).join(" ")}`)
      },
      onDeviceWrite: (device, path) => recordWriter(path, device),
      onDeviceRemove: (device, path) => {
        recordWriter(path, device)
        if (!path.startsWith("updates/") || !path.endsWith(".loro")) return
        const span = spans.get(path) ?? spanOfBlob(serverTruth.get(path) ?? localWrites.get(path)!)
        for (const e of engines) if (!covers(e.vv, span.end)) fail("ackUnsound", `device ${device} deleted ${path} before device ${e.id} merged it`)
      },
      onViewChange: (device) => schedulePass(device, 2_000),
    },
  )

  const localWrites = new Map<string, Uint8Array>()
  const snapshotContent = new Map<string, number>()
  let sameSnapshotFromTwoDevices = 0
  const intent = createIntent()
  const workload = new Workload(rng.fork(), intent)

  for (let d = 0; d < cfg.devices; d++) {
    engines.push(
      new SyncEngine(
        d,
        drive.fs(d),
        {
          members: Array.from({ length: cfg.devices }, (_, i) => i),
          compaction: cfg.compaction,
          compactAfterFiles: 100 + 20 * d,
          compactMinIntervalMs: 60 * MIN,
          snapshotImportDelayMs: 10 * MIN,
          seenMinIntervalMs: 15_000,
          bug: cfg.bug,
        },
        {
          onFlush: (device, path, bytes) => {
            localWrites.set(path, bytes)
            exported.push(bytes)
            const peer = engines[device]!.peer
            flushedVV = vvMax(flushedVV, { [peer]: spanOfBlob(bytes).end[peer]! })
          },
          onConsumed: (device, path, bytes) => {
            const truth = serverTruth.get(path)
            if (!truth || bytes.length === 0 || !sameBytes(truth, bytes))
              fail("placeholderAsData", `device ${device} consumed ${path} with ${bytes.length} bytes, server has ${truth?.length}`)
          },
          onSnapshot: (device, _path, bytes) => {
            const content = createHash("sha256").update(bytes).digest("hex")
            const writer = snapshotContent.get(content)
            if (writer === undefined) snapshotContent.set(content, device)
            else if (writer !== device) sameSnapshotFromTwoDevices++
          },
          requestPass: (device, delay) => schedulePass(device, delay),
        },
      ),
    )
  }

  interface Tracking {
    readonly device: number
    readonly start: number
    readonly offlineMs: number
    readonly target: VV
    readonly published: VV
    readonly files0: number
    readonly bytes0: number
    readonly cpu0: number
    caughtUp?: number
    files?: number
    bytes?: number
    cpu?: number
    publishedAt?: number
    interrupted?: boolean
  }
  const trackings: Tracking[] = []

  const serverVV = () => {
    let vv: VV = {}
    for (const [p] of drive.server) if (p.endsWith(".loro")) vv = vvMax(vv, spans.get(p)!.end)
    return vv
  }

  const afterPass = (d: number) => {
    const e = engines[d]!
    for (const t of trackings) {
      if (t.device === d && t.caughtUp === undefined && covers(e.vv, t.target)) {
        t.caughtUp = sched.now
        t.files = e.stats.importedFiles - t.files0
        t.bytes = e.stats.importedBytes - t.bytes0
        t.cpu = syncCpu[d]! - t.cpu0
      }
      if (t.publishedAt === undefined && engines.every((o) => inLongOffline[o.id] || covers(o.vv, t.published))) t.publishedAt = sched.now
    }
  }

  function schedulePass(d: number, delay: number) {
    if (passPending[d]) return
    passPending[d] = true
    sched.after(delay, () => {
      passPending[d] = false
      const t = performance.now()
      engines[d]!.sync()
      syncCpu[d]! += performance.now() - t
      afterPass(d)
    })
  }

  const periodic = (d: number) =>
    sched.after(2 * MIN, () => {
      schedulePass(d, 0)
      periodic(d)
    })
  for (let d = 0; d < cfg.devices; d++) periodic(d)

  const IDLE_FLUSH = 5_000
  const MAX_FLUSH_DELAY = 60_000
  const pendingOps: number[] = new Array(cfg.devices).fill(0)
  const firstOpAt: number[] = new Array(cfg.devices).fill(0)
  const lastOpAt: number[] = new Array(cfg.devices).fill(0)
  const batchMax = Array.from({ length: cfg.devices }, () => rng.int(20, 60))
  const flush = (d: number) => {
    pendingOps[d] = 0
    engines[d]!.flush()
  }
  const noteOp = (d: number) => {
    if (pendingOps[d]! === 0) firstOpAt[d] = sched.now
    lastOpAt[d] = sched.now
    if (++pendingOps[d]! >= batchMax[d]!) return flush(d)
    const at = Math.min(sched.now + IDLE_FLUSH, firstOpAt[d]! + MAX_FLUSH_DELAY)
    sched.at(at, () => {
      if (pendingOps[d]! > 0 && (sched.now - lastOpAt[d]! >= IDLE_FLUSH || sched.now - firstOpAt[d]! >= MAX_FLUSH_DELAY)) flush(d)
    })
  }

  let quiescent = false
  const inLongOffline: boolean[] = new Array(cfg.devices).fill(false)
  const longOfflineStart: number[] = new Array(cfg.devices).fill(0)

  const comeBack = (d: number) => {
    inLongOffline[d] = false
    drive.setOnline(d, true)
    const e = engines[d]!
    trackings.push({
      device: d,
      start: sched.now,
      offlineMs: sched.now - longOfflineStart[d]!,
      target: serverVV(),
      published: { [e.peer]: e.doc.oplogVersion().get(e.peer) ?? 0 },
      files0: e.stats.importedFiles,
      bytes0: e.stats.importedBytes,
      cpu0: syncCpu[d]!,
    })
  }

  const cycle = (d: number) =>
    sched.after(rng.exp(3 * HOUR), () => {
      if (quiescent) return
      if (!inLongOffline[d]) drive.setOnline(d, false)
      sched.after(rng.exp(20 * MIN), () => {
        if (quiescent) return
        if (!inLongOffline[d]) drive.setOnline(d, true)
        cycle(d)
      })
    })
  for (let d = 0; d < cfg.devices; d++) cycle(d)

  const longOfflineDevices = rng.chance(0.5) ? 2 : 1
  for (let i = 0; i < longOfflineDevices; i++) {
    const d = rng.int(0, cfg.devices - 1)
    const start = rng.chance(0.25) ? 0 : rng.range(0.05, 0.6) * cfg.hours * HOUR
    const length = rng.range(12, 36) * HOUR
    sched.at(start, () => {
      if (quiescent || inLongOffline[d]) return
      inLongOffline[d] = true
      longOfflineStart[d] = sched.now
      for (const t of trackings) if (t.device === d && (t.caughtUp === undefined || t.publishedAt === undefined)) t.interrupted = true
      drive.setOnline(d, false)
      sched.at(start + length, () => {
        if (inLongOffline[d]) comeBack(d)
      })
    })
  }

  if (cfg.base === "fixture") loadFixture(engines[0]!.doc, intent)
  else {
    const seedPages = rng.int(4, 10)
    for (let i = 0; i < seedPages; i++) {
      workload.apply(engines[0]!.doc, 0, "createPage")
      for (let j = 0; j < 4; j++) workload.apply(engines[0]!.doc, 0, "createBlock")
    }
  }
  flush(0)

  const shortGap = 2_000
  const longGap = Math.max(10_000, ((cfg.hours * HOUR) / cfg.ops - 0.9 * shortGap) / 0.1)
  let device = 0
  let done = 0
  const nextOp = () =>
    sched.after(rng.chance(0.9) ? rng.exp(shortGap) : rng.exp(longGap), () => {
      if (rng.chance(0.03)) device = rng.int(0, cfg.devices - 1)
      const kind = workload.pickKind()
      if (kind === "cyclePair") {
        const other = (device + rng.int(1, cfg.devices - 1)) % cfg.devices
        if (workload.cyclePair(engines[device]!.doc, engines[other]!.doc)) {
          noteOp(device)
          noteOp(other)
          done += 2
        }
      } else if (workload.apply(engines[device]!.doc, device, kind)) {
        noteOp(device)
        done++
      }
      if (done < cfg.ops) nextOp()
      else beginQuiescence()
    })
  nextOp()

  let quiescenceAt = 0
  let convergedAt: number | undefined
  let finishAt = Infinity

  const series: [number, number, number][] = []
  const sample = () => {
    series.push([+(sched.now / HOUR).toFixed(3), cloud.count, cloud.bytes])
    return { count: cloud.count, bytes: cloud.bytes }
  }
  const sampler = () =>
    sched.after(10 * MIN, () => {
      sample()
      if (sched.now < finishAt) sampler()
    })
  sampler()


  function beginQuiescence() {
    quiescent = true
    quiescenceAt = sched.now
    for (let d = 0; d < cfg.devices; d++) {
      if (inLongOffline[d]) comeBack(d)
      else drive.setOnline(d, true)
      flush(d)
    }
    const watch = () =>
      sched.after(MIN, () => {
        const target = flushedVV
        if (drive.idle && engines.every((e) => vvEqual(e.vv, target))) {
          convergedAt = sched.now
          finishAt = sched.now + 12 * HOUR
        } else if (sched.now - quiescenceAt > 24 * HOUR) {
          fail("noConvergence", `devices not converged 24h after quiescence`)
          finishAt = sched.now
        } else watch()
      })
    watch()
  }

  while (sched.now < finishAt && sched.step()) {}

  const final = sample()
  const oracle = new LoroDoc()
  oracle.importBatch(exported)
  const target = vvOf(oracle.oplogVersion())
  if (!vvEqual(target, flushedVV)) fail("lostOps", `oracle could not apply every exported update`)
  const reference = canonical(oracle)
  for (const e of engines) {
    const own = e.doc.oplogVersion().get(e.peer) ?? 0
    if ((target[e.peer] ?? 0) !== own) fail("lostOps", `device ${e.id} made ${own} ops, only ${target[e.peer] ?? 0} were exported`)
    if (!vvEqual(e.vv, target)) fail("diverged", `device ${e.id} version differs from oracle`)
    else if (canonical(e.doc) !== reference) fail("diverged", `device ${e.id} state differs from oracle`)
  }
  for (const p of checkIntent(oracle, intent)) fail("lostOps", p)

  const fresh = new LoroDoc()
  fresh.importBatch([...drive.server].filter(([p]) => p.endsWith(".loro")).map(([, f]) => f.bytes))
  if (!vvEqual(vvOf(fresh.oplogVersion()), target) || canonical(fresh) !== reference)
    fail("bootstrap", `a new device reading only the cloud files does not reach the oracle state`)

  const tree = oracle.getTree("blocks")
  const engineStats = engines.reduce<EngineStats>(
    (acc, e) => {
      for (const k of Object.keys(acc) as (keyof EngineStats)[]) acc[k] += e.stats[k]
      return acc
    },
    { importedFiles: 0, importedBytes: 0, placeholdersSeen: 0, snapshotsWritten: 0, filesDeleted: 0 },
  )

  const result: SeedResult = {
    seed: cfg.seed,
    ok: Object.values(violations).every((v) => v === 0),
    problems,
    violations,
    quiescenceToConvergeMs: convergedAt === undefined ? -1 : convergedAt - quiescenceAt,
    catchUps: trackings.map((t) => ({
      device: t.device,
      offlineH: +(t.offlineMs / HOUR).toFixed(2),
      catchUpMs: t.caughtUp === undefined ? -1 : t.caughtUp - t.start,
      publishMs: t.publishedAt === undefined ? -1 : t.publishedAt - t.start,
      filesImported: t.files ?? -1,
      bytesImported: t.bytes ?? -1,
      cpuMs: +(t.cpu ?? -1).toFixed(2),
      interrupted: t.interrupted === true,
    })),
    files: { peakCount: cloud.peakCount, peakBytes: cloud.peakBytes, finalCount: final.count, finalBytes: final.bytes, series },
    ops: intent.counts,
    drive: drive.stats,
    engines: engineStats,
    finalBlocks: tree.nodes().filter((n) => !n.isDeleted()).length,
    docSnapshotBytes: oracle.export({ mode: "snapshot" }).length,
    sameSnapshotFromTwoDevices,
    cpuMs: Math.round(performance.now() - cpuStart),
  }
  for (const doc of [...engines.map((e) => e.doc), oracle, fresh]) doc.free()
  return result
}
