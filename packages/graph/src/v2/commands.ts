import { Clock, Crypto, Effect, Option } from "effect"
import type { LoroTreeNode } from "loro-crdt"
import {
  Command,
  newBlockId,
  newPageId,
  normalizePageName,
  type BlockDraft,
  type BlockId,
  type PageId,
} from "@seqno/domain"
import { CommandRejected } from "@seqno/rpc"
import { Unresolved } from "../commands.ts"
import type { Recorder } from "../history.ts"
import { isCollapsed, readProps, textOf, writeBlock, writeProps } from "../tree.ts"
import {
  AT,
  REF,
  ensurePageData,
  journalPageId,
  parseKey,
  resolvePage,
  spotOf,
  type Spot,
} from "./layout.ts"
import {
  homeOf,
  isShown,
  itemOf,
  placementOf,
  locate,
  nodeChildren,
  pageTrees,
  sameSpot,
  type Item,
  type Located,
  type Trees,
} from "./outline.ts"

export interface Homes {
  readonly home: (id: BlockId) => Option.Option<string>
  readonly onPage: (page: PageId) => ReadonlyMap<string, BlockId>
}

export interface Workspace {
  readonly trees: Trees
  readonly homes: Homes
  readonly record: (page: PageId) => Recorder
  readonly undo: () => void
  readonly redo: () => void
}

type Parent =
  | { readonly _tag: "Page"; readonly page: PageId }
  | { readonly _tag: "Block"; readonly item: Item }

interface Slot {
  readonly page: PageId
  readonly parent: LoroTreeNode | undefined
  readonly before: LoroTreeNode | undefined
  readonly after: LoroTreeNode | undefined
}

const reject = (reason: string) => Effect.fail(new CommandRejected({ reason }))

const parentKey = (parent: Parent): string =>
  parent._tag === "Page" ? `page:${parent.page}` : `block:${parent.item.key}`

const shownItem = (trees: Trees, spot: Spot): Option.Option<Item> => {
  const home = homeOf(trees, spot)
  return Option.map(trees.facts(home).id, (id) => ({ id, key: home.key, home, at: spot }))
}

const sameItem = (a: Item, b: Item): boolean => a.key === b.key

const GROUP = 2 ** 40

interface Siblings {
  readonly items: Array<Item>
  readonly rank: (item: Item) => number
}

const NEAR = 8

const indexIn = ({ items, rank }: Siblings, item: Item): number => {
  const target = rank(item)
  const top = Math.min(target % GROUP, items.length - 1)
  for (let at = top; at >= 0 && at > top - NEAR; at--) {
    if (items[at]?.key === item.key) return at
  }
  let low = 0
  let high = items.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const found = items[middle]
    if (found === undefined) break
    const at = rank(found)
    if (at === target)
      return found.key === item.key ? middle : items.findIndex((one) => sameItem(one, item))
    if (at < target) low = middle + 1
    else high = middle - 1
  }
  return items.findIndex((one) => sameItem(one, item))
}

const indexOfSlot = (slot: Slot): number =>
  slot.after !== undefined
    ? (slot.after.index() ?? 0) + 1
    : slot.before !== undefined
      ? (slot.before.index() ?? 0)
      : 0

export interface Lookup {
  readonly trees: Trees
  readonly homes: Homes
}

const rankIn = (trees: Trees, parent: Parent): ((item: Item) => number) => {
  if (parent._tag === "Block") {
    const home = parent.item.home.page
    return (item) => (item.at.page === home ? 0 : GROUP) + (item.at.node.index() ?? 0)
  }
  const order = new Map(pageTrees(trees, parent.page).map((page, at) => [page, at]))
  return (item) => (order.get(item.at.page) ?? order.size) * GROUP + (item.at.node.index() ?? 0)
}

