import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"

export class FolderError extends Schema.TaggedError<FolderError>()("FolderError", {
  path: Schema.String,
  reason: Schema.String,
}) {}

export class GraphFolder extends Context.Service<
  GraphFolder,
  {
    readonly list: Effect.Effect<ReadonlyArray<string>, FolderError>
    readonly read: (path: string) => Effect.Effect<string, FolderError>
    readonly write: (path: string, text: string) => Effect.Effect<void, FolderError>
    readonly remove: (path: string) => Effect.Effect<void, FolderError>
  }
>()("@seqno/interop/GraphFolder") {}

const failed =
  (path: string) =>
  (error: { readonly message: string }): FolderError =>
    new FolderError({ path, reason: error.message })

export const layerFileSystem = (root: string) =>
  Layer.effect(
    GraphFolder,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const at = (relative: string) => path.join(root, ...relative.split("/"))
      const isFile = (relative: string) =>
        Effect.map(fs.stat(at(relative)), (info) => info.type === "File")
      return GraphFolder.of({
        list: fs.readDirectory(root, { recursive: true }).pipe(
          Effect.map((entries) => entries.map((entry) => entry.split(path.sep).join("/"))),
          Effect.flatMap((entries) => Effect.filter(entries, isFile, { concurrency: 16 })),
          Effect.map((files) => files.toSorted()),
          Effect.mapError(failed("")),
        ),
        read: (relative) => Effect.mapError(fs.readFileString(at(relative)), failed(relative)),
        write: (relative, text) => {
          const target = at(relative)
          const staging = `${target}.seqno-tmp`
          return fs
            .makeDirectory(path.dirname(target), { recursive: true })
            .pipe(
              Effect.andThen(fs.writeFileString(staging, text)),
              Effect.andThen(fs.rename(staging, target)),
              Effect.mapError(failed(relative)),
            )
        },
        remove: (relative) => Effect.mapError(fs.remove(at(relative)), failed(relative)),
      })
    }),
  )
