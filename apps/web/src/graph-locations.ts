import { Context, Effect, Layer, Schema } from "effect"

const DirectoryHandle = Schema.declare(
  (input: unknown): input is FileSystemDirectoryHandle =>
    typeof FileSystemDirectoryHandle !== "undefined" && input instanceof FileSystemDirectoryHandle,
)

export const GraphLocation = Schema.TaggedUnion({
  FolderGraph: { name: Schema.NonEmptyString, handle: DirectoryHandle },
  OpfsGraph: { name: Schema.NonEmptyString },
})
export type GraphLocation = typeof GraphLocation.Type

export const DemoGraph = Schema.Literals(["demo", "developer"])
export type DemoGraph = typeof DemoGraph.Type

export const demoGraph: DemoGraph = "demo"

export const demoGraphs: ReadonlyArray<DemoGraph> = DemoGraph.literals

const demoTitles: Record<DemoGraph, string> = {
  demo: "Getting started",
  developer: "Developer graph",
}

export const demoDescriptions: Record<DemoGraph, string> = {
  demo: "A short tour of how seqno works.",
  developer: "A developer's real notes, distilled from Bassim's prompt history.",
}

export const isDemoGraph = Schema.is(DemoGraph)

export const graphTitle = (name: string) => (isDemoGraph(name) ? demoTitles[name] : name)

export class GraphNotPicked extends Schema.TaggedError<GraphNotPicked>()("GraphNotPicked", {
  reason: Schema.String,
}) {}

export class GraphLocations extends Context.Service<
  GraphLocations,
  {
    readonly recent: Effect.Effect<ReadonlyArray<GraphLocation>>
    readonly pickFolder: Effect.Effect<GraphLocation, GraphNotPicked>
    readonly demo: (name: DemoGraph) => Effect.Effect<GraphLocation, GraphNotPicked>
    readonly reopen: (name: string) => Effect.Effect<GraphLocation, GraphNotPicked>
    readonly resume: (name: string) => Effect.Effect<GraphLocation, GraphNotPicked>
    readonly forget: (name: string) => Effect.Effect<void>
    readonly assets: (name: string) => Effect.Effect<ReadonlyMap<string, string>>
  }
>()("@seqno/web/GraphLocations") {}

const notPicked = (cause: unknown) =>
  new GraphNotPicked({ reason: cause instanceof Error ? cause.message : String(cause) })

const request = <A>(make: () => IDBRequest<A>) =>
  Effect.callback<A, GraphNotPicked>((resume) => {
    const pending = make()
    pending.addEventListener("success", () => resume(Effect.succeed(pending.result)))
    pending.addEventListener("error", () => resume(Effect.fail(notPicked(pending.error))))
  })

const openDatabase = Effect.callback<IDBDatabase, GraphNotPicked>((resume) => {
  const opening = indexedDB.open("seqno", 1)
  opening.addEventListener("upgradeneeded", () =>
    opening.result.createObjectStore("graphs", { keyPath: "name" }),
  )
  opening.addEventListener("success", () => resume(Effect.succeed(opening.result)))
  opening.addEventListener("error", () => resume(Effect.fail(notPicked(opening.error))))
})

const graphs = (mode: IDBTransactionMode) =>
  Effect.map(openDatabase, (database) => database.transaction("graphs", mode).objectStore("graphs"))

const save = (location: GraphLocation) =>
  Effect.as(
    Effect.flatMap(graphs("readwrite"), (store) => request(() => store.put(location))),
    location,
  )

const decodeLocation = Schema.decodeUnknownEffect(GraphLocation)

const permitted = (
  location: GraphLocation,
  ask: (handle: FileSystemDirectoryHandle) => Promise<PermissionState>,
) =>
  GraphLocation.match(location, {
    FolderGraph: ({ handle }) =>
      Effect.tryPromise({
        try: () => ask(handle),
        catch: notPicked,
      }).pipe(
        Effect.flatMap((state) =>
          state === "granted"
            ? Effect.succeed(location)
            : Effect.fail(
                new GraphNotPicked({ reason: "seqno needs permission to edit the folder" }),
              ),
        ),
      ),
    OpfsGraph: () => Effect.succeed(location),
  })

const folderOf = (location: GraphLocation) =>
  GraphLocation.match(location, {
    FolderGraph: ({ handle }) => Promise.resolve(handle),
    OpfsGraph: async ({ name }) => {
      const root = await navigator.storage.getDirectory()
      const folder = await root.getDirectoryHandle("graphs")
      return folder.getDirectoryHandle(name)
    },
  })

type Asset = readonly [path: string, url: string]

const filesUnder = async (
  folder: FileSystemDirectoryHandle,
  prefix: string,
): Promise<ReadonlyArray<Asset>> => {
  const found: Array<Promise<ReadonlyArray<Asset>>> = []
  for await (const [name, entry] of folder.entries()) {
    if (entry instanceof FileSystemFileHandle) {
      found.push(entry.getFile().then((file) => [[`${prefix}${name}`, URL.createObjectURL(file)]]))
    } else if (entry instanceof FileSystemDirectoryHandle) {
      found.push(filesUnder(entry, `${prefix}${name}/`))
    }
  }
  return (await Promise.all(found)).flat()
}

const stored = (name: string) =>
  Effect.flatMap(graphs("readonly"), (store) => request(() => store.get(name))).pipe(
    Effect.flatMap((found) => Effect.mapError(decodeLocation(found), notPicked)),
  )

export const BrowserGraphLocations = Layer.succeed(GraphLocations, {
  recent: Effect.flatMap(graphs("readonly"), (store) => request(() => store.getAll())).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(GraphLocation))),
    Effect.orElseSucceed(() => []),
  ),
  pickFolder: Effect.tryPromise({
    try: () => window.showDirectoryPicker({ id: "seqno-graph", mode: "readwrite" }),
    catch: notPicked,
  }).pipe(Effect.flatMap((handle) => save({ _tag: "FolderGraph", name: handle.name, handle }))),
  demo: (name) =>
    Effect.tryPromise({
      try: async () => {
        const root = await navigator.storage.getDirectory()
        const folder = await root.getDirectoryHandle("graphs", { create: true })
        await folder.getDirectoryHandle(name, { create: true })
      },
      catch: notPicked,
    }).pipe(Effect.flatMap(() => save({ _tag: "OpfsGraph", name }))),
  reopen: (name) =>
    Effect.flatMap(stored(name), (location) =>
      permitted(location, (handle) => handle.requestPermission({ mode: "readwrite" })),
    ),
  resume: (name) =>
    Effect.flatMap(stored(name), (location) =>
      permitted(location, (handle) => handle.queryPermission({ mode: "readwrite" })),
    ),
  forget: (name) =>
    Effect.flatMap(graphs("readwrite"), (store) => request(() => store.delete(name))).pipe(
      Effect.ignore,
    ),
  assets: (name) =>
    stored(name).pipe(
      Effect.flatMap((location) =>
        Effect.tryPromise({
          try: async () => {
            const assets = await (await folderOf(location)).getDirectoryHandle("assets")
            return new Map(await filesUnder(assets, "assets/"))
          },
          catch: notPicked,
        }),
      ),
      Effect.orElseSucceed(() => new Map<string, string>()),
    ),
})
