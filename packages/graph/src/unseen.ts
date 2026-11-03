import { Option } from "effect"
import {
  VersionVector,
  type ContainerID,
  type JsonChange,
  type LoroDoc,
  type LoroTree,
  type LoroTreeNode,
  type OpId,
  type PeerID,
  type TreeID,
} from "loro-crdt"
import { childrenOf, isTrash, isTreeId } from "./tree.ts"

export const WAS = "was"

const UNWRITTEN = new Set([WAS, "collapsed", "trash"])

export interface Spot {
  readonly parent: TreeID | undefined
  readonly index: string
}

export interface Touch {
  readonly id: OpId
  readonly lamport: number
  readonly to: Option.Option<Spot>
}

export interface Touched {
  readonly root: string
  readonly touches: Array<Touch>
}

export interface Unseen {
  readonly nodes: ReadonlyMap<TreeID, Touched>
  readonly keys: ReadonlyMap<string, ReadonlyMap<string, Touch>>
}

export const markWas = (node: LoroTreeNode): void => {
  node.data.set(WAS, `${node.parent()?.id ?? ""}|${node.fractionalIndex() ?? ""}`)
}

export const wasOf = (node: LoroTreeNode): Option.Option<Spot> => {
  const was: unknown = node.data.get(WAS)
  if (typeof was !== "string") return Option.none()
  const bar = was.indexOf("|")
  const parent = was.slice(0, bar)
  const index = was.slice(bar + 1)
  if (bar === -1) return Option.none()
  if (parent === "") return Option.some({ parent: undefined, index })
  return isTreeId(parent) ? Option.some({ parent, index }) : Option.none()
}

const lowest = (doc: LoroDoc, heads: ReadonlyArray<OpId>): VersionVector => {
  const [first, ...rest] = heads.map((head) => doc.frontiersToVV([head]).toJSON())
  const min = new Map<PeerID, number>()
  for (const [peer, counter] of first ?? new Map<PeerID, number>()) {
    const counters = rest.map((vv) => vv.get(peer) ?? 0)
    min.set(peer, Math.min(counter, ...counters))
  }
  return VersionVector.parseJSON(min)
}

const isPeer = (peer: string): peer is PeerID => /^\d+$/.test(peer)

const peerOf = (change: JsonChange): Option.Option<PeerID> => {
  const peer = change.id.slice(change.id.indexOf("@") + 1)
  return isPeer(peer) ? Option.some(peer) : Option.none()
}

export const unseenSince = (doc: LoroDoc, keyed: ReadonlySet<string>): Option.Option<Unseen> => {
  const heads = doc.oplogFrontiers()
  if (heads.length < 2) return Option.none()
  const nodes = new Map<TreeID, Touched>()
  const keys = new Map<string, Map<string, Touch>>()
  const paths = new Map<string, ReadonlyArray<unknown>>()
  const pathOf = (container: ContainerID) => {
    const known = paths.get(container)
    if (known !== undefined) return known
    const path = doc.getPathToContainer(container) ?? []
    paths.set(container, path)
    return path
  }
  const trashes = new Map<string, boolean>()
  const intoTrash = (root: string, parent: TreeID | undefined) => {
    if (parent === undefined) return false
    const key = `${root}|${parent}`
    const known = trashes.get(key)
    if (known !== undefined) return known
    const tree: LoroTree = doc.getTree(root)
    const node = tree.isNodeDeleted(parent) ? undefined : tree.getNodeByID(parent)
    const trash = node !== undefined && isTrash(node)
    trashes.set(key, trash)
    return trash
  }
  const touch = (node: TreeID, root: string, one: Touch) => {
    const known = nodes.get(node)
    if (known === undefined) nodes.set(node, { root, touches: [one] })
    else known.touches.push(one)
  }
  const from = doc.vvToFrontiers(lowest(doc, heads))
  for (const span of doc.findIdSpansBetween(from, heads).forward) {
    for (const change of doc.exportJsonInIdSpan(span)) {
      const peer = peerOf(change)
      if (Option.isNone(peer)) continue
      const start = Number(change.id.slice(0, change.id.indexOf("@")))
      for (const op of change.ops) {
        const at = {
          id: { peer: peer.value, counter: op.counter },
          lamport: change.lamport + op.counter - start,
        }
        const [root, below, key] = pathOf(op.container)
        if (typeof root !== "string") continue
        const content = op.content
        if (below === undefined && "target" in content) {
          if (content.type === "delete" || intoTrash(root, content.parent)) continue
          touch(content.target, root, {
            ...at,
            to: Option.some({ parent: content.parent, index: content.fractional_index }),
          })
        } else if (below === undefined && keyed.has(root) && content.type === "insert") {
          if (!("key" in content)) continue
          const map = keys.get(root) ?? new Map<string, Touch>()
          const known = map.get(content.key)
          if (known === undefined || known.lamport < at.lamport) {
            map.set(content.key, { ...at, to: Option.none() })
          }
          keys.set(root, map)
        } else if (isTreeId(below) && content.type === "insert") {
          const written = key === undefined && "key" in content ? content.key : key
          if (typeof written === "string" && UNWRITTEN.has(written)) continue
          touch(below, root, { ...at, to: Option.none() })
        }
      }
    }
  }
  return Option.some({ nodes, keys })
}