const reader = ({ trees, homes }: Lookup) => {
  const lists = new Map<string, Siblings>()
  const ranks = new Map<string, (item: Item) => number>()

  const rankFor = (parent: Parent) => {
    const key = parentKey(parent)
    const known = ranks.get(key)
    if (known !== undefined) return known
    const made = rankIn(trees, parent)
    ranks.set(key, made)
    return made
  }

  const rankOf = (parent: Parent, item: Item): number => rankFor(parent)(item)

  const shown = (spot: Spot): ReadonlyArray<Item> =>
    isShown(trees, spot) ? Option.toArray(shownItem(trees, spot)) : []

  const rootsOf = (page: PageId): ReadonlyArray<Item> => {
    const seen = homes.onPage(page)
    return pageTrees(trees, page).flatMap((own) =>
      trees
        .tree(own)
        .roots()
        .flatMap((node) => {
          const spot = spotOf(own, node)
          const id = seen.get(spot.key)
          return id === undefined || trees.moved(spot)
            ? shown(spot)
            : [{ id, key: spot.key, home: spot, at: spot }]
        }),
    )
  }

  const siblings = (parent: Parent): Siblings => {
    const key = parentKey(parent)
    const known = lists.get(key)
    if (known !== undefined) return known
    const made = {
      items: [
        ...(parent._tag === "Page"
          ? rootsOf(parent.page)
          : nodeChildren(parent.item).flatMap(shown)),
      ],
      rank: rankFor(parent),
    }
    lists.set(key, made)
    return made
  }

  const children = (parent: Parent): Array<Item> => siblings(parent).items

  const indexOf = (parent: Parent, item: Item): number => indexIn(siblings(parent), item)

  const parentOf = (item: Item): Parent => {
    const above = item.at.node.parent()
    if (above === undefined) {
      return {
        _tag: "Page",
        page: Option.getOrElse(resolvePage(trees.listing(), item.at.page), () => item.at.page),
      }
    }
    const home = homeOf(trees, spotOf(item.at.page, above))
    return Option.match(itemOf(trees, home), {
      onNone: (): Parent => ({ _tag: "Page", page: item.at.page }),
      onSome: (found): Parent => ({ _tag: "Block", item: found }),
    })
  }

  return { lists, children, parentOf, indexOf, rankOf }
}

export const outliner = (ws: Workspace) => {
  const { trees } = ws
  const { lists, children, parentOf, indexOf, rankOf } = reader(ws)

  const forget = (item: Item): boolean => {
    const list = lists.get(parentKey(parentOf(item)))
    const at = list === undefined ? -1 : indexIn(list, item)
    if (at !== -1) list?.items.splice(at, 1)
    return at !== -1
  }

  const slotIn = (parent: Parent, index: number, moving: Item | undefined): Slot => {
    const all = children(parent)
    const skip = moving === undefined ? -1 : indexOf(parent, moving)
    const count = all.length - (skip === -1 ? 0 : 1)
    const nth = (at: number) => all[skip !== -1 && at >= skip ? at + 1 : at]
    const previous = index <= 0 ? undefined : nth(Math.min(index, count) - 1)
    if (previous !== undefined) {
      return {
        page: previous.at.page,
        parent: previous.at.node.parent(),
        before: undefined,
        after: previous.at.node,
      }
    }
    const first = count === 0 ? undefined : nth(0)
    if (first !== undefined) {
      return {
        page: first.at.page,
        parent: first.at.node.parent(),
        before: first.at.node,
        after: undefined,
      }
    }
    return parent._tag === "Page"
      ? { page: parent.page, parent: undefined, before: undefined, after: undefined }
      : {
          page: parent.item.home.page,
          parent: parent.item.home.node,
          before: undefined,
          after: undefined,
        }
  }

  const unblock = (node: LoroTreeNode, slot: Slot) => {
    const chain: Array<LoroTreeNode> = []
    for (let at = slot.parent; at !== undefined; at = at.parent()) {
      if (at.id === node.id) {
        const stale = chain.find((one) => !isShown(trees, spotOf(slot.page, one)))
        if (stale !== undefined) trees.tree(slot.page).move(stale.id, trees.trash(slot.page).id, 0)
        return
      }
      chain.push(at)
    }
  }

  const moveInto = (record: Recorder, node: LoroTreeNode, slot: Slot) => {
    unblock(node, slot)
    if (slot.after !== undefined) record.moveAfter(node, slot.after)
    else if (slot.before !== undefined) record.moveBefore(node, slot.before)
    else record.move(node, slot.parent, 0)
  }

  const remember = (parent: Parent, index: number, item: Item) => {
    const list = lists.get(parentKey(parent))?.items
    list?.splice(Math.min(Math.max(index, 0), list.length), 0, item)
  }

  const place = (item: Item, parent: Parent, index: number): Item => {
    const slot = slotIn(parent, index, forget(item) ? undefined : item)
    const record = ws.record(slot.page)
    const placed = ((): Item => {
      if (slot.page === item.home.page) {
        moveInto(record, item.home.node, slot)
        if (!sameSpot(item.at, item.home)) {
          ws.record(item.at.page).trash(item.at.node)
          ws.record(item.home.page).set(item.home.node.data, AT, undefined)
        }
        return { ...item, at: item.home }
      }
      if (!sameSpot(item.at, item.home) && item.at.page === slot.page) {
        moveInto(record, item.at.node, slot)
        return item
      }
      const node = record.create(slot.parent, indexOfSlot(slot))
      node.data.set(REF, item.home.key)
      const at = spotOf(slot.page, node)
      ws.record(item.home.page).set(item.home.node.data, AT, at.key)
      trees.markMoved(item.home)
      ws.record(item.at.page).trash(item.at.node)
      return { ...item, at }
    })()
    remember(parent, index, placed)
    return placed
  }

  const trash = (item: Item) => {
    forget(item)
    ws.record(item.at.page).trash(item.at.node)
  }

  const create = (parent: Parent, index: number): Effect.Effect<Item, never, Crypto.Crypto> =>
    Effect.gen(function* () {
      const id = yield* Effect.orDie(newBlockId)
      const slot = slotIn(parent, index, undefined)
      const node = ws.record(slot.page).create(slot.parent, indexOfSlot(slot))
      const spot = spotOf(slot.page, node)
      const item = { id, key: spot.key, home: spot, at: spot }
      remember(parent, index, item)
      return item
    })

  return { children, parentOf, indexOf, rankOf, place, trash, create }
}

