export interface Rng {
  readonly next: () => number
  readonly int: (min: number, max: number) => number
  readonly range: (min: number, max: number) => number
  readonly chance: (p: number) => boolean
  readonly pick: <T>(items: readonly T[]) => T
  readonly exp: (mean: number) => number
  readonly fork: () => Rng
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
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    exp: (mean) => -Math.log(1 - next()) * mean,
    fork: () => createRng(Math.floor(next() * 4294967296)),
  }
  return rng
}

export const tiered = (rng: Rng, tiers: readonly (readonly [p: number, min: number, max: number])[]) => {
  let r = rng.next()
  for (const [p, min, max] of tiers) {
    if (r < p) return rng.range(min, max)
    r -= p
  }
  const [, min, max] = tiers[tiers.length - 1]!
  return rng.range(min, max)
}