export const seenBy = (doc: LoroDoc, op: OpId, by: OpId): boolean => {
  const order = doc.cmpFrontiers([op], [by])
  return order === -1 || order === 0
}

export const unseenBy = (
  doc: LoroDoc,
  unseen: Unseen,
  nodes: ReadonlyArray<LoroTreeNode>,
  by: OpId,
): boolean =>
  nodes.some((node) =>
    (unseen.nodes.get(node.id)?.touches ?? []).some((touch) => !seenBy(doc, touch.id, by)),
  )

export const isWithin = (target: LoroTreeNode | undefined, node: LoroTreeNode): boolean => {
  for (let at = target; at !== undefined; at = at.parent()) if (at.id === node.id) return true
  return false
}

export const moveUnder = (
  tree: LoroTree,
  node: LoroTreeNode,
  parent: TreeID | undefined,
  index: number,
): boolean => {
  if (parent !== undefined && isWithin(tree.getNodeByID(parent), node)) return false
  tree.move(node.id, parent, index)
  return true
}

export const lastPlacement = (
  doc: LoroDoc,
  tree: LoroTree,
  unseen: Unseen,
  node: LoroTreeNode,
  by: OpId,
): Option.Option<Spot> => {
  let best: Touch | undefined
  for (const touch of unseen.nodes.get(node.id)?.touches ?? []) {
    if (Option.isNone(touch.to) || seenBy(doc, touch.id, by)) continue
    const parent = touch.to.value.parent
    if (!usable(tree, touch.to.value)) continue
    if (parent !== undefined && isWithin(tree.getNodeByID(parent), node)) continue
    if (best === undefined || best.lamport < touch.lamport) best = touch
  }
  return Option.flatMap(Option.fromUndefinedOr(best), (touch) => touch.to)
}

export const seenPlacement = (
  doc: LoroDoc,
  tree: LoroTree,
  node: LoroTreeNode,
  by: OpId,
): Option.Option<Spot> => {
  let found: Spot | undefined
  let visits = 0
  doc.travelChangeAncestors([by], (change) => {
    visits++
    const span = { peer: change.peer, counter: change.counter, length: change.length }
    for (const one of doc.exportJsonInIdSpan(span).toReversed()) {
      for (const op of one.ops.toReversed()) {
        const content = op.content
        if (op.container !== tree.id || !("target" in content) || content.type === "delete")
          continue
        if (content.target !== node.id) continue
        if (change.peer === by.peer && op.counter > by.counter) continue
        const spot = { parent: content.parent, index: content.fractional_index }
        const above = spot.parent === undefined ? undefined : tree.getNodeByID(spot.parent)
        if (
          !usable(tree, spot) ||
          (above !== undefined && (isTrash(above) || isWithin(above, node)))
        ) {
          continue
        }
        found = spot
        return false
      }
    }
    return visits < 2000
  })
  return Option.fromUndefinedOr(found)
}

export const usable = (tree: LoroTree, spot: Spot): boolean =>
  spot.parent === undefined ||
  (!tree.isNodeDeleted(spot.parent) && tree.getNodeByID(spot.parent) !== undefined)

export interface Placing {
  readonly node: LoroTreeNode
  readonly spot: Spot
  readonly path: ReadonlyArray<string>
  readonly put: (index: number) => boolean
}

const byPlace = (a: Placing, b: Placing): number => {
  if (a.spot.index !== b.spot.index) return a.spot.index < b.spot.index ? -1 : 1
  for (let at = 0; at < Math.min(a.path.length, b.path.length); at++) {
    const left = a.path[at] ?? ""
    const right = b.path[at] ?? ""
    if (left !== right) return left < right ? -1 : 1
  }
  return a.path.length - b.path.length
}

const countUpTo = (sorted: ReadonlyArray<string>, index: string): number => {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((sorted[middle] ?? "") <= index) low = middle + 1
    else high = middle
  }
  return low
}

export const rounds = (once: () => boolean, commit: () => void): boolean => {
  let repaired = false
  for (let round = 0; round < 8 && once(); round++) {
    commit()
    repaired = true
  }
  return repaired
}

export const placeAll = (tree: LoroTree, placings: ReadonlyArray<Placing>): boolean => {
  const moving = new Set(placings.map(({ node }) => node.id))
  const groups = new Map<string, Array<Placing>>()
  for (const placing of placings) {
    const key = placing.spot.parent ?? ""
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [placing])
    else group.push(placing)
  }
  let placed = false
  for (const group of groups.values()) {
    const parentId = group[0]?.spot.parent
    const parent = parentId === undefined ? undefined : tree.getNodeByID(parentId)
    const indexes = (parent === undefined ? tree.roots() : childrenOf(parent))
      .filter((sibling) => !moving.has(sibling.id))
      .map((sibling) => sibling.fractionalIndex() ?? "")
    let order = 0
    for (const placing of group.toSorted(byPlace)) {
      if (placing.put(countUpTo(indexes, placing.spot.index) + order)) order++
    }
    if (order > 0) placed = true
  }
  return placed
}