type Outliner = Pick<ReturnType<typeof reader>, "children" | "parentOf" | "indexOf" | "rankOf">

type Writer = ReturnType<typeof outliner>

const touch = (ws: Workspace, item: Item) =>
  Effect.map(Clock.currentTimeMillis, (now) =>
    ws.record(item.home.page).set(item.home.node.data, "updated", now),
  )

const blockItem = (
  ws: Lookup,
  id: BlockId,
  memo: Located = new Map(),
): Effect.Effect<Item, CommandRejected | Unresolved> =>
  Option.match(ws.homes.home(id), {
    onNone: () => Effect.fail(new Unresolved({ id })),
    onSome: (key) => {
      const found = Option.flatMap(parseKey(key), ([page, node]) =>
        Option.map(ws.trees.node(page, node), (at): Item => {
          const home = { page, node: at, key }
          return { id, key, home, at: placementOf(ws.trees, home) }
        }),
      )
      return Option.match(
        Option.filter(found, (item) => locate(ws.trees, item.home, memo)._tag === "Live"),
        {
          onNone: () => reject(`block ${id} was deleted`),
          onSome: (item) => Effect.succeed(item),
        },
      )
    },
  })

const livePage = (ws: Lookup, id: PageId) =>
  ws.trees.listing().live.has(id) ? Effect.succeed(id) : reject(`page ${id} does not exist`)

const pageOfItem = (ws: Lookup, item: Item): Option.Option<PageId> => {
  const where = locate(ws.trees, item.home)
  return where._tag === "Live" ? Option.some(where.page) : Option.none()
}

const checkTitle = (ws: Workspace, title: string, except?: PageId) => {
  const name = normalizePageName(title)
  if (name === "") return reject("a page title cannot be empty")
  const taken = [...ws.trees.listing().live.values()].some(
    (page) => page.id !== except && page.name === name,
  )
  return taken ? reject(`a page named "${name}" already exists`) : Effect.void
}

const ancestors = (out: Outliner, item: Item): ReadonlyArray<Item> => {
  const found: Array<Item> = []
  for (
    let parent = out.parentOf(item);
    parent._tag === "Block";
    parent = out.parentOf(parent.item)
  ) {
    if (found.some((seen) => sameItem(seen, parent.item))) break
    found.push(parent.item)
  }
  return found
}

