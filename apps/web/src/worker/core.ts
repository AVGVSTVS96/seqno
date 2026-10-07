import {
  Clock,
  Context,
  Crypto,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import { BlockId, PageId, type Block, type Page } from "@seqno/domain"
import { isReadKey, type BlockHit, type Row } from "@seqno/index"
import {
  ALIASES_SQL,
  compileQuery,
  namesRead,
  parseDataviewQuery,
  parseLogseqQuery,
  readSet,
  type Query,
} from "@seqno/query"
import {
  CoreRpcs,
  GraphLocked,
  GraphNotOpen,
  GraphUnavailable,
  PageRpcs,
  QueryInvalid,
  type GraphOpened,
  type QueryResult,
  type Reference,
} from "@seqno/rpc"
import { defaultConfig, parseJournalDay } from "@seqno/interop"
import { journalDayOf } from "./journal.ts"
import { GraphLocks } from "./lock.ts"
import { Device, GraphPlaces, type GraphPlace } from "./place.ts"
import { openSession, type Session, type Touched } from "./session.ts"

const decodeBlockId = Schema.decodeUnknownOption(BlockId)
const decodePageId = Schema.decodeUnknownOption(PageId)

const reasonOf = (error: { readonly _tag: string }) =>
  "reason" in error ? String(error.reason) : "message" in error ? String(error.message) : error._tag

const parseQuery = (text: string) =>
  Result.orElse(parseLogseqQuery(text), (logseq) =>
    Result.mapError(parseDataviewQuery(text), () => logseq),
  )

const blocksOf = (session: Session, ids: ReadonlyArray<BlockId>) =>
  Effect.map(
    Effect.forEach(ids, (id) => Effect.option(session.graph.block(id))),
    (found): ReadonlyArray<Block> => found.flatMap(Option.toArray),
  )

const pagesOf = (session: Session, ids: ReadonlyArray<PageId>) =>
  Effect.map(session.graph.pages, (pages): ReadonlyArray<Page> => {
    const byId = new Map(pages.map((page) => [page.id, page]))
    return ids.flatMap((id) => Option.toArray(Option.fromUndefinedOr(byId.get(id))))
  })

const idsOfRows = (session: Session, table: "blocks" | "pages", rows: ReadonlyArray<Row>) =>
  Effect.gen(function* () {
    const rids = rows.flatMap(([rid]) => (typeof rid === "number" ? [rid] : []))
    if (rids.length === 0) return []
    const marks = rids.map(() => "?").join(",")
    const pairs = yield* session.index.query(
      `SELECT rid, id FROM ${table} WHERE rid IN (${marks})`,
      rids,
    )
    const idOf = new Map(pairs.map(([rid, id]) => [rid, id]))
    return rids.map((rid) => idOf.get(rid))
  })

const resultOf = (session: Session, query: Query, rows: ReadonlyArray<Row>) =>
  query.find === "blocks"
    ? idsOfRows(session, "blocks", rows).pipe(
        Effect.flatMap((ids) =>
          blocksOf(
            session,
            ids.flatMap((id) => Option.toArray(decodeBlockId(id))),
          ),
        ),
        Effect.map((blocks): QueryResult => ({ _tag: "BlockRows", blocks })),
      )
    : idsOfRows(session, "pages", rows).pipe(
        Effect.flatMap((ids) =>
          pagesOf(
            session,
            ids.flatMap((id) => Option.toArray(decodePageId(id))),
          ),
        ),
        Effect.map((pages): QueryResult => ({ _tag: "PageRows", pages })),
      )

const watchQuery = (session: Session, text: string) =>
  Effect.gen(function* () {
    const invalid = (error: { readonly message: string }) =>
      new QueryInvalid({ query: text, reason: error.message })
    const query = yield* Effect.mapError(Effect.fromResult(parseQuery(text)), invalid)
    const ctx = { today: journalDayOf(yield* Clock.currentTimeMillis) }
    const compiled = yield* Effect.mapError(Effect.fromResult(compileQuery(query, ctx)), invalid)
    const asked = yield* Effect.mapError(Effect.fromResult(namesRead(query, ctx)), invalid)
    const names = new Map(
      yield* Effect.forEach(asked, (name) =>
        Effect.map(
          Effect.mapError(session.index.query(ALIASES_SQL, [name]), invalid),
          (rows) =>
            [
              name,
              new Set(rows.flatMap(([alias]) => (typeof alias === "string" ? [alias] : []))),
            ] as const,
        ),
      ),
    )
    const reads = yield* Effect.mapError(
      Effect.fromResult(readSet(query, ctx, (name) => names.get(name) ?? new Set([name]))),
      invalid,
    )
    return session.index
      .watch({ sql: compiled.sql, params: compiled.params, reads: reads.filter(isReadKey) })
      .pipe(
        Stream.mapEffect((rows) => resultOf(session, query, rows)),
        Stream.mapError(invalid),
      )
  })

const ancestorsOf = (session: Session, ids: ReadonlyArray<BlockId>) =>
  Effect.gen(function* () {
    const found = new Map<BlockId, Block>()
    let level = yield* blocksOf(session, ids)
    while (level.length > 0) {
      const parents = new Set(
        level.flatMap((block) =>
          block.parentId === null || found.has(block.parentId) ? [] : [block.parentId],
        ),
      )
      level = yield* blocksOf(session, [...parents])
      for (const block of level) found.set(block.id, block)
    }
    return [...found.values()]
  })

const referencesOf = (hits: ReadonlyArray<BlockHit>): ReadonlyArray<Reference> =>
  hits.map(({ blockId, pageId }) => ({ blockId, pageId }))

class Sessions extends Context.Service<
  Sessions,
  {
    readonly open: (
      graph: string,
      wait: boolean,
    ) => Effect.Effect<GraphOpened, GraphUnavailable | GraphLocked>
    readonly current: Effect.Effect<Session, GraphNotOpen>
    readonly following: <A, E>(
      watch: (session: Session) => Stream.Stream<A, E>,
    ) => Stream.Stream<A, E | GraphNotOpen>
    readonly pageChanges: (pageId: PageId) => Stream.Stream<void>
  }
>()("@seqno/web/worker/Sessions") {}

const SessionsLive = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const places = yield* GraphPlaces
    const device = yield* Device
    const crypto = yield* Crypto.Crypto
    const locks = yield* GraphLocks
    const touches = yield* SubscriptionRef.make<Touched>(new Set())
    const changed = (touched: Touched) => SubscriptionRef.set(touches, touched)
    const state = yield* SubscriptionRef.make(Option.none<readonly [Session, Scope.Closeable]>())

    const current = Effect.flatMap(SubscriptionRef.get(state), (open) =>
      Option.match(open, {
        onNone: () => Effect.fail(new GraphNotOpen()),
        onSome: ([session]) => Effect.succeed(session),
      }),
    )

    const close = Effect.flatMap(SubscriptionRef.getAndSet(state, Option.none()), (open) =>
      Option.match(open, {
        onNone: () => Effect.void,
        onSome: ([, scope]) => Scope.close(scope, Exit.void),
      }),
    )
    yield* Effect.addFinalizer(() => close)

    const start = (graph: string, wait: boolean, place: GraphPlace, scope: Scope.Closeable) =>
      Effect.gen(function* () {
        if (!(yield* Scope.provide(locks.hold(graph, wait), scope))) {
          return yield* new GraphLocked({ graph })
        }
        return yield* openSession(place, changed).pipe(
          Scope.provide(scope),
          Effect.provideService(Device, device),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError((error) => new GraphUnavailable({ graph, reason: reasonOf(error) })),
        )
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))

    return Sessions.of({
      open: (graph, wait) =>
        Effect.gen(function* () {
          const place = yield* places.open(graph)
          yield* close
          const scope = yield* Scope.make()
          const session = yield* start(graph, wait, place, scope)
          yield* SubscriptionRef.set(state, Option.some([session, scope] as const))
          return { graph, pages: yield* session.graph.pages }
        }),
      current,
      following: (watch) =>
        SubscriptionRef.changes(state).pipe(
          Stream.switchMap((open) =>
            Option.match(open, {
              onNone: () => Stream.empty,
              onSome: ([session]) => watch(session),
            }),
          ),
        ),
      pageChanges: (pageId) =>
        SubscriptionRef.changes(touches).pipe(
          Stream.zipWithIndex,
          Stream.filter(([touched, at]) => at === 0 || touched.has(pageId)),
          Stream.as(undefined),
        ),
    })
  }),
)

