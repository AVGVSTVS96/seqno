import { Schema } from "effect"
import type { Block, BlockId, Page, PageId } from "@seqno/domain"
import type { PageStat, ReferencedPage, Reference } from "@seqno/rpc"

export const SortColumn = Schema.Literals(["title", "backlinks", "created", "updated"])
export type SortColumn = typeof SortColumn.Type

export const TableSort = Schema.Struct({
  column: SortColumn,
  descending: Schema.Boolean,
})
export type TableSort = typeof TableSort.Type

export interface ReferenceGroup {
  readonly pageId: PageId
  readonly blockIds: ReadonlyArray<BlockId>
}

export const groupByPage = (
  references: ReadonlyArray<Reference>,
): ReadonlyArray<ReferenceGroup> => {
  const groups = new Map<PageId, Array<BlockId>>()
  for (const { pageId, blockId } of references) {
    const group = groups.get(pageId)
    if (group === undefined) groups.set(pageId, [blockId])
    else group.push(blockId)
  }
  return [...groups].map(([pageId, blockIds]) => ({ pageId, blockIds }))
}

export const trailOf = (blocks: ReadonlyArray<Block>) => {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const parentOf = (block: Block | undefined) =>
    block?.parentId == null ? undefined : byId.get(block.parentId)
  return (blockId: BlockId): ReadonlyArray<Block> => {
    const trail: Array<Block> = []
    for (let at = parentOf(byId.get(blockId)); at !== undefined; at = parentOf(at)) {
      trail.unshift(at)
    }
    return trail
  }
}

export const outermost = (
  blockIds: ReadonlyArray<BlockId>,
  trail: (blockId: BlockId) => ReadonlyArray<Block>,
): ReadonlyArray<BlockId> => {
  const chosen = new Set(blockIds)
  return blockIds.filter((id) => !trail(id).some((parent) => chosen.has(parent.id)))
}

const markup: ReadonlyArray<readonly [RegExp, string]> = [
  [/#\[\[([^\]]*)\]\]/g, "#$1"],
  [/\[\[([^\]]*)\]\]/g, "$1"],
  [/\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/(\*\*|__|~~|==|\^\^|`)/g, ""],
  [/^#{1,6}\s+/, ""],
]

export const crumbLabel = (text: string) =>
  markup
    .reduce(
      (line, [pattern, replacement]) => line.replace(pattern, replacement),
      text.split("\n")[0] ?? "",
    )
    .trim()

export interface PageRow {
  readonly page: Pick<Page, "name" | "title" | "journalDay" | "props">
  readonly backlinks: number
  readonly created: number | null
  readonly updated: number | null
}

export const pageRows = (
  pages: ReadonlyArray<Page>,
  stats: ReadonlyArray<PageStat>,
  referenced: ReadonlyArray<ReferencedPage> = [],
): ReadonlyArray<PageRow> => {
  const byPage = new Map(stats.map((stat) => [stat.pageId, stat]))
  return [
    ...pages.map((page) => {
      const stat = byPage.get(page.id)
      return {
        page,
        backlinks: stat?.backlinks ?? 0,
        created: stat?.created ?? null,
        updated: stat?.updated ?? null,
      }
    }),
    ...referenced.map(({ name, title, journalDay, backlinks, created, updated }) => ({
      page: { name, title, journalDay, props: {} },
      backlinks,
      created,
      updated,
    })),
  ]
}

const compareBy = (column: SortColumn) => (left: PageRow, right: PageRow) => {
  if (column === "title") return left.page.title.localeCompare(right.page.title)
  const a = left[column]
  const b = right[column]
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a - b
}

export const visibleRows = (
  rows: ReadonlyArray<PageRow>,
  options: { readonly sort: TableSort; readonly filter: string; readonly journals: boolean },
): ReadonlyArray<PageRow> => {
  const needle = options.filter.trim().toLowerCase()
  const compare = compareBy(options.sort.column)
  return rows
    .filter((row) => options.journals || row.page.journalDay === null)
    .filter((row) => needle === "" || row.page.title.toLowerCase().includes(needle))
    .toSorted((left, right) => {
      const order = options.sort.descending ? compare(right, left) : compare(left, right)
      return order === 0 ? left.page.name.localeCompare(right.page.name) : order
    })
}

const two = (n: number) => String(n).padStart(2, "0")

export const timestamp = (millis: number | null) => {
  if (millis === null) return ""
  const at = new Date(millis)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

const hidden = new Set(["title", "filters", "favorite", "id", "collapsed", "icon", "public"])

export const visibleProps = (props: Page["props"]): ReadonlyArray<readonly [string, string]> =>
  Object.entries(props).filter(
    ([key]) => !hidden.has(key.toLowerCase()) && !key.startsWith("logseq."),
  )

export const listValues = (value: string) =>
  value
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^\[\[(.*)\]\]$/, "$1")
        .replace(/^#/, ""),
    )
    .filter((part) => part !== "")

export const dayOf = (date: Date) =>
  date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
