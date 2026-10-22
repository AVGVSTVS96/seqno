import { Clock, Crypto, Data, Effect, Option } from "effect"
import type { LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import {
  Command,
  newBlockId,
  type BlockDraft,
  newPageId,
  normalizePageName,
  type BlockId,
  type Page,
  type PageId,
  type PropertyTarget,
} from "@seqno/domain"
import { CommandRejected } from "@seqno/rpc"
import type { Recorder } from "./history.ts"
import type { Registry } from "./registry.ts"
import {
  childrenOf,
  blockIdOf,
  isCollapsed,
  isTrash,
  makeTrash,
  readPage,
  readProps,
  textOf,
  writeBlock,
  writePage,
  writeProps,
} from "./tree.ts"

export class Unresolved extends Data.TaggedError("Unresolved")<{ readonly id: BlockId }> {}

export interface Places {
  readonly tree: LoroTree
  readonly registry: Registry
}

export interface Workspace extends Places {
  readonly record: Recorder
  readonly undo: () => void
  readonly redo: () => void
}

const reject = (reason: string) => Effect.fail(new CommandRejected({ reason }))

const live = (tree: LoroTree, id: TreeID | undefined): Option.Option<LoroTreeNode> =>
  id === undefined || tree.isNodeDeleted(id)
    ? Option.none()
    : Option.fromUndefinedOr(tree.getNodeByID(id))

const ancestors = (node: LoroTreeNode): ReadonlyArray<LoroTreeNode> => {
  const parent = node.parent()
  return parent === undefined ? [] : [parent, ...ancestors(parent)]
}

const rootOf = (node: LoroTreeNode): LoroTreeNode => ancestors(node).at(-1) ?? node

const blockNode = (
  ws: Places,
  id: BlockId,
): Effect.Effect<LoroTreeNode, CommandRejected | Unresolved> => {
  const known = ws.registry.blocks.get(id)
  return known === undefined
    ? Effect.fail(new Unresolved({ id }))
    : Option.match(
        Option.filter(live(ws.tree, known), (node) => !isTrash(rootOf(node))),
        {
          onNone: () => reject(`block ${id} was deleted`),
          onSome: (node) => Effect.succeed(node),
        },
      )
}

export const trashOf = (ws: Places): LoroTreeNode => {
  const known = Option.getOrUndefined(live(ws.tree, ws.registry.trash))
  if (known !== undefined) return known
  const found =
    ws.tree.roots().find((root) => !ws.tree.isNodeDeleted(root.id) && isTrash(root)) ??
    makeTrash(ws.tree)
  ws.registry.trash = found.id
  return found
}

const touch = (ws: Workspace, node: LoroTreeNode) =>
  Effect.map(Clock.currentTimeMillis, (now) => ws.record.set(node.data, "updated", now))

const pageNode = (ws: Workspace, id: PageId): Effect.Effect<LoroTreeNode, CommandRejected> =>
  Option.match(live(ws.tree, ws.registry.pages.get(id)), {
    onNone: () => reject(`page ${id} does not exist`),
    onSome: (node) => Effect.succeed(node),
  })

const isWithin = (node: LoroTreeNode, ancestor: LoroTreeNode): boolean =>
  node.id === ancestor.id || ancestors(node).some((up) => up.id === ancestor.id)

const position = (node: LoroTreeNode): ReadonlyArray<number> =>
  [node, ...ancestors(node)].map((at) => at.index() ?? 0).toReversed()

const byPosition = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): number => {
  const differs = left.findIndex((index, depth) => index !== right[depth])
  return differs === -1 ? left.length - right.length : (left[differs] ?? 0) - (right[differs] ?? 0)
}

const selection = (ws: Workspace, ids: ReadonlyArray<BlockId>) =>
  Effect.map(
    Effect.forEach(ids, (id) => blockNode(ws, id)),
    (nodes) => {
      const chosen = new Map(nodes.map((node) => [node.id, node]))
      return [...chosen.values()]
        .filter((node) => !ancestors(node).some((up) => chosen.has(up.id)))
        .map((node) => ({ node, at: position(node) }))
        .toSorted((a, b) => byPosition(a.at, b.at))
        .map(({ node }) => node)
    },
  )