const CoreHandlers = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const { open, current, following, pageChanges } = yield* Sessions
    return CoreRpcs.of({
      OpenGraph: ({ graph, wait }) => open(graph, wait ?? false),
      Dispatch: ({ command }) =>
        Effect.flatMap(current, (session) =>
          Effect.tap(session.graph.dispatch(command), session.record),
        ),
      GetPages: () => Effect.flatMap(current, (session) => session.graph.pages),
      GetPage: ({ pageId }) => Effect.flatMap(current, (session) => session.graph.page(pageId)),
      GetBlock: ({ blockId }) => Effect.flatMap(current, (session) => session.graph.block(blockId)),
      WatchPage: ({ pageId }) =>
        following((session) =>
          pageChanges(pageId).pipe(
            Stream.filterMapEffect(() => Effect.result(session.graph.page(pageId))),
          ),
        ),
      WatchQuery: ({ query }) => following((session) => Stream.unwrap(watchQuery(session, query))),
      WatchBlockRefCounts: () =>
        following((session) => Stream.orDie(session.index.watchBlockRefCounts)),
      Search: ({ text }) =>
        Effect.gen(function* () {
          const session = yield* current
          const hits = yield* Effect.orDie(session.index.search(text))
          return {
            pages: yield* pagesOf(
              session,
              hits.pages.map((hit) => hit.pageId),
            ),
            blocks: yield* blocksOf(
              session,
              hits.blocks.map((hit) => hit.blockId),
            ),
          }
        }),
    })
  }),
)

const PageHandlers = PageRpcs.toLayer(
  Effect.gen(function* () {
    const { current, following } = yield* Sessions
    return PageRpcs.of({
      WatchReferences: ({ pageId }) =>
        following((session) =>
          session.index.watchBacklinks(pageId).pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchNameReferences: ({ name }) =>
        following((session) =>
          session.index.watchBacklinksToName(name).pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchUnlinkedReferences: ({ pageId }) =>
        following((session) =>
          session.index
            .watchUnlinkedReferences(pageId)
            .pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchPageStats: () => following((session) => Stream.orDie(session.index.watchPageStats)),
      WatchReferencedPages: () =>
        following((session) =>
          session.index.watchReferencedPages.pipe(
            Stream.map((pages) =>
              pages.map((page) => ({
                ...page,
                journalDay: Option.getOrNull(
                  parseJournalDay(page.title, defaultConfig.journalTitleFormat),
                ),
              })),
            ),
            Stream.orDie,
          ),
        ),
      Ancestors: ({ blockIds }) =>
        Effect.flatMap(current, (session) => ancestorsOf(session, blockIds)),
    })
  }),
)

export const RealCore = Layer.mergeAll(CoreHandlers, PageHandlers).pipe(Layer.provide(SessionsLive))
