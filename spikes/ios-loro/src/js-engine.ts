import type { LoroDoc, LoroEventBatch, LoroMap, LoroText, LoroTree, TreeID, VersionVector } from "loro-crdt"
import { TREE, type Delta, type Doc, type DocEvent, type Engine, type NodeId, type TreeValue, type Version } from "./engine.ts"

export interface LoroJsModule {
  readonly LoroDoc: new () => LoroDoc
  readonly LoroText: new () => LoroText
}

interface TreeJson {
  readonly id: TreeID
  readonly meta: Readonly<Record<string, unknown>>
  readonly children: readonly TreeJson[]
}

const toEvents = (batch: LoroEventBatch): DocEvent[] => {
  const out: DocEvent[] = []
  for (const event of batch.events) {
    const diff = event.diff
    if (diff.type === "tree") {
      for (const d of diff.diff) {
        if (d.action === "create") out.push({ kind: "create", node: d.target, parent: d.parent ?? null, index: d.index })
        else if (d.action === "move")
          out.push({
            kind: "move",
            node: d.target,
            parent: d.parent ?? null,
            index: d.index,
            oldParent: d.oldParent ?? null,
            oldIndex: d.oldIndex,
          })
        else out.push({ kind: "delete", node: d.target, oldParent: d.oldParent ?? null, oldIndex: d.oldIndex })
      }
    } else if (diff.type === "text") out.push({ kind: "text", node: event.path[1] as NodeId, delta: diff.diff as readonly Delta[] })
    else if (diff.type === "map") out.push({ kind: "meta", node: event.path[1] as NodeId, updated: diff.updated })
  }
  return out
}

export const jsEngine = (name: string, version: string, loro: LoroJsModule): Engine => ({
  name,
  version,
  createDoc: (): Doc => {
    const doc = new loro.LoroDoc()
    const tree: LoroTree = doc.getTree(TREE)
    const meta = (node: NodeId): LoroMap => tree.getNodeByID(node as TreeID)!.data
    const text = (node: NodeId, key: string) => meta(node).get(key) as LoroText
    return {
      importBytes: (bytes) => void doc.import(bytes),
      exportSnapshot: () => doc.export({ mode: "snapshot" }),
      exportUpdatesSince: (v) => doc.export({ mode: "update", from: v as unknown as VersionVector }),
      oplogVersion: () => doc.oplogVersion() as unknown as Version,
      versionJSON: () => Object.fromEntries([...doc.oplogVersion().toJSON()].map(([peer, counter]) => [String(peer), counter])),
      frontiersJSON: () => doc.oplogFrontiers().map((id) => `${id.counter}@${id.peer}`).sort(),
      setPeer: (peer) => doc.setPeerId(peer),
      commit: () => doc.commit(),
      subscribe: (listener) => doc.subscribe((batch) => listener(toEvents(batch))),
      tree: () => tree.toJSON() as TreeJson[] as readonly TreeValue[],
      roots: () => tree.roots().map((n) => n.id),
      children: (node) => tree.getNodeByID(node as TreeID)!.children()?.map((n) => n.id) ?? [],
      getMeta: (node, key) => {
        const value = meta(node).get(key) as unknown
        return value instanceof loro.LoroText ? value.toString() : value
      },
      toJSON: () => doc.toJSON(),
      createNode: (parent, index) => tree.createNode((parent ?? undefined) as TreeID | undefined, index).id,
      move: (node, parent, index) => tree.move(node as TreeID, (parent ?? undefined) as TreeID | undefined, index),
      deleteNode: (node) => tree.delete(node as TreeID),
      setMeta: (node, key, value) => void meta(node).set(key, value),
      createText: (node, key, initial) => void meta(node).setContainer(key, new loro.LoroText()).insert(0, initial),
      insertText: (node, key, index, s) => text(node, key).insert(index, s),
      deleteText: (node, key, index, length) => text(node, key).delete(index, length),
    }
  },
})
