import { LoroText, type LoroDoc, type LoroEventBatch, type LoroTree, type TextDiff, type TreeID } from "loro-crdt"
import type { Block, Edit, Graph, Page } from "../../shared/fixture/src/index.ts"

export const TREE = "blocks"

export interface Entry {
  readonly id: TreeID
  uuid: string
  parent: TreeID | null
  readonly children: TreeID[]
  text: string
  title?: string
  journalDay?: number
}

export interface BlockMap {
  readonly entries: Map<TreeID, Entry>
  readonly roots: TreeID[]
  readonly byUuid: Map<string, TreeID>
}

export interface Session {
  readonly doc: LoroDoc
  readonly tree: LoroTree
  readonly map: BlockMap
  readonly close: () => void
}

interface JsonNode {
  readonly id: TreeID
  readonly meta: { readonly uuid: string; readonly text?: string; readonly title?: string; readonly journalDay?: number }
  readonly children: readonly JsonNode[]
}

export const importGraph = (doc: LoroDoc, graph: Graph) => {
  const tree = doc.getTree(TREE)
  const ids = new Map<string, TreeID>()
  for (const page of graph.pages) {
    const node = tree.createNode()
    node.data.set("uuid", page.id)
    node.data.set("title", page.name)
    if (page.journalDay !== null) node.data.set("journalDay", page.journalDay)
    ids.set(page.id, node.id)
  }
  for (const block of graph.blocks) {
    const node = tree.createNode(ids.get(block.parentId ?? block.pageId)!)
    node.data.set("uuid", block.id)
    node.data.setContainer("text", new LoroText()).insert(0, block.content)
    ids.set(block.id, node.id)
  }
  doc.commit()
}

export const loadBlockMap = (doc: LoroDoc): BlockMap => {
  const map: BlockMap = { entries: new Map(), roots: [], byUuid: new Map() }
  const visit = (node: JsonNode, parent: TreeID | null) => {
    const { uuid, text = "", title, journalDay } = node.meta
    map.entries.set(node.id, { id: node.id, uuid, parent, children: node.children.map((c) => c.id), text, title, journalDay })
    map.byUuid.set(uuid, node.id)
    for (const child of node.children) visit(child, node.id)
  }
  for (const root of doc.getTree(TREE).toJSON() as JsonNode[]) {
    map.roots.push(root.id)
    visit(root, null)
  }
  return map
}

const childrenOf = (map: BlockMap, parent: TreeID | null | undefined) =>
  parent == null ? map.roots : map.entries.get(parent)?.children

const forget = (map: BlockMap, id: TreeID) => {
  const entry = map.entries.get(id)
  if (entry === undefined) return
  for (const child of entry.children) forget(map, child)
  map.entries.delete(id)
  if (map.byUuid.get(entry.uuid) === id) map.byUuid.delete(entry.uuid)
}

const applyDelta = (text: string, delta: TextDiff["diff"]) => {
  let out = ""
  let at = 0
  for (const op of delta) {
    if (op.retain !== undefined) {
      out += text.slice(at, at + op.retain)
      at += op.retain
    } else if (op.insert !== undefined) out += op.insert
    else if (op.delete !== undefined) at += op.delete
  }
  return out + text.slice(at)
}

export const applyEvents = (map: BlockMap, batch: LoroEventBatch, changed: Set<TreeID>) => {
  for (const event of batch.events) {
    const diff = event.diff
    if (diff.type === "tree") {
      for (const d of diff.diff) {
        changed.add(d.target)
        if (d.action === "create") {
          map.entries.set(d.target, { id: d.target, uuid: "", parent: d.parent ?? null, children: [], text: "" })
          childrenOf(map, d.parent)?.splice(d.index, 0, d.target)
        } else if (d.action === "move") {
          childrenOf(map, d.oldParent)?.splice(d.oldIndex, 1)
          childrenOf(map, d.parent)?.splice(d.index, 0, d.target)
          const entry = map.entries.get(d.target)
          if (entry !== undefined) entry.parent = d.parent ?? null
        } else {
          childrenOf(map, d.oldParent)?.splice(d.oldIndex, 1)
          forget(map, d.target)
        }
      }
      continue
    }
    const entry = map.entries.get(event.path[1] as TreeID)
    if (entry === undefined) continue
    changed.add(entry.id)
    if (diff.type === "text") entry.text = applyDelta(entry.text, diff.diff)
    else if (diff.type === "map") {
      const { uuid, title, journalDay } = diff.updated
      if (typeof uuid === "string") {
        entry.uuid = uuid
        map.byUuid.set(uuid, entry.id)
      }
      if (typeof title === "string") entry.title = title
      if (typeof journalDay === "number") entry.journalDay = journalDay
    }
  }
}

export const openSession = (doc: LoroDoc, onChange: (changed: ReadonlySet<TreeID>, map: BlockMap) => void = () => {}): Session => {
  const map = loadBlockMap(doc)
  const unsubscribe = doc.subscribe((batch) => {
    const changed = new Set<TreeID>()
    applyEvents(map, batch, changed)
    onChange(changed, map)
  })
  return { doc, tree: doc.getTree(TREE), map, close: unsubscribe }
}

const textOf = (session: Session, uuid: string) =>
  session.tree.getNodeByID(session.map.byUuid.get(uuid)!)!.data.get("text") as LoroText

export const applyEdit = (session: Session, edit: Edit) => {
  const { tree, map } = session
  switch (edit.kind) {
    case "insertText":
      textOf(session, edit.block).insert(edit.index, edit.text)
      break
    case "deleteText":
      textOf(session, edit.block).delete(edit.index, edit.length)
      break
    case "createBlock": {
      const node = tree.createNode(map.byUuid.get(edit.parent)!, edit.index)
      node.data.set("uuid", edit.block)
      node.data.setContainer("text", new LoroText()).insert(0, edit.text)
      break
    }
    case "moveBlock":
      tree.move(map.byUuid.get(edit.block)!, map.byUuid.get(edit.parent)!, edit.index)
      break
    case "deleteBlock":
      tree.delete(map.byUuid.get(edit.block)!)
      break
  }
  session.doc.commit()
}

export const toGraph = (map: BlockMap): Pick<Graph, "pages" | "blocks"> => {
  const pages: Page[] = []
  const blocks: Block[] = []
  const visit = (pageId: string, parentId: string | null, ids: readonly TreeID[]) => {
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
  return { pages, blocks }
}
