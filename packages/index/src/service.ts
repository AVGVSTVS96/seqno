import { Context, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { Reactivity } from "effect/reactivity"
import { BlockId, GraphEvent, PageId, normalizePageName } from "@seqno/domain"
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

const REBUILD_BATCH = 2_000

const decodeBlockHit = Schema.decodeUnknownSync(BlockHit)
const decodePageHit = Schema.decodeUnknownSync(PageHit)

const blockHits = (rows: ReadonlyArray<Row>) =>
  rows.map(([blockId, pageId, text]) => decodeBlockHit({ blockId, pageId, text }))

const BACKLINKS = `
SELECT b.id, p.id, b.content FROM pages me
JOIN page_names n ON n.page = me.rid
JOIN refs r ON r.target = n.name
JOIN blocks b ON b.rid = r.block
JOIN pages p ON p.rid = b.page
WHERE me.id = ? AND b.page != me.rid
GROUP BY b.rid
ORDER BY p.day IS NULL, p.day DESC, p.name_lc, b.rid`

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

    query,

    watch: (live: LiveQuery): Stream.Stream<ReadonlyArray<Row>, IndexError> =>
      reactivity.stream([...live.reads, REBUILT], query(live.sql, live.params)),

    backlinks: (pageId: PageId) => sqlite.use((db) => blockHits(db.all(BACKLINKS, [pageId]))),

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
