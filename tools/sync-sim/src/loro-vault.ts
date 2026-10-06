import { createHash } from "node:crypto"
import { Clock, Effect, Layer, Option, Schema } from "effect"
import type { CloudFs } from "./cloud.ts"
import { Graphs, Vaults, type Replica, type VaultSpec, type VaultSync } from "./ports.ts"
import { stubTarget } from "./util.ts"
import { covers, vvMax, type Span, type VV } from "./vv.ts"

export type Bug =
  | "placeholder-as-empty"
  | "gc-without-acks"
  | "gc-without-witness"
  | "gc-unconfirmed-snapshot"
  | "gc-any-device"

export const bugs: ReadonlyArray<Bug> = [
  "placeholder-as-empty",
  "gc-without-acks",
  "gc-without-witness",
  "gc-unconfirmed-snapshot",
  "gc-any-device",
]

const VersionVectorJson = Schema.Record(Schema.String, Schema.Number)

const SeenFile = Schema.Struct({
  vv: VersionVectorJson,
  verified: Schema.Array(Schema.String),
  snapshots: Schema.Array(Schema.Tuple([Schema.String, VersionVectorJson])),
})
type SeenFile = typeof SeenFile.Type

const decodeSeen = Schema.decodeUnknownOption(Schema.fromJsonString(SeenFile))

interface Listed {
  readonly path: string
  readonly name: string
  readonly stub: boolean
}

interface Ack {
  vv: VV
  readonly verified: Set<string>
}

const encoder = new TextEncoder()

const baseName = (name: string) => name.replace(/ \d+(\.[a-z]+)$/, "$1")

const visibleName = (raw: string): Listed["name"] => (stubTarget(raw) ?? raw).normalize("NFC")

const elapsedSince = (time: number) =>
  Effect.map(Clock.currentTimeMillis, (now) =>
    now - time < 0 ? Number.POSITIVE_INFINITY : now - time,
  )

