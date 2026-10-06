export interface Rng {
  readonly next: () => number
  readonly int: (min: number, max: number) => number
  readonly chance: (p: number) => boolean
  readonly pick: <T>(items: readonly T[]) => T
  readonly skewedIndex: (n: number) => number
  readonly uuid: () => string
}

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const hex = (digits: number) => {
    let out = ""
    for (let i = 0; i < digits; i++) out += ((next() * 16) | 0).toString(16)
    return out
  }
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    skewedIndex: (n) => Math.floor(n * next() ** 3),
    uuid: () =>
      `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[int(0, 3)]}${hex(3)}-${hex(12)}`,
  }
}
