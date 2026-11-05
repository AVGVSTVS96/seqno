import { Effect, Layer, Queue, Schema, Stream } from "effect"
import { Entry, FileUnavailable, Storage, StorageFailed } from "./storage.ts"

declare global {
  // https://wicg.github.io/file-system-access/#api-filesystemhandle-querypermission is Chrome-only and missing from lib.dom
  interface FileSystemHandle {
    queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>
  }

  // https://github.com/whatwg/fs/pull/165 adds FileSystemObserver, which lib.dom doesn't have yet
  interface FileSystemChangeRecord {
    readonly type: "appeared" | "disappeared" | "errored" | "modified" | "moved" | "unknown"
    readonly relativePathComponents: readonly string[]
  }

  interface FileSystemObserver {
    observe(handle: FileSystemHandle, options?: { readonly recursive?: boolean }): Promise<void>
    disconnect(): void
  }

  interface Window {
    readonly FileSystemObserver?: new (
      callback: (records: readonly FileSystemChangeRecord[]) => void,
    ) => FileSystemObserver
  }
}

export class PermissionNeeded extends Schema.TaggedError<PermissionNeeded>()("PermissionNeeded", {
  folder: Schema.String,
}) {}

const nameOf = (cause: unknown): string => (cause instanceof DOMException ? cause.name : "")

const failed = (path: string) => (cause: unknown) =>
  new StorageFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) })

const segments = (path: string): readonly string[] =>
  path.split("/").filter((part) => part.length > 0)

const split = (path: string): { readonly dirs: readonly string[]; readonly name: string } => {
  const parts = segments(path)

  return { dirs: parts.slice(0, -1), name: parts.at(-1) ?? "" }
}

const walk = async (
  root: FileSystemDirectoryHandle,
  dirs: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> => {
  let dir = root

  for (const part of dirs) {
    dir = await dir.getDirectoryHandle(part, { create })
  }

  return dir
}

const listDir = async (root: FileSystemDirectoryHandle, path: string) => {
  const dir = await walk(root, segments(path), false).catch((error: unknown) =>
    nameOf(error) === "NotFoundError" ? undefined : Promise.reject(error),
  )

  const entries: Entry[] = []

  if (dir === undefined) {
    return entries
  }

  for await (const handle of dir.values()) {
    entries.push(
      handle.kind === "directory"
        ? Entry.Directory({ name: handle.name })
        : Entry.File({ name: handle.name, placeholder: false }),
    )
  }

  return entries
}

const openFile = async (root: FileSystemDirectoryHandle, path: string) => {
  const { dirs, name } = split(path)
  const dir = await walk(root, dirs, false)

  return await (await dir.getFileHandle(name)).getFile()
}

const readFile = async (root: FileSystemDirectoryHandle, path: string) =>
  new Uint8Array(await (await openFile(root, path)).arrayBuffer())

const unavailable = (path: string) => (cause: unknown) =>
  nameOf(cause) === "NotFoundError"
    ? new FileUnavailable({ path, reason: "missing" })
    : nameOf(cause) === "NotReadableError"
      ? new FileUnavailable({ path, reason: "not-downloaded" })
      : failed(path)(cause)

const writeFile = async (root: FileSystemDirectoryHandle, path: string, bytes: Uint8Array) => {
  const { dirs, name } = split(path)
  const dir = await walk(root, dirs, true)
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()

  try {
    await writable.write(new Uint8Array(bytes))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

const removeFile = async (root: FileSystemDirectoryHandle, path: string) => {
  const { dirs, name } = split(path)

  try {
    await (await walk(root, dirs, false)).removeEntry(name)
  } catch (error) {
    if (nameOf(error) !== "NotFoundError") {
      throw error
    }
  }
}

export const directoryStorage = (root: FileSystemDirectoryHandle): Storage["Service"] => ({
  list: (dir) =>
    Effect.tryPromise({ try: async () => await listDir(root, dir), catch: failed(dir) }),
  read: (path) =>
    Effect.tryPromise({ try: async () => await readFile(root, path), catch: unavailable(path) }),
  write: (path, bytes) =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: async () => {
          await writeFile(root, path, bytes)
        },
        catch: failed(path),
      }),
    ),
  remove: (path) =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: async () => {
          await removeFile(root, path)
        },
        catch: failed(path),
      }),
    ),
  download: () => Effect.void,
})

export const directoryFile =
  (root: FileSystemDirectoryHandle) =>
  (path: string): Effect.Effect<File, StorageFailed | FileUnavailable> =>
    Effect.tryPromise({ try: async () => await openFile(root, path), catch: unavailable(path) })

export const directoryChanges = (
  root: FileSystemDirectoryHandle,
): Stream.Stream<readonly string[]> => {
  const Observer = self.FileSystemObserver

  return Observer === undefined
    ? Stream.empty
    : Stream.callback<readonly string[]>((queue) =>
        Effect.acquireRelease(
          Effect.promise(async () => {
            const observer = new Observer((records) =>
              Queue.offerUnsafe(
                queue,
                records.map((record) =>
                  record.type === "unknown" || record.type === "errored"
                    ? ""
                    : record.relativePathComponents.join("/"),
                ),
              ),
            )

            await observer.observe(root, { recursive: true }).catch(() => undefined)

            return observer
          }),
          (observer) =>
            Effect.sync(() => {
              observer.disconnect()
            }),
        ),
      )
}

export const layerOpfs = (graph: string): Layer.Layer<Storage, StorageFailed> =>
  Layer.effect(
    Storage,
    Effect.tryPromise({
      try: async () =>
        directoryStorage(
          await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle(graph, {
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
        try: async () => await folder.queryPermission({ mode: "readwrite" }),
        catch: failed(folder.name),
      }),
      (state) =>
        state === "granted"
          ? Effect.succeed(directoryStorage(folder))
          : Effect.fail(new PermissionNeeded({ folder: folder.name })),
    ),
  )
