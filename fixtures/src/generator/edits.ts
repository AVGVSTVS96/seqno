import { Match } from "effect"
import type { GeneratedBlock, GeneratedGraph } from "./graph.ts"
import { createRng, type Rng } from "./rng.ts"
import * as W from "./words.ts"

export type Edit =
  | { readonly _tag: "InsertText"; readonly block: string; readonly index: number; readonly text: string }
  | { readonly _tag: "DeleteText"; readonly block: string; readonly index: number; readonly length: number }
  | { readonly _tag: "CreateBlock"; readonly block: string; readonly parent: string; readonly index: number; readonly text: string }
  | { readonly _tag: "MoveBlock"; readonly block: string; readonly parent: string; readonly index: number }
  | { readonly _tag: "DeleteBlock"; readonly block: string }

export type EditTag = Edit["_tag"]

export type EditMix = Readonly<Record<EditTag, number>>

const editTags: ReadonlyArray<EditTag> = ["InsertText", "DeleteText", "CreateBlock", "MoveBlock", "DeleteBlock"]

export const defaultEditMix: EditMix = { InsertText: 0.55, DeleteText: 0.15, CreateBlock: 0.12, MoveBlock: 0.12, DeleteBlock: 0.06 }

export interface EditOptions {
  readonly seed: number
  readonly count: number
  readonly mix?: Partial<EditMix>
  readonly prior?: readonly Edit[]
}

export interface ModelNode {
  parent: string | null
  readonly children: string[]
  text: string
}

export interface GraphModel {
  readonly apply: (edit: Edit) => void
  readonly toGraph: () => GeneratedGraph
  readonly nodes: ReadonlyMap<string, Readonly<ModelNode>>
  readonly liveBlocks: readonly string[]
}

export const createGraphModel = (graph: GeneratedGraph): GraphModel => {
  const nodes = new Map<string, ModelNode>()
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

  for (const page of graph.pages) nodes.set(page.id, { parent: null, children: [], text: "" })
  for (const block of graph.blocks) {
    const parent = block.parentId ?? block.pageId
    nodes.set(block.id, { parent, children: [], text: block.text })
    node(parent).children.push(block.id)
    addLive(block.id)
  }

  const detach = (id: string) => {
    const siblings = node(node(id).parent!).children
    siblings.splice(siblings.indexOf(id), 1)
  }

  const apply = Match.type<Edit>().pipe(
    Match.tagsExhaustive({
      InsertText: (edit) => {
        const n = node(edit.block)
        n.text = n.text.slice(0, edit.index) + edit.text + n.text.slice(edit.index)
      },
      DeleteText: (edit) => {
        const n = node(edit.block)
        n.text = n.text.slice(0, edit.index) + n.text.slice(edit.index + edit.length)
      },
      CreateBlock: (edit) => {
        nodes.set(edit.block, { parent: edit.parent, children: [], text: edit.text })
        node(edit.parent).children.splice(edit.index, 0, edit.block)
        addLive(edit.block)
      },
      MoveBlock: (edit) => {
        detach(edit.block)
        node(edit.block).parent = edit.parent
        node(edit.parent).children.splice(edit.index, 0, edit.block)
      },
      DeleteBlock: (edit) => {
        detach(edit.block)
        const stack = [edit.block]
        while (stack.length > 0) {
          const id = stack.pop()!
          stack.push(...node(id).children)
          nodes.delete(id)
          removeLive(id)
        }
      },
    }),
  )

  const toGraph = (): GeneratedGraph => {
    const blocks: GeneratedBlock[] = []
    const visit = (pageId: string, parentId: string | null, ids: readonly string[]) => {
      for (const id of ids) {
        const n = node(id)
        blocks.push({ id, pageId, parentId, text: n.text })
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
  let r = rng.next() * editTags.reduce((sum, tag) => sum + mix[tag], 0)
  const tag = editTags.find((t) => (r -= mix[t]) < 0) ?? "InsertText"

  if (tag === "DeleteText") {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      const len = model.nodes.get(block)!.text.length
      if (len === 0) continue
      const index = rng.int(0, len - 1)
      return { _tag: tag, block, index, length: Math.min(rng.int(1, 5), len - index) }
    }
  }
  if (tag === "CreateBlock") {
    const parent = rng.chance(0.85) ? model.nodes.get(anyBlock())!.parent! : rng.pick(pageIds)
    const index = rng.int(0, model.nodes.get(parent)!.children.length)
    return { _tag: tag, block: rng.uuid(), parent, index, text: shortText(rng) }
  }
  if (tag === "MoveBlock") {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      const r2 = rng.next()
      const parent = r2 < 0.5 ? model.nodes.get(block)!.parent! : r2 < 0.8 ? anyBlock() : rng.pick(pageIds)
      if (isWithin(model, parent, block)) continue
      const siblings = model.nodes.get(parent)!.children.length - (model.nodes.get(block)!.parent === parent ? 1 : 0)
      return { _tag: tag, block, parent, index: rng.int(0, siblings) }
    }
  }
  if (tag === "DeleteBlock" && live.length > 1) {
    for (let tries = 0; tries < 10; tries++) {
      const block = anyBlock()
      if (subtreeSize(model, block, 20) <= 20) return { _tag: tag, block }
    }
  }
  const block = anyBlock()
  return { _tag: "InsertText", block, index: rng.int(0, model.nodes.get(block)!.text.length), text: typed(rng) }
}

export const generateEdits = (graph: GeneratedGraph, options: EditOptions): Edit[] => {
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

export const applyEdits = (graph: GeneratedGraph, edits: readonly Edit[]): GeneratedGraph => {
  const model = createGraphModel(graph)
  for (const edit of edits) model.apply(edit)
  return model.toGraph()
}