const isPage = (node: LoroTreeNode): boolean => node.parent() === undefined

const pageTaken = (ws: Workspace, taken: (page: Page) => boolean, except?: TreeID): boolean =>
  ws.tree
    .roots()
    .some(
      (root) =>
        root.id !== except &&
        !ws.tree.isNodeDeleted(root.id) &&
        Option.exists(readPage(root), taken),
    )

const nameTaken = (ws: Workspace, title: string, except?: TreeID): boolean => {
  const name = normalizePageName(title)
  return pageTaken(ws, (page) => page.name === name, except)
}

const checkTitle = (ws: Workspace, title: string, except?: TreeID) =>
  normalizePageName(title) === ""
    ? reject("a page title cannot be empty")
    : nameTaken(ws, title, except)
      ? reject(`a page named "${normalizePageName(title)}" already exists`)
      : Effect.void

const createBlock = (ws: Workspace, parent: LoroTreeNode, index: number, text: string) =>
  Effect.gen(function* () {
    const id = yield* Effect.orDie(newBlockId)
    const now = yield* Clock.currentTimeMillis
    writeBlock(ws.record.create(parent, index), id, text, now)
  })

const createTree = (
  ws: Workspace,
  parent: LoroTreeNode,
  index: number,
  draft: BlockDraft,
): Effect.Effect<void, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const id = yield* Effect.orDie(newBlockId)
    const now = yield* Clock.currentTimeMillis
    const node = ws.record.create(parent, index)
    writeBlock(node, id, draft.text, now)
    writeProps(node.data, draft.props)
    yield* Effect.forEach(draft.children, (child, at) => createTree(ws, node, at, child), {
      discard: true,
    })
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

const mergeTarget = (node: LoroTreeNode): LoroTreeNode | undefined => {
  const parent = node.parent()
  const previous = childrenOf(parent ?? node)[(node.index() ?? 0) - 1]
  const target = previous === undefined ? parent : lastVisible(previous)
  return target === undefined || isPage(target) ? undefined : target
}

export const mergeTargetOf = (ws: Places, id: BlockId) =>
  Effect.map(blockNode(ws, id), (node) =>
    Option.flatMap(Option.fromUndefinedOr(mergeTarget(node)), blockIdOf),
  )

const targetNode = (ws: Workspace, target: PropertyTarget) =>
  target._tag === "BlockTarget" ? blockNode(ws, target.blockId) : pageNode(ws, target.pageId)

