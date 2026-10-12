import type { LoroTreeNode } from "loro-crdt"
import type { BlockId, Page, PageId } from "@seqno/domain"
import { writeProps, type BlockState } from "../tree.ts"
import { ensurePageData } from "./layout.ts"
import type { Trees } from "./outline.ts"

export interface PageState {
  readonly page: Page
  readonly blocks: ReadonlyArray<BlockState>
}

const writeBlockState = (node: LoroTreeNode, { block, createdAt, updatedAt }: BlockState) => {
  node.data.set("uuid", block.id)
  node.data.ensureMergeableText("text").insert(0, block.text)
  node.data.ensureMergeableMap("props")
  node.data.set("created", createdAt)
  node.data.set("updated", updatedAt)
  if (block.collapsed) node.data.set("collapsed", true)
  writeProps(node.data, block.props)
}

export const writePage = (trees: Trees, id: PageId, { page, blocks }: PageState): void => {
  trees.dir.titles.set(id, page.title)
  if (page.journalDay !== null) trees.dir.days.set(id, page.journalDay)
  if (Object.keys(page.props).length > 0) writeProps(ensurePageData(trees.dir, id), page.props)
  const tree = trees.tree(id)
  const nodes = new Map<BlockId, LoroTreeNode>()
  for (const state of blocks) {
    const parent = state.block.parentId === null ? undefined : nodes.get(state.block.parentId)
    const node = parent === undefined ? tree.createNode() : parent.createNode()
    writeBlockState(node, state)
    nodes.set(state.block.id, node)
  }
}
