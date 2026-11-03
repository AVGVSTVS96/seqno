const root = "plugin-storages"

const partsOf = (key: string, action: string) => {
  const parts: Array<string> = []
  for (const part of key.split(/[/\\]+/)) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.pop() === undefined) throw new Error(`${action} file denied`)
    } else parts.push(part)
  }
  if (parts.length === 0) throw new Error(`${action} file denied`)
  return parts
}

const storeOf = async (pid: string, create: boolean) => {
  const top = await navigator.storage.getDirectory()
  const all = await top.getDirectoryHandle(root, { create: true })
  return all.getDirectoryHandle(pid.split("/").at(-1) ?? pid, { create }).catch(() => null)
}

const fileOf = async (pid: string, key: string, action: string, create: boolean) => {
  const parts = partsOf(key, action)
  const name = parts.pop() ?? ""
  let dir = await storeOf(pid, create)
  for (const part of parts) {
    dir = dir === null ? null : await dir.getDirectoryHandle(part, { create }).catch(() => null)
  }
  return dir === null ? null : dir.getFileHandle(name, { create }).catch(() => null)
}

const bytesOf = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength)
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return copy
  }
  return null
}

const keysIn = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<Array<string>> => {
  const keys: Array<string> = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") keys.push(`${prefix}${name}`)
    else keys.push(...(await keysIn(await dir.getDirectoryHandle(name), `${prefix}${name}/`)))
  }
  return keys.toSorted()
}

export const writeStorage = async (pid: string, key: string, value: unknown) => {
  const file = await fileOf(pid, key, "write", true)
  if (file === null) throw new Error("write file denied")
  const writable = await file.createWritable()
  await writable.write(bytesOf(value) ?? String(value))
  await writable.close()
  return `${root}/${pid.split("/").at(-1) ?? pid}/${partsOf(key, "write").join("/")}`
}

export const readStorage = async (pid: string, key: string) => {
  const file = await fileOf(pid, key, "read", false)
  if (file === null) throw new Error("file not existed")
  return (await file.getFile()).text()
}

export const hasStorage = async (pid: string, key: string) =>
  (await fileOf(pid, key, "access", false)) !== null

export const removeStorage = async (pid: string, key: string) => {
  const parts = partsOf(key, "access")
  const name = parts.pop() ?? ""
  if (!(await hasStorage(pid, key))) throw new Error("file not existed")
  let dir = await storeOf(pid, false)
  for (const part of parts) dir = dir === null ? null : await dir.getDirectoryHandle(part)
  await dir?.removeEntry(name)
  return null
}

export const clearStorage = async (pid: string) => {
  const dir = await storeOf(pid, false)
  if (dir === null) return null
  for await (const name of dir.keys()) await dir.removeEntry(name, { recursive: true })
  return null
}

export const storageKeys = async (pid: string) => {
  const dir = await storeOf(pid, false)
  return dir === null ? [] : keysIn(dir, "")
}
