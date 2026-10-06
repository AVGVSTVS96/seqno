import { createHash } from "node:crypto"
import { decodeImportBlobMeta, LoroDoc, VersionVector, type PeerID } from "loro-crdt"
import { NotDownloaded, NotFound, type DriveFs } from "./drive.ts"
import { covers, vvMax, vvOf, type Span, type VV } from "./vv.ts"

/** Deliberate defects used to prove the simulator's checks catch them. */
export type Bug = "placeholder-as-empty" | "gc-without-acks" | "gc-without-witness" | "gc-unconfirmed-snapshot" | "gc-any-device"

export interface EngineConfig {
  readonly members: readonly number[]
  readonly compaction: boolean
  readonly compactAfterFiles: number
  readonly compactMinIntervalMs: number
  readonly snapshotImportDelayMs: number
  readonly seenMinIntervalMs: number
  readonly bug: Bug | undefined
}

export interface EngineHooks {
  readonly onFlush: (device: number, path: string, bytes: Uint8Array) => void
  readonly onSnapshot: (device: number, path: string, bytes: Uint8Array) => void
  readonly onConsumed: (device: number, path: string, bytes: Uint8Array) => void
  readonly requestPass: (device: number, delayMs: number) => void
}

export interface EngineStats {
  importedFiles: number
  importedBytes: number
  placeholdersSeen: number
  snapshotsWritten: number
  filesDeleted: number
}

interface SeenFile {
  readonly vv: VV
  readonly verified: readonly string[]
  readonly snapshots: readonly (readonly [name: string, vv: VV])[]
}

interface Ack {
  vv: VV
  readonly verified: Set<string>
}

interface Listed {
  readonly path: string
  readonly name: string
  readonly stub: boolean
}

const peerOf = (device: number) => String(device + 1) as PeerID
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** "12.loro" -> "12.loro", "12 2.loro" -> "12.loro": iCloud conflict copies map back to the file they duplicate. */
const baseName = (name: string) => name.replace(/ \d+(\.[a-z]+)$/, "$1")

/**
 * One device's sync loop over the shared folder:
 *
 *   updates/<device>/<n>.loro   only my own ops, n = my first op counter in the file, so a name never repeats
 *   snapshots/<hash>.loro       full Loro snapshot; hash covers writer + bytes so two devices never share a name
 *   seen/<device>.json          my merged version vector + snapshots I downloaded and verified
 *
 * Deletion rule (only ever for files I wrote):
 *   update file U:   every member's seen-VV covers U, and a snapshot covering U is confirmed on the server
 *   snapshot S:      a different snapshot S' strictly above S (VV, then name) is confirmed on the server
 *   "confirmed" = a device other than the writer downloaded it and verified its checksum, so its bytes are on the server.
 */
export class SyncEngine {
  readonly doc = new LoroDoc()
  readonly stats: EngineStats = { importedFiles: 0, importedBytes: 0, placeholdersSeen: 0, snapshotsWritten: 0, filesDeleted: 0 }
  readonly id: number
  readonly peer: PeerID
  private readonly fs: DriveFs
  private readonly cfg: EngineConfig
  private readonly hooks: EngineHooks
  private flushed = 0
  private readonly spans = new Map<string, Span>()
  private readonly consumed = new Set<string>()
  private readonly acks = new Map<number, Ack>()
  private readonly snapshotVV = new Map<string, VV>()
  private readonly verified = new Set<string>()
  private readonly checked = new Set<string>()
  private readonly behindSince = new Map<string, number>()
  private readonly mine = new Set<string>()
  private lastSeenJson = ""
  private lastSeenAt = -Infinity
  private lastSnapshotAt = -Infinity

  constructor(id: number, fs: DriveFs, cfg: EngineConfig, hooks: EngineHooks) {
    this.id = id
    this.peer = peerOf(id)
    this.fs = fs
    this.cfg = cfg
    this.hooks = hooks
    this.doc.setPeerId(this.peer)
    this.doc.getTree("blocks").enableFractionalIndex(0)
  }

