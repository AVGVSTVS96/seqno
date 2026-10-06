import {
  Diff_Tags,
  getVersion,
  Index_Tags,
  LoroDoc,
  LoroText,
  loroValueToJsValue,
  TextDelta_Tags,
  TreeExternalDiff_Tags,
  TreeParentId,
  TreeParentId_Tags,
  type DiffEvent,
  type LoroTree,
  type PathItem,
  type TreeId,
  type VersionVector,
} from "loro-react-native"
import { TREE, type Delta, type Doc, type DocEvent, type Engine, type NodeId, type TreeValue, type Version } from "../src/engine.ts"

const idOf = (t: TreeId): NodeId => `${t.counter}@${t.peer}`

const treeId = (id: NodeId): TreeId => {
  const at = id.indexOf("@")
  return { counter: Number(id.slice(0, at)), peer: BigInt(id.slice(at + 1)) }
}

const parentOf = (p: TreeParentId): NodeId | null => (p.tag === TreeParentId_Tags.Node ? idOf(p.inner.id) : null)

const ROOT = new TreeParentId.Root()
const parentId = (id: NodeId | null) => (id === null ? ROOT : new TreeParentId.Node({ id: treeId(id) }))

const nodeIn = (path: readonly PathItem[]): NodeId | undefined => {
  for (let i = path.length - 1; i >= 0; i--) {
    const index = path[i]!.index
    if (index.tag === Index_Tags.Node) return idOf(index.inner.target)
  }
}

const toBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const toEvents = (event: DiffEvent): DocEvent[] => {
  const out: DocEvent[] = []
  for (const { path, diff } of event.events) {
    if (diff.tag === Diff_Tags.Tree) {
      for (const { target, action } of diff.inner.diff.diff) {
        const node = idOf(target)
        if (action.tag === TreeExternalDiff_Tags.Create)
          out.push({ kind: "create", node, parent: parentOf(action.inner.parent), index: action.inner.index })
        else if (action.tag === TreeExternalDiff_Tags.Move)
          out.push({
            kind: "move",
            node,
            parent: parentOf(action.inner.parent),
            index: action.inner.index,
            oldParent: parentOf(action.inner.oldParent),
            oldIndex: action.inner.oldIndex,
          })
        else out.push({ kind: "delete", node, oldParent: parentOf(action.inner.oldParent), oldIndex: action.inner.oldIndex })
      }
      continue
    }
    const node = nodeIn(path)
    if (node === undefined) continue
    if (diff.tag === Diff_Tags.Text) {
      const delta: Delta[] = diff.inner.diff.map((d) =>
        d.tag === TextDelta_Tags.Retain
          ? { retain: d.inner.retain }
          : d.tag === TextDelta_Tags.Insert
            ? { insert: d.inner.insert }
            : { delete: d.inner.delete_ },
      )
      out.push({ kind: "text", node, delta })
    } else if (diff.tag === Diff_Tags.Map) {
      const updated: Record<string, unknown> = {}
      diff.inner.diff.updated.forEach((value, key) => {
        const v = value?.asValue()
        updated[key] = v === undefined ? undefined : loroValueToJsValue(v)
      })
      out.push({ kind: "meta", node, updated })
    }
  }
  return out
}

export const rnEngine: Engine = {
  name: "loro-react-native",
  version: getVersion(),
  createDoc: (): Doc => {
    const doc = new LoroDoc()
    const tree: LoroTree = doc.getTree(TREE)
    const meta = (node: NodeId) => tree.getMeta(treeId(node))
    const text = (node: NodeId, key: string) => meta(node).get(key)!.asLoroText()!
    return {
      importBytes: (bytes) => void doc.import_(toBuffer(bytes)),
      exportSnapshot: () => new Uint8Array(doc.exportSnapshot()),
      exportUpdatesSince: (v) => new Uint8Array(doc.exportUpdates(v as unknown as VersionVector)),
      oplogVersion: () => doc.oplogVv() as unknown as Version,
      versionJSON: () => Object.fromEntries([...doc.oplogVv().toHashmap()].map(([peer, counter]) => [String(peer), counter])),
      frontiersJSON: () => doc.oplogFrontiers().toVec().map((id) => `${id.counter}@${id.peer}`).sort(),
      setPeer: (peer) => doc.setPeerId(peer),
      commit: () => doc.commit(),
      subscribe: (listener) => {
        const subscription = doc.subscribeRoot((event: DiffEvent) => listener(toEvents(event)))
        return () => subscription.unsubscribe()
      },
      tree: () => tree.getValueWithMeta() as unknown as readonly TreeValue[],
      roots: () => tree.roots().map(idOf),
      children: (node) => (tree.children(parentId(node)) ?? []).map(idOf),
      getMeta: (node, key) => {
        const value = meta(node).get(key)
        if (value === undefined) return undefined
        return value.isContainer() ? value.asLoroText()?.toString() : loroValueToJsValue(value.asValue()!)
      },
      toJSON: () => doc.getDeepValue(),
      createNode: (parent, index) =>
        idOf(index === undefined ? tree.create(parentId(parent)) : tree.createAt(parentId(parent), index)),
      move: (node, parent, index) => tree.movTo(treeId(node), parentId(parent), index),
      deleteNode: (node) => tree.delete_(treeId(node)),
      setMeta: (node, key, value) => meta(node).insert(key, value),
      createText: (node, key, initial) => void meta(node).insertContainer(key, new LoroText()).insert(0, initial),
      insertText: (node, key, index, s) => text(node, key).insert(index, s),
      deleteText: (node, key, index, length) => text(node, key).delete_(index, length),
    }
  },
}