const position = (out: Outliner, item: Item): ReadonlyArray<number> => {
  const path: Array<number> = []
  let at = item
  for (let depth = 0; depth < 1000; depth++) {
    const parent = out.parentOf(at)
    path.push(out.rankOf(parent, at))
    if (parent._tag === "Page") break
    at = parent.item
  }
  return path.toReversed()
}

const byPosition = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): number => {
  const differs = left.findIndex((index, depth) => index !== right[depth])
  return differs === -1 ? left.length - right.length : (left[differs] ?? 0) - (right[differs] ?? 0)
}

const selection = (ws: Workspace, out: Outliner, ids: ReadonlyArray<BlockId>) => {
  const memo: Located = new Map()
  return Effect.map(
    Effect.forEach(ids, (id) => blockItem(ws, id, memo)),
    (items) => {
      const chosen = new Map(items.map((item) => [item.key, item]))
      return [...chosen.values()]
        .filter((item) => !ancestors(out, item).some((up) => chosen.has(up.key)))
        .map((item) => ({ item, at: position(out, item) }))
        .toSorted((a, b) => byPosition(a.at, b.at))
        .map(({ item }) => item)
    },
  )
}

const createBlock = (out: Writer, parent: Parent, index: number, text: string) =>
  Effect.gen(function* () {
    const item = yield* out.create(parent, index)
    writeBlock(item.home.node, item.id, text, yield* Clock.currentTimeMillis)
  })

const createTree = (
  ws: Workspace,
  node: LoroTreeNode,
  page: PageId,
  draft: BlockDraft,
): Effect.Effect<void, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const id = yield* Effect.orDie(newBlockId)
    writeBlock(node, id, draft.text, yield* Clock.currentTimeMillis)
    writeProps(node.data, draft.props)
    yield* Effect.forEach(
      draft.children,
      (child, at) => createTree(ws, ws.record(page).create(node, at), page, child),
      { discard: true },
    )
  })

const lastVisible = (out: Outliner, item: Item): Item => {
  const last = out.children({ _tag: "Block", item }).at(-1)
  return last === undefined || isCollapsed(item.home.node) ? item : lastVisible(out, last)
}

const mergeTarget = (out: Outliner, item: Item): Item | undefined => {
  const parent = out.parentOf(item)
  const previous = out.children(parent)[out.indexOf(parent, item) - 1]
  if (previous !== undefined) return lastVisible(out, previous)
  return parent._tag === "Block" ? parent.item : undefined
}

export const mergeTargetOf = (ws: Lookup, id: BlockId) =>
  Effect.map(blockItem(ws, id), (item) =>
    Option.map(Option.fromUndefinedOr(mergeTarget(reader(ws), item)), (target) => target.id),
  )

const childAfter = (ws: Workspace, out: Outliner, parent: Parent, after: BlockId | undefined) =>
  after === undefined
    ? Effect.succeed(0)
    : Effect.flatMap(blockItem(ws, after), (sibling) => {
        const at = out.indexOf(parent, sibling)
        return at === -1
          ? reject(`block ${after} is not a child of the target parent`)
          : Effect.succeed(at + 1)
      })

const parentFor = (ws: Workspace, pageId: PageId, parentId: BlockId | null) =>
  Effect.gen(function* () {
    yield* livePage(ws, pageId)
    if (parentId === null) return { _tag: "Page", page: pageId } satisfies Parent
    const item = yield* blockItem(ws, parentId)
    if (!Option.contains(pageOfItem(ws, item), pageId)) {
      return yield* reject(`block ${parentId} is not on page ${pageId}`)
    }
    return { _tag: "Block", item } satisfies Parent
  })

