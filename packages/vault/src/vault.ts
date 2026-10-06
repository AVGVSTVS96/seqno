import { Clock, Context, Duration, Effect, Layer, Option, Schema, Semaphore } from "effect"
import type { DeviceId } from "@seqno/domain"
import {
  deviceOfDir,
  deviceOfSeen,
  isSeenConflictOf,
  isSnapshotName,
  isUpdateName,
  originalName,
  readName,
  seenDir,
  seenPath,
  snapshotName,
  snapshotPath,
  snapshotsDir,
  updatePath,
  updatesDir,
} from "./layout.ts"
import type { Replica } from "./replica.ts"
import { Entry, Storage, type StorageFailed } from "./storage.ts"
import { covers, inspectBlob, isEmpty, join, Version, type BlobKind, type Span } from "./version.ts"

export const SeenFile = Schema.Struct({
  vv: Version,
  verified: Schema.Array(Schema.String),
  snapshots: Schema.Array(Schema.Tuple([Schema.String, Version])),
})
export type SeenFile = typeof SeenFile.Type

const SeenJson = Schema.fromJsonString(SeenFile)
const decodeSeen = Schema.decodeUnknownOption(SeenJson)
const encodeSeen = Schema.encodeSync(SeenJson)

export class UpdateRejected extends Schema.TaggedError<UpdateRejected>()("UpdateRejected", {
  reason: Schema.String,
}) {}

export interface VaultConfig {
  readonly device: DeviceId
  readonly peer: `${number}`
  readonly members: ReadonlyArray<DeviceId>
  readonly compactAfterFiles: number
  readonly compactEvery: Duration.Input
}

export interface SyncReport {
  readonly merged: ReadonlyArray<string>
  readonly waiting: ReadonlyArray<string>
  readonly behind: boolean
  readonly written: ReadonlyArray<string>
  readonly deleted: ReadonlyArray<string>
}

export class Vault extends Context.Service<
  Vault,
  {
    readonly device: DeviceId
    readonly writeUpdate: (
      bytes: Uint8Array,
    ) => Effect.Effect<string, UpdateRejected | StorageFailed>
    readonly sync: (replica: Replica) => Effect.Effect<SyncReport, StorageFailed>
  }
>()("@seqno/vault/Vault") {}

interface Listed {
  readonly key: string
  readonly path: string
  readonly name: string
  readonly placeholder: boolean
}

interface Fetched {
  readonly bytes: Uint8Array
  readonly span: Span
}

interface Ack {
  vv: Version
  readonly verified: Set<string>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const byName = new Intl.Collator("en", { numeric: true })

const make = (config: VaultConfig) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const lock = yield* Semaphore.make(1)
    const me = config.device
    const myUpdates = `${updatesDir}/${me}`
    const spans = new Map<string, Span>()
    const consumed = new Set<string>()
    const acks = new Map<DeviceId, Ack>()
    const snapshotVersions = new Map<string, Version>()
    const checked = new Set<string>()
    const verified = new Set<string>()
    const mine = new Set<string>()
    const state = { lastSeen: "", lastSnapshotAt: Option.none<number>() }

    const filesIn = (dir: string, keyDir: string) =>
      Effect.map(storage.list(dir), (entries) =>
        entries
          .filter(Entry.$is("File"))
          .map((entry): Listed => {
            const listed = readName(entry.name)
            return {
              key: `${keyDir}/${listed.name}`,
              path: `${dir}/${listed.raw}`,
              name: listed.name,
              placeholder: listed.stub || entry.placeholder,
            }
          })
          .toSorted((a, b) => byName.compare(a.key, b.key)),
      )

    const listUpdates = Effect.flatMap(storage.list(updatesDir), (entries) =>
      Effect.map(
        Effect.forEach(entries.filter(Entry.$is("Directory")), (entry) => {
          const listed = readName(entry.name)
          return Option.match(deviceOfDir(listed.name), {
            onNone: () => Effect.succeed([]),
            onSome: (device) => filesIn(`${updatesDir}/${listed.raw}`, `${updatesDir}/${device}`),
          })
        }),
        (dirs) => dirs.flat().filter((file) => isUpdateName(file.name)),
      ),
    )

    const listSnapshots = Effect.map(filesIn(snapshotsDir, snapshotsDir), (files) =>
      files.filter((file) => isSnapshotName(file.name)),
    )

