import type { Block, BlockId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { isHiddenProperty } from "@seqno/syntax"
import { outline, type Outline, type Row } from "./tree.ts"

export interface Viewport {
  readonly top: number
  readonly bottom: number
}

export type Segment =
  | { readonly _tag: "Rows"; readonly from: number; readonly to: number }
  | { readonly _tag: "Gap"; readonly from: number; readonly to: number; readonly height: number }

export const viewportOf = (element: HTMLElement | null, current: Viewport): Viewport => {
  if (element === null) return current
  const box = element.getBoundingClientRect()
  const top = Math.round(-box.top)
  const bottom = Math.round(window.innerHeight - box.top)
  return top === current.top && bottom === current.bottom ? current : { top, bottom }
}

const lineChars = 110
const lineHeight = 24
const rowPadding = 4
const hiddenLine = /^\s*(?:id|collapsed)::/

const propertiesBox = 16

export const estimateHeight = (block: Block) => {
  let lines = 0
  for (const line of block.text.split("\n")) {
    if (!hiddenLine.test(line)) lines += Math.max(1, Math.ceil(line.length / lineChars))
  }
  const shown = Object.keys(block.props).filter((key) => !isHiddenProperty(key)).length
  const properties = shown === 0 ? 0 : propertiesBox + lineHeight * shown
  return rowPadding + lineHeight * Math.max(1, lines) + properties
}

const orderListKey = "logseq.order-list-type"
const numbered = /^[ \t]*logseq\.order-list-type::[ \t]*number[ \t]*$/m

const ordinalsOf = (rows: ReadonlyArray<Row>): ReadonlyArray<number | null> => {
  const streaks = new Map<BlockId | null, number>()
  return rows.map((row) => {
    const listed = row.block.props[orderListKey] === "number" || numbered.test(row.block.text)
    const streak = listed ? (streaks.get(row.block.parentId) ?? 0) + 1 : 0
    streaks.set(row.block.parentId, streak)
    return streak === 0 ? null : streak
  })
}

export interface Laid {
  readonly view: Outline
  readonly positions: ReadonlyMap<BlockId, number>
  readonly ordinals: ReadonlyArray<number | null>
  readonly estimates: ReadonlyArray<number>
}

const laidOut = new WeakMap<PageTree, Map<string, Laid>>()

export const layOut = (tree: PageTree, zoom: BlockId | null, embedded: boolean): Laid => {
  const key = `${zoom ?? ""} ${embedded}`
  const known = laidOut.get(tree) ?? new Map<string, Laid>()
  laidOut.set(tree, known)
  const found = known.get(key)
  if (found !== undefined) return found
  const view = outline(tree, zoom, embedded)
  const laid: Laid = {
    view,
    positions: new Map(view.rows.map((row, index) => [row.block.id, index])),
    ordinals: ordinalsOf(view.rows),
    estimates: view.rows.map((row) => estimateHeight(row.block)),
  }
  known.set(key, laid)
  return laid
}

const measuredTops = new WeakMap<
  Laid,
  { readonly heights: ReadonlyMap<string, number>; readonly tops: ReadonlyArray<number> }
>()

export const offsetsOf = (
  laid: Laid,
  heights: ReadonlyMap<string, number>,
): ReadonlyArray<number> => {
  const known = measuredTops.get(laid)
  if (known?.heights === heights) return known.tops
  const tops = [0]
  let total = 0
  laid.view.rows.forEach((row, index) => {
    total += heights.get(row.block.id) ?? laid.estimates[index] ?? 0
    tops.push(total)
  })
  measuredTops.set(laid, { heights, tops })
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
