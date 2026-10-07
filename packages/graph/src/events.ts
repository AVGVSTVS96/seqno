import { Match, Option } from "effect"
import type { LoroEventBatch, LoroTree, LoroTreeNode, TreeDiffItem, TreeID } from "loro-crdt"
import type { GraphEvent, PageId } from "@seqno/domain"
import { forget, type Registry } from "./registry.ts"
import {
  blockIdOf,
  isTreeId,
  pageIdOf,
  readBlock,
  readPage,
  walkBlocks,
  type Placement,
} from "./tree.ts"

interface Change {
  readonly upserted: boolean
  readonly moved: boolean
}

export const translate = (
  tree: LoroTree,
  batches: ReadonlyArray<LoroEventBatch>,
  registry: Registry,
): ReadonlyArray<GraphEvent> => {
  const formerParent = new Map<TreeID, TreeID | undefined>()
  const changed = new Map<TreeID, Change>()
  const deleted: Array<TreeID> = []
  const mark = (id: TreeID, change: Partial<Change>) => {
    const before = changed.get(id) ?? { upserted: false, moved: false }
    changed.set(id, { ...before, ...change })
  }
  const record = Match.type<TreeDiffItem>().pipe(
    Match.discriminatorsExhaustive("action")({
      create: (item) => mark(item.target, { upserted: true }),
      move: (item) => {
        formerParent.set(item.target, item.oldParent)
        mark(item.target, { moved: true })
      },
      delete: (item) => {
        formerParent.set(item.target, item.oldParent)
        deleted.push(item.target)
      },
    }),
  )
  for (const batch of batches) {
    for (const event of batch.events) {
      if (event.diff.type === "tree") event.diff.diff.forEach(record)
      else if (isTreeId(event.path[1])) mark(event.path[1], { upserted: true })
    }
  }

  const parentOf = (id: TreeID): TreeID | undefined =>
    tree.isNodeDeleted(id) && formerParent.has(id)
      ? formerParent.get(id)
      : tree.getNodeByID(id)?.parent()?.id
  const rootOf = (id: TreeID): TreeID => {
    const parent = parentOf(id)
    return parent === undefined ? id : rootOf(parent)
  }
  const pageOf = (id: TreeID): Option.Option<PageId> =>
    Option.flatMap(Option.fromUndefinedOr(tree.getNodeByID(rootOf(id))), pageIdOf)
  const placementUnder = (parent: TreeID): Option.Option<Placement> =>
    Option.flatMap(Option.fromUndefinedOr(tree.getNodeByID(parent)), (node) =>
      parentOf(parent) === undefined
        ? Option.map(pageIdOf(node), (pageId): Placement => ({ pageId, parentId: null }))
        : Option.flatMap(blockIdOf(node), (parentId) =>
            Option.map(pageOf(parent), (pageId): Placement => ({ pageId, parentId })),
          ),
    )

  const events: Array<GraphEvent> = []
  const moveSubtree = (node: LoroTreeNode, at: Placement) =>
    walkBlocks(node, at, (child, childAt) =>
      Option.map(blockIdOf(child), (blockId) => {
        events.push({ _tag: "BlockMoved", blockId, ...childAt })
        return blockId
      }),
    )
  const deleteSubtree = (node: LoroTreeNode, at: Placement) =>
    walkBlocks(node, at, (child, childAt) =>
      Option.map(blockIdOf(child), (blockId) => {
        forget(registry.blocks, blockId, child.id)
        events.push({ _tag: "BlockDeleted", blockId, pageId: childAt.pageId })
        return blockId
      }),
    )

  const sent = new Set<TreeID>()
  const send = (id: TreeID): void => {
    if (sent.has(id)) return
    sent.add(id)
    const node = tree.getNodeByID(id)
    if (node === undefined || tree.isNodeDeleted(id)) return
    const parent = node.parent()
    if (parent !== undefined) send(parent.id)
    const change = changed.get(id)
    if (change === undefined) return
    if (parent === undefined) {
      Option.map(readPage(node), (page) => {
        registry.pages.set(page.id, id)
        events.push({ _tag: "PageUpserted", page })
      })
      return
    }
    Option.map(placementUnder(parent.id), (at) => {
      Option.map(readBlock(node, at), ({ block, createdAt, updatedAt }) => {
        registry.blocks.set(block.id, id)
        if (change.upserted) events.push({ _tag: "BlockUpserted", block, createdAt, updatedAt })
        if (change.moved) events.push({ _tag: "BlockMoved", blockId: block.id, ...at })
        const formerPage = Option.flatMap(Option.fromUndefinedOr(formerParent.get(id)), pageOf)
        if (change.moved && !Option.contains(formerPage, at.pageId)) {
          moveSubtree(node, { pageId: at.pageId, parentId: block.id })
        }
      })
    })
  }
  changed.forEach((_, id) => send(id))

  for (const id of new Set(deleted)) {
    const node = tree.getNodeByID(id)
    const parent = formerParent.get(id)
    if (node === undefined || !tree.isNodeDeleted(id)) continue
    if (parent === undefined) {
      Option.map(pageIdOf(node), (pageId) => {
        deleteSubtree(node, { pageId, parentId: null })
        forget(registry.pages, pageId, id)
        registry.loaded.delete(pageId)
        events.push({ _tag: "PageDeleted", pageId })
      })
      continue
    }
    Option.map(placementUnder(parent), (at) =>
      Option.map(blockIdOf(node), (blockId) => {
        forget(registry.blocks, blockId, id)
        events.push({ _tag: "BlockDeleted", blockId, pageId: at.pageId })
        deleteSubtree(node, { pageId: at.pageId, parentId: blockId })
      }),
    )
  }
  return events
}
