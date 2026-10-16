import type { Block, BlockId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { isHiddenProperty } from "@seqno/syntax"
import { outline, type Outline, type Row } from "./tree.ts"

const lineChars = 110
const lineHeight = 24
const rowPadding = 4
const hiddenLine = /^\s*(?:id|collapsed)::/

const propertiesBox = 16

const estimateHeight = (block: Block) => {
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
  readonly key: (index: number) => string
  readonly estimate: (index: number) => number
}

const laidOut = new WeakMap<PageTree, Map<string, Laid>>()

export const layOut = (tree: PageTree, zoom: BlockId | null, embedded: boolean): Laid => {
  const key = `${zoom ?? ""} ${embedded}`
  const known = laidOut.get(tree) ?? new Map<string, Laid>()
  laidOut.set(tree, known)
  const found = known.get(key)
  if (found !== undefined) return found
  const view = outline(tree, zoom, embedded)
  const estimates = view.rows.map((row) => estimateHeight(row.block))
  const laid: Laid = {
    view,
    positions: new Map(view.rows.map((row, index) => [row.block.id, index])),
    ordinals: ordinalsOf(view.rows),
    key: (index) => view.rows[index]?.block.id ?? String(index),
    estimate: (index) => estimates[index] ?? 0,
  }
  known.set(key, laid)
  return laid
}
