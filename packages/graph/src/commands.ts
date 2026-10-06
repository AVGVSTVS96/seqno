import { Clock, Data, Effect, Option } from "effect"
import type { LoroTree, LoroTreeNode, TreeID, UndoManager } from "loro-crdt"
import {
  Command,
  newBlockId,
  newPageId,
  normalizePageName,
  type BlockId,
  type PageId,
  type PropertyTarget,
} from "@seqno/domain"
import { CommandRejected } from "@seqno/rpc"
import type { Registry } from "./registry.ts"
import {
  childrenOf,
  isCollapsed,
  propsOf,
  readPage,
  textOf,
  touch,
  writeBlock,
  writePage,
} from "./tree.ts"

export class Unresolved extends Data.TaggedError("Unresolved")<{ readonly id: BlockId }> {}

export interface Workspace {
  readonly tree: LoroTree
  readonly registry: Registry
  readonly undo: UndoManager
}

const reject = (reason: string) => Effect.fail(new CommandRejected({ reason }))

const live = (tree: LoroTree, id: TreeID | undefined): Option.Option<LoroTreeNode> =>
  id === undefined || tree.isNodeDeleted(id)
    ? Option.none()
    : Option.fromUndefinedOr(tree.getNodeByID(id))

const blockNode = (
  ws: Workspace,
  id: BlockId,
): Effect.Effect<LoroTreeNode, CommandRejected | Unresolved> => {
  const known = ws.registry.blocks.get(id)
  return known === undefined
    ? Effect.fail(new Unresolved({ id }))
    : Option.match(live(ws.tree, known), {
        onNone: () => reject(`block ${id} was deleted`),
        onSome: (node) => Effect.succeed(node),
      })
}

const pageNode = (ws: Workspace, id: PageId): Effect.Effect<LoroTreeNode, CommandRejected> =>
  Option.match(live(ws.tree, ws.registry.pages.get(id)), {
    onNone: () => reject(`page ${id} does not exist`),
    onSome: (node) => Effect.succeed(node),
  })

const ancestors = (node: LoroTreeNode): ReadonlyArray<LoroTreeNode> => {
  const parent = node.parent()
  return parent === undefined ? [] : [parent, ...ancestors(parent)]
}

const rootOf = (node: LoroTreeNode): LoroTreeNode => ancestors(node).at(-1) ?? node

const isWithin = (node: LoroTreeNode, ancestor: LoroTreeNode): boolean =>
  node.id === ancestor.id || ancestors(node).some((up) => up.id === ancestor.id)

const position = (node: LoroTreeNode): ReadonlyArray<number> =>
  [node, ...ancestors(node)].map((at) => at.index() ?? 0).reverse()

const byPosition = (a: LoroTreeNode, b: LoroTreeNode): number => {
  const [left, right] = [position(a), position(b)]
  const differs = left.findIndex((index, depth) => index !== right[depth])
  return differs === -1 ? left.length - right.length : (left[differs] ?? 0) - (right[differs] ?? 0)
}

const selection = (ws: Workspace, ids: ReadonlyArray<BlockId>) =>
  Effect.map(Effect.forEach(ids, (id) => blockNode(ws, id)), (nodes) => {
    const chosen = new Set(nodes.map((node) => node.id))
    const roots = nodes.filter(
      (node, at) =>
        nodes.findIndex((other) => other.id === node.id) === at &&
        !ancestors(node).some((up) => chosen.has(up.id)),
    )
    return roots.toSorted(byPosition)
  })

const isPage = (node: LoroTreeNode): boolean => node.parent() === undefined

const nameTaken = (ws: Workspace, title: string, except?: TreeID): boolean => {
  const name = normalizePageName(title)
  return ws.tree
    .roots()
    .some(
      (root) =>
        root.id !== except &&
        !ws.tree.isNodeDeleted(root.id) &&
        Option.exists(readPage(root), (page) => page.name === name),
    )
}

const checkTitle = (ws: Workspace, title: string, except?: TreeID) =>
  normalizePageName(title) === ""
    ? reject("a page title cannot be empty")
    : nameTaken(ws, title, except)
      ? reject(`a page named "${normalizePageName(title)}" already exists`)
      : Effect.void

const createBlock = (parent: LoroTreeNode, index: number, text: string) =>
  Effect.gen(function* () {
    const id = yield* Effect.orDie(newBlockId)
    const now = yield* Clock.currentTimeMillis
    writeBlock(parent.createNode(index), id, text, now)
  })

const childAfter = (ws: Workspace, parent: LoroTreeNode, after: BlockId | undefined) =>
  after === undefined
    ? Effect.succeed(0)
    : Effect.flatMap(blockNode(ws, after), (sibling) =>
        sibling.parent()?.id === parent.id
          ? Effect.succeed((sibling.index() ?? 0) + 1)
          : reject(`block ${after} is not a child of the target parent`),
      )

const lastVisible = (node: LoroTreeNode): LoroTreeNode => {
  const last = childrenOf(node).at(-1)
  return last === undefined || isCollapsed(node) ? node : lastVisible(last)
}

const targetNode = (ws: Workspace, target: PropertyTarget) =>
  target._tag === "BlockTarget" ? blockNode(ws, target.blockId) : pageNode(ws, target.pageId)

