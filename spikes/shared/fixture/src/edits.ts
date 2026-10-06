import type { Block, Graph, Page } from "./graph.ts"
import { createRng, type Rng } from "./rng.ts"
import * as W from "./words.ts"

/**
 * `parent` is a page id or a block id. `index` is the block's final position among the parent's
 * children, counted without the block itself. All text is ASCII, so UTF-8, UTF-16 and Unicode
 * scalar offsets are identical on every platform.
 */
export type Edit =
  | { readonly kind: "insertText"; readonly block: string; readonly index: number; readonly text: string }
  | { readonly kind: "deleteText"; readonly block: string; readonly index: number; readonly length: number }
  | { readonly kind: "createBlock"; readonly block: string; readonly parent: string; readonly index: number; readonly text: string }
  | { readonly kind: "moveBlock"; readonly block: string; readonly parent: string; readonly index: number }
  | { readonly kind: "deleteBlock"; readonly block: string }

export type EditMix = Readonly<Record<Edit["kind"], number>>

export const defaultEditMix: EditMix = { insertText: 0.55, deleteText: 0.15, createBlock: 0.12, moveBlock: 0.12, deleteBlock: 0.06 }

export interface EditOptions {
  readonly seed: number
  readonly count: number
  readonly mix?: Partial<EditMix>
  /** Edits already applied on top of the graph before this stream starts. */
  readonly prior?: readonly Edit[]
}

export interface ModelNode {
  parent: string | null
  readonly children: string[]
  content: string
}

export interface GraphModel {
  readonly apply: (edit: Edit) => void
  readonly toGraph: () => Graph
  readonly nodes: ReadonlyMap<string, Readonly<ModelNode>>
  readonly liveBlocks: readonly string[]
}

export const createGraphModel = (graph: Graph): GraphModel => {
  const nodes = new Map<string, ModelNode>()
  const pageOf = new Map<string, Page>()
  const live: string[] = []
  const slot = new Map<string, number>()

  const addLive = (id: string) => {
    slot.set(id, live.length)
    live.push(id)
  }
  const removeLive = (id: string) => {
    const i = slot.get(id)!
    const last = live.pop()!
    if (last !== id) {
      live[i] = last
      slot.set(last, i)
    }
    slot.delete(id)
  }
  const node = (id: string) => {
    const n = nodes.get(id)
    if (n === undefined) throw new Error(`unknown node ${id}`)
    return n
  }

  for (const page of graph.pages) {
    nodes.set(page.id, { parent: null, children: [], content: "" })
    pageOf.set(page.id, page)
  }
  for (const block of graph.blocks) {
    const parent = block.parentId ?? block.pageId
    nodes.set(block.id, { parent, children: [], content: block.content })
    node(parent).children.push(block.id)
    addLive(block.id)
  }

  const detach = (id: string) => {
    const siblings = node(node(id).parent!).children
    siblings.splice(siblings.indexOf(id), 1)
  }

  const apply = (edit: Edit) => {
    switch (edit.kind) {
      case "insertText": {
        const n = node(edit.block)
        n.content = n.content.slice(0, edit.index) + edit.text + n.content.slice(edit.index)
        return
      }
      case "deleteText": {
        const n = node(edit.block)
        n.content = n.content.slice(0, edit.index) + n.content.slice(edit.index + edit.length)
        return
      }
      case "createBlock": {
        nodes.set(edit.block, { parent: edit.parent, children: [], content: edit.text })
        node(edit.parent).children.splice(edit.index, 0, edit.block)
        addLive(edit.block)
        return
      }
      case "moveBlock": {
        detach(edit.block)
        node(edit.block).parent = edit.parent
        node(edit.parent).children.splice(edit.index, 0, edit.block)
        return
      }
      case "deleteBlock": {
        detach(edit.block)
        const stack = [edit.block]
        while (stack.length > 0) {
          const id = stack.pop()!
          stack.push(...node(id).children)
          nodes.delete(id)
          removeLive(id)
        }
        return
      }
    }
  }

  const toGraph = (): Graph => {
    const blocks: Block[] = []
    const visit = (pageId: string, parentId: string | null, ids: readonly string[]) => {
      for (const id of ids) {
        const n = node(id)
        blocks.push({ id, pageId, parentId, content: n.content })
        visit(pageId, id, n.children)
      }
    }
    for (const page of graph.pages) visit(page.id, null, node(page.id).children)
    return { options: graph.options, pages: graph.pages, blocks }
  }

  return { apply, toGraph, nodes, liveBlocks: live }
}

