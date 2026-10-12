import { Effect, Option } from "effect"
import type { LoroDoc } from "loro-crdt"
import { fromLoro, type Version } from "./version.ts"

export interface Replica {
  readonly version: Effect.Effect<Version>
  readonly merge: (blobs: ReadonlyArray<Uint8Array>) => Effect.Effect<ReadonlyArray<boolean>>
  readonly restore: (snapshot: Uint8Array) => Effect.Effect<Option.Option<Version>>
  readonly snapshot: Effect.Effect<Uint8Array>
}

const importOne = (doc: LoroDoc, blob: Uint8Array): boolean => {
  try {
    doc.import(blob)
    return true
  } catch {
    return false
  }
}

export const loroReplica = (doc: LoroDoc): Replica => ({
  version: Effect.sync(() => fromLoro(doc.oplogVersion())),
  merge: (blobs) =>
    Effect.sync(() => {
      try {
        doc.importBatch([...blobs])
        return blobs.map(() => true)
      } catch {
        return blobs.map((blob) => importOne(doc, blob))
      }
    }),
  restore: (snapshot) =>
    Effect.sync(() =>
      importOne(doc, snapshot) ? Option.some(fromLoro(doc.oplogVersion())) : Option.none(),
    ),
  snapshot: Effect.sync(() => doc.export({ mode: "snapshot" })),
})
