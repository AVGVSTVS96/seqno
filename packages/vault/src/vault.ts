import { Clock, Context, Duration, Effect, Layer, Option, Schema, Semaphore } from "effect"
import type { DeviceId, Root } from "@seqno/domain"
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
import { Entry, Storage } from "./storage.ts"
import type { StorageFailed } from "./storage.ts"
import { covers, inspectBlob, isEmpty, join, Version } from "./version.ts"
import type { BlobKind, Span } from "./version.ts"

export const MirrorClaim = Schema.Struct({
  claim: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  version: Version,
})

export type MirrorClaim = typeof MirrorClaim.Type

export const SeenFile = Schema.Struct({
  vv: Version,
  verified: Schema.Array(Schema.String),
  snapshots: Schema.Array(Schema.Tuple([Schema.String, Version])),
  mirror: Schema.optionalKey(MirrorClaim),
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
  readonly formerPeers?: readonly string[]
  readonly synced?: boolean
  readonly members: readonly DeviceId[]
  readonly compactAfterFiles: number
  readonly compactEvery: Duration.Input
}

export interface SeenDevice {
  readonly device: DeviceId
  readonly vv: Version
  readonly mirror: MirrorClaim | null
}

export interface SyncReport {
  readonly merged: readonly string[]
  readonly waiting: readonly string[]
  readonly foreign: readonly string[]
  readonly foreignRoots: readonly string[]
  readonly devices: readonly SeenDevice[]
  readonly unread: number
  readonly behind: boolean
  readonly written: readonly string[]
  readonly deleted: readonly string[]
}

export class Vault extends Context.Service<
  Vault,
  {
    readonly device: DeviceId
    readonly writeUpdate: (
      bytes: Uint8Array,
    ) => Effect.Effect<string, UpdateRejected | StorageFailed>
    readonly sync: (replica: Replica) => Effect.Effect<SyncReport, StorageFailed>
    readonly setMirror: (claim: MirrorClaim) => Effect.Effect<void>
    readonly abandon: Effect.Effect<void, StorageFailed>
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

const lineageOf = (replica: Replica) =>
  Effect.map(replica.roots, (roots) => {
    const [only, ...rest] = roots.filter((root) => root.imported)

    return only !== undefined && rest.length === 0 ? only.peer : null
  })

const given: SyncReport = {
  merged: [],
  waiting: [],
  foreign: [],
  foreignRoots: [],
  devices: [],
  unread: 0,
  behind: false,
  written: [],
  deleted: [],
}

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

    const state = {
      lastSeen: "",
      lastSnapshotAt: Option.none<number>(),
      merged: false,
      mirror: Option.none<MirrorClaim>(),
      abandoned: false,
    }

    const blobRoots = new Map<string, readonly Root[]>()

    const rootsOf = (replica: Replica, key: string, bytes: Uint8Array) => {
      const known = blobRoots.get(key)

      if (known !== undefined) {
        return known
      }

      const found = replica.rootsIn(bytes)
      blobRoots.set(key, found)

      return found
    }

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

        if (Option.isNone(bytes)) {
          yield* storage.download(file.path)
        }

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

        if (Option.isNone(blob) && !file.placeholder) {
          yield* storage.download(file.path)
        }

        return blob
      })

    const owners = [me, ...(config.formerPeers ?? [])]

    const isMine = (bytes: Uint8Array, name: string) =>
      Effect.map(
        Effect.promise(
          async () =>
            await Promise.all(owners.map(async (owner) => await snapshotName(owner, bytes))),
        ),
        (expected) => expected.includes(originalName(name)),
      )

    const local = config.synced === false

    const confirmed = (name: string) =>
      (local && checked.has(name)) ||
      (!mine.has(originalName(name)) && verified.has(name)) ||
      [...acks].some(([device, ack]) => device !== me && ack.verified.has(name))

    const writeUpdate = (bytes: Uint8Array) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (state.abandoned) {
            return yield* new UpdateRejected({ reason: "this device gave the folder up" })
          }

          const meta = Option.filter(inspectBlob(bytes), (blob) => blob.kind === "update")

          if (Option.isNone(meta)) {
            return yield* new UpdateRejected({ reason: "bytes are not a Loro update" })
          }

          const { start, end } = meta.value.span
          const authors = Object.keys(end).filter((peer) => (end[peer] ?? 0) > (start[peer] ?? 0))
          const [author] = authors

          if (author === undefined || authors.length > 1) {
            return yield* new UpdateRejected({
              reason: `an update file holds one peer's ops, found peers [${authors.join(", ")}]`,
            })
          }

          const path = updatePath(me, author, start[author] ?? 0)
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

    const sync = (replica: Replica): Effect.Effect<SyncReport, StorageFailed> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (state.abandoned) {
            return given
          }

          const snapshots = yield* listSnapshots
          const updates = yield* listUpdates
          const seenFiles = yield* filesIn(seenDir, seenDir)
          const merged: string[] = []
          const waiting: string[] = []
          const written: string[] = []
          const deleted: string[] = []
          const inHand = new Map<string, readonly [Listed, Uint8Array]>()
          const listedBy = new Map<string, DeviceId>()

          const devices: SeenDevice[] = []
          let unread = 0

          for (const file of seenFiles) {
            const device = deviceOfSeen(file.name)

            if (Option.isNone(device)) {
              continue
            }

            const seen = Option.flatMap(yield* readBytes(file), (bytes) =>
              decodeSeen(decoder.decode(bytes)),
            )

            if (Option.isNone(seen)) {
              unread++
              continue
            }

            if (originalName(file.name) === file.name) {
              if (
                device.value === me &&
                Option.isNone(state.mirror) &&
                seen.value.mirror !== undefined
              ) {
                state.mirror = Option.some(seen.value.mirror)
              }

              devices.push({
                device: device.value,
                vv: seen.value.vv,
                mirror:
                  device.value === me
                    ? Option.getOrNull(state.mirror)
                    : (seen.value.mirror ?? null),
              })
            }

            const canonical = originalName(file.name) === file.name

            for (const [name, vv] of seen.value.snapshots) {
              snapshotVersions.set(name, join(snapshotVersions.get(name) ?? {}, vv))

              if (!canonical) {
                continue
              }

              listedBy.set(name, device.value)

              if (device.value === me) {
                mine.add(originalName(name))
              }
            }

            if (device.value === me) {
              continue
            }

            const ack = acks.get(device.value) ?? { vv: {}, verified: new Set<string>() }
            ack.vv = join(ack.vv, seen.value.vv)
            seen.value.verified.forEach((name) => ack.verified.add(name))
            acks.set(device.value, ack)
          }

          const settle = (file: Listed, bytes: Uint8Array, vv: Version) =>
            Effect.gen(function* () {
              snapshotVersions.set(file.name, vv)
              checked.add(file.name)
              const owner = listedBy.get(file.name)
              const own = owner === undefined ? yield* isMine(bytes, file.name) : owner === me

              if (own) {
                mine.add(originalName(file.name))
              } else {
                verified.add(file.name)
              }
            })

          const direct = !state.merged && isEmpty(yield* replica.version)
          const tried = new Set<string>()

          if (direct) {
            const ops = (file: Listed) =>
              Object.values(snapshotVersions.get(file.name) ?? {}).reduce((a, b) => a + b, 0)

            const unchecked = snapshots.filter((file) => !checked.has(file.name))

            const newestFirst = [
              ...unchecked
                .filter((file) => listedBy.has(file.name))
                .toSorted((a, b) => ops(b) - ops(a)),
              ...unchecked.filter((file) => !listedBy.has(file.name)),
            ]

            for (const file of newestFirst) {
              tried.add(file.name)
              const bytes = yield* readBytes(file)

              if (Option.isNone(bytes)) {
                waiting.push(file.key)
                continue
              }

              const restored = yield* replica.restore(bytes.value)

              if (Option.isNone(restored)) {
                yield* storage.download(file.path)
                waiting.push(file.key)
                continue
              }

              yield* settle(file, bytes.value, restored.value)
              consumed.add(file.key)
              merged.push(file.key)
              break
            }
          }

          for (const file of snapshots) {
            if (checked.has(file.name) || tried.has(file.name)) {
              continue
            }

            if (direct && listedBy.has(file.name)) {
              continue
            }

            const blob = yield* fetchBlob(file, "snapshot")

            if (Option.isNone(blob)) {
              waiting.push(file.key)
              continue
            }

            yield* settle(file, blob.value.bytes, blob.value.span.end)
            inHand.set(file.name, [file, blob.value.bytes])
          }

          const foreign: string[] = []
          const foreignRoots = new Set<string>()

          const mergeAll = (offered: ReadonlyArray<readonly [Listed, Uint8Array]>) =>
            Effect.gen(function* () {
              const have = yield* replica.version

              const rooted = offered.flatMap(([file, bytes]) =>
                Option.isSome(Option.filter(inspectBlob(bytes), (meta) => meta.rooted))
                  ? [
                      {
                        key: file.key,
                        roots: rootsOf(replica, file.key, bytes),
                        own:
                          file.key.startsWith(`${myUpdates}/`) || mine.has(originalName(file.name)),
                        size: bytes.length,
                      },
                    ]
                  : [],
              )

              const roots = new Map(rooted.map((blob) => [blob.key, blob.roots]))

              const lineage =
                (yield* lineageOf(replica)) ??
                (isEmpty(have)
                  ? (rooted
                      .toSorted((a, b) => Number(b.own) - Number(a.own) || b.size - a.size)
                      .flatMap((blob) => blob.roots.filter((root) => root.imported))[0]?.peer ??
                    null)
                  : null)

              const hasPages = yield* replica.hasPages

              const batch = offered.filter(([file]) => {
                const found = roots.get(file.key)

                if (found === undefined) {
                  return true
                }

                const allowed = !found.some(
                  (root) =>
                    root.imported &&
                    root.peer !== lineage &&
                    (have[root.peer] ?? 0) === 0 &&
                    (lineage !== null || hasPages),
                )

                if (!allowed) {
                  foreign.push(file.key)
                  found
                    .filter((root) => root.imported && root.peer !== lineage)
                    .forEach((root) => foreignRoots.add(root.peer))
                }

                return allowed
              })

              if (batch.length === 0) {
                return 0
              }

              state.merged = true
              const results = yield* replica.merge(batch.map(([, bytes]) => bytes))

              return batch.filter(([file], index) => {
                if (results[index] !== true) {
                  waiting.push(file.key)

                  return true
                }

                consumed.add(file.key)
                merged.push(file.key)

                return false
              }).length
            })

          if (isEmpty(yield* replica.version)) {
            const newest = [...inHand.values()].reduce<
              Option.Option<readonly [Listed, Uint8Array]>
            >(
              (best, entry) =>
                Option.isSome(best) &&
                covers(
                  snapshotVersions.get(best.value[0].name) ?? {},
                  snapshotVersions.get(entry[0].name) ?? {},
                )
                  ? best
                  : Option.some(entry),
              Option.none(),
            )

            if (Option.isSome(newest)) {
              yield* mergeAll([newest.value])
            }
          }

          const have = yield* replica.version
          const batch: Array<readonly [Listed, Uint8Array]> = []
          let updatesWaiting = 0

          for (const file of updates) {
            if (consumed.has(file.key)) {
              continue
            }

            const blob = yield* fetchBlob(file, "update")

            if (Option.isNone(blob)) {
              waiting.push(file.key)
              updatesWaiting++
              continue
            }

            spans.set(file.key, blob.value.span)

            if (covers(have, blob.value.span.end)) {
              consumed.add(file.key)
            } else {
              batch.push([file, blob.value.bytes])
            }
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
              if (covers(yield* replica.version, vv)) {
                continue
              }

              const held = inHand.get(file.name)
              const bytes = held === undefined ? yield* readBytes(file) : Option.some(held[1])

              if (Option.isNone(bytes)) {
                continue
              }

              if ((yield* mergeAll([[file, bytes.value]])) > 0) {
                yield* storage.download(file.path)
              } else if (!checked.has(file.name)) {
                yield* settle(file, bytes.value, vv)
              }
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
            ...Option.match(state.mirror, { onNone: () => ({}), onSome: (mirror) => ({ mirror }) }),
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
              const name = yield* Effect.promise(async () => await snapshotName(me, bytes))

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

            if (!file.key.startsWith(`${myUpdates}/`) || span === undefined) {
              continue
            }

            const acked = memberAcks.every((ack) => covers(ack, span.end))
            const witnessed = witnesses.some(([, vv]) => covers(vv, span.end))

            if (acked && witnessed) {
              yield* remove(file)
            }
          }

          for (const [file, vv] of live()) {
            if (!mine.has(originalName(file.name))) {
              continue
            }

            const above = witnesses.some(
              ([other, w]) =>
                other.name !== file.name &&
                covers(w, vv) &&
                (!covers(vv, w) || other.name > file.name),
            )

            if (above) {
              yield* remove(file)
            }
          }

          for (const file of seenFiles) {
            if (isSeenConflictOf(me, file.name)) {
              yield* remove(file)
            }
          }

          return {
            merged,
            waiting,
            foreign,
            foreignRoots: [...foreignRoots],
            devices,
            unread,
            behind,
            written,
            deleted,
          }
        }),
      )

    const setMirror = (claim: MirrorClaim) =>
      Effect.sync(() => {
        state.mirror = Option.some(claim)
      })

    const abandon = lock.withPermits(1)(
      Effect.gen(function* () {
        const own = (yield* listUpdates).filter((file) => file.key.startsWith(`${myUpdates}/`))
        const snapshots = (yield* listSnapshots).filter((file) => mine.has(originalName(file.name)))

        const seen = (yield* filesIn(seenDir, seenDir)).filter(
          (file) => originalName(file.name) === `${me}.json`,
        )

        yield* Effect.forEach(
          [...own, ...snapshots, ...seen],
          (file) => storage.remove(file.path),
          {
            discard: true,
          },
        )
        state.abandoned = true
      }),
    )

    return Vault.of({ device: me, writeUpdate, sync, setMirror, abandon })
  })

export const layer = (config: VaultConfig): Layer.Layer<Vault, never, Storage> =>
  Layer.effect(Vault, make(config))