export const applyCommand = (
  ws: Workspace,
  out: Writer,
  command: Command,
): Effect.Effect<void, CommandRejected | Unresolved, Crypto.Crypto> =>
  Command.match(command, {
    CreatePage: ({ title, journalDay, props }) =>
      Effect.gen(function* () {
        yield* checkTitle(ws, title)
        const { dir } = ws.trees
        const withProps = (id: PageId) =>
          Object.entries(props ?? {}).forEach(([key, value]) =>
            ws.record(id).prop(ensurePageData(dir, id), key, value),
          )
        if (journalDay === undefined) {
          const id = yield* Effect.orDie(newPageId)
          ws.record(id).set(dir.titles, id, title)
          return withProps(id)
        }
        const { live, trashed, titled } = ws.trees.listing()
        const id = journalPageId(journalDay)
        if (
          [...live.values()].some((page) => page.journalDay === journalDay) ||
          (titled.has(id) && !trashed.has(id))
        ) {
          return yield* reject("a journal for that day already exists")
        }
        const record = ws.record(id)
        if (trashed.has(id)) {
          record.set(dir.trashed, id, undefined)
          out.children({ _tag: "Page", page: id }).toReversed().forEach(out.trash)
        }
        record.set(dir.titles, id, title)
        record.set(dir.days, id, journalDay)
        withProps(id)
      }),
    RenamePage: ({ pageId, title }) =>
      Effect.gen(function* () {
        yield* livePage(ws, pageId)
        yield* checkTitle(ws, title, pageId)
        ws.record(pageId).set(ws.trees.dir.titles, pageId, title)
      }),
    DeletePage: ({ pageId }) =>
      Effect.map(livePage(ws, pageId), () =>
        ws.record(pageId).set(ws.trees.dir.trashed, pageId, true),
      ),
    InsertBlock: ({ pageId, parentId, after, text }) =>
      Effect.gen(function* () {
        const parent = yield* parentFor(ws, pageId, parentId)
        yield* createBlock(out, parent, yield* childAfter(ws, out, parent, after), text)
      }),
    InsertBlocks: ({ pageId, parentId, after, blocks }) =>
      Effect.gen(function* () {
        const parent = yield* parentFor(ws, pageId, parentId)
        const start = yield* childAfter(ws, out, parent, after)
        yield* Effect.forEach(
          blocks,
          (draft, at) =>
            Effect.flatMap(out.create(parent, start + at), (item) =>
              createTree(ws, item.home.node, item.home.page, draft),
            ),
          { discard: true },
        )
      }),
    EditText: ({ blockId, from, to, insert }) =>
      Effect.gen(function* () {
        const item = yield* blockItem(ws, blockId)
        const data = item.home.node.data
        if (from > to || to > textOf(data).length) {
          return yield* reject(`range ${from}-${to} is outside the block text`)
        }
        ws.record(item.home.page).edit(data, from, to - from, insert)
        yield* touch(ws, item)
      }),
    SplitBlock: ({ blockId, at }) =>
      Effect.gen(function* () {
        const item = yield* blockItem(ws, blockId)
        const data = item.home.node.data
        const text = textOf(data)
        if (at > text.length) return yield* reject(`offset ${at} is outside the block text`)
        const parent = out.parentOf(item)
        const index = out.indexOf(parent, item)
        if (at === 0 && text.length > 0) return yield* createBlock(out, parent, index, "")
        const tail = text.slice(at, text.length)
        ws.record(item.home.page).edit(data, at, text.length - at, "")
        yield* touch(ws, item)
        const own: Parent = { _tag: "Block", item }
        const nests = out.children(own).length > 0 && !isCollapsed(item.home.node)
        yield* nests ? createBlock(out, own, 0, tail) : createBlock(out, parent, index + 1, tail)
      }),
    MergeWithPrevious: ({ blockId }) =>
      Effect.gen(function* () {
        const item = yield* blockItem(ws, blockId)
        const parent = out.parentOf(item)
        const target = mergeTarget(out, item)
        if (target === undefined) {
          return yield* reject("the first block of a page has nothing to merge into")
        }
        const into = target.home.node.data
        const record = ws.record(target.home.page)
        record.edit(into, textOf(into).length, 0, textOf(item.home.node.data).toString())
        const kept = readProps(into)
        Object.entries(readProps(item.home.node.data))
          .filter(([key]) => !(key in kept))
          .forEach(([key, value]) => record.prop(into, key, value))
        const own: Parent = { _tag: "Block", item }
        const intoParent = parent._tag === "Block" && sameItem(parent.item, target)
        for (const child of out.children(own).slice()) {
          if (intoParent) out.place(child, parent, out.indexOf(parent, item))
          else {
            const under: Parent = { _tag: "Block", item: target }
            out.place(child, under, out.children(under).length)
          }
        }
        out.trash(item)
        yield* touch(ws, target)
      }),
    Indent: ({ blockIds }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, out, blockIds)
        if (roots.some((item) => out.indexOf(out.parentOf(item), item) === 0)) {
          return yield* reject("a block without a previous sibling cannot be indented")
        }
        for (const item of roots) {
          const parent = out.parentOf(item)
          const previous = out.children(parent)[out.indexOf(parent, item) - 1]
          if (previous === undefined) continue
          const under: Parent = { _tag: "Block", item: previous }
          out.place(item, under, out.children(under).length)
        }
      }),
    Outdent: ({ blockIds }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, out, blockIds)
        if (roots.some((item) => out.parentOf(item)._tag === "Page")) {
          return yield* reject("a top-level block cannot be outdented")
        }
        for (const item of roots.toReversed()) {
          const parent = out.parentOf(item)
          if (parent._tag !== "Block") continue
          const own: Parent = { _tag: "Block", item }
          for (const sibling of out.children(parent).slice(out.indexOf(parent, item) + 1)) {
            out.place(sibling, own, out.children(own).length)
          }
          const above = out.parentOf(parent.item)
          out.place(item, above, out.indexOf(above, parent.item) + 1)
        }
      }),
    MoveBlocks: ({ blockIds, parentId, after }) =>
      Effect.gen(function* () {
        const roots = yield* selection(ws, out, blockIds)
        const anchor = after === undefined ? undefined : yield* blockItem(ws, after)
        const first = roots[0]
        const target: Parent | undefined =
          parentId !== null
            ? { _tag: "Block", item: yield* blockItem(ws, parentId) }
            : anchor !== undefined
              ? out.parentOf(anchor)
              : first === undefined
                ? undefined
                : Option.match(pageOfItem(ws, first), {
                    onNone: () => undefined,
                    onSome: (page): Parent => ({ _tag: "Page", page }),
                  })
        if (target === undefined || (parentId === null && target._tag !== "Page")) {
          return yield* reject("the target position is not on a page")
        }
        if (
          target._tag === "Block" &&
          roots.some(
            (item) =>
              sameItem(item, target.item) ||
              ancestors(out, target.item).some((up) => sameItem(up, item)),
          )
        ) {
          return yield* reject("blocks cannot move inside themselves")
        }
        if (
          anchor !== undefined &&
          (out.indexOf(target, anchor) === -1 || roots.some((item) => sameItem(item, anchor)))
        ) {
          return yield* reject(`block ${after} is not a child of the target parent`)
        }
        roots.reduce<Item | undefined>((previous, item) => {
          if (previous === undefined) return out.place(item, target, 0)
          const before = out.indexOf(target, previous)
          const moving = out.indexOf(target, item)
          return out.place(item, target, before + (moving !== -1 && moving < before ? 0 : 1))
        }, anchor)
      }),
    DeleteBlocks: ({ blockIds }) =>
      Effect.map(selection(ws, out, blockIds), (roots) => roots.forEach(out.trash)),
    SetCollapsed: ({ blockId, collapsed }) =>
      Effect.map(blockItem(ws, blockId), (item) =>
        ws.record(item.home.page).set(item.home.node.data, "collapsed", collapsed),
      ),
    SetProperty: ({ target, key, value }) =>
      target._tag === "BlockTarget"
        ? Effect.gen(function* () {
            const item = yield* blockItem(ws, target.blockId)
            ws.record(item.home.page).prop(item.home.node.data, key, value)
            yield* touch(ws, item)
          })
        : Effect.map(livePage(ws, target.pageId), (page) =>
            ws.record(page).prop(ensurePageData(ws.trees.dir, page), key, value),
          ),
    Undo: () => Effect.sync(ws.undo),
    Redo: () => Effect.sync(ws.redo),
  })
