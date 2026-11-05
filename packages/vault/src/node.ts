import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { Effect, Layer } from "effect"
import { Entry, FileUnavailable, Storage, StorageFailed } from "./storage.ts"

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT"

const failed = (path: string) => (cause: unknown) =>
  new StorageFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) })

const writeAtomically = async (target: string, bytes: Uint8Array) => {
  await mkdir(dirname(target), { recursive: true })
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)

  try {
    const file = await open(temp, "wx")

    try {
      await file.writeFile(bytes)
      await file.datasync()
    } finally {
      await file.close()
    }

    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

const readEntries = async (path: string) => {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) {
      return []
    }

    throw error
  }
}

export const nodeStorage = (root: string): Storage["Service"] => ({
  list: (dir) =>
    Effect.tryPromise({
      try: async () => {
        const entries = await readEntries(join(root, dir))

        return entries.flatMap((entry): Entry[] => {
          if (entry.isDirectory()) {
            return [Entry.Directory({ name: entry.name })]
          }

          if (entry.isFile()) {
            return [Entry.File({ name: entry.name, placeholder: false })]
          }

          return []
        })
      },
      catch: failed(dir),
    }),
  read: (path) =>
    Effect.tryPromise({
      try: async () => new Uint8Array(await readFile(join(root, path))),
      catch: (cause) =>
        isMissing(cause) ? new FileUnavailable({ path, reason: "missing" }) : failed(path)(cause),
    }),
  write: (path, bytes) =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: async () => {
          await writeAtomically(join(root, path), bytes)
        },
        catch: failed(path),
      }),
    ),
  remove: (path) =>
    Effect.uninterruptible(
      Effect.tryPromise({
        try: async () => {
          await rm(join(root, path), { force: true })
        },
        catch: failed(path),
      }),
    ),
  download: () => Effect.void,
})

export const layerNode = (root: string): Layer.Layer<Storage> =>
  Layer.succeed(Storage, nodeStorage(root))
