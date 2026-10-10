import { Clock, Crypto, Effect, Layer, Option, Schema } from "effect"
import { DeviceId, type JournalDay } from "@seqno/domain"
import { layerWasmMemory } from "@seqno/index/wasm"
import { directoryStorage } from "@seqno/vault"
import { demoGraph } from "./demo.ts"
import { developerGraph } from "./developer.ts"
import { journalDayOf } from "./journal.ts"
import { GraphLocation, GraphLocations } from "./locations.ts"
import { Device, GraphPlaces, Identity, type StarterFile } from "./place.ts"

const starters = new Map<string, (today: JournalDay) => ReadonlyArray<StarterFile>>([
  ["demo", demoGraph],
  ["developer", developerGraph],
])

const opfsFolder = (path: ReadonlyArray<string>) =>
  Effect.promise(() =>
    path.reduce(
      async (dir, part) => (await dir).getDirectoryHandle(part, { create: true }),
      navigator.storage.getDirectory(),
    ),
  )

export const BrowserGraphPlaces = Layer.effect(
  GraphPlaces,
  Effect.map(Effect.service(GraphLocations), (locations) =>
    GraphPlaces.of({
      open: (graph) =>
        Effect.flatMap(locations.resolve(graph), (location) =>
          Effect.map(
            GraphLocation.match(location, {
              FolderGraph: ({ handle }) => Effect.succeed({ handle, starter: [] }),
              OpfsGraph: ({ name }) =>
                Effect.all({
                  handle: opfsFolder(["graphs", name]),
                  starter: Effect.map(
                    Clock.currentTimeMillis,
                    (now) => starters.get(name)?.(journalDayOf(now)) ?? [],
                  ),
                }),
            }),
            ({ handle, starter }) => ({
              storage: directoryStorage(handle),
              sqlite: layerWasmMemory,
              starter,
            }),
          ),
        ),
    }),
  ),
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
  const bytes = yield* crypto.randomBytes(12)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  const peer: `${number}` = `${Number.parseInt(hex.slice(0, 13), 16) + 1}`
  return Identity.make({ device: DeviceId.make(`web-${hex.slice(13)}`), peer })
})

export const BrowserDevice = Layer.effect(
  Device,
  Effect.gen(function* () {
    const root = yield* opfsFolder([])
    const stored = yield* readIdentity(root)
    if (Option.isSome(stored)) return Device.of(stored.value)
    const minted = yield* mintIdentity
    yield* writeIdentity(root, Schema.encodeSync(IdentityJson)(minted))
    return Device.of(minted)
  }),
)
