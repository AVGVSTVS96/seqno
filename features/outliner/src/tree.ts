import type { Block, BlockId } from "@seqno/domain"
import { refsOf, refsValue } from "@seqno/dom"
import type { PageTree } from "@seqno/rpc"

export interface Row {
  readonly block: Block
  readonly depth: number
  readonly hasChildren: boolean
  readonly expanded: boolean
  readonly end: number
  readonly path: readonly BlockId[]
}

export interface Outline {
  readonly rows: readonly Row[]
  readonly trail: readonly Block[]
  readonly children: (parentId: BlockId | null) => readonly Block[]
  readonly parentOf: (blockId: BlockId) => BlockId | null
  readonly childRefs: (blockId: BlockId) => string
}

const none: readonly Block[] = []

export const outline = (tree: PageTree, zoom: BlockId | null, embedded = false): Outline => {
  const byId = new Map(tree.blocks.map((block) => [block.id, block]))
  const childrenOf = new Map<BlockId | null, Block[]>()

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
  const trail: Block[] = []

  for (
    let at = root;
    at !== undefined;
    at = at.parentId === null ? undefined : byId.get(at.parentId)
  ) {
    trail.unshift(at)
  }

  const rows: Row[] = []

  const visit = (block: Block, path: readonly BlockId[]) => {
    const hasChildren = children(block.id).length > 0
    const expanded = hasChildren && ((block === root && !embedded) || !block.collapsed)
    const index = rows.length
    const row = { block, depth: path.length, hasChildren, expanded, end: index + 1, path }
    rows.push(row)

    if (expanded) {
      const inner = [...path, block.id]

      for (const child of children(block.id)) {
        visit(child, inner)
      }

      rows[index] = { ...row, end: rows.length }
    }
  }

  for (const top of root === undefined ? children(null) : [root]) {
    visit(top, [])
  }

  const below = new Map<BlockId, readonly string[]>()

  const refsBelow = (blockId: BlockId): readonly string[] => {
    const known = below.get(blockId)

    if (known !== undefined) {
      return known
    }

    const found = children(blockId).flatMap((child) => [
      ...refsOf(child.text),
      ...refsBelow(child.id),
    ])

    below.set(blockId, found)

    return found
  }

  return {
    rows,
    trail,
    children,
    parentOf: (blockId) => byId.get(blockId)?.parentId ?? null,
    childRefs: (blockId) => refsValue(refsBelow(blockId)),
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

export const topLevel = (view: Outline, blockIds: readonly BlockId[]): BlockId[] => {
  const chosen = new Set(blockIds)

  return view.rows
    .map((row) => row.block.id)
    .filter((id) => {
      const parent = view.parentOf(id)

      return chosen.has(id) && (parent === null || !isWithin(view, parent, chosen))
    })
}
