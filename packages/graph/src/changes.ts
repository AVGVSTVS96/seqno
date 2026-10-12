import { Option } from "effect"
import { VersionVector, type LoroDoc, type LoroTree, type PeerID, type TreeID } from "loro-crdt"
import type { BlockId, PageId } from "@seqno/domain"
import { blockIdOf, isTrash, isTreeId, pageIdOf } from "./tree.ts"

export interface Changed {
  readonly pages: ReadonlySet<PageId>
  readonly blocks: ReadonlySet<BlockId>
}

const isPeer = (peer: string): peer is PeerID => /^\d+$/.test(peer)

export const loroVersion = (version: ReadonlyMap<string, number>) =>
  VersionVector.parseJSON(
    new Map(
      [...version].flatMap(([peer, counter]) => (isPeer(peer) ? [[peer, counter] as const] : [])),
    ),
  )

const touchedNodes = (doc: LoroDoc, tree: LoroTree, from: VersionVector) => {
  const nodes = new Set<TreeID>()
  const spans = doc.findIdSpansBetween(doc.vvToFrontiers(from), doc.oplogFrontiers()).forward
  for (const span of spans) {
    const containers = doc.getChangedContainersIn(span, span.length)
    for (const container of containers) {
      if (container === tree.id) continue
      const node = doc.getPathToContainer(container)?.[1]
      if (!isTreeId(node)) return Option.none()
      nodes.add(node)
    }
    if (!containers.includes(tree.id)) continue
    for (const change of doc.exportJsonInIdSpan(span)) {
      for (const op of change.ops) {
        if (op.container === tree.id && "target" in op.content) nodes.add(op.content.target)
      }
    }
  }
  return Option.some(nodes)
}

export const changedSince = (
  doc: LoroDoc,
  tree: LoroTree,
  since: ReadonlyMap<string, number>,
): Option.Option<Changed> => {
  const from = loroVersion(since)
  const order = doc.oplogVersion().compare(from)
  if (since.size === 0 || order === undefined || order < 0) return Option.none()
  return Option.map(touchedNodes(doc, tree, from), (nodes) => {
    const pages = new Set<PageId>()
    const blocks = new Set<BlockId>()
    for (const id of nodes) {
      const node = tree.getNodeByID(id)
      if (node === undefined) continue
      let root = node
      for (let up = root.parent(); up !== undefined; up = root.parent()) root = up
      const inPage = root !== node && !isTrash(root) && !tree.isNodeDeleted(id)
      Option.map(blockIdOf(node), (block) => blocks.add(block))
      Option.map(pageIdOf(inPage ? root : node), (page) => pages.add(page))
    }
    return { pages, blocks }
  })
}
