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
  {
    readonly resolve: (graph: string) => Effect.Effect<GraphLocation, GraphUnavailable>
    readonly listed: Effect.Effect<ReadonlyArray<string>, Error>
    readonly forget: (graph: string) => Effect.Effect<void, Error>
  }
>()("@seqno/web/worker/GraphLocations") {}

const request = <A>(make: () => IDBRequest<A>) =>
  Effect.callback<A, Error>((resume) => {
    const pending = make()
    pending.addEventListener("success", () => resume(Effect.succeed(pending.result)))
    pending.addEventListener("error", () =>
      resume(Effect.fail(pending.error ?? new Error("IndexedDB request failed"))),
    )
  })

const openDatabase = Effect.callback<IDBDatabase, Error>((resume) => {
  const opening = indexedDB.open("seqno", 1)
  opening.addEventListener("upgradeneeded", () =>
    opening.result.createObjectStore("graphs", { keyPath: "name" }),
  )
  opening.addEventListener("success", () => resume(Effect.succeed(opening.result)))
  opening.addEventListener("error", () =>
    resume(Effect.fail(opening.error ?? new Error("IndexedDB open failed"))),
  )
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

const graphs = (mode: IDBTransactionMode) =>
  Effect.map(openDatabase, (database) => database.transaction("graphs", mode).objectStore("graphs"))

export const BrowserGraphLocations = Layer.succeed(GraphLocations, {
  resolve: (graph) =>
    graphs("readonly").pipe(
      Effect.flatMap((store) => request(() => store.get(graph))),
      Effect.flatMap(Schema.decodeUnknownEffect(GraphLocation)),
      Effect.flatMap(reachable),
      Effect.mapError((error) => new GraphUnavailable({ graph, reason: error.message })),
    ),
  listed: graphs("readonly").pipe(
    Effect.flatMap((store) => request(() => store.getAllKeys())),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))),
  ),
  forget: (graph) =>
    Effect.asVoid(
      Effect.flatMap(graphs("readwrite"), (store) => request(() => store.delete(graph))),
    ),
})
