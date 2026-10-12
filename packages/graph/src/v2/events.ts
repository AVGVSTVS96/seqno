import { Option, Schema } from "effect"
import type { LoroEventBatch } from "loro-crdt"
import { PageId, type BlockId, type GraphEvent, type Page } from "@seqno/domain"
import { blockIdOf, isTreeId, readBlock } from "../tree.ts"
import { AT, REF, feeding, isDirectory, keyOf, pageOfTree, parseKey, type Spot } from "./layout.ts"
import {
  homeOf,
  itemOf,
  locate,
  nodeChildren,
  readView,
  treeRoots,
  type Located,
  type Trees,
  type Where,
} from "./outline.ts"

interface Position {
  readonly page: PageId
  readonly parent: BlockId | null
}

export interface Known {
  readonly homes: Map<BlockId, string>
  readonly at: Map<BlockId, Position>
  readonly byPage: Map<PageId, Set<BlockId>>
  readonly pages: Map<PageId, Page>
}

export const emptyKnown = (): Known => ({
  homes: new Map(),
  at: new Map(),
  byPage: new Map(),
  pages: new Map(),
})

const unplace = (known: Known, id: BlockId) => {
  const before = known.at.get(id)
  if (before === undefined) return
  known.at.delete(id)
  known.byPage.get(before.page)?.delete(id)
}

export const place = (known: Known, id: BlockId, home: string, position: Position) => {
  known.homes.set(id, home)
  unplace(known, id)
  known.at.set(id, position)
  const onPage = known.byPage.get(position.page)
  if (onPage === undefined) known.byPage.set(position.page, new Set([id]))
  else onPage.add(id)
}

export const remember = (known: Known, page: PageId, reads: ReturnType<typeof readView>) => {
  for (const read of reads) {
    place(known, read.block.id, keyOf(read.home), { page, parent: read.block.parentId })
  }
}

export interface Pending {
  readonly nodes: Set<string>
  readonly data: Set<string>
  readonly pages: Set<PageId>
}

export const emptyPending = (): Pending => ({ nodes: new Set(), data: new Set(), pages: new Set() })

const decodePageId = Schema.decodeUnknownOption(PageId)

const addPage = (pending: Pending, id: unknown) =>
  Option.map(decodePageId(id), (page) => pending.pages.add(page))

export const collectChanges = (batch: LoroEventBatch, pending: Pending): boolean => {
  let directory = false
  for (const event of batch.events) {
    const [root, below] = event.path
    if (isDirectory(root)) {
      directory = true
      if (below !== undefined) addPage(pending, below)
      else if (event.diff.type === "map")
        Object.keys(event.diff.updated).forEach((id) => addPage(pending, id))
      continue
    }
    const page = pageOfTree(root)
    if (Option.isNone(page)) continue
    if (event.diff.type === "tree") {
      for (const item of event.diff.diff) pending.nodes.add(`${page.value}|${item.target}`)
    } else if (isTreeId(below)) {
      const placing =
        event.path.length === 2 &&
        event.diff.type === "map" &&
        Object.keys(event.diff.updated).every((key) => key === AT || key === REF)
      ;(placing ? pending.nodes : pending.data).add(`${page.value}|${below}`)
    }
  }
  return directory
}

const samePage = (a: Page, b: Page): boolean => JSON.stringify(a) === JSON.stringify(b)

const spotOf = (trees: Trees, key: string): Option.Option<Spot> =>
  Option.flatMap(parseKey(key), ([page, id]) =>
    Option.map(trees.node(page, id), (node) => ({ page, node })),
  )

interface Outcome {
  readonly home: Spot
  readonly id: BlockId
  readonly where: Where
  readonly before: Position | undefined
}

export const translate = (
  trees: Trees,
  pending: Pending,
  known: Known,
): ReadonlyArray<GraphEvent> => {
  const listing = trees.listing()
  const upserts: Array<GraphEvent> = []
  const blocks: Array<GraphEvent> = []
  const deaths: Array<GraphEvent> = []
  const queue: Array<Spot> = []
  const queued = new Set<string>()
  const enqueue = (home: Spot) => {
    const key = keyOf(home)
    if (queued.has(key)) return
    queued.add(key)
    queue.push(home)
  }
  const enqueueTree = (page: PageId) =>
    treeRoots(trees, page).forEach((spot) => enqueue(homeOf(trees, spot)))

  for (const id of pending.pages) {
    const now = listing.live.get(id)
    const before = known.pages.get(id)
    if (now !== undefined) {
      if (before === undefined || !samePage(before, now))
        upserts.push({ _tag: "PageUpserted", page: now })
      known.pages.set(id, now)
    } else if (before !== undefined) {
      known.pages.delete(id)
      deaths.push({ _tag: "PageDeleted", pageId: id })
      for (const block of known.byPage.get(id) ?? []) {
        Option.map(spotOf(trees, known.homes.get(block) ?? ""), enqueue)
      }
    }
    if ((now === undefined) !== (before === undefined) || listing.merged.has(id)) {
      enqueueTree(id)
      feeding(listing, id).forEach(enqueueTree)
    }
  }
  const changed = new Set<string>()
  for (const key of pending.data) {
    Option.map(spotOf(trees, key), (spot) => {
      const home = homeOf(trees, spot)
      changed.add(keyOf(home))
      enqueue(home)
    })
  }
  for (const key of pending.nodes)
    Option.map(spotOf(trees, key), (spot) => enqueue(homeOf(trees, spot)))

  const memo: Located = new Map()
  const outcomes: Array<Outcome> = []
  for (let at = 0; at < queue.length; at++) {
    const home = queue[at]
    if (home === undefined) continue
    const id = blockIdOf(home.node)
    if (Option.isNone(id)) continue
    const where = locate(trees, home, memo)
    const before = known.at.get(id.value)
    outcomes.push({ home, id: id.value, where, before })
    const moved =
      where._tag === "Live"
        ? before === undefined || before.page !== where.page
        : before !== undefined || changed.has(keyOf(home)) || pending.nodes.has(keyOf(home))
    if (!moved) continue
    Option.map(itemOf(trees, home), (item) =>
      nodeChildren(item).forEach((child) => enqueue(homeOf(trees, child))),
    )
  }

  const depth = (outcome: Outcome) =>
    outcome.where._tag === "Live" ? outcome.where.depth : Number.MAX_SAFE_INTEGER
  for (const { home, id, where, before } of outcomes.toSorted((a, b) => depth(a) - depth(b))) {
    const homeKey = keyOf(home)
    if (where._tag !== "Live") {
      if (before === undefined && !changed.has(homeKey) && !pending.nodes.has(homeKey)) continue
      known.homes.set(id, homeKey)
      unplace(known, id)
      blocks.push({ _tag: "BlockDeleted", blockId: id, pageId: before?.page ?? home.page })
      continue
    }
    const position = { page: where.page, parent: where.parentId }
    const read = readBlock(home.node, { pageId: where.page, parentId: where.parentId })
    if (Option.isNone(read)) continue
    place(known, id, homeKey, position)
    if (before === undefined || changed.has(homeKey)) {
      blocks.push({ _tag: "BlockUpserted", ...read.value })
    }
    if (before !== undefined && (before.page !== where.page || before.parent !== where.parentId)) {
      blocks.push({ _tag: "BlockMoved", blockId: id, pageId: where.page, parentId: where.parentId })
    }
  }
  return [...upserts, ...blocks, ...deaths]
}
