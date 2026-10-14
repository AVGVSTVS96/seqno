import { Clock, Crypto, Effect, Layer, Option, Schema } from "effect"
import { DeviceId, type JournalDay } from "@seqno/domain"
import { layerWasmMemory } from "@seqno/index/wasm"
import { StorageFailed, directoryStorage } from "@seqno/vault"
import { demoGraph } from "./demo.ts"
import { developerGraph } from "./developer.ts"
import { journalDayOf } from "./journal.ts"
import type { Layout } from "./layout.ts"
import { GraphLocation, GraphLocations } from "./locations.ts"
import {
  Device,
  GraphPlaces,
  Identity,
  type IndexFile,
  type Starter,
  type StarterFile,
} from "./place.ts"

const starters = new Map<
  string,
  { readonly version: number; readonly files: (today: JournalDay) => ReadonlyArray<StarterFile> }
>([
  ["demo", { version: 1, files: demoGraph }],
  ["developer", { version: 5, files: developerGraph }],
])

interface Found {
  readonly handle: FileSystemDirectoryHandle
  readonly layout: Layout
  readonly synced: boolean
  readonly starter: Starter | null
}

const opfsFolder = (path: ReadonlyArray<string>) =>
  Effect.promise(() =>
    path.reduce(
      async (dir, part) => (await dir).getDirectoryHandle(part, { create: true }),
      navigator.storage.getDirectory(),
    ),
  )

const indexName = (graph: string) => `${encodeURIComponent(graph)}.sqlite`

const indexFile = (
  graph: string,
  listed: Effect.Effect<ReadonlyArray<string>, Error>,
): IndexFile => {
  const name = indexName(graph)
  const attempt = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new StorageFailed({ path: `indexes/${name}`, reason: String(cause) }),
    })
  const handle = (create: boolean) =>
    Effect.flatMap(opfsFolder(["indexes"]), (folder) =>
      attempt(() => folder.getFileHandle(name, { create })),
    )
  return {
    read: handle(false).pipe(
      Effect.flatMap((file) =>
        attempt(async () => new Uint8Array(await (await file.getFile()).arrayBuffer())),
      ),
      Effect.option,
    ),
    write: (image) =>
      Effect.flatMap(
        Effect.orElseSucceed(listed, () => [graph]),
        (names) =>
          names.includes(graph)
            ? Effect.flatMap(handle(true), (file) =>
                attempt(async () => {
                  const writable = await file.createWritable()
                  await writable.write(image).catch(async (cause: unknown) => {
                    await writable.abort()
                    throw cause
                  })
                  await writable.close()
                }),
              )
            : Effect.void,
      ),
  }
}

const namesIn = async (folder: FileSystemDirectoryHandle) => {
  const names: Array<string> = []
  for await (const name of folder.keys()) names.push(name)
  return names
}

const dropOrphans = (listed: Effect.Effect<ReadonlyArray<string>, Error>) =>
  Effect.gen(function* () {
    const folder = yield* opfsFolder(["indexes"])
    const files = yield* Effect.tryPromise(() => namesIn(folder))
    const kept = new Set((yield* listed).map(indexName))
    yield* Effect.forEach(
      files.filter((file) => file.endsWith(".sqlite") && !kept.has(file)),
      (file) => Effect.ignore(Effect.tryPromise(() => folder.removeEntry(file))),
      { discard: true },
    )
  }).pipe(Effect.ignore)

export const BrowserGraphPlaces = Layer.effect(
  GraphPlaces,
  Effect.gen(function* () {
    const locations = yield* GraphLocations
    const orphansDropped = dropOrphans(locations.listed)
    yield* Effect.forkScoped(orphansDropped)
    return GraphPlaces.of({
      open: (graph) =>
        Effect.flatMap(locations.resolve(graph), (location) =>
          Effect.map(
            GraphLocation.match(location, {
              FolderGraph: ({ handle }): Effect.Effect<Found> =>
                Effect.succeed({ handle, layout: "OneTree", synced: true, starter: null }),
              OpfsGraph: ({ name }): Effect.Effect<Found> =>
                Effect.all({
                  handle: opfsFolder(["graphs", name]),
                  layout: Effect.succeed<Layout>("TreePerPage"),
                  synced: Effect.succeed(false),
                  starter: Effect.map(Clock.currentTimeMillis, (now): Starter | null => {
                    const starter = starters.get(name)
                    return starter === undefined
                      ? null
                      : { version: starter.version, files: starter.files(journalDayOf(now)) }
                  }),
                }),
            }),
            ({ handle, layout, synced, starter }) => ({
              storage: directoryStorage(handle),
              layout,
              synced,
              sqlite: layerWasmMemory,
              indexFile: indexFile(graph, locations.listed),
              starter,
            }),
          ),
        ),
      forget: (graph) => Effect.andThen(Effect.ignore(locations.forget(graph)), orphansDropped),
    })
  }),
)

const identityFile = "device.json"
const IdentityJson = Schema.fromJsonString(Identity)

const readIdentity = (root: FileSystemDirectoryHandle) =>
  Effect.promise(async () => {
    const file = await root.getFileHandle(identityFile).catch(() => undefined)
    return file === undefined ? undefined : (await file.getFile()).text()
  }).pipe(
    Effect.map((text) =>
      Option.flatMap(Option.fromUndefinedOr(text), Schema.decodeUnknownOption(IdentityJson)),
    ),
  )

const writeIdentity = (root: FileSystemDirectoryHandle, text: string) =>
  Effect.promise(async () => {
    const writable = await (
      await root.getFileHandle(identityFile, { create: true })
    ).createWritable()
    await writable.write(text)
    await writable.close()
  })

const mintIdentity = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  const bytes = yield* crypto.randomBytes(6)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return Identity.make({ device: DeviceId.make(`web-${hex}`) })
})

const deviceOf = (identity: typeof Identity.Type) =>
  Device.of({
    device: identity.device,
    formerPeers: Option.toArray(Option.fromUndefinedOr(identity.peer)),
  })

export const BrowserDevice = Layer.effect(
  Device,
  Effect.gen(function* () {
    const root = yield* opfsFolder([])
    const stored = yield* readIdentity(root)
    if (Option.isSome(stored)) return deviceOf(stored.value)
    const minted = yield* mintIdentity
    yield* writeIdentity(root, Schema.encodeSync(IdentityJson)(minted))
    return deviceOf(minted)
  }),
)