const attach =
  (bug: Bug | undefined) =>
  (spec: VaultSpec, fs: CloudFs, replica: Replica): Effect.Effect<VaultSync, never, Graphs> =>
    Effect.gen(function* () {
      const graphs = yield* Graphs
      const me = spec.deviceId
      const peer = replica.peer
      const spans = new Map<string, Span>()
      const consumed = new Set<string>()
      const acks = new Map<string, Ack>()
      const snapshotVV = new Map<string, VV>()
      const verified = new Set<string>()
      const checked = new Set<string>()
      const behindSince = new Map<string, number>()
      const mine = new Set<string>()
      const stats = { importedFiles: 0, importedBytes: 0, placeholdersSeen: 0 }
      let flushed = 0
      let lastSeenJson = ""
      let lastSeenAt = Number.NEGATIVE_INFINITY
      let lastSnapshotAt = Number.NEGATIVE_INFINITY

      const list = (dir: string) =>
        Effect.map(fs.list(dir), (raws) =>
          raws.flatMap((raw): ReadonlyArray<Listed> => {
            const name = visibleName(raw)
            return name.endsWith(".loro")
              ? [{ path: `${dir}/${name}`, name, stub: stubTarget(raw) !== undefined }]
              : []
          }),
        )

      const placeholder = (file: Listed) =>
        file.stub
          ? Effect.succeed(true)
          : Effect.map(fs.stat(file.path), (stat) => Option.isSome(stat) && stat.value.dataless)

      const readable = (file: Listed): Effect.Effect<Option.Option<Uint8Array>> =>
        Effect.flatMap(placeholder(file), (isPlaceholder) => {
          if (isPlaceholder) {
            stats.placeholdersSeen++
            return Effect.as(fs.download(file.path), Option.none())
          }
          return fs.read(file.path).pipe(
            Effect.map(Option.some),
            Effect.catch(() => Effect.succeed(Option.none<Uint8Array>())),
          )
        })

      const markConsumed = (path: string) => consumed.add(path)

      const flush = Effect.gen(function* () {
        const version = yield* replica.version
        const end = version[peer] ?? 0
        if (end === flushed) {
          return
        }
        const bytes = yield* replica.exportUpdates({ ...version, [peer]: flushed })
        const path = `updates/${me}/${flushed}.loro`
        yield* fs.write(path, bytes)
        spans.set(path, { start: { [peer]: flushed }, end: { [peer]: end } })
        markConsumed(path)
        flushed = end
      })

      const importUpdates = (updates: ReadonlyArray<Listed>) =>
        Effect.gen(function* () {
          const have = yield* replica.version
          const batch: Array<{
            readonly path: string
            readonly bytes: Uint8Array
            readonly span: Span
          }> = []
          let waiting = 0
          for (const file of updates) {
            if (consumed.has(file.path)) {
              continue
            }
            if (bug === "placeholder-as-empty" && (yield* placeholder(file))) {
              markConsumed(file.path)
              continue
            }
            const bytes = yield* readable(file)
            const span = Option.flatMap(bytes, (b) => graphs.blobSpan(b, false))
            if (Option.isNone(bytes) || Option.isNone(span)) {
              waiting++
              continue
            }
            if (covers(have, span.value.end)) {
              spans.set(file.path, span.value)
              markConsumed(file.path)
            } else {
              batch.push({ path: file.path, bytes: bytes.value, span: span.value })
            }
          }
          if (batch.length === 0) {
            return waiting
          }
          const ok = yield* replica.importBlobs(batch.map((b) => b.bytes))
          batch.forEach((b, i) => {
            if (ok[i] !== true) {
              waiting++
              return
            }
            spans.set(b.path, b.span)
            markConsumed(b.path)
            stats.importedFiles++
            stats.importedBytes += b.bytes.length
          })
          return waiting
        })

      const waitedFor = (snapshot: string) =>
        Effect.gen(function* () {
          const have = yield* replica.version
          if (Object.keys(have).length === 0) {
            return true
          }
          const since = behindSince.get(snapshot) ?? (yield* Clock.currentTimeMillis)
          behindSince.set(snapshot, since)
          return (yield* elapsedSince(since)) >= spec.snapshotImportDelayMs
        })

      const checkSnapshots = (snapshots: ReadonlyArray<Listed>, updatesSettled: boolean) =>
        Effect.gen(function* () {
          let have = yield* replica.version
          let behind = false
          for (const file of snapshots) {
            const known = snapshotVV.get(file.name)
            const needed = known !== undefined && !covers(have, known)
            if (
              checked.has(file.name) &&
              !(needed && updatesSettled && (yield* waitedFor(file.name)))
            ) {
              behind ||= needed
              continue
            }
            if (bug === "placeholder-as-empty" && (yield* placeholder(file))) {
              checked.add(file.name)
              markConsumed(file.path)
              continue
            }
            const bytes = yield* readable(file)
            const span = Option.flatMap(bytes, (b) => graphs.blobSpan(b, true))
            if (Option.isNone(bytes) || Option.isNone(span)) {
              behind ||= needed
              continue
            }
            snapshotVV.set(file.name, span.value.end)
            checked.add(file.name)
            if (!mine.has(baseName(file.name))) {
              verified.add(file.name)
            }
            markConsumed(file.path)
            if (covers(have, span.value.end)) {
              continue
            }
            const ready = updatesSettled && (yield* waitedFor(file.name))
            const imported = ready && (yield* replica.importBlobs([bytes.value]))[0] === true
            if (imported) {
              stats.importedFiles++
              stats.importedBytes += bytes.value.length
              have = yield* replica.version
            } else {
              behind = true
            }
          }
          return behind
        })

      const seenFiles = Effect.map(fs.list("seen"), (raws) =>
        raws.flatMap((raw) => {
          const name = visibleName(raw)
          return [{ raw, name, stub: stubTarget(raw) !== undefined }]
        }),
      )

      const readSeen = Effect.gen(function* () {
        for (const file of yield* seenFiles) {
          const match = /^([A-Za-z0-9_-]{1,64})\.json$/.exec(file.name)
          const device = match?.[1]
          if (device === undefined || device === me) {
            continue
          }
          const bytes = yield* readable({
            path: `seen/${file.name}`,
            name: file.name,
            stub: file.stub,
          })
          const seen = Option.flatMap(bytes, (b) => decodeSeen(new TextDecoder().decode(b)))
          if (Option.isNone(seen)) {
            continue
          }
          const ack = acks.get(device) ?? { vv: {}, verified: new Set<string>() }
          ack.vv = vvMax(ack.vv, seen.value.vv)
          for (const snapshot of seen.value.verified) {
            ack.verified.add(snapshot)
          }
          acks.set(device, ack)
          for (const [snapshot, vv] of seen.value.snapshots) {
            snapshotVV.set(snapshot, vvMax(snapshotVV.get(snapshot) ?? {}, vv))
          }
        }
      })

      const writeSeen = Effect.gen(function* () {
        const present = new Set((yield* fs.list("snapshots")).map(visibleName))
        const seen: SeenFile = {
          vv: yield* replica.version,
          verified: [...verified].filter((s) => present.has(s)).toSorted(),
          snapshots: [...present]
            .filter((s) => mine.has(baseName(s)))
            .toSorted()
            .map((s) => [s, snapshotVV.get(s) ?? {}] as const),
        }
        const json = JSON.stringify(seen)
        if (json === lastSeenJson) {
          return null
        }
        const wait = spec.seenMinIntervalMs - (yield* elapsedSince(lastSeenAt))
        if (wait > 0) {
          return wait
        }
        yield* fs.write(`seen/${me}.json`, encoder.encode(json))
        lastSeenJson = json
        lastSeenAt = yield* Clock.currentTimeMillis
        return null
      })

      const confirmed = (snapshot: string) => {
        if (bug === "gc-unconfirmed-snapshot") {
          return true
        }
        if (!mine.has(baseName(snapshot)) && verified.has(snapshot)) {
          return true
        }
        return [...acks].some(([device, ack]) => device !== me && ack.verified.has(snapshot))
      }

      const maybeSnapshot = (
        updates: ReadonlyArray<Listed>,
        live: ReadonlyArray<readonly [string, VV]>,
      ) =>
        Effect.gen(function* () {
          if ((yield* elapsedSince(lastSnapshotAt)) < spec.compactMinIntervalMs) {
            return
          }
          const newest = live.reduce<VV>((acc, [, vv]) => vvMax(acc, vv), {})
          const uncovered = updates.filter((f) => {
            const span = spans.get(f.path)
            return span === undefined || !covers(newest, span.end)
          }).length
          if (uncovered < spec.compactAfterFiles) {
            return
          }
          yield* flush
          const bytes = yield* replica.exportSnapshot
          const digest = createHash("sha256").update(`${peer}:`).update(bytes).digest("hex")
          const name = `${digest.slice(0, 32)}.loro`
          const path = `snapshots/${name}`
          const taken =
            Option.isSome(yield* fs.stat(path)) ||
            Option.isSome(yield* fs.stat(`snapshots/.${name}.icloud`))
          if (taken) {
            return
          }
          const vv = yield* replica.version
          yield* fs.write(path, bytes)
          mine.add(name)
          checked.add(name)
          snapshotVV.set(name, vv)
          lastSnapshotAt = yield* Clock.currentTimeMillis
        })

      const remove = (path: string) =>
        Effect.tap(fs.remove(path), () => Effect.sync(() => spans.delete(path)))

      const collectGarbage = (
        snapshots: ReadonlyArray<Listed>,
        updates: ReadonlyArray<Listed>,
        live: ReadonlyArray<readonly [string, VV]>,
      ) =>
        Effect.gen(function* () {
          const witnesses = live.filter(([name]) => confirmed(name))
          const own = yield* replica.version
          const memberAcks = spec.members.map((m) => (m === me ? own : (acks.get(m)?.vv ?? {})))
          const acked = (vv: VV) =>
            bug === "gc-without-acks" || memberAcks.every((ack) => covers(ack, vv))
          const witnessed = (vv: VV) =>
            bug === "gc-without-witness" || witnesses.some(([, w]) => covers(w, vv))

          for (const file of updates) {
            if (!file.path.startsWith(`updates/${me}/`) && bug !== "gc-any-device") {
              continue
            }
            const span = spans.get(file.path)
            if (span !== undefined && acked(span.end) && witnessed(span.end)) {
              yield* remove(file.path)
            }
          }

          for (const file of snapshots) {
            const vv = snapshotVV.get(file.name)
            if (!mine.has(baseName(file.name)) || vv === undefined) {
              continue
            }
            const above = witnesses.some(
              ([name, w]) =>
                name !== file.name && covers(w, vv) && (!covers(vv, w) || name > file.name),
            )
            if (above) {
              yield* remove(file.path)
            }
          }

          const ownCopy = new RegExp(`^${me} \\d+\\.json$`)
          for (const file of yield* seenFiles) {
            if (ownCopy.test(file.name)) {
              yield* remove(`seen/${file.name}`)
            }
          }
        })

      const pass = Effect.gen(function* () {
        const snapshots = yield* list("snapshots")
        const dirs = yield* fs.list("updates")
        const updates = (yield* Effect.forEach(dirs, (dir) => list(`updates/${dir}`))).flat()
        const waiting = yield* importUpdates(updates)
        const behind = yield* checkSnapshots(snapshots, waiting === 0)
        yield* readSeen
        const wakeInMs = yield* writeSeen
        if (!spec.compaction) {
          return { wakeInMs }
        }
        const live = snapshots.flatMap((f) => {
          const vv = snapshotVV.get(f.name)
          return vv === undefined ? [] : [[f.name, vv] as const]
        })
        if (waiting === 0 && !behind) {
          yield* maybeSnapshot(updates, live)
        }
        yield* collectGarbage(snapshots, updates, live)
        return { wakeInMs }
      })

      return {
        flush,
        pass,
        stats: Effect.sync(() => ({ ...stats })),
      }
    })

export const loroVaults = (bug: Bug | undefined) =>
  Layer.succeed(Vaults, Vaults.of({ attach: attach(bug) }))
