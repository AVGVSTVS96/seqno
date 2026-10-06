export type Range = readonly [from: number, to: number]

export interface Match {
  readonly kind: number
  readonly at: number
  readonly ranges: ReadonlyArray<Range>
}

const Exact = 0
const Prefix = 1
const Substring = 2
const Scattered = 3

const scattered = (label: string, query: string): Match | null => {
  const ranges: Array<[number, number]> = []
  let at = 0
  for (const char of query) {
    const found = label.indexOf(char, at)
    if (found === -1) return null
    const last = ranges.at(-1)
    if (last !== undefined && last[1] === found) last[1] = found + 1
    else ranges.push([found, found + 1])
    at = found + 1
  }
  return { kind: Scattered, at, ranges }
}

export const fuzzyMatch = (label: string, query: string): Match | null => {
  const text = label.toLowerCase()
  const wanted = query.trim().toLowerCase()
  if (wanted === "") return { kind: Exact, at: 0, ranges: [] }
  const found = text.indexOf(wanted)
  if (found === -1) return scattered(text, wanted)
  const kind = found > 0 ? Substring : text === wanted ? Exact : Prefix
  return { kind, at: found, ranges: [[found, found + wanted.length]] }
}

export const byMatch = (
  left: { readonly label: string; readonly match: Match },
  right: { readonly label: string; readonly match: Match },
) =>
  left.match.kind - right.match.kind ||
  left.match.at - right.match.at ||
  left.label.length - right.label.length ||
  left.label.localeCompare(right.label)

export const rankBy = <A>(
  items: ReadonlyArray<A>,
  labelOf: (item: A) => string,
  query: string,
): ReadonlyArray<{ readonly item: A; readonly match: Match }> =>
  items
    .flatMap((item) => {
      const label = labelOf(item)
      const match = fuzzyMatch(label, query)
      return match === null ? [] : [{ item, label, match }]
    })
    .toSorted(byMatch)
    .map(({ item, match }) => ({ item, match }))
