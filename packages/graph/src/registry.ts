import type { TreeID } from "loro-crdt"
import type { BlockId, PageId } from "@seqno/domain"

export interface Registry {
  readonly pages: Map<PageId, TreeID>
  readonly blocks: Map<BlockId, TreeID>
  readonly loaded: Set<PageId>
}

export const emptyRegistry = (): Registry => ({
  pages: new Map(),
  blocks: new Map(),
  loaded: new Set(),
})

export const forget = <K>(index: Map<K, TreeID>, key: K, node: TreeID): void => {
  if (index.get(key) === node) index.delete(key)
}
