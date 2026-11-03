import { Buffer } from "buffer"
import type { FsClient } from "./repo.ts"

// isomorphic-git reads a global Buffer in the browser: https://github.com/isomorphic-git/isomorphic-git/issues/1753
Object.assign(globalThis, { Buffer: Reflect.get(globalThis, "Buffer") ?? Buffer })

class FsError extends Error {
  readonly code: "ENOENT" | "ENOTDIR" | "ENOTEMPTY" | "EISDIR" | "EINVAL" | "EPERM"
  constructor(code: FsError["code"], path: string) {
    super(`${code}: ${path}`)
    this.code = code
  }
}

const nameOf = (cause: unknown) => (cause instanceof DOMException ? cause.name : "")

const translated = (path: string) => (cause: unknown) => {
  switch (nameOf(cause)) {
    case "NotFoundError":
      return Promise.reject(new FsError("ENOENT", path))
    case "TypeMismatchError":
      return Promise.reject(new FsError("ENOTDIR", path))
    case "InvalidModificationError":
      return Promise.reject(new FsError("ENOTEMPTY", path))
    default:
      return Promise.reject(cause)
  }
}

const segments = (path: string) => path.split("/").filter((part) => part.length > 0 && part !== ".")

interface Placed {
  readonly root: FileSystemDirectoryHandle
  readonly dirs: ReadonlyArray<string>
  readonly name: string | null
}

const fileMode = 0o100644
const dirMode = 0o40000

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

const walk = async (root: FileSystemDirectoryHandle, dirs: ReadonlyArray<string>, path: string) => {
  let dir = root
  for (const part of dirs) dir = await dir.getDirectoryHandle(part).catch(translated(path))
  return dir
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
    return name === null ? parent : parent.getDirectoryHandle(name).catch(translated(path))
  }

  const file = async (path: string) => {
    const { root, dirs, name } = place(path)
    if (name === null) throw new FsError("EISDIR", path)
    const parent = await walk(root, dirs, path)
    return { parent, name, handle: () => parent.getFileHandle(name).catch(translated(path)) }
  }

  const readFile = async (path: string, options?: { readonly encoding?: string } | string) => {
    const found = await (await file(path)).handle()
    const bytes = new Uint8Array(await (await found.getFile()).arrayBuffer())
    const encoding = typeof options === "string" ? options : options?.encoding
    return encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes
  }

  const writeFile = async (path: string, data: Uint8Array | string) => {
    const { parent, name } = await file(path)
    const handle = await parent.getFileHandle(name, { create: true }).catch(translated(path))
    const writable = await handle.createWritable()
    try {
      await writable.write(typeof data === "string" ? data : new Uint8Array(data))
      await writable.close()
    } catch (cause) {
      await writable.abort().catch(() => undefined)
      throw cause
    }
  }

  const stat = async (path: string) => {
    const { root, dirs, name } = place(path)
    if (name === null) return stats("dir", 0, 0)
    const parent = await walk(root, dirs, path)
    const found = await parent
      .getFileHandle(name)
      .catch(async (cause: unknown) =>
        nameOf(cause) === "TypeMismatchError"
          ? parent.getDirectoryHandle(name).catch(translated(path))
          : translated(path)(cause),
      )
    if (found.kind === "directory") return stats("dir", 0, 0)
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
        const names: Array<string> = []
        for await (const name of dir.keys()) {
          if (!name.endsWith(".crswap")) names.push(name)
        }
        return names
      },
      mkdir: async (path: string) => {
        const { parent, name } = await file(path)
        await parent.getDirectoryHandle(name, { create: true }).catch(translated(path))
      },
      stat,
      lstat: stat,
      readlink: async (path: string) => Promise.reject(new FsError("EINVAL", path)),
      symlink: async (_target: string, path: string) => Promise.reject(new FsError("EPERM", path)),
    },
  }
}

export const lockIndex = async (gitdir: FileSystemDirectoryHandle) => {
  const taken = await gitdir.getFileHandle("index.lock").then(
    () => true,
    () => false,
  )
  if (taken) return null
  await gitdir.getFileHandle("index.lock", { create: true })
  return () => gitdir.removeEntry("index.lock").catch(() => undefined)
}
