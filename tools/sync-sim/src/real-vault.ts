import { Duration, Effect, Layer, Option } from "effect"
import {
  Entry,
  FileUnavailable,
  Storage,
  Vault,
  layer,
  type Replica as VaultReplica,
} from "@seqno/vault"
import type { CloudFs } from "./cloud.ts"
import { Vaults, type Replica, type VaultSpec, type VaultSync } from "./ports.ts"
import type { VV } from "./vv.ts"

const entryOf = (fs: CloudFs, dir: string, name: string) =>
  Effect.gen(function* () {
    const path = `${dir}/${name}`
    const stat = yield* fs.stat(path)
    if (Option.isSome(stat)) {
      return [Entry.File({ name, placeholder: stat.value.dataless })]
    }
    const inside = yield* fs.list(path)
    return inside.length > 0 ? [Entry.Directory({ name })] : []
  })

const cloudStorage = (fs: CloudFs) =>
  Storage.of({
    list: (dir) =>
      Effect.flatMap(fs.list(dir), (names) =>
        Effect.map(
          Effect.forEach(names, (name) => entryOf(fs, dir, name)),
          (entries) => entries.flat(),
        ),
      ),
    read: (path) =>
      Effect.mapError(
        fs.read(path),
        (error) =>
          new FileUnavailable({
            path,
            reason: error._tag === "NotDownloaded" ? "not-downloaded" : "missing",
          }),
      ),
    write: fs.write,
    remove: fs.remove,
    download: fs.download,
  })

const vaultReplica = (replica: Replica): VaultReplica => ({
  version: replica.version,
  merge: replica.importBlobs,
  snapshot: replica.exportSnapshot,
})

const RETRY_MS = 30_000

const attach = (spec: VaultSpec, fs: CloudFs, replica: Replica) =>
  Effect.gen(function* () {
    const vault = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* Vault
      }),
      layer({
        device: spec.deviceId,
        peer: `${Number(replica.peer)}`,
        members: spec.members,
        compactAfterFiles: spec.compaction ? spec.compactAfterFiles : Number.POSITIVE_INFINITY,
        compactEvery: Duration.millis(spec.compactMinIntervalMs),
      }).pipe(Layer.provide(Layer.succeed(Storage, cloudStorage(fs)))),
    )
    const stats = { importedFiles: 0, importedBytes: 0, placeholdersSeen: 0 }
    let flushed: VV = {}

    const flush = Effect.gen(function* () {
      const now = yield* replica.version
      const from = flushed[replica.peer] ?? 0
      if ((now[replica.peer] ?? 0) <= from) return
      const bytes = yield* replica.exportUpdates({ ...now, [replica.peer]: from })
      yield* Effect.orDie(vault.writeUpdate(bytes))
      flushed = now
    })

    const pass = Effect.map(Effect.orDie(vault.sync(vaultReplica(replica))), (report) => {
      stats.importedFiles += report.merged.length
      stats.placeholdersSeen += report.waiting.length
      return { wakeInMs: report.waiting.length > 0 || report.behind ? RETRY_MS : null }
    })

    return { flush, pass, stats: Effect.sync(() => ({ ...stats })) } satisfies VaultSync
  })

export const realVaults = Layer.succeed(Vaults, Vaults.of({ attach }))
