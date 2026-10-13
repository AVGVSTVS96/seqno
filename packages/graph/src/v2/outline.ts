import { Option } from "effect"
import type { LoroDoc, LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import type { BlockId, PageId } from "@seqno/domain"
import {
  blockFromData,
  blockIdOf,
  childrenOf,
  isTrash,
  makeTrash,
  type BlockState,
} from "../tree.ts"
import {
  AT,
  REF,
  directoryOf,
  listPages,
  mergedFrom,
  parseKey,
  resolvePage,
  spotOf,
  treeName,
  type Directory,
  type Listing,
  type Spot,
} from "./layout.ts"

export interface Facts {
  readonly id: Option.Option<BlockId>
  readonly ref: unknown
  readonly trash: boolean
}

const UNWRITTEN: Facts = { id: Option.none(), ref: undefined, trash: false }

const readFacts = (node: LoroTreeNode): Facts | undefined => {
  const id = blockIdOf(node)
  if (Option.isSome(id)) return { id, ref: undefined, trash: false }
  const ref: unknown = node.data.get(REF)
  if (ref !== undefined) return { id, ref, trash: false }
  return isTrash(node) ? { id, ref, trash: true } : undefined
}

export interface Trees {
  readonly doc: LoroDoc
  readonly dir: Directory
  readonly facts: (spot: Spot) => Facts
  readonly tree: (page: PageId) => LoroTree
  readonly trash: (page: PageId, known?: () => ReadonlyMap<string, BlockId>) => LoroTreeNode
  readonly node: (page: PageId, id: TreeID) => Option.Option<LoroTreeNode>
  readonly moved: (home: Spot) => boolean
  readonly markMoved: (home: Spot) => void
  readonly listing: () => Listing
  readonly relist: () => void
}

export const makeTrees = (doc: LoroDoc): Trees => {
  const dir = directoryOf(doc)
  const trees = new Map<PageId, LoroTree>()
  const trashes = new Map<PageId, LoroTreeNode>()
  const written = new Map<string, Facts>()
  let listed: Listing | undefined
  let movedHomes: Set<string> | undefined
  const facts = (spot: Spot): Facts => {
    const found = written.get(spot.key)
    if (found !== undefined) return found
    const read = readFacts(spot.node)
    if (read === undefined) return UNWRITTEN
    written.set(spot.key, read)
    return read
  }
  const moved = () => (movedHomes ??= new Set(Object.keys(dir.moved.toJSON())))
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
    facts,
    tree,
    trash: (page, known = () => new Map()) => {
      const cached = trashes.get(page)
      if (cached !== undefined && !cached.isDeleted()) return cached
      const inTree = tree(page)
      const blocks = known()
      const found =
        inTree.roots().find((root) => {
          const spot = spotOf(page, root)
          return !blocks.has(spot.key) && facts(spot).trash
        }) ?? makeTrash(inTree)
      trashes.set(page, found)
      return found
    },
    node: (page, id) => {
      const inTree = tree(page)
      return inTree.isNodeDeleted(id)
        ? Option.none()
        : Option.fromUndefinedOr(inTree.getNodeByID(id))
    },
    moved: (home) => moved().has(home.key),
    markMoved: (home) => {
      dir.moved.set(home.key, true)
      moved().add(home.key)
    },
    listing: () => {
      listed ??= listPages(dir)
      return listed
    },
    relist: () => {
      listed = undefined
      movedHomes = undefined
    },
  }
}

export interface Item {
  readonly id: BlockId
  readonly key: string
  readonly home: Spot
  readonly at: Spot
}

export const spotAt = (trees: Trees, key: unknown): Option.Option<Spot> =>
  Option.flatMap(parseKey(key), ([page, id]) =>
    Option.map(trees.node(page, id), (node) => spotOf(page, node)),
  )

export const homeOf = (trees: Trees, spot: Spot): Spot => {
  const { ref } = trees.facts(spot)
  return ref === undefined ? spot : Option.getOrElse(spotAt(trees, ref), () => spot)
}

export const placementOf = (trees: Trees, home: Spot): Spot => {
  if (!trees.moved(home)) return home
  const at = home.node.data.get(AT)
  return at === undefined ? home : Option.getOrElse(spotAt(trees, at), () => home)
}

export const sameSpot = (a: Spot, b: Spot): boolean => a.key === b.key

export const itemOf = (trees: Trees, home: Spot): Option.Option<Item> =>
  Option.map(trees.facts(home).id, (id) => ({
    id,
    key: home.key,
    home,
    at: placementOf(trees, home),
  }))

export const isShown = (trees: Trees, spot: Spot): boolean => {
  if (trees.facts(spot).trash) return false
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
  let end: Where = DEAD
  let cursor: Spot = home
  for (;;) {
    const key = cursor.key
    const known = memo.get(key)
    if (known !== undefined) {
      chain.push(cursor)
      end = known
      break
    }
    const looped = chain.findIndex((spot) => spot.key === key)
    if (looped !== -1) {
      end = { _tag: "Cycle", homes: chain.slice(looped) }
      break
    }
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
    const above = spotOf(at.page, parent)
    if (trees.facts(above).trash) break
    cursor = homeOf(trees, above)
  }
  let below = end
  for (let index = chain.length - 1; index >= 0; index--) {
    const spot = chain[index]
    const above = chain[index + 1]
    if (spot === undefined) continue
    if (above !== undefined) below = under(below, trees.facts(above).id)
    memo.set(spot.key, below)
  }
  return below
}

export const nodeChildren = (item: { readonly home: Spot; readonly at: Spot }) => {
  const own = childrenOf(item.home.node).map((node) => spotOf(item.home.page, node))
  return sameSpot(item.home, item.at)
    ? own
    : [...own, ...childrenOf(item.at.node).map((node) => spotOf(item.at.page, node))]
}

export const treeRoots = (trees: Trees, page: PageId): ReadonlyArray<Spot> =>
  trees
    .tree(page)
    .roots()
    .flatMap((node) => {
      const spot = spotOf(page, node)
      return trees.facts(spot).trash ? [] : [spot]
    })

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
      if (!isRecord(content) || content[AT] !== spot.key) return
    } else if (json[AT] !== undefined && Option.isSome(spotAt(trees, json[AT]))) return
    Option.map(blockFromData(content, { pageId: page, parentId }), (state) => {
      out.push({ ...state, home, at: spot })
      for (const child of nodeChildren({ home, at: spot })) visit(child, state.block.id)
    })
  }
  for (const own of pageTrees(trees, page)) {
    for (const root of trees.tree(own).roots()) visit(spotOf(own, root), null)
  }
  return out
}
