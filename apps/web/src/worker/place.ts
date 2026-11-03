import { Context, Effect, Layer, Schema, type Option, type Stream } from "effect"
import { DeviceId } from "@seqno/domain"
import type { IndexError, Sqlite } from "@seqno/index"
import { FolderError, GraphFolder } from "@seqno/interop"
import { Entry, editLogDir, type Storage, type StorageFailed } from "@seqno/vault"
import type { GraphUnavailable } from "@seqno/rpc"
import type { OpenFile } from "./assets.ts"
import type { GitPlace } from "./git.ts"
import type { Layout } from "./layout.ts"
import type { MirrorStore } from "./mirror-store.ts"

export interface StarterFile {
  readonly path: string
  readonly text: string
}

export interface Starter {
  readonly version: number
  readonly files: ReadonlyArray<StarterFile>
}

export interface IndexFile {
  readonly read: Effect.Effect<Option.Option<Uint8Array>>
  readonly write: (image: Uint8Array<ArrayBuffer>) => Effect.Effect<void, StorageFailed>
}

export interface GraphPlace {
  readonly storage: Storage["Service"]
  readonly file: OpenFile
  readonly changed: Stream.Stream<ReadonlyArray<string>>
  readonly layout: Layout
  readonly synced: boolean
  readonly sqlite: Layer.Layer<Sqlite, IndexError>
  readonly indexFile: IndexFile
  readonly mirrorStore: MirrorStore
  readonly starter: Starter | null
  readonly git?: Effect.Effect<GitPlace>
}

export class GraphPlaces extends Context.Service<
  GraphPlaces,
  {
    readonly open: (graph: string) => Effect.Effect<GraphPlace, GraphUnavailable>
    readonly forget: (graph: string) => Effect.Effect<void>
  }
>()("@seqno/web/worker/GraphPlaces") {}

export const Identity = Schema.Struct({
  device: DeviceId,
  peer: Schema.optionalKey(Schema.String),
})

export class Device extends Context.Service<
  Device,
  { readonly device: DeviceId; readonly formerPeers: ReadonlyArray<string> }
>()("@seqno/web/worker/Device") {}

const vaultFolders = new Set(["updates", "snapshots", "seen", editLogDir])

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const folderError =
  (path: string) =>
  (error: { readonly _tag: string }): FolderError =>
    new FolderError({ path, reason: "reason" in error ? String(error.reason) : error._tag })

export const storageFolder = (storage: Storage["Service"]): GraphFolder["Service"] => {
  const walk = (dir: string): Effect.Effect<ReadonlyArray<string>, FolderError> =>
    Effect.flatMap(Effect.mapError(storage.list(dir), folderError(dir)), (entries) =>
      Effect.map(
        Effect.forEach(entries, (entry) => {
          const path = dir === "" ? entry.name : `${dir}/${entry.name}`
          return Entry.$match(entry, {
            File: () => Effect.succeed([path]),
            Directory: () =>
              dir === "" && vaultFolders.has(entry.name) ? Effect.succeed([]) : walk(path),
          })
        }),
        (nested) => nested.flat(),
      ),
    )
  return GraphFolder.of({
    list: Effect.map(walk(""), (files) => files.toSorted()),
    read: (path) =>
      storage.read(path).pipe(
        Effect.map((bytes) => decoder.decode(bytes)),
        Effect.mapError(folderError(path)),
      ),
    write: (path, text) =>
      Effect.mapError(storage.write(path, encoder.encode(text)), folderError(path)),
    remove: (path) => Effect.mapError(storage.remove(path), folderError(path)),
  })
}

export const layerFolder = (storage: Storage["Service"]) =>
  Layer.succeed(GraphFolder, storageFolder(storage))
