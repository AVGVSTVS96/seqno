import { Data, Effect } from "effect"
import type { DeviceId } from "@seqno/domain"
import { Graph, compareConverted, convertOneTree, graphV2Layer, journalsByDay } from "@seqno/graph"
import type { PageTree } from "@seqno/rpc"
import {
  Entry,
  editLogDir,
  snapshotName,
  snapshotPath,
  treePerPageMarker,
  type Storage,
  type StorageFailed,
} from "@seqno/vault"

export type Layout = "OneTree" | "TreePerPage"

const oneTreeDirs = ["snapshots", "updates", "seen"]

export class LayoutUnreadable extends Data.TaggedError("LayoutUnreadable")<{
  readonly reason: string
}> {}

export const within = (storage: Storage["Service"], dir: string): Storage["Service"] => {
  const at = (path: string) => (path === "" ? dir : `${dir}/${path}`)
  return {
    list: (path) => storage.list(at(path)),
    read: (path) => storage.read(at(path)),
    write: (path, bytes) => storage.write(at(path), bytes),
    remove: (path) => storage.remove(at(path)),
    download: (path) => storage.download(at(path)),
  }
}

export const filesUnder = (
  storage: Storage["Service"],
  dir: string,
): Effect.Effect<ReadonlyArray<string>, StorageFailed> =>
  Effect.flatMap(storage.list(dir), (entries) =>
    Effect.map(
      Effect.forEach(entries, (entry) => {
        const path = dir === "" ? entry.name : `${dir}/${entry.name}`
        return Entry.$match(entry, {
          File: () => Effect.succeed([path]),
          Directory: () => filesUnder(storage, path),
        })
      }),
      (nested) => nested.flat(),
    ),
  )

export const removeFiles = (storage: Storage["Service"], dir: string) =>
  Effect.flatMap(filesUnder(storage, dir), (paths) =>
    Effect.forEach(paths, storage.remove, { discard: true }),
  )

const oneTreeFiles = (storage: Storage["Service"]) =>
  Effect.map(
    Effect.forEach(oneTreeDirs, (dir) => filesUnder(storage, dir)),
    (found) => found.flat(),
  )

export const hasEditLog = (storage: Storage["Service"]) =>
  Effect.map(
    Effect.all([oneTreeFiles(storage), filesUnder(storage, editLogDir)]),
    ([oneTree, treePerPage]) => oneTree.length + treePerPage.length > 0,
  )

const isMarked = (storage: Storage["Service"]) =>
  storage.read(treePerPageMarker.path).pipe(
    Effect.as(true),
    Effect.catchTag("FileUnavailable", () => Effect.succeed(false)),
  )

const convert = (storage: Storage["Service"], device: DeviceId) =>
  Effect.gen(function* () {
    const log = within(storage, editLogDir)
    yield* removeFiles(log, "")
    const paths = (yield* oneTreeFiles(storage)).filter((path) => path.endsWith(".loro"))
    if (paths.length > 0) {
      const files = yield* Effect.forEach(paths, storage.read)
      const converted = yield* convertOneTree(files)
      const name = yield* Effect.promise(() => snapshotName(device, converted.snapshot))
      yield* log.write(snapshotPath(name), converted.snapshot)
      const compared = yield* compareConverted(files, [yield* log.read(snapshotPath(name))])
      if (compared.different.length > 0) {
        yield* removeFiles(log, "")
        return yield* new LayoutUnreadable({
          reason: `converting it to the new format changed ${compared.different.length} of its ${compared.pages} pages (${compared.different.slice(0, 3).join(", ")}), so it stays as it was`,
        })
      }
    }
    yield* storage.write(treePerPageMarker.path, new TextEncoder().encode(treePerPageMarker.text))
  })

export interface EditLog {
  readonly storage: Storage["Service"]
  readonly graph: typeof Graph.layer
  readonly incoming: (pages: ReadonlyArray<PageTree>) => ReadonlyArray<PageTree>
}

const oneTree = (storage: Storage["Service"]): EditLog => ({
  storage,
  graph: Graph.layer,
  incoming: (pages) => pages,
})

const treePerPage = (storage: Storage["Service"]): EditLog => ({
  storage: within(storage, editLogDir),
  graph: graphV2Layer,
  incoming: journalsByDay,
})

export const openEditLog = (storage: Storage["Service"], layout: Layout, device: DeviceId) =>
  Effect.gen(function* () {
    const marked = yield* isMarked(storage)
    if (layout === "OneTree") {
      if (marked) {
        return yield* new LayoutUnreadable({
          reason: "a newer version of seqno changed how this graph is saved; reload to update",
        })
      }
      return oneTree(storage)
    }
    if (!marked) yield* convert(storage, device)
    yield* Effect.forEach(oneTreeDirs, (dir) => removeFiles(storage, dir), { discard: true })
    return treePerPage(storage)
  })
