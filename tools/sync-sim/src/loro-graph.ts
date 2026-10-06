import { Clock, Crypto, Effect, Layer, Option } from "effect"
import {
  BlockId,
  Command,
  PageId,
  newBlockId,
  newPageId,
  normalizePageName,
  type Block,
  type GraphEvent,
  type Page,
  type Props,
} from "@seqno/domain"
import { CommandRejected } from "@seqno/rpc"
import {
  decodeImportBlobMeta,
  LoroDoc,
  LoroMap,
  LoroText,
  VersionVector,
  type LoroTreeNode,
  type PeerID,
  type TreeID,
} from "loro-crdt"
import { Graphs, type Fate, type Replica, type ReplicaSpec } from "./ports.ts"
import type { Span, VV } from "./vv.ts"

type Node = LoroTreeNode

const isTreeId = (value: unknown): value is TreeID =>
  typeof value === "string" && /^\d+@\d+$/.test(value)

const isPeerId = (value: string): value is PeerID => /^\d+$/.test(value)

const vvOf = (version: VersionVector): VV => Object.fromEntries(version.toJSON())

const versionOf = (vv: VV): VersionVector =>
  VersionVector.parseJSON(
    new Map(
      Object.entries(vv).flatMap(([peer, n]) => (isPeerId(peer) ? [[peer, n] as const] : [])),
    ),
  )

const blobSpan = (bytes: Uint8Array, checksum: boolean): Option.Option<Span> => {
  try {
    const meta = decodeImportBlobMeta(bytes, checksum)
    return Option.some({
      start: meta.mode === "snapshot" ? {} : vvOf(meta.partialStartVersionVector),
      end: vvOf(meta.partialEndVersionVector),
    })
  } catch {
    return Option.none()
  }
}

const sortKeys = (_key: string, value: unknown): unknown =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1)))
    : value

const reject = (reason: string) => Effect.fail(new CommandRejected({ reason }))

const idOf = (node: Node): string => {
  const id = node.data.get("id")
  return typeof id === "string" ? id : node.id
}
const rootOf = (node: Node): Node => {
  let cur = node
  for (let up = cur.parent(); up !== undefined; up = cur.parent()) {
    cur = up
  }
  return cur
}
const textOf = (node: Node): LoroText | undefined => {
  const src = node.data.get("src")
  return src instanceof LoroText ? src : undefined
}
const propsOf = (node: Node): Props => {
  const props = node.data.get("props")
  if (!(props instanceof LoroMap)) {
    return {}
  }
  return Object.fromEntries(
    props.entries().flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  )
}
const createdAt = (node: Node): number => {
  const at = node.data.get("created")
  return typeof at === "number" ? at : 0
}
const blockOf = (node: Node): Block => {
  const parent = node.parent()
  return {
    id: BlockId.make(idOf(node)),
    pageId: PageId.make(idOf(rootOf(node))),
    parentId:
      parent === undefined || parent.parent() === undefined ? null : BlockId.make(idOf(parent)),
    text: textOf(node)?.toString() ?? "",
    collapsed: node.data.get("collapsed") === true,
    props: propsOf(node),
  }
}
const pageOf = (node: Node): Page => {
  const title = node.data.get("title")
  const text = typeof title === "string" ? title : ""
  return {
    id: PageId.make(idOf(node)),
    name: normalizePageName(text),
    title: text,
    journalDay: null,
    props: propsOf(node),
  }
}

const upserted = (node: Node) =>
  Effect.map(Clock.currentTimeMillis, (now): ReadonlyArray<GraphEvent> => [
    { _tag: "BlockUpserted", block: blockOf(node), createdAt: createdAt(node), updatedAt: now },
  ])

const unsupported = (name: string) =>
  reject(`${name} is not implemented by the sync-sim stand-in graph`)

