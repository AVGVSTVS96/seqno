// oxlint-disable-next-line unicorn/prefer-node-protocol -- this is the npm buffer polyfill for the browser, not Node's module
import { Buffer } from "buffer"
import type { FsClient } from "./repo.ts"

// isomorphic-git reads a global Buffer in the browser: https://github.com/isomorphic-git/isomorphic-git/issues/1753
if (!("Buffer" in globalThis)) {
  Object.assign(globalThis, { Buffer })
}

class FsError extends Error {
  override readonly name = "FsError"
  readonly code: "ENOENT" | "ENOTDIR" | "ENOTEMPTY" | "EISDIR" | "EINVAL" | "EPERM"
  constructor(code: FsError["code"], path: string) {
    super(`${code}: ${path}`)
    this.code = code
  }
}

const nameOf = (cause: unknown) => (cause instanceof DOMException ? cause.name : "")

const translated =
  (path: string) =>
  (cause: unknown): never => {
    switch (nameOf(cause)) {
      case "NotFoundError": {
        throw new FsError("ENOENT", path)
      }

      case "TypeMismatchError": {
        throw new FsError("ENOTDIR", path)
      }

      case "InvalidModificationError": {
        throw new FsError("ENOTEMPTY", path)
      }

      default: {
        throw cause
      }
    }
  }

type ReadOptions = { readonly encoding?: string } | string

const isEncoding = (options: ReadOptions | undefined): options is string =>
  typeof options === "string"

const segments = (path: string) => path.split("/").filter((part) => part.length > 0 && part !== ".")

interface Placed {
  readonly root: FileSystemDirectoryHandle
  readonly dirs: readonly string[]
  readonly name: string | null
}

const fileMode = 0o10_0644
const dirMode = 0o4_0000

const stats = (kind: "file" | "dir", size: number, mtimeMs: number) => ({
  type: kind,
  mode: kind === "file" ? fileMode : dirMode,
  size,
  ino: 0,
  mtimeMs,
  ctimeMs: mtimeMs,
  uid: 1,
  gid: 1,
  dev: 1,
  isFile: () => kind === "file",
  isDirectory: () => kind === "dir",
  isSymbolicLink: () => false,
})

const walk = async (root: FileSystemDirectoryHandle, dirs: readonly string[], path: string) => {
  let dir = root

  for (const part of dirs) {
    dir = await dir.getDirectoryHandle(part).catch(translated(path))
  }

  return dir
}

const fileOrDirectory = async (parent: FileSystemDirectoryHandle, name: string) => {
  try {
    return await parent.getFileHandle(name)
  } catch (error) {
    if (nameOf(error) === "TypeMismatchError") {
      return await parent.getDirectoryHandle(name)
    }

    throw error
  }
}

export const handleFs = (
  work: FileSystemDirectoryHandle,
  gitdir: FileSystemDirectoryHandle,
): FsClient => {
  const place = (path: string): Placed => {
    const parts = segments(path)
    const [first, ...rest] = parts
    const [root, inner] = first === ".git" ? [gitdir, rest] : [work, parts]

    return { root, dirs: inner.slice(0, -1), name: inner.at(-1) ?? null }
  }

  const directory = async (path: string) => {
    const { root, dirs, name } = place(path)
    const parent = await walk(root, dirs, path)

    return name === null ? parent : await parent.getDirectoryHandle(name).catch(translated(path))
  }

  const file = async (path: string) => {
    const { root, dirs, name } = place(path)

    if (name === null) {
      throw new FsError("EISDIR", path)
    }

    const parent = await walk(root, dirs, path)

    return {
      parent,
      name,
      handle: async () => await parent.getFileHandle(name).catch(translated(path)),
    }
  }

  const readFile = async (path: string, options?: ReadOptions) => {
    const found = await (await file(path)).handle()
    const bytes = new Uint8Array(await (await found.getFile()).arrayBuffer())
    const encoding = isEncoding(options) ? options : options?.encoding

    return encoding === undefined ? bytes : new TextDecoder(encoding).decode(bytes)
  }

  const writeFile = async (path: string, data: Uint8Array | string) => {
    const { parent, name } = await file(path)
    const handle = await parent.getFileHandle(name, { create: true }).catch(translated(path))
    const writable = await handle.createWritable()

    try {
      await writable.write(data instanceof Uint8Array ? new Uint8Array(data) : data)
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => null)
      throw error
    }
  }

  const stat = async (path: string) => {
    const { root, dirs, name } = place(path)

    if (name === null) {
      return stats("dir", 0, 0)
    }

    const parent = await walk(root, dirs, path)

    const found = await fileOrDirectory(parent, name).catch(translated(path))

    if (found.kind === "directory") {
      return stats("dir", 0, 0)
    }

    const contents = await found.getFile()

    return stats("file", contents.size, contents.lastModified)
  }

  const remove = async (path: string) => {
    const { parent, name } = await file(path)
    await parent.removeEntry(name).catch(translated(path))
  }

  return {
    promises: {
      readFile,
      writeFile,
      unlink: remove,
      rmdir: remove,
      readdir: async (path: string) => {
        const dir = await directory(path)
        const names: string[] = []

        for await (const name of dir.keys()) {
          if (!name.endsWith(".crswap")) {
            names.push(name)
          }
        }

        return names
      },
      mkdir: async (path: string) => {
        const { parent, name } = await file(path)
        await parent.getDirectoryHandle(name, { create: true }).catch(translated(path))
      },
      stat,
      lstat: stat,
      readlink: async (path: string) => await Promise.reject(new FsError("EINVAL", path)),
      symlink: async (_target: string, path: string) =>
        await Promise.reject(new FsError("EPERM", path)),
    },
  }
}

export const lockIndex = async (gitdir: FileSystemDirectoryHandle) => {
  const taken = await gitdir.getFileHandle("index.lock").then(
    () => true,
    () => false,
  )

  if (taken) {
    return null
  }

  await gitdir.getFileHandle("index.lock", { create: true })

  return async () => {
    await gitdir.removeEntry("index.lock").catch(() => null)
  }
}
