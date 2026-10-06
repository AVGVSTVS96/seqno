import type { Block, BlockId } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"

export interface Row {
  readonly block: Block
  readonly depth: number
  readonly hasChildren: boolean
  readonly expanded: boolean
}

export interface Outline {
  readonly rows: ReadonlyArray<Row>
  readonly trail: ReadonlyArray<Block>
  readonly children: (parentId: BlockId | null) => ReadonlyArray<Block>
  readonly parentOf: (blockId: BlockId) => BlockId | null
}

const none: ReadonlyArray<Block> = []

export const outline = (tree: PageTree, zoom: BlockId | null): Outline => {
  const byId = new Map(tree.blocks.map((block) => [block.id, block]))
  const childrenOf = new Map<BlockId | null, Array<Block>>()
  for (const block of tree.blocks) {
    const siblings = childrenOf.get(block.parentId)
    if (siblings === undefined) {
      childrenOf.set(block.parentId, [block])
    } else {
      siblings.push(block)
    }
  }
  const children = (parentId: BlockId | null) => childrenOf.get(parentId) ?? none
  const root = zoom === null ? undefined : byId.get(zoom)
  const trail: Array<Block> = []
  for (
    let at = root;
    at !== undefined;
    at = at.parentId === null ? undefined : byId.get(at.parentId)
  ) {
    trail.unshift(at)
  }
  const rows: Array<Row> = []
  const visit = (block: Block, depth: number) => {
    const hasChildren = children(block.id).length > 0
    const expanded = hasChildren && (block === root || !block.collapsed)
    rows.push({ block, depth, hasChildren, expanded })
    if (expanded) {
      for (const child of children(block.id)) {
        visit(child, depth + 1)
      }
    }
  }
  for (const top of root === undefined ? children(null) : [root]) {
    visit(top, 0)
  }
  return {
    rows,
    trail,
    children,
    parentOf: (blockId) => byId.get(blockId)?.parentId ?? null,
  }
}

export const isWithin = (view: Outline, blockId: BlockId, ancestors: ReadonlySet<BlockId>) => {
  for (let at: BlockId | null = blockId; at !== null; at = view.parentOf(at)) {
    if (ancestors.has(at)) {
      return true
    }
  }
  return false
}

export const topLevel = (view: Outline, blockIds: ReadonlyArray<BlockId>): Array<BlockId> => {
  const chosen = new Set(blockIds)
  return view.rows
    .map((row) => row.block.id)
    .filter((id) => {
      const parent = view.parentOf(id)
      return chosen.has(id) && (parent === null || !isWithin(view, parent, chosen))
    })
}
