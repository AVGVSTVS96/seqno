export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const fnv = (bytes) => {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193)
  return h >>> 0
}

export const makeUpdate = (seed, size) => {
  const out = new Uint8Array(size)
  const next = rng(seed)
  for (let i = 8; i < size; i++) out[i] = (next() * 256) | 0
  const view = new DataView(out.buffer)
  view.setUint32(0, size, true)
  view.setUint32(4, fnv(out.subarray(8)), true)
  return out
}

export const verifyUpdate = (bytes) => {
  if (bytes.length < 8) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(0, true) === bytes.length && view.getUint32(4, true) === fnv(bytes.subarray(8))
}

export const sizesFor = (seed, n, min, max) => {
  const next = rng(seed)
  return Array.from({ length: n }, () => min + Math.floor(next() * (max - min + 1)))
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const r = (x) => Math.round(x * 100) / 100
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(pct(s, 0.5)), p95: r(pct(s, 0.95)), max: r(s.at(-1)) }
}
