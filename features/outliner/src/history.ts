import type { Block, BlockId, GraphEvent } from "@seqno/domain"

export interface Editing {
  readonly blockId: BlockId
  readonly caret: number
}

export type HistoryStep = "Undo" | "Redo"

export const textEnd = Number.MAX_SAFE_INTEGER

export interface HistoryKey {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

export const historyStep = (press: HistoryKey): HistoryStep | null => {
  if (!(press.ctrlKey || press.metaKey) || press.altKey) return null
  const key = press.key.toLowerCase()
  if (key === "z") return press.shiftKey ? "Redo" : "Undo"
  return key === "y" && !press.shiftKey ? "Redo" : null
}

const changeEnd = (before: string, after: string): number => {
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  return after.length - suffix
}

export const historyFocus = (
  events: ReadonlyArray<GraphEvent>,
  before: ReadonlyArray<Block>,
): Editing | null => {
  const deleted = new Set(
    events.flatMap((event) => (event._tag === "BlockDeleted" ? [event.blockId] : [])),
  )
  const known = new Map(before.map((block) => [block.id, block.text]))
  const upserted = events.flatMap((event) =>
    event._tag === "BlockUpserted" && !deleted.has(event.block.id) ? [event.block] : [],
  )
  const changed = upserted.find((block) => known.get(block.id) !== block.text)
  if (changed !== undefined) {
    return { blockId: changed.id, caret: changeEnd(known.get(changed.id) ?? "", changed.text) }
  }
  const touched =
    upserted[0]?.id ??
    events.flatMap((event) =>
      event._tag === "BlockMoved" && !deleted.has(event.blockId) ? [event.blockId] : [],
    )[0]
  if (touched !== undefined) return { blockId: touched, caret: textEnd }
  const first = before.findIndex((block) => deleted.has(block.id))
  const above = before.slice(0, Math.max(first, 0)).findLast((block) => !deleted.has(block.id))
  return above === undefined ? null : { blockId: above.id, caret: textEnd }
}