  get vv(): VV {
    return vvOf(this.doc.oplogVersion())
  }

  get unflushed() {
    return (this.doc.oplogVersion().get(this.peer) ?? 0) - this.flushed
  }

  flush() {
    const version = this.doc.oplogVersion()
    const end = version.get(this.peer) ?? 0
    if (end === this.flushed) return
    const from = version.toJSON()
    from.set(this.peer, this.flushed)
    const bytes = this.doc.export({ mode: "update", from: VersionVector.parseJSON(from) })
    const path = `updates/${this.id}/${this.flushed}.loro`
    this.fs.write(path, bytes)
    this.spans.set(path, { start: { [this.peer]: this.flushed }, end: { [this.peer]: end } })
    this.consumed.add(path)
    this.flushed = end
    this.hooks.onFlush(this.id, path, bytes)
  }

  sync() {
    const snapshots = this.list("snapshots")
    const updates = this.fs.list("updates").flatMap((dir) => this.list(`updates/${dir}`))
    const waiting = this.importUpdates(updates)
    const behind = this.checkSnapshots(snapshots, waiting === 0)
    this.readSeen()
    this.writeSeen()
    if (!this.cfg.compaction) return
    const live = snapshots.flatMap((f) => {
      const vv = this.snapshotVV.get(f.name)
      return vv ? [[f.name, vv] as const] : []
    })
    if (waiting === 0 && !behind) this.maybeSnapshot(updates, live)
    this.collectGarbage(snapshots, updates, live)
  }

  private list(dir: string): Listed[] {
    const out: Listed[] = []
    for (const raw of this.fs.list(dir)) {
      const stub = /^\.(.+)\.icloud$/.exec(raw)
      const name = stub ? stub[1]! : raw
      if (name.endsWith(".loro")) out.push({ path: `${dir}/${name}`, name, stub: stub !== null })
    }
    return out
  }

  private placeholder(file: Listed) {
    return file.stub || this.fs.stat(file.path)?.dataless === true
  }

  /** Real bytes, or undefined after asking iCloud to download them. A placeholder is never read as content. */
  private readable(file: Listed): Uint8Array | undefined {
    if (this.placeholder(file)) {
      this.stats.placeholdersSeen++
      this.fs.download(file.path)
      return undefined
    }
    try {
      return this.fs.read(file.path)
    } catch (e) {
      if (e instanceof NotDownloaded || e instanceof NotFound) return undefined
      throw e
    }
  }

  /** Imports every update file not seen yet. Returns how many are still waiting for bytes. */
  private importUpdates(updates: readonly Listed[]): number {
    const have = this.vv
    const batch: { path: string; bytes: Uint8Array; span: Span }[] = []
    let waiting = 0
    for (const file of updates) {
      if (this.consumed.has(file.path)) continue
      if (this.cfg.bug === "placeholder-as-empty" && this.placeholder(file)) {
        this.markConsumed(file.path, new Uint8Array(0))
        continue
      }
      const bytes = this.readable(file)
      const span = bytes && this.spanOf(bytes, false)
      if (!bytes || !span) {
        waiting++
        continue
      }
      if (covers(have, span.end)) {
        this.spans.set(file.path, span)
        this.markConsumed(file.path, bytes)
      } else batch.push({ path: file.path, bytes, span })
    }
    if (batch.length === 0) return waiting
    const ok = this.importAll(batch.map((b) => b.bytes))
    batch.forEach((b, i) => {
      if (!ok[i]) return void waiting++
      this.spans.set(b.path, b.span)
      this.markConsumed(b.path, b.bytes)
      this.stats.importedFiles++
      this.stats.importedBytes += b.bytes.length
    })
    return waiting
  }