export const applyCommand = (ws: Workspace, command: Command) =>
  Command.match(command, {
    CreatePage: ({ title, journalDay, props }) =>
      Effect.gen(function* () {
        yield* checkTitle(ws, title)
        if (journalDay !== undefined && pageTaken(ws, (page) => page.journalDay === journalDay)) {
          return yield* reject("a journal for that day already exists")
        }
        const id = yield* Effect.orDie(newPageId)
        const root = ws.record.create(undefined)
        writePage(root, id, title)
        if (journalDay !== undefined) root.data.set("journalDay", journalDay)
        Object.entries(props ?? {}).forEach(([key, value]) => ws.record.prop(root.data, key, value))
      }),
    RenamePage: ({ pageId, title }) =>
      Effect.gen(function* () {
        const page = yield* pageNode(ws, pageId)
        yield* checkTitle(ws, title, page.id)
        ws.record.set(page.data, "title", title)
      }),
    DeletePage: ({ pageId }) => Effect.map(pageNode(ws, pageId), (page) => ws.record.trash(page)),
    InsertBlock: ({ pageId, parentId, after, text }) =>
      Effect.gen(function* () {
        const page = yield* pageNode(ws, pageId)
        const parent = parentId === null ? page : yield* blockNode(ws, parentId)
        if (rootOf(parent).id !== page.id) {
          return yield* reject(`block ${parentId} is not on page ${pageId}`)
        }
        yield* createBlock(ws, parent, yield* childAfter(ws, parent, after), text)
      }),
    InsertBlocks: ({ pageId, parentId, after, blocks }) =>
      Effect.gen(function* () {
        const page = yield* pageNode(ws, pageId)
        const parent = parentId === null ? page : yield* blockNode(ws, parentId)
        if (rootOf(parent).id !== page.id) {
          return yield* reject(`block ${parentId} is not on page ${pageId}`)
        }
        const start = yield* childAfter(ws, parent, after)
        yield* Effect.forEach(blocks, (draft, at) => createTree(ws, parent, start + at, draft), {
          discard: true,
        })
      }),
    EditText: ({ blockId, from, to, insert }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        if (from > to || to > textOf(node.data).length) {
          return yield* reject(`range ${from}-${to} is outside the block text`)
        }
        ws.record.edit(node.data, from, to - from, insert)
        yield* touch(ws, node)
      }),
    SplitBlock: ({ blockId, at }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        const text = textOf(node.data)
        const parent = node.parent()
        const index = node.index() ?? 0
        if (at > text.length || parent === undefined) {
          return yield* reject(`offset ${at} is outside the block text`)
        }
        if (at === 0 && text.length > 0) return yield* createBlock(ws, parent, index, "")
        const tail = text.slice(at, text.length)
        ws.record.edit(node.data, at, text.length - at, "")
        yield* touch(ws, node)
        const nests = childrenOf(node).length > 0 && !isCollapsed(node)
        yield* nests ? createBlock(ws, node, 0, tail) : createBlock(ws, parent, index + 1, tail)
      }),
    MergeWithPrevious: ({ blockId }) =>
      Effect.gen(function* () {
        const node = yield* blockNode(ws, blockId)
        const parent = node.parent()
        const target = mergeTarget(node)
        if (target === undefined) {
          return yield* reject("the first block of a page has nothing to merge into")
        }
        ws.record.edit(target.data, textOf(target.data).length, 0, textOf(node.data).toString())
        const kept = readProps(target.data)
        Object.entries(readProps(node.data))
          .filter(([key]) => !(key in kept))
          .forEach(([key, value]) => ws.record.prop(target.data, key, value))
        for (const child of childrenOf(node)) {
          if (target.id === parent?.id) ws.record.moveBefore(child, node)
          else ws.record.move(child, target, ws.record.children(target).length)
        }
        ws.record.trash(node)
        yield* touch(ws, target)
      }),
    Indent: ({ blockIds }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, blockIds)
        if (roots.some((node) => (node.index() ?? 0) === 0)) {
          return yield* reject("a block without a previous sibling cannot be indented")
        }
        for (const node of roots) {
          const previous = ws.record.children(node.parent() ?? node)[(node.index() ?? 0) - 1]
          if (previous !== undefined) {
            ws.record.move(node, previous, ws.record.children(previous).length)
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
          for (const sibling of ws.record.children(parent).slice((node.index() ?? 0) + 1)) {
            ws.record.move(sibling, node, ws.record.children(node).length)
          }
          ws.record.moveAfter(node, parent)
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
        if (
          anchor !== undefined &&
          (anchor.parent()?.id !== parent.id || roots.some((node) => node.id === anchor.id))
        ) {
          return yield* reject(`block ${after} is not a child of the target parent`)
        }
        roots.reduce<LoroTreeNode | undefined>((previous, node) => {
          if (previous === undefined) ws.record.move(node, parent, 0)
          else ws.record.moveAfter(node, previous)
          return node
        }, anchor)
      }),
    DeleteBlocks: ({ blockIds }) =>
      Effect.map(selection(ws, blockIds), (roots) => roots.forEach(ws.record.trash)),
    SetCollapsed: ({ blockId, collapsed }) =>
      Effect.map(blockNode(ws, blockId), (node) =>
        ws.record.set(node.data, "collapsed", collapsed),
      ),
    SetProperty: ({ target, key, value }) =>
      Effect.gen(function* () {
        const node = yield* targetNode(ws, target)
        ws.record.prop(node.data, key, value)
        if (!isPage(node)) yield* touch(ws, node)
      }),
    Undo: () => Effect.sync(ws.undo),
    Redo: () => Effect.sync(ws.redo),
  })
