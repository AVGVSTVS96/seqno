import type { Row } from "./tree.ts"

export interface Viewport {
  readonly top: number
  readonly bottom: number
}

export type Segment =
  | { readonly _tag: "Rows"; readonly from: number; readonly to: number }
  | { readonly _tag: "Gap"; readonly from: number; readonly to: number; readonly height: number }

const lineChars = 110
const lineHeight = 24
const rowPadding = 4
const hiddenLine = /^\s*(?:id|collapsed)::/

export const estimateHeight = (text: string) => {
  let lines = 0
  for (const line of text.split("\n")) {
    if (!hiddenLine.test(line)) lines += Math.max(1, Math.ceil(line.length / lineChars))
  }
  return rowPadding + lineHeight * Math.max(1, lines)
}

export const offsets = (
  rows: ReadonlyArray<Row>,
  heights: ReadonlyMap<string, number>,
): ReadonlyArray<number> => {
  const tops = [0]
  let total = 0
  for (const row of rows) {
    total += heights.get(row.block.id) ?? estimateHeight(row.block.text)
    tops.push(total)
  }
  return tops
}

const firstEndingAfter = (tops: ReadonlyArray<number>, y: number) => {
  let low = 0
  let high = tops.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if ((tops[middle + 1] ?? Number.POSITIVE_INFINITY) > y) high = middle
    else low = middle + 1
  }
  return low
}

export const windowOf = (
  tops: ReadonlyArray<number>,
  viewport: Viewport,
  overscan: number,
): readonly [number, number] => {
  const count = tops.length - 1
  const total = tops[count] ?? 0
  const top = Math.max(0, viewport.top - overscan)
  const bottom = Math.min(total, viewport.bottom + overscan)
  if (count === 0 || bottom <= 0 || top >= total || bottom <= top) return [count, count]
  const from = firstEndingAfter(tops, top)
  const to = Math.min(count, firstEndingAfter(tops, bottom) + 1)
  return [from, Math.max(from, to)]
}

export const segments = (
  tops: ReadonlyArray<number>,
  shown: ReadonlyArray<number>,
): ReadonlyArray<Segment> => {
  const count = tops.length - 1
  const sorted = [...new Set(shown)]
    .filter((index) => index >= 0 && index < count)
    .toSorted((a, b) => a - b)
  const out: Array<Segment> = []
  let at = 0
  const gap = (to: number) => {
    if (to > at) out.push({ _tag: "Gap", from: at, to, height: (tops[to] ?? 0) - (tops[at] ?? 0) })
  }
  for (const index of sorted) {
    gap(index)
    const last = out.at(-1)
    if (last?._tag === "Rows" && last.to === index) out[out.length - 1] = { ...last, to: index + 1 }
    else out.push({ _tag: "Rows", from: index, to: index + 1 })
    at = index + 1
  }
  gap(count)
  if (out.length === 0) out.push({ _tag: "Gap", from: 0, to: 0, height: 0 })
  return out
}