const typed = (rng: Rng) =>
  rng.chance(0.7) ? "abcdefghijklmnopqrstuvwxyz     "[rng.int(0, 30)]! : `${rng.pick(W.words)} `

const shortText = (rng: Rng) => {
  const target = rng.int(10, 80)
  let s = rng.pick(W.words)
  while (s.length < target) s += ` ${rng.pick(W.words)}`
  return s.slice(0, Math.max(10, target))
}

const isWithin = (model: GraphModel, id: string, ancestor: string) => {
  for (let at: string | null = id; at !== null; at = model.nodes.get(at)!.parent) if (at === ancestor) return true
  return false
}

const subtreeSize = (model: GraphModel, id: string, limit: number) => {
  let size = 0
  const stack = [id]
  while (stack.length > 0 && size <= limit) {
    size++
    stack.push(...model.nodes.get(stack.pop()!)!.children)
  }
  return size
}

const nextEdit = (rng: Rng, model: GraphModel, pageIds: readonly string[], mix: EditMix): Edit => {
  const live = model.liveBlocks
  const anyBlock = () => live[rng.int(0, live.length - 1)]!
  let r = rng.next() * Object.values(mix).reduce((a, b) => a + b, 0)
  const kind = (Object.keys(mix) as Edit["kind"][]).find((k) => (r -= mix[k]) < 0) ?? "insertText"

  if (kind === "deleteText") {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      const len = model.nodes.get(block)!.content.length
      if (len === 0) continue
      const index = rng.int(0, len - 1)
      return { kind, block, index, length: Math.min(rng.int(1, 5), len - index) }
    }
  }
  if (kind === "createBlock") {
    const parent = rng.chance(0.85) ? model.nodes.get(anyBlock())!.parent! : rng.pick(pageIds)
    const index = rng.int(0, model.nodes.get(parent)!.children.length)
    return { kind, block: rng.uuid(), parent, index, text: shortText(rng) }
  }
  if (kind === "moveBlock") {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      const r2 = rng.next()
      const parent = r2 < 0.5 ? model.nodes.get(block)!.parent! : r2 < 0.8 ? anyBlock() : rng.pick(pageIds)
      if (isWithin(model, parent, block)) continue
      const siblings = model.nodes.get(parent)!.children.length - (model.nodes.get(block)!.parent === parent ? 1 : 0)
      return { kind, block, parent, index: rng.int(0, siblings) }
    }
  }
  if (kind === "deleteBlock" && live.length > 1) {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      if (subtreeSize(model, block, 20) <= 20) return { kind, block }
    }
  }
  const block = anyBlock()
  return { kind: "insertText", block, index: rng.int(0, model.nodes.get(block)!.content.length), text: typed(rng) }
}

export const generateEdits = (graph: Graph, options: EditOptions): Edit[] => {
  const rng = createRng(options.seed)
  const mix = { ...defaultEditMix, ...options.mix }
  const model = createGraphModel(graph)
  for (const edit of options.prior ?? []) model.apply(edit)
  const pageIds = graph.pages.map((p) => p.id)
  const edits: Edit[] = []
  for (let i = 0; i < options.count; i++) {
    const edit = nextEdit(rng, model, pageIds, mix)
    model.apply(edit)
    edits.push(edit)
  }
  return edits
}

export const applyEdits = (graph: Graph, edits: readonly Edit[]): Graph => {
  const model = createGraphModel(graph)
  for (const edit of edits) model.apply(edit)
  return model.toGraph()
}