  /**
   * Downloads and checksums every snapshot once, so it can serve as a deletion witness for its writer.
   * Imports one only when all visible update files are in and it still holds ops this device lacks.
   * Returns true if a known snapshot is ahead of this device.
   */
  private checkSnapshots(snapshots: readonly Listed[], updatesSettled: boolean): boolean {
    let have = this.vv
    let behind = false
    for (const file of snapshots) {
      const known = this.snapshotVV.get(file.name)
      const needed = known !== undefined && !covers(have, known)
      if (this.checked.has(file.name) && !(needed && updatesSettled && this.waitedFor(file.name))) {
        behind ||= needed
        continue
      }
      if (this.cfg.bug === "placeholder-as-empty" && this.placeholder(file)) {
        this.checked.add(file.name)
        this.markConsumed(file.path, new Uint8Array(0))
        continue
      }
      const bytes = this.readable(file)
      const span = bytes && this.spanOf(bytes, true)
      if (!bytes || !span) {
        behind ||= needed
        continue
      }
      this.snapshotVV.set(file.name, span.end)
      this.checked.add(file.name)
      if (!this.mine.has(baseName(file.name))) this.verified.add(file.name)
      this.markConsumed(file.path, bytes)
      if (covers(have, span.end)) continue
      if (updatesSettled && this.waitedFor(file.name) && this.importAll([bytes])[0]) {
        this.stats.importedFiles++
        this.stats.importedBytes += bytes.length
        have = this.vv
      } else behind = true
    }
    return behind
  }

  /** A fresh device takes a snapshot right away; a running one first gives the small update files time to arrive. */
  private waitedFor(snapshot: string) {
    if (Object.keys(this.vv).length === 0) return true
    const since = this.behindSince.get(snapshot) ?? this.fs.wallClock()
    this.behindSince.set(snapshot, since)
    return this.elapsedSince(since) >= this.cfg.snapshotImportDelayMs
  }

  /** The only clock is the device's own skewed, jumping wall clock; a jump backwards counts as "long ago", so it can never stall a timer. */
  private elapsedSince(time: number) {
    const elapsed = this.fs.wallClock() - time
    return elapsed < 0 ? Infinity : elapsed
  }

  private spanOf(bytes: Uint8Array, checksum: boolean): Span | undefined {
    try {
      const meta = decodeImportBlobMeta(bytes, checksum)
      return { start: vvOf(meta.partialStartVersionVector), end: vvOf(meta.partialEndVersionVector) }
    } catch {
      return undefined
    }
  }

  private importAll(blobs: Uint8Array[]): boolean[] {
    try {
      this.doc.importBatch(blobs)
      return blobs.map(() => true)
    } catch {
      return blobs.map((blob) => {
        try {
          this.doc.import(blob)
          return true
        } catch {
          return false
        }
      })
    }
  }

  private markConsumed(path: string, bytes: Uint8Array) {
    this.consumed.add(path)
    this.hooks.onConsumed(this.id, path, bytes)
  }

  private readSeen() {
    for (const raw of this.fs.list("seen")) {
      const stub = /^\.(.+)\.icloud$/.exec(raw)
      const name = stub ? stub[1]! : raw
      const m = /^(\d+)\.json$/.exec(name)
      if (!m || Number(m[1]) === this.id) continue
      const bytes = this.readable({ path: `seen/${name}`, name, stub: stub !== null })
      if (!bytes) continue
      let seen: SeenFile
      try {
        seen = JSON.parse(decoder.decode(bytes)) as SeenFile
      } catch {
        continue
      }
      const device = Number(m[1])
      const ack = this.acks.get(device) ?? { vv: {}, verified: new Set<string>() }
      ack.vv = vvMax(ack.vv, seen.vv)
      for (const s of seen.verified) ack.verified.add(s)
      this.acks.set(device, ack)
      for (const [snap, vv] of seen.snapshots) this.snapshotVV.set(snap, vvMax(this.snapshotVV.get(snap) ?? {}, vv))
    }
  }

