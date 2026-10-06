import { Effect, Layer, Schema } from "effect"
import { Entry, FileUnavailable, Storage, StorageFailed } from "./storage.ts"

declare global {
  // https://wicg.github.io/file-system-access/#api-filesystemhandle-querypermission is Chrome-only and missing from lib.dom
  interface FileSystemHandle {
    queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>
  }
}

export class PermissionNeeded extends Schema.TaggedError<PermissionNeeded>()("PermissionNeeded", {
  folder: Schema.String,
}) {}

const nameOf = (cause: unknown): string => (cause instanceof DOMException ? cause.name : "")

const failed = (path: string) => (cause: unknown) =>
  new StorageFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) })

const segments = (path: string): ReadonlyArray<string> =>
  path.split("/").filter((part) => part.length > 0)

const split = (path: string): { readonly dirs: ReadonlyArray<string>; readonly name: string } => {
  const parts = segments(path)
  return { dirs: parts.slice(0, -1), name: parts.at(-1) ?? "" }
}

const walk = async (
  root: FileSystemDirectoryHandle,
  dirs: ReadonlyArray<string>,
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  let dir = root
  for (const part of dirs) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

const listDir = async (root: FileSystemDirectoryHandle, path: string) => {
  const dir = await walk(root, segments(path), false).catch((cause: unknown) =>
    nameOf(cause) === "NotFoundError" ? undefined : Promise.reject(cause),
  )
  const entries: Array<Entry> = []
  if (dir === undefined) return entries
  for await (const handle of dir.values()) {
    entries.push(
      handle.kind === "directory"
        ? Entry.Directory({ name: handle.name })
        : Entry.File({ name: handle.name, placeholder: false }),
    )
  }
  return entries
}

const readFile = async (root: FileSystemDirectoryHandle, path: string) => {
  const { dirs, name } = split(path)
  const dir = await walk(root, dirs, false)
  const file = await (await dir.getFileHandle(name)).getFile()
  return new Uint8Array(await file.arrayBuffer())
}

const writeFile = async (root: FileSystemDirectoryHandle, path: string, bytes: Uint8Array) => {
  const { dirs, name } = split(path)
  const dir = await walk(root, dirs, true)
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
  try {
    await writable.write(new Uint8Array(bytes))
    await writable.close()
  } catch (cause) {
    await writable.abort().catch(() => undefined)
    throw cause
  }
}

const removeFile = async (root: FileSystemDirectoryHandle, path: string) => {
  const { dirs, name } = split(path)
  try {
    await (await walk(root, dirs, false)).removeEntry(name)
  } catch (cause) {
    if (nameOf(cause) !== "NotFoundError") throw cause
  }
}

export const directoryStorage = (root: FileSystemDirectoryHandle): Storage["Service"] => ({
  list: (dir) => Effect.tryPromise({ try: () => listDir(root, dir), catch: failed(dir) }),
  read: (path) =>
    Effect.tryPromise({
      try: () => readFile(root, path),
      catch: (cause) =>
        nameOf(cause) === "NotFoundError"
          ? new FileUnavailable({ path, reason: "missing" })
          : nameOf(cause) === "NotReadableError"
            ? new FileUnavailable({ path, reason: "not-downloaded" })
            : failed(path)(cause),
    }),
  write: (path, bytes) =>
    Effect.tryPromise({ try: () => writeFile(root, path, bytes), catch: failed(path) }),
  remove: (path) => Effect.tryPromise({ try: () => removeFile(root, path), catch: failed(path) }),
  download: () => Effect.void,
})

export const layerOpfs = (graph: string): Layer.Layer<Storage, StorageFailed> =>
  Layer.effect(
    Storage,
    Effect.tryPromise({
      try: async () =>
        directoryStorage(
          await (await navigator.storage.getDirectory()).getDirectoryHandle(graph, {
            create: true,
          }),
        ),
      catch: failed(graph),
    }),
  )

export const layerDirectoryHandle = (
  folder: FileSystemDirectoryHandle,
): Layer.Layer<Storage, PermissionNeeded | StorageFailed> =>
  Layer.effect(
    Storage,
    Effect.flatMap(
      Effect.tryPromise({
        try: () => folder.queryPermission({ mode: "readwrite" }),
        catch: failed(folder.name),
      }),
      (state) =>
        state === "granted"
          ? Effect.succeed(directoryStorage(folder))
          : Effect.fail(new PermissionNeeded({ folder: folder.name })),
    ),
  )
