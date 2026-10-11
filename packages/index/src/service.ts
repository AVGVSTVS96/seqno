import { Context, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { Reactivity } from "effect/reactivity"
import { BlockId, GraphEvent, PageId, normalizePageName } from "@seqno/domain"
import { titleIn } from "./facets.ts"
import { indexer } from "./indexer.ts"
import { REBUILT, toInvalidation, type Changes, type ReadKey } from "./keys.ts"
import {
  RELAXED,
  SCHEMA_VERSION,
  readStamp,
  recreate,
  schemaVersion,
  writeStamp,
} from "./schema.ts"
import { IndexError, Sqlite, type Row, type SqlValue, type Statements } from "./sqlite.ts"

export interface LiveQuery {
  readonly sql: string
  readonly params: ReadonlyArray<SqlValue>
  readonly reads: ReadonlyArray<ReadKey>
}

export const BlockHit = Schema.Struct({ blockId: BlockId, pageId: PageId, text: Schema.String })
export type BlockHit = typeof BlockHit.Type

export const PageHit = Schema.Struct({ pageId: PageId, title: Schema.String })
export type PageHit = typeof PageHit.Type

export interface SearchResult {
  readonly pages: ReadonlyArray<PageHit>
  readonly blocks: ReadonlyArray<BlockHit>
}

export const PageStat = Schema.Struct({
  pageId: PageId,
  backlinks: Schema.Int,
  created: Schema.NullOr(Schema.Number),
  updated: Schema.NullOr(Schema.Number),
})
export type PageStat = typeof PageStat.Type

export const ReferencedPage = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  tag: Schema.Boolean,
  backlinks: Schema.Int,
  created: Schema.NullOr(Schema.Number),
  updated: Schema.NullOr(Schema.Number),
})
export type ReferencedPage = typeof ReferencedPage.Type

export const GraphPage = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  day: Schema.NullOr(Schema.Int),
  exists: Schema.Boolean,
  tag: Schema.Boolean,
  created: Schema.NullOr(Schema.Number),
})
export type GraphPage = typeof GraphPage.Type

export interface PagesGraph {
  readonly pages: ReadonlyArray<GraphPage>
  readonly links: ReadonlyArray<readonly [string, string]>
}

const REBUILD_BATCH = 2_000

const decodeBlockHit = Schema.decodeUnknownSync(BlockHit)
const decodePageHit = Schema.decodeUnknownSync(PageHit)
const decodePageStat = Schema.decodeUnknownSync(PageStat)
const decodeReferencedPage = Schema.decodeUnknownSync(ReferencedPage)
const decodeGraphPage = Schema.decodeUnknownSync(GraphPage)
const decodeName = Schema.decodeUnknownSync(Schema.String)

const blockHits = (rows: ReadonlyArray<Row>) =>
  rows.map(([blockId, pageId, text]) => decodeBlockHit({ blockId, pageId, text }))

const REFERENCE_ORDER = "ORDER BY p.day IS NULL, p.day DESC, p.name_lc, b.rid"

const BACKLINKS = `
SELECT b.id, p.id, b.content FROM pages me
JOIN page_names n ON n.page = me.rid
JOIN refs r ON r.target = n.name
JOIN blocks b ON b.rid = r.block
JOIN pages p ON p.rid = b.page
WHERE me.id = ? AND b.page != me.rid
GROUP BY b.rid
${REFERENCE_ORDER}`

const BACKLINKS_TO_NAME = `
SELECT b.id, p.id, b.content FROM refs r
JOIN blocks b ON b.rid = r.block
JOIN pages p ON p.rid = b.page
WHERE r.target = ?
GROUP BY b.rid
${REFERENCE_ORDER}`

const PAGE_NAMES = `
SELECT n.name FROM pages me JOIN page_names n ON n.page = me.rid WHERE me.id = ?`

const UNLINKED = `
SELECT b.id, p.id, b.content FROM fts
JOIN blocks b ON b.rid = fts.rowid
JOIN pages p ON p.rid = b.page
JOIN pages me ON me.id = ?1
WHERE fts MATCH ?2 AND b.page != me.rid
AND NOT EXISTS (
  SELECT 1 FROM refs r JOIN page_names n ON n.name = r.target
  WHERE r.block = b.rid AND n.page = me.rid)
${REFERENCE_ORDER}`

const PAGE_STATS = `
SELECT p.id,
  (SELECT count(DISTINCT r.block) FROM page_names n
    JOIN refs r ON r.target = n.name
    JOIN blocks b ON b.rid = r.block
    WHERE n.page = p.rid AND b.page != p.rid),
  (SELECT min(created) FROM blocks WHERE page = p.rid),
  (SELECT max(updated) FROM blocks WHERE page = p.rid)
FROM pages p`