  private writeSeen() {
    const present = new Set(this.fs.list("snapshots").map((raw) => /^\.(.+)\.icloud$/.exec(raw)?.[1] ?? raw))
    const seen: SeenFile = {
      vv: this.vv,
      verified: [...this.verified].filter((s) => present.has(s)).sort(),
      snapshots: [...present].filter((s) => this.mine.has(baseName(s))).sort().map((s) => [s, this.snapshotVV.get(s) ?? {}] as const),
    }
    const json = JSON.stringify(seen)
    if (json === this.lastSeenJson) return
    const wait = this.cfg.seenMinIntervalMs - this.elapsedSince(this.lastSeenAt)
    if (wait > 0) {
      this.hooks.requestPass(this.id, wait)
      return
    }
    this.fs.write(`seen/${this.id}.json`, encoder.encode(json))
    this.lastSeenJson = json
    this.lastSeenAt = this.fs.wallClock()
  }

  private ackOf(device: number): VV {
    return device === this.id ? this.vv : (this.acks.get(device)?.vv ?? {})
  }

  private confirmed(snapshot: string) {
    if (this.cfg.bug === "gc-unconfirmed-snapshot") return true
    if (!this.mine.has(baseName(snapshot)) && this.verified.has(snapshot)) return true
    for (const [device, ack] of this.acks) if (device !== this.id && ack.verified.has(snapshot)) return true
    return false
  }

  private maybeSnapshot(updates: readonly Listed[], live: readonly (readonly [string, VV])[]) {
    if (this.elapsedSince(this.lastSnapshotAt) < this.cfg.compactMinIntervalMs) return
    const newest = live.reduce<VV>((acc, [, vv]) => vvMax(acc, vv), {})
    const uncovered = updates.filter((f) => {
      const span = this.spans.get(f.path)
      return !span || !covers(newest, span.end)
    }).length
    if (uncovered < this.cfg.compactAfterFiles) return
    this.flush()
    const bytes = this.doc.export({ mode: "snapshot" })
    const name = `${createHash("sha256").update(`${this.peer}:`).update(bytes).digest("hex").slice(0, 32)}.loro`
    const path = `snapshots/${name}`
    if (this.fs.stat(path) || this.fs.stat(`snapshots/.${name}.icloud`)) return
    const vv = this.vv
    this.fs.write(path, bytes)
    this.mine.add(name)
    this.checked.add(name)
    this.snapshotVV.set(name, vv)
    this.lastSnapshotAt = this.fs.wallClock()
    this.stats.snapshotsWritten++
    this.hooks.onSnapshot(this.id, path, bytes)
  }

  private collectGarbage(snapshots: readonly Listed[], updates: readonly Listed[], live: readonly (readonly [string, VV])[]) {
    const witnesses = live.filter(([name]) => this.confirmed(name))
    const acks = this.cfg.members.map((m) => this.ackOf(m))
    const acked = (vv: VV) => this.cfg.bug === "gc-without-acks" || acks.every((ack) => covers(ack, vv))
    const witnessed = (vv: VV) => this.cfg.bug === "gc-without-witness" || witnesses.some(([, w]) => covers(w, vv))

    for (const file of updates) {
      if (!file.path.startsWith(`updates/${this.id}/`) && this.cfg.bug !== "gc-any-device") continue
      const span = this.spans.get(file.path)
      if (span && acked(span.end) && witnessed(span.end)) this.remove(file.path)
    }

    for (const file of snapshots) {
      if (!this.mine.has(baseName(file.name))) continue
      const vv = this.snapshotVV.get(file.name)
      if (!vv) continue
      const above = witnesses.some(([name, w]) => name !== file.name && covers(w, vv) && (!covers(vv, w) || name > file.name))
      if (above) this.remove(file.path)
    }

    for (const raw of this.fs.list("seen")) {
      const name = /^\.(.+)\.icloud$/.exec(raw)?.[1] ?? raw
      if (new RegExp(`^${this.id} \\d+\\.json$`).test(name)) this.remove(`seen/${name}`)
    }
  }

  private remove(path: string) {
    this.fs.remove(path)
    this.spans.delete(path)
    this.stats.filesDeleted++
  }
}
