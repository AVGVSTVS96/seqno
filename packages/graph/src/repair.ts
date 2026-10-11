import { Option } from "effect"
import type { LoroEventBatch, LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import type { Page, PageId } from "@seqno/domain"
import {
  MERGED_INTO,
  childrenOf,
  isTreeId,
  mergedInto,
  pageIdOf,
  readPage,
  setProp,
} from "./tree.ts"

interface Touched {
  readonly pages: Set<TreeID>
  readonly filled: Set<TreeID>
}

const liveNode = (tree: LoroTree, id: TreeID | undefined): Option.Option<LoroTreeNode> =>
  id === undefined || tree.isNodeDeleted(id)
    ? Option.none()
    : Option.fromUndefinedOr(tree.getNodeByID(id))

type Kind = "page" | "merged" | "block"

const touchedBy = (tree: LoroTree, batches: ReadonlyArray<LoroEventBatch>): Touched => {
  const touched: Touched = { pages: new Set(), filled: new Set() }
  const kinds = new Map<TreeID, Kind>()
  const kindOf = (id: TreeID): Kind => {
    const known = kinds.get(id)
    if (known !== undefined) return known
    const kind = Option.match(
      Option.filter(liveNode(tree, id), (node) => node.parent() === undefined),
      {
        onNone: (): Kind => "block",
        onSome: (root): Kind => (Option.isSome(mergedInto(root)) ? "merged" : "page"),
      },
    )
    kinds.set(id, kind)
    return kind
  }
  for (const batch of batches) {
    for (const event of batch.events) {
      if (event.diff.type !== "tree") {
        const id = event.path[1]
        if (isTreeId(id) && kindOf(id) !== "block") touched.pages.add(id)
        continue
      }
      for (const item of event.diff.diff) {
        if (item.action === "delete") continue
        if (item.parent === undefined) touched.pages.add(item.target)
        else if (kindOf(item.parent) === "merged") touched.filled.add(item.parent)
      }
    }
  }
  return touched
}

const pagesByName = (tree: LoroTree) => {
  const byName = new Map<string, Array<readonly [LoroTreeNode, Page]>>()
  for (const root of tree.roots()) {
    if (tree.isNodeDeleted(root.id)) continue
    Option.map(readPage(root), (page) => {
      byName.set(page.name, [...(byName.get(page.name) ?? []), [root, page]])
    })
  }
  return byName
}

const moveChildren = (tree: LoroTree, from: LoroTreeNode, into: LoroTreeNode) => {
  for (const child of childrenOf(from)) tree.move(child.id, into.id, childrenOf(into).length)
}

const absorb = (tree: LoroTree, winner: readonly [LoroTreeNode, Page], loser: LoroTreeNode) => {
  const [node, page] = winner
  moveChildren(tree, loser, node)
  Option.map(readPage(loser), ({ props }) =>
    Object.entries(props)
      .filter(([key]) => !(key in page.props))
      .forEach(([key, value]) => setProp(node, key, value)),
  )
  loser.data.set(MERGED_INTO, page.id)
}

const targetOf = (tree: LoroTree, id: PageId): Option.Option<LoroTreeNode> => {
  const byId = new Map(
    tree
      .roots()
      .filter((root) => !tree.isNodeDeleted(root.id))
      .flatMap((root) =>
        Option.toArray(Option.map(pageIdOf(root), (page) => [page, root] as const)),
      ),
  )
  const seen = new Set<PageId>()
  const follow = (at: PageId): Option.Option<LoroTreeNode> => {
    const node = byId.get(at)
    if (node === undefined || seen.has(at)) return Option.none()
    seen.add(at)
    return Option.match(mergedInto(node), { onNone: () => Option.some(node), onSome: follow })
  }
  return follow(id)
}

export const repairPages = (tree: LoroTree, batches: ReadonlyArray<LoroEventBatch>): boolean => {
  const touched = touchedBy(tree, batches)
  let repaired = false
  if (touched.pages.size > 0) {
    for (const group of pagesByName(tree).values()) {
      if (group.length < 2 || !group.some(([node]) => touched.pages.has(node.id))) continue
      const [winner, ...losers] = group.toSorted(([, a], [, b]) => (a.id < b.id ? -1 : 1))
      if (winner === undefined) continue
      for (const [loser] of losers) absorb(tree, winner, loser)
      repaired = true
    }
  }
  for (const id of touched.filled) {
    Option.map(liveNode(tree, id), (node) =>
      Option.map(
        Option.flatMap(mergedInto(node), (target) => targetOf(tree, target)),
        (target) => {
          if (childrenOf(node).length === 0) return
          moveChildren(tree, node, target)
          repaired = true
        },
      ),
    )
  }
  return repaired
}
