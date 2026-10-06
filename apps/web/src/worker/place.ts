import { Context, Effect, Layer, Schema } from "effect"
import { DeviceId } from "@seqno/domain"
import type { IndexError, Sqlite } from "@seqno/index"
import { FolderError, GraphFolder } from "@seqno/interop"
import { Entry, type Storage } from "@seqno/vault"
import type { GraphUnavailable } from "@seqno/rpc"

export interface StarterFile {
  readonly path: string
  readonly text: string
}

export interface GraphPlace {
  readonly storage: Storage["Service"]
  readonly sqlite: Layer.Layer<Sqlite, IndexError>
  readonly starter: ReadonlyArray<StarterFile>
}

export class GraphPlaces extends Context.Service<
  GraphPlaces,
  { readonly open: (graph: string) => Effect.Effect<GraphPlace, GraphUnavailable> }
>()("@seqno/web/worker/GraphPlaces") {}

export const Identity = Schema.Struct({
  device: DeviceId,
  peer: Schema.TemplateLiteral([Schema.Number]),
})

export class Device extends Context.Service<
  Device,
  { readonly device: DeviceId; readonly peer: `${number}` }
>()("@seqno/web/worker/Device") {}

const vaultFolders = new Set(["updates", "snapshots", "seen"])

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
