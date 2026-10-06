import type { BlockId } from "@seqno/domain"
import type { Row } from "./tree.ts"

export interface Selection {
  readonly anchor: BlockId
  readonly head: BlockId
}

export interface Highlight {
  readonly level: number
  readonly first: boolean
  readonly last: boolean
}

export const selectedRange = (
  rows: ReadonlyArray<Row>,
  selection: Selection | null,
): readonly [number, number] | null => {
  if (selection === null) return null
  const anchor = rows.findIndex((row) => row.block.id === selection.anchor)
  const head = rows.findIndex((row) => row.block.id === selection.head)
  if (anchor === -1 || head === -1) return null
  return [Math.min(anchor, head), Math.max(anchor, head) + 1]
}

export const highlights = (
  rows: ReadonlyArray<Row>,
  range: readonly [number, number] | null,
): ReadonlyMap<number, Highlight> => {
  const out = new Map<number, Highlight>()
  if (range === null) return out
  const [from, to] = range
  for (let index = from; index < to; index++) {
    const row = rows[index]
    if (row === undefined || out.has(index)) continue
    for (let at = index; at < row.end; at++) {
      out.set(at, { level: row.depth, first: at === index, last: at === row.end - 1 })
    }
  }
  return out
}
