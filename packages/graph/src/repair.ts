import { Option } from "effect"
import type { LoroDoc, LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import type { Page, PageId } from "@seqno/domain"
import type { Pending } from "./events.ts"
import {
  MERGED_INTO,
  TREE,
  childrenOf,
  isTrash,
  mergedInto,
  pageIdOf,
  readPage,
  setProp,
} from "./tree.ts"
import {
  lastPlacement,
  moveUnder,
  placeAll,
  unseenBy,
  unseenSince,
  usable,
  wasOf,
  rounds,
  type Placing,
  type Spot,
  type Unseen,
} from "./unseen.ts"

interface Touched {
  readonly pages: Set<TreeID>
  readonly filled: Set<TreeID>
}

const liveNode = (tree: LoroTree, id: TreeID | undefined): Option.Option<LoroTreeNode> =>
  id === undefined || tree.isNodeDeleted(id)
    ? Option.none()
    : Option.fromUndefinedOr(tree.getNodeByID(id))

type Kind = "page" | "merged" | "block"

const touchedBy = (tree: LoroTree, pending: Pending): Touched => {
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
  for (const id of pending.data) {
    if (kindOf(id) !== "block") touched.pages.add(id)
  }
  for (const id of pending.atRoot) touched.pages.add(id)
  for (const id of pending.under) {
    if (kindOf(id) === "merged") touched.filled.add(id)
  }
  return touched
}

export type LivePages = () => ReadonlyArray<readonly [LoroTreeNode, Page]>

const pagesByName = (pages: LivePages) => {
  const byName = new Map<string, Array<readonly [LoroTreeNode, Page]>>()
  for (const entry of pages()) {
    byName.set(entry[1].name, [...(byName.get(entry[1].name) ?? []), entry])
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
      .forEach(([key, value]) => setProp(node.data, key, value)),
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

const everyRoot = (tree: LoroTree): Touched => {
  const touched: Touched = { pages: new Set(), filled: new Set() }
  for (const root of tree.roots()) {
    if (tree.isNodeDeleted(root.id)) continue
    if (Option.isSome(mergedInto(root))) touched.filled.add(root.id)
    else touched.pages.add(root.id)
  }
  return touched
}

const repairTouched = (tree: LoroTree, touched: Touched, pages: LivePages): boolean => {
  let repaired = false
  if (touched.pages.size > 0) {
    for (const group of pagesByName(pages).values()) {
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

export const repairPages = (tree: LoroTree, pending: Pending, pages: LivePages): boolean =>
  repairTouched(tree, touchedBy(tree, pending), pages)

export const repairAll = (tree: LoroTree, pages: LivePages): boolean =>
  repairTouched(tree, everyRoot(tree), pages)

const rescueOnce = (doc: LoroDoc, tree: LoroTree, unseen: Unseen): boolean => {
  const killed = new Map<TreeID, Array<ReadonlyArray<LoroTreeNode>>>()
  for (const [id, { root }] of unseen.nodes) {
    if (root !== TREE) continue
    Option.map(
      Option.filter(liveNode(tree, id), (node) => !isTrash(node)),
      (node) => {
        const chain = [node]
        for (let at = node.parent(); at !== undefined; at = at.parent()) {
          if (isTrash(at)) {
            const k = chain.at(-1)
            if (k !== undefined) killed.set(k.id, [...(killed.get(k.id) ?? []), chain])
            return
          }
          chain.push(at)
        }
      },
    )
  }
  const placings: Array<Placing> = []
  const placing = (node: LoroTreeNode, spot: Spot, path: ReadonlyArray<string>) =>
    placings.push({ node, spot, path, put: (index) => moveUnder(tree, node, spot.parent, index) })
  for (const chains of killed.values()) {
    const k = chains[0]?.at(-1)
    const by = k?.getLastMoveId()
    if (k === undefined || by === undefined) continue
    const missed = (node: LoroTreeNode) => unseenBy(doc, unseen, [node], by)
    const page = Option.isSome(readPage(k))
    if (missed(k) || (page && chains.some((chain) => chain.some(missed)))) {
      const to = page
        ? wasOf(k)
        : Option.orElse(lastPlacement(doc, tree, unseen, k, by), () => wasOf(k))
      Option.map(
        Option.filter(to, (spot) => usable(tree, spot)),
        (spot) => placing(k, spot, []),
      )
      continue
    }
    const was = Option.filter(wasOf(k), (spot) => usable(tree, spot))
    if (Option.isNone(was)) continue
    const lifted = new Set<TreeID>()
    for (const chain of chains) {
      for (let at = chain.length - 2; at >= 0; at--) {
        const node = chain[at]
        if (node === undefined || !missed(node)) continue
        if (!lifted.has(node.id)) {
          lifted.add(node.id)
          const path = chain.slice(at, -1).map((one) => one.fractionalIndex() ?? "")
          placing(node, was.value, path.toReversed())
        }
        break
      }
    }
  }
  placeAll(tree, placings)
  return placings.length > 0
}

export const repairUnseen = (doc: LoroDoc, tree: LoroTree): boolean =>
  Option.match(unseenSince(doc, new Set()), {
    onNone: () => false,
    onSome: (unseen) => rounds(() => rescueOnce(doc, tree, unseen)),
  })
