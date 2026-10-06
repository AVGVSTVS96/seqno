export interface Rng {
  readonly next: () => number
  readonly int: (min: number, max: number) => number
  readonly range: (min: number, max: number) => number
  readonly chance: (p: number) => boolean
  readonly pick: <T>(items: readonly [T, ...T[]]) => T
  readonly exp: (mean: number) => number
  readonly bytes: (size: number) => Uint8Array
  readonly fork: () => Rng
}

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)] ?? items[0],
    exp: (mean) => -Math.log(1 - next()) * mean,
    bytes: (size) => Uint8Array.from({ length: size }, () => Math.floor(next() * 256)),
    fork: () => createRng(Math.floor(next() * 4294967296)),
  }
}

export type Tier = readonly [p: number, min: number, max: number]

export const tiered = (rng: Rng, tiers: readonly [Tier, ...Tier[]]): number => {
  let r = rng.next()
  for (const [p, min, max] of tiers) {
    if (r < p) {
      return rng.range(min, max)
    }
    r -= p
  }
  const [, min, max] = tiers.at(-1) ?? tiers[0]
  return rng.range(min, max)
}
