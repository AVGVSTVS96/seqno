import { normalizePageName, type Block, type Page } from "@seqno/domain"
import type { PageStat } from "@seqno/rpc"
import { crumbLabel, listValues } from "../pages/model.ts"

export type Item =
  | { readonly _tag: "Create"; readonly title: string }
  | { readonly _tag: "Page"; readonly page: Page }
  | {
      readonly _tag: "Block"
      readonly block: Block
      readonly page: Page
      readonly crumbs: ReadonlyArray<string>
    }

export interface Group {
  readonly id: "create" | "nodes" | "recent"
  readonly title: string | null
  readonly items: ReadonlyArray<Item>
  readonly total: number
}

export interface Hits {
  readonly pages: ReadonlyArray<Page>
  readonly blocks: ReadonlyArray<Block>
  readonly ancestors: ReadonlyArray<Block>
}

export const noHits: Hits = { pages: [], blocks: [], ancestors: [] }

const nodesShown = 10
const recentShown = 5

const terms = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    .filter((term) => term !== "")

const escape = (term: string) => term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

export interface Part {
  readonly text: string
  readonly mark: boolean
}

export const highlight = (text: string, query: string): ReadonlyArray<Part> => {
  const words = terms(query)
  if (words.length === 0) return [{ text, mark: false }]
  const pattern = new RegExp(words.map(escape).join("|"), "giu")
  const parts: Array<Part> = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    if (from > at) parts.push({ text: text.slice(at, from), mark: false })
    parts.push({ text: match[0], mark: true })
    at = from + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: false })
  return parts
}

const crumbsOf = (block: Block, page: Page, ancestors: ReadonlyMap<string, Block>) => {
  const trail: Array<string> = []
  for (
    let at = block.parentId === null ? undefined : ancestors.get(block.parentId);
    at !== undefined;
    at = at.parentId === null ? undefined : ancestors.get(at.parentId)
  ) {
    trail.unshift(crumbLabel(at.text))
  }
  return [page.title, ...trail]
}

export const blockHits = (hits: Hits, pages: ReadonlyArray<Page>) => {
  const byId = new Map(pages.map((page) => [page.id, page]))
  const ancestors = new Map(hits.ancestors.map((block) => [block.id, block]))
  return hits.blocks.flatMap((block) => {
    const page = byId.get(block.pageId)
    return page === undefined ? [] : [{ block, page, crumbs: crumbsOf(block, page, ancestors) }]
  })
}

const matches = (page: Page, words: ReadonlyArray<string>) =>
  words.every((word) => page.title.toLowerCase().includes(word.toLowerCase()))

export const groupsOf = (input: {
  readonly query: string
  readonly hits: Hits
  readonly pages: ReadonlyArray<Page>
  readonly stats: ReadonlyArray<PageStat>
  readonly expanded: ReadonlySet<Group["id"]>
}): ReadonlyArray<Group> => {
  const { query, hits, pages, stats, expanded } = input
  const words = terms(query)
  const name = normalizePageName(query)
  const exists =
    name === "" ||
    pages.some(
      (page) =>
        page.name === name ||
        listValues(page.props["alias"] ?? "").some((alias) => normalizePageName(alias) === name),
    )
  const nodes: ReadonlyArray<Item> = [
    ...hits.pages.map((page): Item => ({ _tag: "Page", page })),
    ...blockHits(hits, pages).map((hit): Item => ({ _tag: "Block", ...hit })),
  ]
  const updated = new Map(stats.map((stat) => [stat.pageId, stat.updated ?? 0]))
  const recent = pages
    .filter((page) => updated.has(page.id) && matches(page, words))
    .toSorted((left, right) => (updated.get(right.id) ?? 0) - (updated.get(left.id) ?? 0))
    .map((page): Item => ({ _tag: "Page", page }))
  const limited = (id: Group["id"], title: string, items: ReadonlyArray<Item>, shown: number) => ({
    id,
    title,
    items: expanded.has(id) ? items : items.slice(0, shown),
    total: items.length,
  })
  return [
    ...(exists
      ? []
      : [
          {
            id: "create",
            title: null,
            items: [{ _tag: "Create", title: query.trim() }],
            total: 1,
          } satisfies Group,
        ]),
    ...(nodes.length === 0 ? [] : [limited("nodes", "Nodes", nodes, nodesShown)]),
    ...(recent.length === 0 ? [] : [limited("recent", "Recently updated", recent, recentShown)]),
  ]
}

export const itemKey = (item: Item) =>
  item._tag === "Create"
    ? "create"
    : item._tag === "Page"
      ? `page:${item.page.id}`
      : `block:${item.block.id}`
