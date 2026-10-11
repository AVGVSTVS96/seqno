import { Effect } from "effect"
import { BlockId, PageId } from "@seqno/domain"

export interface ImportIds {
  readonly block: () => BlockId
  readonly page: () => PageId
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0

const xoshiro128 = (seed: Uint8Array) => {
  const view = new DataView(seed.buffer, seed.byteOffset, 16)
  const s = [0, 4, 8, 12].map((at) => view.getUint32(at))
  return () => {
    const [a = 0, b = 0, c = 0, d = 0] = s
    const result = (rotl(Math.imul(b, 5) >>> 0, 7) * 9) >>> 0
    const t = (b << 9) >>> 0
    const c2 = (c ^ a) >>> 0
    const d2 = (d ^ b) >>> 0
    s[0] = (a ^ d2) >>> 0
    s[1] = (b ^ c2) >>> 0
    s[2] = (c2 ^ t) >>> 0
    s[3] = rotl(d2, 11)
    return result
  }
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

export const seededIds = (seed: Uint8Array): ImportIds => {
  const next = xoshiro128(seed)
  const uuid = () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    for (let at = 4; at < 16; at += 4) view.setUint32(at, next())
    bytes[4] = 0
    bytes[5] = 0
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const text = hex(bytes)
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
  }
  return { block: () => BlockId.make(uuid()), page: () => PageId.make(uuid()) }
}

export const contentSeed = (parts: ReadonlyArray<string>) =>
  Effect.map(
    Effect.promise(() =>
      globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))),
    ),
    (digest) => new Uint8Array(digest),
  )
