import type { VersionVector } from "loro-crdt"

export type VV = Readonly<Record<string, number>>

export const vvOf = (v: VersionVector): VV => Object.fromEntries(v.toJSON())

export const covers = (a: VV, b: VV) => {
  for (const p in b) if ((a[p] ?? 0) < b[p]!) return false
  return true
}

export const vvEqual = (a: VV, b: VV) => covers(a, b) && covers(b, a)

export const vvMax = (a: VV, b: VV): VV => {
  const out: Record<string, number> = { ...a }
  for (const p in b) out[p] = Math.max(out[p] ?? 0, b[p]!)
  return out
}

export interface Span {
  readonly start: VV
  readonly end: VV
}

/** Per-peer sets of covered op counters, kept as sorted disjoint [start, end) intervals. */
export class Coverage {
  private readonly peers = new Map<string, [number, number][]>()

  add({ start, end }: Span) {
    for (const p in end) {
      const from = start[p] ?? 0
      const to = end[p]!
      if (to > from) this.addRange(p, from, to)
    }
  }

  private addRange(peer: string, from: number, to: number) {
    const list = this.peers.get(peer) ?? []
    const merged: [number, number][] = []
    let [lo, hi] = [from, to]
    for (const [a, b] of list) {
      if (b < lo || a > hi) merged.push([a, b])
      else [lo, hi] = [Math.min(lo, a), Math.max(hi, b)]
    }
    merged.push([lo, hi])
    merged.sort((x, y) => x[0] - y[0])
    this.peers.set(peer, merged)
  }

  /** Ranges in `this` that `other` does not cover. */
  missingFrom(other: Coverage): string[] {
    const out: string[] = []
    for (const [peer, list] of this.peers) {
      const theirs = other.peers.get(peer) ?? []
      for (const [a, b] of list) {
        const ok = theirs.some(([c, d]) => c <= a && d >= b)
        if (!ok) out.push(`${peer}:[${a},${b})`)
      }
    }
    return out
  }
}
