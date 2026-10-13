import { Option, Schema } from "effect"
import { LoroMap, type LoroDoc, type LoroTreeNode, type TreeID } from "loro-crdt"
import { JournalDay, PageId, Props, normalizePageName, type Page } from "@seqno/domain"
import { inOrder, isTreeId, readProps } from "../tree.ts"

export const TITLES = "titles"
export const DAYS = "days"
export const TRASHED = "trashed"
export const MERGED = "mergedInto"
export const PAGE_DATA = "pageData"
export const MOVED = "moved"

export const REF = "ref"
export const AT = "at"

const TREE_PREFIX = "blocks:"

export const treeName = (page: PageId): string => `${TREE_PREFIX}${page}`

const decodePageId = Schema.decodeUnknownOption(PageId)
const decodeDay = Schema.decodeUnknownOption(JournalDay)
const decodeProps = Schema.decodeUnknownOption(Props)
const decodeKeys = Schema.decodeUnknownOption(Schema.Array(Schema.String))

export const pageOfTree = (name: unknown): Option.Option<PageId> =>
  typeof name === "string" && name.startsWith(TREE_PREFIX)
    ? decodePageId(name.slice(TREE_PREFIX.length))
    : Option.none()

export const journalPageId = (day: JournalDay): PageId => {
  const digits = String(day).padStart(12, "0")
  return PageId.make(`${digits.slice(0, 8)}-${digits.slice(8)}-7000-8000-000000000000`)
}

export interface Spot {
  readonly page: PageId
  readonly node: LoroTreeNode
  readonly key: string
}

export const spotOf = (page: PageId, node: LoroTreeNode): Spot => ({
  page,
  node,
  key: `${page}|${node.id}`,
})

export const parseKey = (key: unknown): Option.Option<readonly [PageId, TreeID]> => {
  if (typeof key !== "string") return Option.none()
  const bar = key.indexOf("|")
  const id = key.slice(bar + 1)
  return bar === -1 || !isTreeId(id)
    ? Option.none()
    : Option.map(decodePageId(key.slice(0, bar)), (page) => [page, id] as const)
}

export interface Directory {
  readonly titles: LoroMap
  readonly days: LoroMap
  readonly trashed: LoroMap
  readonly merged: LoroMap
  readonly pageData: LoroMap
  readonly moved: LoroMap
}

export const directoryOf = (doc: LoroDoc): Directory => ({
  titles: doc.getMap(TITLES),
  days: doc.getMap(DAYS),
  trashed: doc.getMap(TRASHED),
  merged: doc.getMap(MERGED),
  pageData: doc.getMap(PAGE_DATA),
  moved: doc.getMap(MOVED),
})

export const isDirectory = (name: unknown): boolean =>
  name === TITLES || name === DAYS || name === TRASHED || name === MERGED || name === PAGE_DATA

export const pageData = (dir: Directory, page: PageId): Option.Option<LoroMap> => {
  const found = dir.pageData.get(page)
  return found instanceof LoroMap ? Option.some(found) : Option.none()
}

export const ensurePageData = (dir: Directory, page: PageId): LoroMap =>
  Option.getOrElse(pageData(dir, page), () => dir.pageData.ensureMergeableMap(page))

export const pagePropsOf = (dir: Directory, page: PageId): Props =>
  Option.match(pageData(dir, page), { onNone: () => ({}), onSome: readProps })

export interface Listing {
  readonly live: ReadonlyMap<PageId, Page>
  readonly merged: ReadonlyMap<PageId, PageId>
  readonly trashed: ReadonlySet<PageId>
  readonly titled: ReadonlySet<PageId>
}

const entries = (map: LoroMap): ReadonlyArray<readonly [string, unknown]> =>
  Object.entries(map.toJSON())

export const listPages = (dir: Directory): Listing => {
  const days = new Map(entries(dir.days))
  const trashed = new Set<PageId>()
  for (const [id, value] of entries(dir.trashed)) {
    if (value === true) Option.map(decodePageId(id), (page) => trashed.add(page))
  }
  const merged = new Map<PageId, PageId>()
  for (const [id, value] of entries(dir.merged)) {
    Option.map(decodePageId(id), (page) =>
      Option.map(decodePageId(value), (into) => merged.set(page, into)),
    )
  }
  const data = dir.pageData.toJSON()
  const live = new Map<PageId, Page>()
  const titled = new Set<PageId>()
  for (const [id, title] of entries(dir.titles)) {
    const page = decodePageId(id)
    if (Option.isNone(page) || typeof title !== "string") continue
    titled.add(page.value)
    const name = normalizePageName(title)
    if (name === "" || trashed.has(page.value) || merged.has(page.value)) continue
    const own: unknown = data[id]
    const props =
      typeof own === "object" && own !== null
        ? inOrder(
            Option.getOrElse(decodeProps(Reflect.get(own, "props")), () => ({})),
            Option.getOrElse(decodeKeys(Reflect.get(own, "propKeys")), () => []),
          )
        : {}
    live.set(page.value, {
      id: page.value,
      name,
      title,
      journalDay: Option.getOrNull(decodeDay(days.get(id))),
      props,
    })
  }
  return { live, merged, trashed, titled }
}

export const resolvePage = (listing: Listing, page: PageId): Option.Option<PageId> => {
  let at = page
  for (let steps = 0; steps <= listing.merged.size; steps++) {
    const into = listing.merged.get(at)
    if (into === undefined) return listing.live.has(at) ? Option.some(at) : Option.none()
    at = into
  }
  return Option.none()
}

export const feeding = (listing: Listing, page: PageId): ReadonlyArray<PageId> =>
  [...listing.merged.keys()].filter((from) => {
    const seen = new Set<PageId>()
    for (
      let at = listing.merged.get(from);
      at !== undefined && !seen.has(at);
      at = listing.merged.get(at)
    ) {
      if (at === page) return true
      seen.add(at)
    }
    return false
  })

export const mergedFrom = (listing: Listing, page: PageId): ReadonlyArray<PageId> =>
  [...listing.merged.keys()]
    .filter((from) => Option.contains(resolvePage(listing, from), page))
    .toSorted()
