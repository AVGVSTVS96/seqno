import { Effect, Option } from "effect"
import { LoroDoc } from "loro-crdt"
import { importMessage } from "@seqno/domain"
import type { Root } from "@seqno/domain"
import { fromLoro } from "./version.ts"
import type { Version } from "./version.ts"

export interface Replica {
  readonly version: Effect.Effect<Version>
  readonly merge: (blobs: readonly Uint8Array[]) => Effect.Effect<readonly boolean[]>
  readonly restore: (snapshot: Uint8Array) => Effect.Effect<Option.Option<Version>>
  readonly snapshot: Effect.Effect<Uint8Array>
  readonly roots: Effect.Effect<readonly Root[]>
  readonly hasPages: Effect.Effect<boolean>
  readonly rootsIn: (bytes: Uint8Array) => readonly Root[]
}

export const rootsOfDoc = (doc: LoroDoc): readonly Root[] =>
  [...doc.oplogVersion().toJSON().keys()].flatMap((peer) => {
    const change = doc.getChangeAt({ peer, counter: 0 })

    return change.deps.length === 0 ? [{ peer, imported: change.message === importMessage }] : []
  })

export const rootsInBlob = (bytes: Uint8Array): readonly Root[] => {
  const doc = new LoroDoc()

  try {
    doc.import(bytes)

    return rootsOfDoc(doc)
  } catch {
    return []
  } finally {
    doc.free()
  }
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
  roots: Effect.sync(() => rootsOfDoc(doc)),
  hasPages: Effect.sync(() => doc.oplogVersion().length() > 0),
  rootsIn: rootsInBlob,
})
