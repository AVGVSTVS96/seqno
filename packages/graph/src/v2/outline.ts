import { Option } from "effect"
import type { LoroDoc, LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import type { BlockId, PageId } from "@seqno/domain"
import { blockFromData, blockIdOf, childrenOf, isTrash, type BlockState } from "../tree.ts"
import {
  AT,
  REF,
  directoryOf,
  keyOf,
  listPages,
  mergedFrom,
  parseKey,
  resolvePage,
  trashOfTree,
  treeName,
  type Directory,
  type Listing,
  type Spot,
} from "./layout.ts"

export interface Trees {
  readonly doc: LoroDoc
  readonly dir: Directory
  readonly tree: (page: PageId) => LoroTree
  readonly trash: (page: PageId) => LoroTreeNode
  readonly node: (page: PageId, id: TreeID) => Option.Option<LoroTreeNode>
  readonly listing: () => Listing
  readonly relist: () => void
}

export const makeTrees = (doc: LoroDoc): Trees => {
  const dir = directoryOf(doc)
  const trees = new Map<PageId, LoroTree>()
  const trashes = new Map<PageId, LoroTreeNode>()
  let listed: Listing | undefined
  const tree = (page: PageId) => {
    const known = trees.get(page)
    if (known !== undefined) return known
    const made = doc.getTree(treeName(page))
    trees.set(page, made)
    return made
  }
  return {
    doc,
    dir,
    tree,
    trash: (page) => {
      const known = trashes.get(page)
      if (known !== undefined && !known.isDeleted()) return known
      const found = trashOfTree(tree(page))
      trashes.set(page, found)
      return found
    },
    node: (page, id) => {
      const inTree = tree(page)
      return inTree.isNodeDeleted(id)
        ? Option.none()
        : Option.fromUndefinedOr(inTree.getNodeByID(id))
    },
    listing: () => {
      listed ??= listPages(dir)
      return listed
    },
    relist: () => {
      listed = undefined
    },
  }
}

export interface Item {
  readonly id: BlockId
  readonly key: string
  readonly home: Spot
  readonly at: Spot
}

const spotAt = (trees: Trees, key: unknown): Option.Option<Spot> =>
  Option.flatMap(parseKey(key), ([page, id]) =>
    Option.map(trees.node(page, id), (node) => ({ page, node })),
  )

export const homeOf = (trees: Trees, spot: Spot): Spot => {
  const ref = spot.node.data.get(REF)
  return ref === undefined ? spot : Option.getOrElse(spotAt(trees, ref), () => spot)
}

export const placementOf = (trees: Trees, home: Spot): Spot => {
  const at = home.node.data.get(AT)
  return at === undefined ? home : Option.getOrElse(spotAt(trees, at), () => home)
}

export const sameSpot = (a: Spot, b: Spot): boolean => a.node.id === b.node.id && a.page === b.page

export const itemOf = (trees: Trees, home: Spot): Option.Option<Item> =>
  Option.map(blockIdOf(home.node), (id) => ({
    id,
    key: keyOf(home),
    home,
    at: placementOf(trees, home),
  }))

export const isShown = (trees: Trees, spot: Spot): boolean => {
  if (isTrash(spot.node)) return false
  const home = homeOf(trees, spot)
  return sameSpot(placementOf(trees, home), spot)
}

export type Where =
  | {
      readonly _tag: "Live"
      readonly page: PageId
      readonly parentId: BlockId | null
      readonly depth: number
    }
  | { readonly _tag: "Dead" }
  | { readonly _tag: "Cycle"; readonly homes: ReadonlyArray<Spot> }

const DEAD: Where = { _tag: "Dead" }

export type Located = Map<string, Where>

const under = (parent: Where, parentId: Option.Option<BlockId>): Where =>
  parent._tag !== "Live"
    ? parent
    : Option.match(parentId, {
        onNone: () => DEAD,
        onSome: (id): Where => ({
          _tag: "Live",
          page: parent.page,
          parentId: id,
          depth: parent.depth + 1,
        }),
      })

export const locate = (trees: Trees, home: Spot, memo: Located = new Map()): Where => {
  const chain: Array<Spot> = []
  const seen = new Map<string, number>()
  let end: Where = DEAD
  let cursor: Spot = home
  for (;;) {
    const key = keyOf(cursor)
    const known = memo.get(key)
    if (known !== undefined) {
      chain.push(cursor)
      end = known
      break
    }
    const looped = seen.get(key)
    if (looped !== undefined) {
      end = { _tag: "Cycle", homes: chain.slice(looped) }
      break
    }
    seen.set(key, chain.length)
    chain.push(cursor)
    const at = placementOf(trees, cursor)
    const parent = at.node.parent()
    if (parent === undefined) {
      end = Option.match(resolvePage(trees.listing(), at.page), {
        onNone: () => DEAD,
        onSome: (page): Where => ({ _tag: "Live", page, parentId: null, depth: 0 }),
      })
      break
    }
    if (isTrash(parent)) break
    cursor = homeOf(trees, { page: at.page, node: parent })
  }
  let below = end
  for (let index = chain.length - 1; index >= 0; index--) {
    const spot = chain[index]
    const above = chain[index + 1]
    if (spot === undefined) continue
    if (above !== undefined) below = under(below, blockIdOf(above.node))
    memo.set(keyOf(spot), below)
  }
  return below
}

export const nodeChildren = (item: { readonly home: Spot; readonly at: Spot }) => {
  const own = childrenOf(item.home.node).map((node): Spot => ({ page: item.home.page, node }))
  return sameSpot(item.home, item.at)
    ? own
    : [...own, ...childrenOf(item.at.node).map((node): Spot => ({ page: item.at.page, node }))]
}

export const treeRoots = (trees: Trees, page: PageId): ReadonlyArray<Spot> =>
  trees
    .tree(page)
    .roots()
    .flatMap((node) => (isTrash(node) ? [] : [{ page, node }]))

export const pageTrees = (trees: Trees, page: PageId): ReadonlyArray<PageId> => [
  page,
  ...mergedFrom(trees.listing(), page),
]

export interface Read extends BlockState {
  readonly home: Spot
  readonly at: Spot
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const readView = (trees: Trees, page: PageId): Array<Read> => {
  const out: Array<Read> = []
  const visit = (spot: Spot, parentId: BlockId | null) => {
    const json: unknown = spot.node.data.toJSON()
    if (!isRecord(json) || json["trash"] === true) return
    let home = spot
    let content: unknown = json
    if (json[REF] !== undefined) {
      home = homeOf(trees, spot)
      if (sameSpot(home, spot)) return
      content = home.node.data.toJSON()
      if (!isRecord(content) || content[AT] !== keyOf(spot)) return
    } else if (json[AT] !== undefined && Option.isSome(spotAt(trees, json[AT]))) return
    Option.map(blockFromData(content, { pageId: page, parentId }), (state) => {
      out.push({ ...state, home, at: spot })
      for (const child of nodeChildren({ home, at: spot })) visit(child, state.block.id)
    })
  }
  for (const own of pageTrees(trees, page)) {
    for (const root of trees.tree(own).roots()) visit({ page: own, node: root }, null)
  }
  return out
}
