import type { Block, BlockId } from "@seqno/domain"
import { names, type Table } from "./names.ts"
import { refsSelf } from "./refs.ts"

export interface BlockRow {
  readonly block: Block
  readonly level: number
  readonly hasChildren: boolean
  readonly folded: boolean
  readonly selected: boolean
}

export interface Bullet {
  readonly blockId: BlockId
  readonly folded: boolean
  readonly numbered: boolean
}

export interface BlockParts {
  readonly "seqno-row": readonly [BlockRow]
  readonly "seqno-control": readonly [{ readonly folded: boolean; readonly numbered: boolean }]
  readonly "seqno-bullet": readonly [Bullet]
  readonly "seqno-dot": readonly [{ readonly blockId: BlockId; readonly selected: boolean }]
}

export const blockParts: Table<BlockParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2860-L2873
  "seqno-row": ({ block, level, hasChildren, folded, selected }) => ({
    className: names("ls-block", block.id, selected && "selected"),
    blockid: block.id,
    level,
    haschild: hasChildren ? "true" : "false",
    "data-refs-self": refsSelf(block.text),
    "data-collapsed": folded || undefined,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1754-L1756
  "seqno-control": ({ folded, numbered }) => ({
    className: names("block-control-wrap", numbered && "is-order-list", folded && "bullet-closed"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1777-L1787
  "seqno-bullet": ({ blockId, folded, numbered }) => ({
    className: names(
      "bullet-container",
      folded && "bullet-closed",
      numbered && "as-order-list typed-list",
    ),
    id: `dot-${blockId}`,
    blockid: blockId,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1789-L1792
  "seqno-dot": ({ blockId, selected }) => ({
    className: names("bullet", selected && "selected"),
    blockid: blockId,
  }),
}