const open = (spec: ReplicaSpec) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const doc = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const created = new LoroDoc()
        created.setPeerId(spec.peer)
        created.getTree("blocks").enableFractionalIndex(0)
        return created
      }),
      (created) => Effect.sync(() => created.free()),
    )
    const tree = doc.getTree("blocks")
    const ids = doc.getMap("ids")
    const peer = String(spec.peer)
    const mint = <A, E>(effect: Effect.Effect<A, E, Crypto.Crypto>) =>
      Effect.orDie(Effect.provideService(effect, Crypto.Crypto, crypto))

    const nodeOf = (id: string): Node | undefined => {
      const treeId = ids.get(id)
      return isTreeId(treeId) && tree.has(treeId) ? tree.getNodeByID(treeId) : undefined
    }
    const aliveNode = (id: string): Node | undefined => {
      const node = nodeOf(id)
      return node !== undefined && !tree.isNodeDeleted(node.id) ? node : undefined
    }
    const committed = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.tap(effect, () => Effect.sync(() => doc.commit()))

    const blockNode = (id: BlockId) => {
      const node = aliveNode(id)
      return node === undefined || node.parent() === undefined
        ? reject(`block ${id} does not exist`)
        : Effect.succeed(node)
    }
    const pageNode = (id: PageId) => {
      const node = aliveNode(id)
      return node === undefined || node.parent() !== undefined
        ? reject(`page ${id} does not exist`)
        : Effect.succeed(node)
    }
    const slotAfter = (parent: Node, after: BlockId | undefined, moving: Node | undefined) => {
      if (after === undefined) {
        return Effect.succeed(0)
      }
      const sibling = aliveNode(after)
      const index = sibling?.index()
      if (sibling === undefined || index === undefined || sibling.parent()?.id !== parent.id) {
        return reject(`block ${after} is not a child of the target parent`)
      }
      const current = moving?.parent()?.id === parent.id ? moving.index() : undefined
      return Effect.succeed(index + 1 - (current !== undefined && current < index ? 1 : 0))
    }

    const apply = (command: Command): Effect.Effect<ReadonlyArray<GraphEvent>, CommandRejected> =>
      Command.match(command, {
        CreatePage: ({ title }) =>
          normalizePageName(title).length === 0
            ? reject("a page title needs a visible character")
            : Effect.gen(function* () {
                const id = yield* mint(newPageId)
                const node = tree.createNode()
                node.data.set("id", id)
                node.data.set("title", title)
                ids.set(id, node.id)
                return [{ _tag: "PageUpserted", page: pageOf(node) }]
              }),
        RenamePage: ({ pageId, title }) =>
          Effect.map(pageNode(pageId), (node): ReadonlyArray<GraphEvent> => {
            node.data.set("title", title)
            return [{ _tag: "PageUpserted", page: pageOf(node) }]
          }),
        DeletePage: ({ pageId }) =>
          Effect.map(pageNode(pageId), (node): ReadonlyArray<GraphEvent> => {
            tree.delete(node.id)
            return [{ _tag: "PageDeleted", pageId }]
          }),
        InsertBlock: ({ pageId, parentId, after, text }) =>
          Effect.gen(function* () {
            const page = yield* pageNode(pageId)
            const parent = parentId === null ? page : yield* blockNode(parentId)
            if (rootOf(parent).id !== page.id) {
              return yield* reject(`block ${parentId} is not on page ${pageId}`)
            }
            const index = yield* slotAfter(parent, after, undefined)
            const id = yield* mint(newBlockId)
            const now = yield* Clock.currentTimeMillis
            const node = tree.createNode(parent.id, index)
            node.data.set("id", id)
            node.data.set("created", now)
            node.data.setContainer("src", new LoroText()).insert(0, text)
            ids.set(id, node.id)
            return yield* upserted(node)
          }),
        InsertBlocks: () => reject("the stand-in graph inserts one block at a time"),
        EditText: ({ blockId, from, to, insert }) =>
          Effect.flatMap(blockNode(blockId), (node) => {
            const text = textOf(node)
            if (text === undefined || from > to || to > text.length) {
              return reject(`range ${from}..${to} is outside block ${blockId}`)
            }
            if (to > from) {
              text.delete(from, to - from)
            }
            if (insert.length > 0) {
              text.insert(from, insert)
            }
            return upserted(node)
          }),
        MoveBlocks: ({ blockIds, parentId, after }) =>
          Effect.gen(function* () {
            const events: GraphEvent[] = []
            let previous = after
            for (const blockId of blockIds) {
              const node = yield* blockNode(blockId)
              if (previous === blockId || parentId === blockId) {
                return yield* reject(`block ${blockId} cannot move relative to itself`)
              }
              const anchor = previous === undefined ? undefined : yield* blockNode(previous)
              const parent = parentId !== null ? yield* blockNode(parentId) : rootOf(anchor ?? node)
              const index = yield* slotAfter(parent, previous, node)
              yield* Effect.try({
                try: () => tree.move(node.id, parent.id, index),
                catch: () =>
                  new CommandRejected({ reason: `moving ${blockId} would form a cycle` }),
              })
              events.push({
                _tag: "BlockMoved",
                blockId,
                pageId: PageId.make(idOf(rootOf(node))),
                parentId: parent.parent() === undefined ? null : BlockId.make(idOf(parent)),
              })
              previous = blockId
            }
            return events
          }),
        DeleteBlocks: ({ blockIds }) =>
          Effect.forEach(blockIds, (blockId) =>
            Effect.map(blockNode(blockId), (node): GraphEvent => {
              const pageId = PageId.make(idOf(rootOf(node)))
              tree.delete(node.id)
              return { _tag: "BlockDeleted", blockId, pageId }
            }),
          ),
        SetCollapsed: ({ blockId, collapsed }) =>
          Effect.flatMap(blockNode(blockId), (node) => {
            node.data.set("collapsed", collapsed)
            return upserted(node)
          }),
        SetProperty: ({ target, key, value }) => {
          const write = (node: Node) => {
            const props = node.data.getOrCreateContainer("props", new LoroMap())
            if (value === null) {
              props.delete(key)
            } else {
              props.set(key, value)
            }
          }
          return target._tag === "BlockTarget"
            ? Effect.flatMap(blockNode(target.blockId), (node) => {
                write(node)
                return upserted(node)
              })
            : Effect.map(pageNode(target.pageId), (node): ReadonlyArray<GraphEvent> => {
                write(node)
                return [{ _tag: "PageUpserted", page: pageOf(node) }]
              })
        },
        SplitBlock: () => unsupported("SplitBlock"),
        MergeWithPrevious: () => unsupported("MergeWithPrevious"),
        Indent: () => unsupported("Indent"),
        Outdent: () => unsupported("Outdent"),
        Undo: () => unsupported("Undo"),
        Redo: () => unsupported("Redo"),
      })

    const fate = (id: string): Fate => {
      const node = nodeOf(id)
      if (node === undefined) {
        return { _tag: "Missing" }
      }
      if (!tree.isNodeDeleted(node.id)) {
        return { _tag: "Alive", root: idOf(rootOf(node)) }
      }
      let top = node
      for (let up = top.parent(); up !== undefined && tree.has(up.id); up = top.parent()) {
        top = up
      }
      return { _tag: "Deleted", top: idOf(top) }
    }

    const importBlobs = (blobs: ReadonlyArray<Uint8Array>): ReadonlyArray<boolean> => {
      try {
        doc.importBatch([...blobs])
        return blobs.map(() => true)
      } catch {
        return blobs.map((blob) => {
          try {
            doc.import(blob)
            return true
          } catch {
            return false
          }
        })
      }
    }

    const replica: Replica = {
      peer,
      dispatch: (command) => committed(apply(command)),
      block: (id) =>
        Effect.sync(() => {
          const node = aliveNode(id)
          return node === undefined || node.parent() === undefined
            ? Option.none()
            : Option.some(blockOf(node))
        }),
      pageAlive: (id) =>
        Effect.sync(() => {
          const node = aliveNode(id)
          return node !== undefined && node.parent() === undefined
        }),
      children: (pageId, parentId) =>
        Effect.sync(() =>
          (aliveNode(parentId ?? pageId)?.children() ?? []).map((child) =>
            BlockId.make(idOf(child)),
          ),
        ),
      fate: (id) => Effect.sync(() => fate(id)),
      version: Effect.sync(() => vvOf(doc.oplogVersion())),
      exportUpdates: (from) =>
        Effect.sync(() => doc.export({ mode: "update", from: versionOf(from) })),
      exportSnapshot: Effect.sync(() => doc.export({ mode: "snapshot" })),
      importBlobs: (blobs) => Effect.sync(() => importBlobs(blobs)),
      canonical: Effect.sync(() => {
        const json: unknown = doc.toJSON()
        return JSON.stringify(json, sortKeys)
      }),
      liveNodes: Effect.sync(() => tree.nodes().filter((node) => !node.isDeleted()).length),
    }
    return replica
  })

export const LoroGraphs = Layer.succeed(Graphs, Graphs.of({ open, blobSpan }))