const REFERENCED_PAGES = `
WITH named AS (
  SELECT r.target AS target, count(DISTINCT r.block) AS uses, min(r.block) AS first,
    max(r.tag) AS tag, min(b.created) AS created, max(b.updated) AS updated
  FROM refs r JOIN blocks b ON b.rid = r.block
  WHERE NOT EXISTS (SELECT 1 FROM page_names n WHERE n.name = r.target)
  GROUP BY r.target)
SELECT named.target, blocks.content, named.tag, named.uses, named.created, named.updated
FROM named JOIN blocks ON blocks.rid = named.first
ORDER BY named.target`

const referencedOf = (db: Statements) =>
  db.all(REFERENCED_PAGES).map(([name, content, tag, backlinks, created, updated]) =>
    decodeReferencedPage({
      name,
      title:
        typeof name === "string" && typeof content === "string" ? titleIn(content, name) : name,
      tag: tag === 1,
      backlinks,
      created,
      updated,
    }),
  )

const GRAPH_PAGES = `
SELECT p.name_lc, p.name, p.day, (SELECT min(created) FROM blocks WHERE page = p.rid)
FROM pages p ORDER BY p.name_lc`

const CANONICAL = `
LEFT JOIN page_names n ON n.name = e.target
LEFT JOIN pages dst ON dst.rid = n.page`

const GRAPH_TAGS = `
WITH e(target) AS (SELECT target FROM refs WHERE tag = 1 UNION SELECT tag FROM page_tags)
SELECT DISTINCT coalesce(dst.name_lc, e.target) FROM e ${CANONICAL}`

const GRAPH_LINKS = `
WITH e(page, target) AS (
  SELECT b.page, r.target FROM refs r JOIN blocks b ON b.rid = r.block
  UNION SELECT page, tag FROM page_tags)
SELECT DISTINCT src.name_lc, coalesce(dst.name_lc, e.target)
FROM e JOIN pages src ON src.rid = e.page ${CANONICAL}
WHERE coalesce(dst.name_lc, e.target) != src.name_lc`

const namespaceParent = (name: string) => {
  const slash = name.lastIndexOf("/")
  return slash > 0 ? name.slice(0, slash) : null
}

