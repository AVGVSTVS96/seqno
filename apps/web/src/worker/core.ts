import {
  Clock,
  Crypto,
  Effect,
  Exit,
  Option,
  Result,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import { BlockId, PageId, type Block, type Page } from "@seqno/domain"
import { isReadKey, type Row } from "@seqno/index"
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
  GraphNotOpen,
  GraphUnavailable,
  QueryInvalid,
  type QueryResult,
} from "@seqno/rpc"
import { journalDayOf } from "./journal.ts"
import { Device, GraphPlaces } from "./place.ts"
import { openSession, type Session } from "./session.ts"

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

export const RealCore = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const places = yield* GraphPlaces
    const device = yield* Device
    const crypto = yield* Crypto.Crypto
    const revision = yield* SubscriptionRef.make(0)
    const changed = SubscriptionRef.update(revision, (n) => n + 1)
    const state = yield* SubscriptionRef.make(Option.none<readonly [Session, Scope.Closeable]>())

    const current = Effect.flatMap(SubscriptionRef.get(state), (open) =>
      Option.match(open, {
        onNone: () => Effect.fail(new GraphNotOpen()),
        onSome: ([session]) => Effect.succeed(session),
      }),
    )

    const live = <A, E>(read: (session: Session) => Effect.Effect<A, E>) =>
      SubscriptionRef.changes(revision).pipe(
        Stream.mapEffect(() => Effect.flatMap(current, read)),
        Stream.changes,
      )

    const close = Effect.flatMap(SubscriptionRef.getAndSet(state, Option.none()), (open) =>
      Option.match(open, {
        onNone: () => Effect.void,
        onSome: ([, scope]) => Scope.close(scope, Exit.void),
      }),
    )

    return CoreRpcs.of({
      OpenGraph: ({ graph }) =>
        Effect.gen(function* () {
          const place = yield* places.open(graph)
          yield* close
          const scope = yield* Scope.make()
          const session = yield* openSession(place, changed).pipe(
            Scope.provide(scope),
            Effect.provideService(Device, device),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.tapError(() => Scope.close(scope, Exit.void)),
            Effect.mapError((error) => new GraphUnavailable({ graph, reason: reasonOf(error) })),
          )
          yield* SubscriptionRef.set(state, Option.some([session, scope] as const))
          yield* changed
          return { graph, pages: yield* session.graph.pages }
        }),
      Dispatch: ({ command }) =>
        Effect.flatMap(current, (session) =>
          Effect.tap(session.graph.dispatch(command), session.record),
        ),
      GetPages: () => Effect.flatMap(current, (session) => session.graph.pages),
      GetPage: ({ pageId }) => Effect.flatMap(current, (session) => session.graph.page(pageId)),
      GetBlock: ({ blockId }) => Effect.flatMap(current, (session) => session.graph.block(blockId)),
      WatchPage: ({ pageId }) => live((session) => session.graph.page(pageId)),
      WatchQuery: ({ query }) =>
        Stream.unwrap(Effect.flatMap(current, (session) => watchQuery(session, query))),
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
