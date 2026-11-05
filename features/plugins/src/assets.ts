import type { Asset } from "@seqno/rpc"
import { assetKind, assetPathOf } from "@seqno/syntax"
import { Match } from "effect"
import { scalarText, text, texts } from "./package.ts"
import type { Handlers } from "./protocol.ts"
import {
  clearStorage,
  hasStorage,
  readStorage,
  removeStorage,
  storageKeys,
  writeStorage,
} from "./storage.ts"

export interface AssetBridge {
  readonly listed: () => readonly Asset[]
  readonly write: (path: string, data: Uint8Array) => Promise<Asset>
  readonly remove: (path: string) => Promise<void>
  readonly openPdf: (path: string) => void
}

const storageRoot = (pid: string) => `assets/storages/${pid.split("/").at(-1) ?? pid}`

const joined = (root: string, key: string): string | null => {
  const parts: string[] = []

  for (const part of key.split("/")) {
    if (part === "" || part === ".") {
      continue
    }

    if (part === "..") {
      if (parts.pop() === undefined) {
        return null
      }
    } else {
      parts.push(part)
    }
  }

  return parts.length === 0 ? null : `${root}/${parts.join("/")}`
}

const extensionsOf = (given: readonly string[]): ReadonlySet<string> | null =>
  given.length === 0
    ? null
    : new Set(
        given.map((ext) => (ext === "" || ext.startsWith(".") ? ext : `.${ext}`).toLowerCase()),
      )

const extensionOf = (path: string) => {
  const name = path.split("/").at(-1) ?? ""
  const dot = name.lastIndexOf(".")

  return dot <= 0 ? "" : name.slice(dot).toLowerCase()
}

const encoder = new TextEncoder()

const bytesOf = (view: ArrayBufferView): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))

  return copy
}

const contentOf = Match.type<unknown>().pipe(
  Match.when(Match.instanceOf(ArrayBuffer), (buffer) => new Uint8Array(buffer)),
  Match.when((value: unknown): value is ArrayBufferView => ArrayBuffer.isView(value), bytesOf),
  Match.when(Match.string, (content) => content),
  Match.orElse((value) => JSON.stringify(value)),
)

const storagePath = (pid: string, key: string, denied: string) => {
  const path = joined(storageRoot(pid), key)

  if (path === null) {
    throw new Error(denied)
  }

  return path
}

export const assetsApi = (assets: AssetBridge, graphName: () => string | null) => {
  const absolute = (path: string) => `${graphName() ?? ""}/${path}`

  const inGraph = (path: string) => {
    const graph = graphName()
    const local = graph !== null && path.startsWith(`${graph}/`) ? path.slice(graph.length) : path

    return assetPathOf(local)
  }

  const found = (path: string) => assets.listed().find((asset) => asset.path === path)

  const read = async (path: string) => {
    const asset = found(path)

    if (asset === undefined) {
      throw new Error("file not existed")
    }

    return await (await fetch(asset.url)).text()
  }

  const table: Handlers = {
    list_files_of_current_graph: (_, [exts]) => {
      const wanted = extensionsOf(texts(exts))

      return assets
        .listed()
        .filter((asset) => wanted === null || wanted.has(extensionOf(asset.path)))
        .map((asset) => ({
          path: absolute(asset.path),
          size: asset.size,
          accessTime: asset.modified,
          modifiedTime: asset.modified,
          changeTime: asset.modified,
          birthTime: asset.modified,
        }))
    },
    make_url: (_, [path]) => {
      const given = text(path)

      if (given === null) {
        return null
      }

      if (/^(?:https?|data|blob):/iu.test(given)) {
        return given
      }

      const local = inGraph(given)

      return local === null ? null : (found(local)?.url ?? null)
    },
    built_in_open: (_, [path]) => {
      const given = text(path)

      if (given === null || extensionOf(given) === "") {
        return null
      }

      if (assetKind(given) !== "Pdf") {
        return false
      }

      assets.openPdf(given)

      return null
    },
    write_plugin_storage_file: async (pid, [owner, key, value, assetsFlag]) => {
      const content = contentOf(value)

      if (assetsFlag !== true) {
        return await writeStorage(text(owner) ?? pid, text(key) ?? "", content)
      }

      const path = storagePath(text(owner) ?? pid, scalarText(key) ?? "", "write file denied")
      await assets.write(path, content instanceof Uint8Array ? content : encoder.encode(content))

      return absolute(path)
    },
    read_plugin_storage_file: async (pid, [owner, key, assetsFlag]) => {
      if (assetsFlag !== true) {
        return await readStorage(text(owner) ?? pid, text(key) ?? "")
      }

      return await read(storagePath(text(owner) ?? pid, scalarText(key) ?? "", "read file denied"))
    },
    unlink_plugin_storage_file: async (pid, [owner, key, assetsFlag]) => {
      if (assetsFlag !== true) {
        return await removeStorage(text(owner) ?? pid, text(key) ?? "")
      }

      const path = storagePath(text(owner) ?? pid, scalarText(key) ?? "", "access file denied")

      if (found(path) === undefined) {
        throw new Error("file not existed")
      }

      await assets.remove(path)

      return null
    },
    exist_plugin_storage_file: async (pid, [owner, key, assetsFlag]) => {
      if (assetsFlag !== true) {
        return await hasStorage(text(owner) ?? pid, text(key) ?? "")
      }

      const path = joined(storageRoot(text(owner) ?? pid), text(key) ?? "")

      return path !== null && found(path) !== undefined
    },
    list_plugin_storage_files: async (pid, [owner, assetsFlag]) => {
      if (assetsFlag !== true) {
        return await storageKeys(text(owner) ?? pid)
      }

      const root = `${storageRoot(text(owner) ?? pid)}/`

      return assets
        .listed()
        .flatMap((asset) => (asset.path.startsWith(root) ? [asset.path.slice(root.length)] : []))
    },
    clear_plugin_storage_files: async (pid, [owner, assetsFlag]) => {
      if (assetsFlag !== true) {
        return await clearStorage(text(owner) ?? pid)
      }

      const root = `${storageRoot(text(owner) ?? pid)}/`
      await Promise.all(
        assets
          .listed()
          .filter((asset) => asset.path.startsWith(root))
          .map(async (asset) => {
            await assets.remove(asset.path)
          }),
      )

      return null
    },
  }

  return table
}
