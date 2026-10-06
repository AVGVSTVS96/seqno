import { Context, Effect, Layer, Schema } from "effect"
import { GraphUnavailable } from "@seqno/rpc"

const DirectoryHandle = Schema.declare(
  (input: unknown): input is FileSystemDirectoryHandle =>
    typeof FileSystemDirectoryHandle !== "undefined" && input instanceof FileSystemDirectoryHandle,
)

export const GraphLocation = Schema.TaggedUnion({
  FolderGraph: { name: Schema.NonEmptyString, handle: DirectoryHandle },
  OpfsGraph: { name: Schema.NonEmptyString },
})
export type GraphLocation = typeof GraphLocation.Type

export class GraphLocations extends Context.Service<
  GraphLocations,
  { readonly resolve: (graph: string) => Effect.Effect<GraphLocation, GraphUnavailable> }
>()("@seqno/web/worker/GraphLocations") {}

const request = <A>(make: () => IDBRequest<A>) =>
  Effect.callback<A, Error>((resume) => {
    const pending = make()
    pending.onsuccess = () => resume(Effect.succeed(pending.result))
    pending.onerror = () => resume(Effect.fail(pending.error ?? new Error("IndexedDB request failed")))
  })

const openDatabase = Effect.callback<IDBDatabase, Error>((resume) => {
  const opening = indexedDB.open("seqno", 1)
  opening.onupgradeneeded = () => opening.result.createObjectStore("graphs", { keyPath: "name" })
  opening.onsuccess = () => resume(Effect.succeed(opening.result))
  opening.onerror = () => resume(Effect.fail(opening.error ?? new Error("IndexedDB open failed")))
})

const reachable = (location: GraphLocation) =>
  GraphLocation.match(location, {
    FolderGraph: ({ handle }) =>
      Effect.tryPromise(() => handle.queryPermission({ mode: "readwrite" })).pipe(
        Effect.flatMap((state) =>
          state === "granted"
            ? Effect.succeed(location)
            : Effect.fail(new Error("the folder needs permission again; pick it from the list")),
        ),
      ),
    OpfsGraph: ({ name }) =>
      Effect.tryPromise(async () => {
        const root = await navigator.storage.getDirectory()
        const graphs = await root.getDirectoryHandle("graphs")
        await graphs.getDirectoryHandle(name)
        return location
      }),
  })

export const BrowserGraphLocations = Layer.succeed(GraphLocations, {
  resolve: (graph) =>
    openDatabase.pipe(
      Effect.flatMap((database) =>
        request(() => database.transaction("graphs").objectStore("graphs").get(graph)),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(GraphLocation)),
      Effect.flatMap(reachable),
      Effect.mapError(
        (error) => new GraphUnavailable({ graph, reason: error.message }),
      ),
    ),
})
