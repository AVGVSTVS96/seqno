import { Match } from "effect"
import type { BlockId, Command } from "@seqno/domain"
import { isWithin, topLevel, type Outline } from "./tree.ts"

export type DropZone = "before" | "after" | "child"

export interface DropTarget {
  readonly blockId: BlockId
  readonly zone: DropZone
}

interface Place {
  readonly parentId: BlockId | null
  readonly after?: BlockId
}

export const moveCommand = (
  view: Outline,
  dragged: ReadonlyArray<BlockId>,
  target: DropTarget,
): Command | null => {
  const [first, ...rest] = topLevel(view, dragged)
  const row = view.rows.find((candidate) => candidate.block.id === target.blockId)
  if (first === undefined || row === undefined) {
    return null
  }
  const moving = new Set([first, ...rest])
  if (isWithin(view, row.block.id, moving)) {
    return null
  }
  const zone = target.zone === "after" && row.expanded ? "child" : target.zone
  const place = Match.value(zone).pipe(
    Match.when("child", (): Place => ({ parentId: row.block.id })),
    Match.when("after", (): Place => ({ parentId: row.block.parentId, after: row.block.id })),
    Match.when("before", (): Place => {
      const siblings = view.children(row.block.parentId).filter((b) => !moving.has(b.id))
      const previous = siblings[siblings.findIndex((b) => b.id === row.block.id) - 1]
      return previous === undefined
        ? { parentId: row.block.parentId }
        : { parentId: row.block.parentId, after: previous.id }
    }),
    Match.exhaustive,
  )
  return { _tag: "MoveBlocks", blockIds: [first, ...rest], ...place }
}
