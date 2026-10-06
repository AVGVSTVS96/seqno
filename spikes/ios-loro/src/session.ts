import type { Block, Edit, Graph, Page } from "../vendor/fixture/index.ts"
import type { Delta, Doc, DocEvent, NodeId, TreeValue } from "./engine.ts"

export interface Entry {
  readonly id: NodeId
  uuid: string
  parent: NodeId | null
  readonly children: NodeId[]
  text: string
  title?: string
  journalDay?: number
}

export interface BlockMap {
  readonly entries: Map<NodeId, Entry>
  readonly roots: NodeId[]
  readonly byUuid: Map<string, NodeId>
}

export interface Session {
  readonly doc: Doc
  readonly map: BlockMap
  readonly events: { count: number }
  readonly close: () => void
}

export const importGraph = (doc: Doc, graph: Graph) => {
  const ids = new Map<string, NodeId>()
  for (const page of graph.pages) {
    const node = doc.createNode(null)
    doc.setMeta(node, "uuid", page.id)
    doc.setMeta(node, "title", page.name)
    if (page.journalDay !== null) doc.setMeta(node, "journalDay", page.journalDay)
    ids.set(page.id, node)
  }
  for (const block of graph.blocks) {
    const node = doc.createNode(ids.get(block.parentId ?? block.pageId)!)
    doc.setMeta(node, "uuid", block.id)
    doc.createText(node, "text", block.content)
    ids.set(block.id, node)
  }
  doc.commit()
}

export const loadBlockMap = (roots: readonly TreeValue[]): BlockMap => {
  const map: BlockMap = { entries: new Map(), roots: [], byUuid: new Map() }
  const visit = (node: TreeValue, parent: NodeId | null) => {
    const { uuid, text = "", title, journalDay } = node.meta as { uuid: string; text?: string; title?: string; journalDay?: number }
    map.entries.set(node.id, { id: node.id, uuid, parent, children: node.children.map((c) => c.id), text, title, journalDay })
    map.byUuid.set(uuid, node.id)
    for (const child of node.children) visit(child, node.id)
  }
  for (const root of roots) {
    map.roots.push(root.id)
    visit(root, null)
  }
  return map
}

const childrenOf = (map: BlockMap, parent: NodeId | null) => (parent === null ? map.roots : map.entries.get(parent)?.children)

const forget = (map: BlockMap, id: NodeId) => {
  const entry = map.entries.get(id)
  if (entry === undefined) return
  for (const child of entry.children) forget(map, child)
  map.entries.delete(id)
  if (map.byUuid.get(entry.uuid) === id) map.byUuid.delete(entry.uuid)
}

const applyDelta = (text: string, delta: readonly Delta[]) => {
  let out = ""
  let at = 0
  for (const op of delta) {
    if ("retain" in op) {
      out += text.slice(at, at + op.retain)
      at += op.retain
    } else if ("insert" in op) out += op.insert
    else at += op.delete
  }
  return out + text.slice(at)
}

export const applyEvents = (map: BlockMap, events: readonly DocEvent[]) => {
  for (const e of events) {
    switch (e.kind) {
      case "create":
        map.entries.set(e.node, { id: e.node, uuid: "", parent: e.parent, children: [], text: "" })
        childrenOf(map, e.parent)?.splice(e.index, 0, e.node)
        break
      case "move": {
        childrenOf(map, e.oldParent)?.splice(e.oldIndex, 1)
        childrenOf(map, e.parent)?.splice(e.index, 0, e.node)
        const entry = map.entries.get(e.node)
        if (entry !== undefined) entry.parent = e.parent
        break
      }
      case "delete":
        childrenOf(map, e.oldParent)?.splice(e.oldIndex, 1)
        forget(map, e.node)
        break
      case "text": {
        const entry = map.entries.get(e.node)
        if (entry !== undefined) entry.text = applyDelta(entry.text, e.delta)
        break
      }
      case "meta": {
        const entry = map.entries.get(e.node)
        if (entry === undefined) break
        const { uuid, title, journalDay } = e.updated
        if (typeof uuid === "string") {
          entry.uuid = uuid
          map.byUuid.set(uuid, entry.id)
        }
        if (typeof title === "string") entry.title = title
        if (typeof journalDay === "number") entry.journalDay = journalDay
        break
      }
    }
  }
}

export const openSession = (doc: Doc, map: BlockMap = loadBlockMap(doc.tree())): Session => {
  const events = { count: 0 }
  const close = doc.subscribe((batch) => {
    events.count++
    applyEvents(map, batch)
  })
  return { doc, map, events, close }
}

export const applyEdit = ({ doc, map }: Session, edit: Edit) => {
  const node = (uuid: string) => map.byUuid.get(uuid)!
  switch (edit.kind) {
    case "insertText":
      doc.insertText(node(edit.block), "text", edit.index, edit.text)
      break
    case "deleteText":
      doc.deleteText(node(edit.block), "text", edit.index, edit.length)
      break
    case "createBlock": {
      const created = doc.createNode(node(edit.parent), edit.index)
      doc.setMeta(created, "uuid", edit.block)
      doc.createText(created, "text", edit.text)
      break
    }
    case "moveBlock":
      doc.move(node(edit.block), node(edit.parent), edit.index)
      break
    case "deleteBlock":
      doc.deleteNode(node(edit.block))
      break
  }
  doc.commit()
}

export const toGraph = (map: BlockMap, options: Graph["options"]): Graph => {
  const pages: Page[] = []
  const blocks: Block[] = []
  const visit = (pageId: string, parentId: string | null, ids: readonly NodeId[]) => {
    for (const id of ids) {
      const e = map.entries.get(id)!
      blocks.push({ id: e.uuid, pageId, parentId, content: e.text })
      visit(pageId, e.uuid, e.children)
    }
  }
  for (const id of map.roots) {
    const page = map.entries.get(id)!
    pages.push({ id: page.uuid, name: page.title ?? "", journalDay: page.journalDay ?? null })
    visit(page.uuid, null, page.children)
  }
  return { options, pages, blocks }
}
