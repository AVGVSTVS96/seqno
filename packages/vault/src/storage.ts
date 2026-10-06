import { Context, Data, Schema, type Effect } from "effect"

export class StorageFailed extends Schema.TaggedError<StorageFailed>()("StorageFailed", {
  path: Schema.String,
  reason: Schema.String,
}) {}

export class FileUnavailable extends Schema.TaggedError<FileUnavailable>()("FileUnavailable", {
  path: Schema.String,
  reason: Schema.Literals(["missing", "not-downloaded"]),
}) {}

export type Entry = Data.TaggedEnum<{
  File: { readonly name: string; readonly placeholder: boolean }
  Directory: { readonly name: string }
}>
export const Entry = Data.taggedEnum<Entry>()

export class Storage extends Context.Service<
  Storage,
  {
    readonly list: (dir: string) => Effect.Effect<ReadonlyArray<Entry>, StorageFailed>
    readonly read: (path: string) => Effect.Effect<Uint8Array, StorageFailed | FileUnavailable>
    readonly write: (path: string, bytes: Uint8Array) => Effect.Effect<void, StorageFailed>
    readonly remove: (path: string) => Effect.Effect<void, StorageFailed>
    readonly download: (path: string) => Effect.Effect<void, StorageFailed>
  }
>()("@seqno/vault/Storage") {}
