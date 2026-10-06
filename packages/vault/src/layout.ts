import { Option, Schema } from "effect"
import { DeviceId } from "@seqno/domain"

export const updatesDir = "updates"
export const snapshotsDir = "snapshots"
export const seenDir = "seen"

export const updatePath = (device: DeviceId, start: number): string =>
  `${updatesDir}/${device}/${start}.loro`

export const snapshotPath = (name: string): string => `${snapshotsDir}/${name}`

export const seenPath = (device: DeviceId): string => `${seenDir}/${device}.json`

export interface ListedName {
  readonly raw: string
  readonly name: string
  readonly stub: boolean
}

export const readName = (listed: string): ListedName => {
  const inner = /^\.(.+)\.icloud$/.exec(listed)?.[1]
  const raw = inner ?? listed
  return { raw, name: raw.normalize("NFC"), stub: inner !== undefined }
}

const conflictSuffix = / \d+(\.[a-z]+)$/

export const originalName = (name: string): string => name.replace(conflictSuffix, "$1")

export const isUpdateName = (name: string): boolean => /^\d+\.loro$/.test(originalName(name))

export const isSnapshotName = (name: string): boolean =>
  /^[0-9a-f]{32}\.loro$/.test(originalName(name))

const decodeDevice = Schema.decodeUnknownOption(DeviceId)

export const deviceOfDir = (name: string): Option.Option<DeviceId> => decodeDevice(name)

export const deviceOfSeen = (name: string): Option.Option<DeviceId> =>
  Option.flatMap(Option.fromNullishOr(/^(.+)\.json$/.exec(name)?.[1]), decodeDevice)

export const isSeenConflictOf = (device: DeviceId, name: string): boolean =>
  name !== `${device}.json` && originalName(name) === `${device}.json`

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const snapshotName = async (peer: string, bytes: Uint8Array): Promise<string> => {
  const prefix = new TextEncoder().encode(`${peer}:`)
  const input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix)
  input.set(bytes, prefix.length)
  return `${hex(await crypto.subtle.digest("SHA-256", input)).slice(0, 32)}.loro`
}
