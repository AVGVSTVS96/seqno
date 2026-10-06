export type VV = Readonly<Record<string, number>>

export interface Span {
  readonly start: VV
  readonly end: VV
}

export const covers = (a: VV, b: VV): boolean => {
  for (const peer in b) {
    if ((a[peer] ?? 0) < (b[peer] ?? 0)) {
      return false
    }
  }
  return true
}

export const vvEqual = (a: VV, b: VV): boolean => covers(a, b) && covers(b, a)

export const vvMax = (a: VV, b: VV): VV => {
  const out: Record<string, number> = { ...a }
  for (const peer in b) {
    out[peer] = Math.max(out[peer] ?? 0, b[peer] ?? 0)
  }
  return out
}

export class Coverage {
  private readonly peers = new Map<string, ReadonlyArray<readonly [number, number]>>()

  add({ start, end }: Span) {
    for (const peer in end) {
      const from = start[peer] ?? 0
      const to = end[peer] ?? 0
      if (to > from) {
        this.addRange(peer, from, to)
      }
    }
  }

  missingFrom(other: Coverage): ReadonlyArray<string> {
    return [...this.peers].flatMap(([peer, ranges]) => {
      const theirs = other.peers.get(peer) ?? []
      return ranges
        .filter(([a, b]) => !theirs.some(([c, d]) => c <= a && d >= b))
        .map(([a, b]) => `${peer}:[${a},${b})`)
    })
  }

  private addRange(peer: string, from: number, to: number) {
    let lo = from
    let hi = to
    const kept: Array<readonly [number, number]> = []
    for (const [a, b] of this.peers.get(peer) ?? []) {
      if (b < lo || a > hi) {
        kept.push([a, b])
      } else {
        lo = Math.min(lo, a)
        hi = Math.max(hi, b)
      }
    }
    kept.push([lo, hi])
    this.peers.set(
      peer,
      kept.toSorted((x, y) => x[0] - y[0]),
    )
  }
}
