import { Option, Schema } from "effect"
import { decodeImportBlobMeta, type VersionVector } from "loro-crdt"

export const Version = Schema.Record(
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
)
export type Version = typeof Version.Type

export interface Span {
  readonly start: Version
  readonly end: Version
}

export type BlobKind = "update" | "snapshot"

export interface BlobMeta {
  readonly kind: BlobKind
  readonly span: Span
}

export const fromLoro = (version: VersionVector): Version => Object.fromEntries(version.toJSON())

export const covers = (a: Version, b: Version): boolean =>
  Object.entries(b).every(([peer, counter]) => (a[peer] ?? 0) >= counter)

export const join = (a: Version, b: Version): Version =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((peer) => [
      peer,
      Math.max(a[peer] ?? 0, b[peer] ?? 0),
    ]),
  )

export const isEmpty = (version: Version): boolean => Object.keys(version).length === 0

const checkedMeta = Option.liftThrowable((bytes: Uint8Array) => decodeImportBlobMeta(bytes, true))

export const inspectBlob = (bytes: Uint8Array): Option.Option<BlobMeta> =>
  Option.flatMap(checkedMeta(bytes), (meta) =>
    meta.mode === "update" || meta.mode === "snapshot"
      ? Option.some({
          kind: meta.mode,
          span: {
            start: fromLoro(meta.partialStartVersionVector),
            end: fromLoro(meta.partialEndVersionVector),
          },
        })
      : Option.none(),
  )
