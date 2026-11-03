import { BlockId } from "@seqno/domain"

export const freshId = (now = Date.now()): BlockId => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, index) => {
    const value =
      index < 6
        ? Math.floor(now / 2 ** (8 * (5 - index))) % 256
        : index === 6
          ? 0x70 | (byte & 0x0f)
          : index === 8
            ? 0x80 | (byte & 0x3f)
            : byte
    return value.toString(16).padStart(2, "0")
  }).join("")
  return BlockId.make(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  )
}