export const applyCommand = (ws: Workspace, command: Command) =>
  Command.match(command, {
    CreatePage: ({ title }) =>
      Effect.gen(function* () {
        yield* checkTitle(ws, title)
        const id = yield* Effect.orDie(newPageId)
        writePage(ws.tree.createNode(), id, title)
      }),
    RenamePage: ({ pageId, title }) =>
      Effect.gen(function* () {
        const page = yield* pageNode(ws, pageId)
        yield* checkTitle(ws, title, page.id)
        page.data.set("title", title)
      }),
    DeletePage: ({ pageId }) =>
      Effect.map(pageNode(ws, pageId), (page) => ws.tree.delete(page.id)),
    InsertBlock: ({ pageId, parentId, after, text }) =>
      Effect.gen(function* () {
        const page = yield* pageNode(ws, pageId)
        const parent = parentId === null ? page : yield* blockNode(ws, parentId)
        if (rootOf(parent).id !== page.id) {
          return yield* reject(`block ${parentId} is not on page ${pageId}`)
        }
        yield* createBlock(parent, yield* childAfter(ws, parent, after), text)
      }),
    EditText: ({ blockId, from, to, insert }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        const text = textOf(node)
        if (from > to || to > text.length) {
          return yield* reject(`range ${from}-${to} is outside the block text`)
        }
        text.splice(from, to - from, insert)
        touch(node, yield* Clock.currentTimeMillis)
      }),
    SplitBlock: ({ blockId, at }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        const text = textOf(node)
        const parent = node.parent()
        const index = node.index() ?? 0
        if (at > text.length || parent === undefined) {
          return yield* reject(`offset ${at} is outside the block text`)
        }
        if (at === 0 && text.length > 0) return yield* createBlock(parent, index, "")
        const tail = text.slice(at, text.length)
        text.delete(at, text.length - at)
        touch(node, yield* Clock.currentTimeMillis)
        const nests = childrenOf(node).length > 0 && !isCollapsed(node)
        yield* nests ? createBlock(node, 0, tail) : createBlock(parent, index + 1, tail)
      }),
    MergeWithPrevious: ({ blockId }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        const parent = node.parent()
        const previous = childrenOf(parent ?? node)[(node.index() ?? 0) - 1]
        const target = previous === undefined ? parent : lastVisible(previous)
        if (target === undefined || isPage(target)) {
          return yield* reject("the first block of a page has nothing to merge into")
        }
        const into = textOf(target)
        into.insert(into.length, textOf(node).toString())
        for (const child of childrenOf(node)) {
          if (target.id === parent?.id) child.moveBefore(node)
          else ws.tree.move(child.id, target.id, childrenOf(target).length)
        }
        ws.tree.delete(node.id)
        touch(target, yield* Clock.currentTimeMillis)
      }),
    Indent: ({ blockIds }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, blockIds)
        if (roots.some((node) => (node.index() ?? 0) === 0)) {
          return yield* reject("a block without a previous sibling cannot be indented")
        }
        for (const node of roots) {
          const previous = childrenOf(node.parent() ?? node)[(node.index() ?? 0) - 1]
          if (previous !== undefined) {
            ws.tree.move(node.id, previous.id, childrenOf(previous).length)
          }
        }
      }),
    Outdent: ({ blockIds }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, blockIds)
        if (roots.some((node) => isPage(node.parent() ?? node))) {
          return yield* reject("a top-level block cannot be outdented")
        }
        for (const node of roots.toReversed()) {
          const parent = node.parent()
          if (parent === undefined) continue
          for (const sibling of childrenOf(parent).slice((node.index() ?? 0) + 1)) {
            ws.tree.move(sibling.id, node.id, childrenOf(node).length)
          }
          node.moveAfter(parent)
        }
      }),
    MoveBlocks: ({ blockIds, parentId, after }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, blockIds)
        const anchor = after === undefined ? undefined : yield* blockNode(ws, after)
        const first = roots[0]
        const parent =
          parentId !== null
            ? yield* blockNode(ws, parentId)
            : (anchor?.parent() ?? (first === undefined ? undefined : rootOf(first)))
        if (parent === undefined || (parentId === null && !isPage(parent))) {
          return yield* reject("the target position is not on a page")
        }
        if (roots.some((node) => isWithin(parent, node))) {
          return yield* reject("blocks cannot move inside themselves")
        }
        if (anchor !== undefined && (anchor.parent()?.id !== parent.id || roots.some((node) => node.id === anchor.id))) {
          return yield* reject(`block ${after} is not a child of the target parent`)
        }
        roots.reduce<LoroTreeNode | undefined>((previous, node) => {
          if (previous === undefined) ws.tree.move(node.id, parent.id, 0)
          else node.moveAfter(previous)
          return node
        }, anchor)
      }),
    DeleteBlocks: ({ blockIds }) =>
      Effect.map(selection(ws, blockIds), (roots) => roots.forEach((node) => ws.tree.delete(node.id))),
    SetCollapsed: ({ blockId, collapsed }) =>
      Effect.map(blockNode(ws, blockId), (node) => node.data.set("collapsed", collapsed)),
    SetProperty: ({ target, key, value }) =>
      Effect.gen(function* () {
        const node = yield* targetNode(ws, target)
        const props = propsOf(node)
        if (value === null) props.delete(key)
        else props.set(key, value)
        if (!isPage(node)) touch(node, yield* Clock.currentTimeMillis)
      }),
    Undo: () => Effect.sync(() => void ws.undo.undo()),
    Redo: () => Effect.sync(() => void ws.undo.redo()),
  })