const graphOf = (db: Statements): PagesGraph => {
  const tags = new Set(db.all(GRAPH_TAGS).map(([name]) => decodeName(name)))
  const pages = [
    ...db.all(GRAPH_PAGES).map(([name, title, day, created]) =>
      decodeGraphPage({
        name,
        title,
        day,
        exists: true,
        tag: tags.has(decodeName(name)),
        created,
      }),
    ),
    ...referencedOf(db).map((page) =>
      decodeGraphPage({
        name: page.name,
        title: page.title,
        day: null,
        exists: false,
        tag: page.tag || tags.has(page.name),
        created: page.created,
      }),
    ),
  ]
  const names = new Set(pages.map((page) => page.name))
  const references = db
    .all(GRAPH_LINKS)
    .map(([source, target]): readonly [string, string] => [decodeName(source), decodeName(target)])
  const namespaces = pages.flatMap((page): ReadonlyArray<readonly [string, string]> => {
    const parent = namespaceParent(page.name)
    return parent !== null && names.has(parent) ? [[page.name, parent]] : []
  })
  const seen = new Set<string>()
  const links = [...references, ...namespaces].filter(([source, target]) => {
    const key = `${source}\u0000${target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { pages, links }
}

const samePagesGraph = (left: PagesGraph, right: PagesGraph) =>
  left.pages.length === right.pages.length &&
  left.links.length === right.links.length &&
  left.pages.every((page, at) => {
    const other = right.pages[at]
    return (
      other !== undefined &&
      page.name === other.name &&
      page.title === other.title &&
      page.day === other.day &&
      page.exists === other.exists &&
      page.tag === other.tag &&
      page.created === other.created
    )
  }) &&
  left.links.every(
    ([source, target], at) => right.links[at]?.[0] === source && right.links[at]?.[1] === target,
  )

const BLOCK_REF_SOURCES = `SELECT content FROM blocks WHERE instr(content, '((') > 0`

const blockRef = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

const blockRefCountsOf = (db: Statements): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const [content] of db.all(BLOCK_REF_SOURCES)) {
    if (typeof content !== "string") continue
    const targets = new Set([...content.matchAll(blockRef)].map((m) => (m[1] ?? "").toLowerCase()))
    for (const target of targets) counts[target] = (counts[target] ?? 0) + 1
  }
  return counts
}

const BLOCK_REFERENCES = `
SELECT b.id, p.id, b.content FROM blocks b
JOIN pages p ON p.rid = b.page
WHERE instr(lower(b.content), ?1) > 0
${REFERENCE_ORDER}`

const blockReferencesOf = (db: Statements, blockId: string) =>
  blockHits(db.all(BLOCK_REFERENCES, [`((${blockId.toLowerCase()}))`]))

const phrase = (text: string) => `"${text.replaceAll('"', '""')}"`

const anyPhrase = (names: ReadonlyArray<string>): string | null => {
  const phrases = names.filter((name) => /[\p{L}\p{N}]/u.test(name)).map(phrase)
  return phrases.length === 0 ? null : phrases.join(" OR ")
}

const namesOf = (db: Statements, pageId: PageId) =>
  db.all(PAGE_NAMES, [pageId]).flatMap(([name]) => (typeof name === "string" ? [name] : []))

const unlinkedOf = (db: Statements, pageId: PageId) => {
  const match = anyPhrase(namesOf(db, pageId))
  return match === null ? [] : blockHits(db.all(UNLINKED, [pageId, match]))
}

const statsOf = (db: Statements) =>
  db
    .all(PAGE_STATS)
    .map(([pageId, backlinks, created, updated]) =>
      decodePageStat({ pageId, backlinks, created, updated }),
    )

const sameBlocks = (left: ReadonlyArray<BlockHit>, right: ReadonlyArray<BlockHit>) =>
  left.length === right.length &&
  left.every((hit, at) => hit.blockId === right[at]?.blockId && hit.pageId === right[at]?.pageId)

const NAME_READS: ReadonlyArray<ReadKey> = ["page.name", "page.alias"]
const UNLINKED_READS: ReadonlyArray<ReadKey> = [...NAME_READS, "text", "ref", "move", "exist"]
const REFERENCED_READS: ReadonlyArray<ReadKey> = [...NAME_READS, "ref", "exist", "updated"]
const GRAPH_READS: ReadonlyArray<ReadKey> = [...NAME_READS, "ref", "move", "exist", "page.tag"]
const BLOCK_REF_READS: ReadonlyArray<ReadKey> = ["text", "exist"]
const STATS_READS: ReadonlyArray<ReadKey> = [
  ...NAME_READS,
  "ref",
  "move",
  "exist",
  "created",
  "updated",
]

const SEARCH_PAGES = `
SELECT p.id, p.name FROM page_names n JOIN pages p ON p.rid = n.page
WHERE instr(n.name, ?1) > 0
GROUP BY p.rid
ORDER BY min(instr(n.name, ?1)), length(p.name_lc), p.name_lc
LIMIT ?2`

const SEARCH_BLOCKS = `
SELECT b.id, p.id, b.content FROM fts
JOIN blocks b ON b.rid = fts.rowid
JOIN pages p ON p.rid = b.page
WHERE fts MATCH ?1
ORDER BY rank
LIMIT ?2`

const ftsQuery = (text: string): string | null => {
  const terms = text
    .split(/\s+/)
    .filter((term) => term !== "")
    .map((term) => `"${term.replaceAll('"', '""')}"`)
  return terms.length === 0 ? null : `${terms.join(" ")}*`
}

const applyAll = (db: Statements, events: Iterable<GraphEvent>): Changes => {
  const changes: Changes = new Map()
  const index = indexer(db, changes)
  for (const event of events) index(event)
  return changes
}

const make = Effect.gen(function* () {
  const sqlite = yield* Sqlite
  const reactivity = yield* Reactivity.make
  const writer = yield* Semaphore.make(1)

  yield* sqlite.use((db) => db.exec(RELAXED))
  yield* sqlite.transaction((db) => {
    if (schemaVersion(db) !== SCHEMA_VERSION) recreate(db)
  })

  const query = (sql: string, params: ReadonlyArray<SqlValue> = []) =>
    sqlite.use((db) => db.all(sql, params))

  const watching = <A>(reads: ReadonlyArray<string>, read: Effect.Effect<A, IndexError>) =>
    reactivity.stream([...reads, REBUILT], read)

  const backlinks = (pageId: PageId) => sqlite.use((db) => blockHits(db.all(BACKLINKS, [pageId])))

  const unlinkedReferences = (pageId: PageId) => sqlite.use((db) => unlinkedOf(db, pageId))

  const pageStats = sqlite.use(statsOf)

  const referencedPages = sqlite.use(referencedOf)

  return {
    stamp: sqlite.use(readStamp).pipe(Effect.map(Option.fromNullOr)),

    apply: (events: ReadonlyArray<GraphEvent>, stamp: string) =>
      sqlite
        .transaction((db) => {
          const changes = applyAll(db, events)
          writeStamp(db, stamp)
          return changes
        })
        .pipe(
          Effect.flatMap((changes) => reactivity.invalidate(toInvalidation(changes))),
          writer.withPermits(1),
        ),

    rebuild: <E, R>(events: Stream.Stream<GraphEvent, E, R>, stamp: string) =>
      Effect.gen(function* () {
        yield* sqlite.transaction(recreate)
        yield* events.pipe(
          Stream.grouped(REBUILD_BATCH),
          Stream.runForEach((batch) => sqlite.transaction((db) => applyAll(db, batch))),
        )
        yield* sqlite.transaction((db) => writeStamp(db, stamp))
      }).pipe(Effect.ensuring(reactivity.invalidate([REBUILT])), writer.withPermits(1)),

    fill: <E, R>(pages: Stream.Stream<ReadonlyArray<GraphEvent>, E, R>) =>
      pages.pipe(
        Stream.runForEach((batch) =>
          Effect.andThen(
            writer.withPermits(1)(sqlite.transaction((db) => void applyAll(db, batch))),
            Effect.yieldNow,
          ),
        ),
        Effect.ensuring(reactivity.invalidate([REBUILT])),
      ),

    query,

    watch: (live: LiveQuery): Stream.Stream<ReadonlyArray<Row>, IndexError> =>
      reactivity.stream([...live.reads, REBUILT], query(live.sql, live.params)),

    backlinks,

    watchBacklinks: (pageId: PageId): Stream.Stream<ReadonlyArray<BlockHit>, IndexError> =>
      watching(
        NAME_READS,
        sqlite.use((db) => namesOf(db, pageId)),
      ).pipe(
        Stream.switchMap((names) =>
          watching(
            [...NAME_READS, "move", ...names.map((name) => `ref:${name}`)],
            backlinks(pageId),
          ),
        ),
        Stream.changesWith(sameBlocks),
      ),

    watchBacklinksToName: (name: string): Stream.Stream<ReadonlyArray<BlockHit>, IndexError> => {
      const target = normalizePageName(name)
      return watching(
        [...NAME_READS, "move", `ref:${target}`],
        sqlite.use((db) => blockHits(db.all(BACKLINKS_TO_NAME, [target]))),
      ).pipe(Stream.changesWith(sameBlocks))
    },

    unlinkedReferences,

    watchUnlinkedReferences: (pageId: PageId): Stream.Stream<ReadonlyArray<BlockHit>, IndexError> =>
      watching(UNLINKED_READS, unlinkedReferences(pageId)).pipe(Stream.changesWith(sameBlocks)),

    pageStats,

    watchPageStats: watching(STATS_READS, pageStats),

    referencedPages,

    watchReferencedPages: watching(REFERENCED_READS, referencedPages),

    pagesGraph: sqlite.use(graphOf),

    watchPagesGraph: watching(GRAPH_READS, sqlite.use(graphOf)).pipe(
      Stream.changesWith(samePagesGraph),
    ),

    blockRefCounts: sqlite.use(blockRefCountsOf),

    watchBlockRefCounts: watching(BLOCK_REF_READS, sqlite.use(blockRefCountsOf)),

    watchBlockReferences: (blockId: string): Stream.Stream<ReadonlyArray<BlockHit>, IndexError> =>
      watching(
        [...BLOCK_REF_READS, "move"],
        sqlite.use((db) => blockReferencesOf(db, blockId)),
      ).pipe(Stream.changesWith(sameBlocks)),

    search: (text: string, limit = 20): Effect.Effect<SearchResult, IndexError> =>
      sqlite.use((db) => {
        const name = normalizePageName(text)
        const match = ftsQuery(text)
        return {
          pages:
            name === ""
              ? []
              : db
                  .all(SEARCH_PAGES, [name, limit])
                  .map(([pageId, title]) => decodePageHit({ pageId, title })),
          blocks: match === null ? [] : blockHits(db.all(SEARCH_BLOCKS, [match, limit])),
        }
      }),
  }
})

export class Index extends Context.Service<Index, Effect.Success<typeof make>>()(
  "@seqno/index/Index",
) {
  static readonly layer = Layer.effect(Index, make)
}