    const readBytes = (file: Listed) =>
      Effect.gen(function* () {
        const bytes = file.placeholder
          ? Option.none<Uint8Array>()
          : yield* Effect.option(storage.read(file.path))
        if (Option.isNone(bytes)) yield* storage.download(file.path)
        return bytes
      })

    const fetchBlob = (file: Listed, kind: BlobKind) =>
      Effect.gen(function* () {
        const blob = Option.flatMap(yield* readBytes(file), (bytes) =>
          Option.map(
            Option.filter(inspectBlob(bytes), (meta) => meta.kind === kind),
            (meta): Fetched => ({ bytes, span: meta.span }),
          ),
        )
        if (Option.isNone(blob) && !file.placeholder) yield* storage.download(file.path)
        return blob
      })

    const isMine = (bytes: Uint8Array, name: string) =>
      Effect.map(
        Effect.promise(() => snapshotName(config.peer, bytes)),
        (expected) => expected === originalName(name),
      )

    const confirmed = (name: string) =>
      (!mine.has(originalName(name)) && verified.has(name)) ||
      [...acks].some(([device, ack]) => device !== me && ack.verified.has(name))

    const writeUpdate = (bytes: Uint8Array) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const meta = Option.filter(inspectBlob(bytes), (blob) => blob.kind === "update")
          if (Option.isNone(meta)) {
            return yield* new UpdateRejected({ reason: "bytes are not a Loro update" })
          }
          const { start, end } = meta.value.span
          const authors = Object.keys(end).filter((peer) => (end[peer] ?? 0) > (start[peer] ?? 0))
          if (authors.length !== 1 || authors[0] !== config.peer) {
            return yield* new UpdateRejected({
              reason: `an update file holds only peer ${config.peer}'s own ops, found peers [${authors.join(", ")}]`,
            })
          }
          const path = updatePath(me, start[config.peer] ?? 0)
          const existing = yield* filesIn(myUpdates, myUpdates)
          if (existing.some((file) => file.key === path)) {
            return yield* new UpdateRejected({ reason: `${path} already exists` })
          }
          yield* storage.write(path, bytes)
          spans.set(path, meta.value.span)
          consumed.add(path)
          return path
        }),
      )

    const sync = (replica: Replica) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const snapshots = yield* listSnapshots
          const updates = yield* listUpdates
          const merged: Array<string> = []
          const waiting: Array<string> = []
          const written: Array<string> = []
          const deleted: Array<string> = []
          const inHand = new Map<string, readonly [Listed, Fetched]>()

          for (const file of snapshots) {
            if (checked.has(file.name)) continue
            const blob = yield* fetchBlob(file, "snapshot")
            if (Option.isNone(blob)) {
              waiting.push(file.key)
              continue
            }
            snapshotVersions.set(file.name, blob.value.span.end)
            checked.add(file.name)
            if (yield* isMine(blob.value.bytes, file.name)) mine.add(originalName(file.name))
            else verified.add(file.name)
            inHand.set(file.name, [file, blob.value])
          }

          const mergeAll = (batch: ReadonlyArray<readonly [Listed, Fetched]>) =>
            Effect.map(
              replica.merge(batch.map(([, blob]) => blob.bytes)),
              (results) =>
                batch.filter(([file], index) => {
                  if (results[index] !== true) {
                    waiting.push(file.key)
                    return true
                  }
                  consumed.add(file.key)
                  merged.push(file.key)
                  return false
                }).length,
            )

          if (isEmpty(yield* replica.version)) {
            const newest = [...inHand.values()].reduce<Option.Option<readonly [Listed, Fetched]>>(
              (best, entry) =>
                Option.isSome(best) && covers(best.value[1].span.end, entry[1].span.end)
                  ? best
                  : Option.some(entry),
              Option.none(),
            )
            if (Option.isSome(newest)) yield* mergeAll([newest.value])
          }

          const have = yield* replica.version
          const batch: Array<readonly [Listed, Fetched]> = []
          let updatesWaiting = 0
          for (const file of updates) {
            if (consumed.has(file.key)) continue
            const blob = yield* fetchBlob(file, "update")
            if (Option.isNone(blob)) {
              waiting.push(file.key)
              updatesWaiting++
              continue
            }
            spans.set(file.key, blob.value.span)
            if (covers(have, blob.value.span.end)) consumed.add(file.key)
            else batch.push([file, blob.value])
          }
          updatesWaiting += yield* mergeAll(batch)

          const live = () =>
            snapshots.flatMap((file) =>
              Option.toArray(
                Option.map(
                  Option.fromNullishOr(snapshotVersions.get(file.name)),
                  (vv) => [file, vv] as const,
                ),
              ),
            )

          if (updatesWaiting === 0) {
            for (const [file, vv] of live()) {
              if (covers(yield* replica.version, vv)) continue
              const held = inHand.get(file.name)
              const blob =
                held === undefined ? yield* fetchBlob(file, "snapshot") : Option.some(held[1])
              if (Option.isSome(blob)) yield* mergeAll([[file, blob.value]])
            }
          }

          const seenFiles = yield* filesIn(seenDir, seenDir)
          for (const file of seenFiles) {
            const device = deviceOfSeen(file.name)
            if (Option.isNone(device) || device.value === me) continue
            const seen = Option.flatMap(yield* readBytes(file), (bytes) =>
              decodeSeen(decoder.decode(bytes)),
            )
            if (Option.isNone(seen)) continue
            const ack = acks.get(device.value) ?? { vv: {}, verified: new Set<string>() }
            ack.vv = join(ack.vv, seen.value.vv)
            seen.value.verified.forEach((name) => ack.verified.add(name))
            acks.set(device.value, ack)
            for (const [name, vv] of seen.value.snapshots) {
              snapshotVersions.set(name, join(snapshotVersions.get(name) ?? {}, vv))
            }
          }

          const version = yield* replica.version
          const present = new Set(snapshots.map((file) => file.name))
          const seen = encodeSeen({
            vv: version,
            verified: [...verified].filter((name) => present.has(name)).toSorted(),
            snapshots: [...present]
              .filter((name) => mine.has(originalName(name)))
              .toSorted()
              .map((name) => [name, snapshotVersions.get(name) ?? {}] as const),
          })
          if (seen !== state.lastSeen) {
            yield* storage.write(seenPath(me), encoder.encode(seen))
            state.lastSeen = seen
          }

          const behind = live().some(([, vv]) => !covers(version, vv))
          const now = yield* Clock.currentTimeMillis
          const rested = Option.match(state.lastSnapshotAt, {
            onNone: () => true,
            onSome: (at) => now < at || now - at >= Duration.toMillis(config.compactEvery),
          })
          if (updatesWaiting === 0 && !behind && rested) {
            const newest = live().reduce<Version>((acc, [, vv]) => join(acc, vv), {})
            const uncovered = updates.filter((file) => {
              const span = spans.get(file.key)
              return span === undefined || !covers(newest, span.end)
            }).length
            if (uncovered >= config.compactAfterFiles) {
              const bytes = yield* replica.snapshot
              const meta = Option.filter(inspectBlob(bytes), (blob) => blob.kind === "snapshot")
              const name = yield* Effect.promise(() => snapshotName(config.peer, bytes))
              if (Option.isSome(meta) && !present.has(name)) {
                yield* storage.write(snapshotPath(name), bytes)
                mine.add(name)
                checked.add(name)
                snapshotVersions.set(name, meta.value.span.end)
                state.lastSnapshotAt = Option.some(now)
                written.push(snapshotPath(name))
              }
            }
          }

          const witnesses = live().filter(([file]) => confirmed(file.name))
          const memberAcks = config.members.map((member) =>
            member === me ? version : (acks.get(member)?.vv ?? {}),
          )
          const remove = (file: Listed) =>
            Effect.map(storage.remove(file.path), () => {
              spans.delete(file.key)
              deleted.push(file.key)
            })

          for (const file of updates) {
            const span = spans.get(file.key)
            if (!file.key.startsWith(`${myUpdates}/`) || span === undefined) continue
            const acked = memberAcks.every((ack) => covers(ack, span.end))
            const witnessed = witnesses.some(([, vv]) => covers(vv, span.end))
            if (acked && witnessed) yield* remove(file)
          }

          for (const [file, vv] of live()) {
            if (!mine.has(originalName(file.name))) continue
            const above = witnesses.some(
              ([other, w]) =>
                other.name !== file.name &&
                covers(w, vv) &&
                (!covers(vv, w) || other.name > file.name),
            )
            if (above) yield* remove(file)
          }

          for (const file of seenFiles) {
            if (isSeenConflictOf(me, file.name)) yield* remove(file)
          }

          return { merged, waiting, behind, written, deleted }
        }),
      )

    return Vault.of({ device: me, writeUpdate, sync })
  })

export const layer = (config: VaultConfig): Layer.Layer<Vault, never, Storage> =>
  Layer.effect(Vault, make(config))
