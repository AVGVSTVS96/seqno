import { Option, Predicate, Schema } from "effect"
import { LoroMap } from "loro-crdt"
import type { LoroDoc, LoroTreeNode, TreeID } from "loro-crdt"
import { JournalDay, PageId, Props, normalizePageName } from "@seqno/domain"
import type { Page } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import { fileShape, inOrder, isMap, isTreeId, readProps } from "../tree.ts"

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

const OwnData = Schema.Struct({
  props: Schema.optionalKey(Schema.Unknown),
  propKeys: Schema.optionalKey(Schema.Unknown),
  format: Schema.optionalKey(Schema.Unknown),
  frontMatter: Schema.optionalKey(Schema.Unknown),
})

const decodeOwnData = Schema.decodeUnknownOption(OwnData)

type PathItem = string | number | undefined

export const pageOfTree = (name: PathItem): Option.Option<PageId> =>
  Predicate.isString(name) && name.startsWith(TREE_PREFIX)
    ? decodePageId(name.slice(TREE_PREFIX.length))
    : Option.none()

export const journalPageId = (day: JournalDay): PageId => {
  const digits = String(day).padStart(12, "0")

  return PageId.make(`${digits.slice(0, 8)}-${digits.slice(8)}-7000-8000-000000000000`)
}

export const dayIds = (pages: Iterable<Page>): ReadonlyMap<PageId, PageId> => {
  const firstOfDay = new Map<JournalDay, PageId>()

  for (const page of pages) {
    if (page.journalDay === null) {
      continue
    }

    const known = firstOfDay.get(page.journalDay)

    if (known === undefined || page.id < known) {
      firstOfDay.set(page.journalDay, page.id)
    }
  }

  return new Map([...firstOfDay].map(([day, id]) => [id, journalPageId(day)]))
}

export const journalsByDay = (pages: readonly PageTree[]): readonly PageTree[] => {
  const ids = dayIds(pages.map(({ page }) => page))

  return pages.map((tree) => {
    const id = ids.get(tree.page.id)

    return id === undefined
      ? tree
      : {
          page: { ...tree.page, id },
          blocks: tree.blocks.map((block) => ({ ...block, pageId: id })),
        }
  })
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

export const parseKey = (key: string): Option.Option<readonly [PageId, TreeID]> => {
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

export const isDirectory = (name: PathItem): boolean =>
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
  map.entries().map(([key, value]) => [key, isMap(value) ? value.toJSON() : value])

export const listPages = (dir: Directory): Listing => {
  const days = new Map(entries(dir.days))
  const trashed = new Set<PageId>()

  for (const [id, value] of entries(dir.trashed)) {
    if (value === true) {
      Option.map(decodePageId(id), (page) => trashed.add(page))
    }
  }

  const merged = new Map<PageId, PageId>()

  for (const [id, value] of entries(dir.merged)) {
    Option.map(decodePageId(id), (page) =>
      Option.map(decodePageId(value), (into) => merged.set(page, into)),
    )
  }

  const data = new Map(entries(dir.pageData))
  const live = new Map<PageId, Page>()
  const titled = new Set<PageId>()

  for (const [id, title] of entries(dir.titles)) {
    const page = decodePageId(id)

    if (Option.isNone(page) || !Predicate.isString(title)) {
      continue
    }

    titled.add(page.value)
    const name = normalizePageName(title)

    if (name === "" || trashed.has(page.value) || merged.has(page.value)) {
      continue
    }

    const own = Option.getOrElse(decodeOwnData(data.get(id)), (): typeof OwnData.Type => ({}))

    live.set(page.value, {
      id: page.value,
      name,
      title,
      journalDay: Option.getOrNull(decodeDay(days.get(id))),
      props: inOrder(
        Option.getOrElse(decodeProps(own.props), () => ({})),
        Option.getOrElse(decodeKeys(own.propKeys), () => []),
      ),
      ...fileShape(own),
    })
  }

  return { live, merged, trashed, titled }
}

export const resolvePage = (listing: Listing, page: PageId): Option.Option<PageId> => {
  let at = page

  for (let steps = 0; steps <= listing.merged.size; steps++) {
    const into = listing.merged.get(at)

    if (into === undefined) {
      return listing.live.has(at) ? Option.some(at) : Option.none()
    }

    at = into
  }

  return Option.none()
}

export const feeding = (listing: Listing, page: PageId): readonly PageId[] =>
  [...listing.merged.keys()].filter((from) => {
    const seen = new Set<PageId>()

    for (
      let at = listing.merged.get(from);
      at !== undefined && !seen.has(at);
      at = listing.merged.get(at)
    ) {
      if (at === page) {
        return true
      }

      seen.add(at)
    }

    return false
  })

export const mergedFrom = (listing: Listing, page: PageId): readonly PageId[] =>
  [...listing.merged.keys()]
    .filter((from) => Option.contains(resolvePage(listing, from), page))
    .toSorted()
