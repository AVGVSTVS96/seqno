import { Match, Option } from "effect"
import type { LoroEventBatch, LoroTree, LoroTreeNode, TreeDiffItem, TreeID } from "loro-crdt"
import type { GraphEvent, PageId } from "@seqno/domain"
import { forget, type Registry } from "./registry.ts"
import {
  blockIdOf,
  isTrash,
  isTreeId,
  livePageIdOf,
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
        if (!formerParent.has(item.target)) formerParent.set(item.target, item.oldParent)
        mark(item.target, { moved: true })
      },
      delete: (item) => {
        if (!formerParent.has(item.target)) formerParent.set(item.target, item.oldParent)
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
  const roots = new Map<TreeID, TreeID>()
  const rootOf = (id: TreeID): TreeID => {
    const known = roots.get(id)
    if (known !== undefined) return known
    const parent = parentOf(id)
    const root = parent === undefined ? id : rootOf(parent)
    roots.set(id, root)
    return root
  }
  const rootBefore = (id: TreeID): TreeID => {
    const parent = formerParent.has(id) ? formerParent.get(id) : parentOf(id)
    return parent === undefined ? id : rootBefore(parent)
  }
  const isTrashNode = (id: TreeID) => {
    const node = tree.getNodeByID(id)
    return node !== undefined && isTrash(node)
  }
  const inTrash = (id: TreeID) => isTrashNode(rootOf(id))
  const pageBefore = (id: TreeID): Option.Option<PageId> =>
    Option.flatMap(Option.fromUndefinedOr(tree.getNodeByID(rootBefore(id))), pageIdOf)
  const wasInTrash = (id: TreeID | undefined) => id !== undefined && isTrashNode(rootBefore(id))
  const pageOf = (id: TreeID): Option.Option<PageId> =>
    Option.flatMap(Option.fromUndefinedOr(tree.getNodeByID(rootOf(id))), pageIdOf)
  const placementUnder = (parent: TreeID): Option.Option<Placement> =>
    Option.flatMap(Option.fromUndefinedOr(tree.getNodeByID(parent)), (node) =>
      parentOf(parent) === undefined
        ? Option.map(livePageIdOf(node), (pageId): Placement => ({ pageId, parentId: null }))
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
  const deleteSubtree = (node: LoroTreeNode, at: Placement, kept = false) =>
    walkBlocks(node, at, (child, childAt) =>
      Option.map(blockIdOf(child), (blockId) => {
        if (!kept) forget(registry.blocks, blockId, child.id)
        events.push({ _tag: "BlockDeleted", blockId, pageId: childAt.pageId })
        return blockId
      }),
    )
  const upsertSubtree = (node: LoroTreeNode, at: Placement) =>
    walkBlocks(node, at, (child, childAt) =>
      Option.map(readBlock(child, childAt), ({ block, createdAt, updatedAt }) => {
        registry.blocks.set(block.id, child.id)
        events.push({ _tag: "BlockUpserted", block, createdAt, updatedAt })
        return block.id
      }),
    )
  const trashed = (node: LoroTreeNode, change: Change) => {
    if (!change.moved || !formerParent.has(node.id)) return
    const from = formerParent.get(node.id)
    if (from === undefined) {
      Option.map(
        Option.filter(pageIdOf(node), (pageId) => registry.pages.get(pageId) === node.id),
        (pageId) => {
          deleteSubtree(node, { pageId, parentId: null }, true)
          forget(registry.pages, pageId, node.id)
          registry.loaded.delete(pageId)
          events.push({ _tag: "PageDeleted", pageId })
        },
      )
      return
    }
    Option.map(placementUnder(from), (at) =>
      Option.map(blockIdOf(node), (blockId) => {
        events.push({ _tag: "BlockDeleted", blockId, pageId: at.pageId })
        deleteSubtree(node, { pageId: at.pageId, parentId: blockId }, true)
      }),
    )
  }

  const retired: Array<LoroTreeNode> = []
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
    const restored = change.moved && wasInTrash(formerParent.get(id))
    if (parent === undefined) {
      Option.match(readPage(node), {
        onNone: () => retired.push(node),
        onSome: (page) => {
          registry.pages.set(page.id, id)
          events.push({ _tag: "PageUpserted", page })
          if (restored) upsertSubtree(node, { pageId: page.id, parentId: null })
        },
      })
      return
    }
    if (inTrash(id)) return trashed(node, change)
    Option.map(placementUnder(parent.id), (at) => {
      Option.map(readBlock(node, at), ({ block, createdAt, updatedAt }) => {
        registry.blocks.set(block.id, id)
        if (restored) {
          events.push({ _tag: "BlockUpserted", block, createdAt, updatedAt })
          upsertSubtree(node, { pageId: at.pageId, parentId: block.id })
          return
        }
        if (change.upserted) events.push({ _tag: "BlockUpserted", block, createdAt, updatedAt })
        if (change.moved) events.push({ _tag: "BlockMoved", blockId: block.id, ...at })
        const formerPage = Option.flatMap(Option.fromUndefinedOr(formerParent.get(id)), pageBefore)
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
  for (const node of retired) {
    Option.map(
      Option.filter(pageIdOf(node), (pageId) => registry.pages.get(pageId) === node.id),
      (pageId) => {
        deleteSubtree(node, { pageId, parentId: null })
        forget(registry.pages, pageId, node.id)
        registry.loaded.delete(pageId)
        events.push({ _tag: "PageDeleted", pageId })
      },
    )
  }
  return events
}
