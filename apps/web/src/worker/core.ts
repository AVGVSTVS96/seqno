import {
  Clock,
  Context,
  Crypto,
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { BlockId, PageId, type Block, type Command, type Page } from "@seqno/domain"
import { isReadKey, type BlockHit, type GraphPage, type Row } from "@seqno/index"
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
  BlockNotFound,
  CoreRpcs,
  GraphLocked,
  GraphNotOpen,
  GraphUnavailable,
  PageRpcs,
  QueryInvalid,
  type GraphMoved,
  type GraphNode,
  type GraphOpened,
  type QueryResult,
  type Reference,
} from "@seqno/rpc"
import { defaultConfig, parseJournalDay } from "@seqno/interop"
import { journalDayOf } from "./journal.ts"
import { GraphLocks } from "./lock.ts"
import { Device, GraphPlaces } from "./place.ts"
import { withReferenceEdits } from "./rename.ts"
import { openSession, type Session } from "./session.ts"

const decodeBlockId = Schema.decodeUnknownOption(BlockId)
const decodePageId = Schema.decodeUnknownOption(PageId)

const reasonOf = (error: { readonly _tag: string }) =>
  "reason" in error ? String(error.reason) : "message" in error ? String(error.message) : error._tag

const parseQuery = (text: string) =>
  Result.orElse(parseLogseqQuery(text), (logseq) =>
    Result.mapError(parseDataviewQuery(text), () => logseq),
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
          session.blocks(ids.flatMap((id) => Option.toArray(decodeBlockId(id)))),
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
    let level = yield* session.blocks(ids)
    while (level.length > 0) {
      const parents = new Set(
        level.flatMap((block) =>
          block.parentId === null || found.has(block.parentId) ? [] : [block.parentId],
        ),
      )
      level = yield* session.blocks([...parents])
      for (const block of level) found.set(block.id, block)
    }
    return [...found.values()]
  })

const referencesOf = (hits: ReadonlyArray<BlockHit>): ReadonlyArray<Reference> =>
  hits.map(({ blockId, pageId }) => ({ blockId, pageId }))

type View = Data.TaggedEnum<{
  Idle: {}
  Open: { readonly graph: string; readonly session: Session }
  Moved: { readonly graph: string }
  Gone: {}
}>
const View = Data.taggedEnum<View>()

interface Shared {
  readonly graph: string
  readonly users: Set<number>
  readonly opened: Deferred.Deferred<Session, GraphUnavailable | GraphLocked>
  readonly scope: Scope.Closeable
}

class Sessions extends Context.Service<
  Sessions,
  {
    readonly attach: (client: number, tab: string) => Stream.Stream<GraphMoved>
    readonly open: (
      client: number,
      graph: string,
      wait: boolean,
    ) => Effect.Effect<GraphOpened, GraphUnavailable | GraphLocked>
    readonly current: (client: number) => Effect.Effect<Session, GraphNotOpen>
    readonly following: <A, E>(
      client: number,
      watch: (session: Session) => Stream.Stream<A, E>,
    ) => Stream.Stream<A, E>
  }
>()("@seqno/web/worker/Sessions") {}

const SessionsLive = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const places = yield* GraphPlaces
    const device = yield* Device
    const crypto = yield* Crypto.Crypto
    const locks = yield* GraphLocks
    const scope = yield* Effect.scope
    const mutex = yield* Semaphore.make(1)
    const guarded = mutex.withPermits(1)
    const graphs = new Map<string, Shared>()
    const closing = new Set<Shared>()
    const views = new Map<number, SubscriptionRef.SubscriptionRef<View>>()

    const viewIn = (client: number) =>
      Effect.suspend(() => {
        const found = views.get(client)
        return found === undefined
          ? Effect.tap(SubscriptionRef.make<View>(View.Idle()), (view) =>
              Effect.sync(() => views.set(client, view)),
            )
          : Effect.succeed(found)
      })

    const show = (client: number, view: View) =>
      Effect.flatMap(viewIn(client), (ref) => SubscriptionRef.set(ref, view))

    const letGo = (shared: Shared) =>
      Scope.close(shared.scope, Exit.void).pipe(
        Effect.ensuring(Effect.sync(() => closing.delete(shared))),
      )

    const close = (shared: Shared) =>
      Effect.exit(Deferred.await(shared.opened)).pipe(
        Effect.andThen(letGo(shared)),
        Effect.uninterruptible,
      )

    const forget = (shared: Shared) =>
      Effect.sync(() => {
        if (graphs.get(shared.graph) === shared) graphs.delete(shared.graph)
        closing.add(shared)
      })

    const closingHere = (graph: string) => [...closing].some((shared) => shared.graph === graph)

    const moveOut = (shared: Shared) =>
      Effect.flatMap(
        guarded(
          Effect.gen(function* () {
            if (graphs.get(shared.graph) !== shared) return false
            yield* forget(shared)
            const users = [...shared.users]
            shared.users.clear()
            yield* Effect.forEach(users, (client) =>
              show(client, View.Moved({ graph: shared.graph })),
            )
            return true
          }),
        ),
        (moved) => (moved ? close(shared) : Effect.void),
      )

    const start = (shared: Shared, wait: boolean) =>
      Effect.gen(function* () {
        const { graph } = shared
        const place = yield* places.open(graph)
        const held = yield* Scope.provide(
          locks.hold(graph, wait || closingHere(graph)),
          shared.scope,
        )
        if (Option.isNone(held)) return yield* new GraphLocked({ graph })
        const session = yield* openSession(place).pipe(
          Scope.provide(shared.scope),
          Effect.provideService(Device, device),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError((error) => new GraphUnavailable({ graph, reason: reasonOf(error) })),
        )
        yield* Effect.forkIn(
          Effect.andThen(held.value, Effect.forkIn(moveOut(shared), scope)),
          shared.scope,
        )
        return session
      })

    const join = (client: number, graph: string, wait: boolean) =>
      Effect.gen(function* () {
        const found = graphs.get(graph)
        if (found !== undefined) {
          found.users.add(client)
          return { shared: found, first: false }
        }
        const shared: Shared = {
          graph,
          users: new Set([client]),
          opened: yield* Deferred.make<Session, GraphUnavailable | GraphLocked>(),
          scope: yield* Scope.make(),
        }
        graphs.set(graph, shared)
        yield* Effect.forkIn(
          start(shared, wait).pipe(
            Effect.onError(() => Effect.andThen(guarded(forget(shared)), letGo(shared))),
            Effect.onExit((exit) => Deferred.done(shared.opened, exit)),
          ),
          scope,
        )
        return { shared, first: true }
      })

    const release = (shared: Shared, client: number) =>
      Effect.exit(
        Effect.flatMap(Deferred.await(shared.opened), (session) =>
          session.graph.release(String(client)),
        ),
      )

    const saveIndexOf = (shared: Shared) =>
      Effect.exit(Effect.flatMap(Deferred.await(shared.opened), (session) => session.closing))

    const leave = (client: number, view: View) =>
      Effect.flatMap(
        guarded(
          Effect.gen(function* () {
            yield* show(client, view)
            const was = [...graphs.values()].filter((shared) => shared.users.delete(client))
            yield* Effect.forEach(
              was.filter((shared) => shared.users.size === 0),
              forget,
            )
            return was
          }),
        ),
        (was) =>
          Effect.forEach(
            was,
            (shared) =>
              shared.users.size === 0
                ? close(shared)
                : Effect.andThen(
                    release(shared, client),
                    view._tag === "Gone" ? saveIndexOf(shared) : Effect.void,
                  ),
            { discard: true },
          ),
      )

    yield* Effect.addFinalizer(() => Effect.forEach([...graphs.values()], close, { discard: true }))

    const viewOf = (client: number) => guarded(viewIn(client))

    return Sessions.of({
      attach: (client, tab) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const view = yield* viewOf(client)
            yield* Effect.forkIn(
              Effect.andThen(
                locks.tabClosed(tab),
                Effect.andThen(
                  leave(client, View.Gone()),
                  guarded(Effect.sync(() => views.delete(client))),
                ),
              ),
              scope,
            )
            return SubscriptionRef.changes(view).pipe(
              Stream.takeWhile((now) => now._tag !== "Gone"),
              Stream.filter(View.$is("Moved")),
              Stream.map(({ graph }) => ({ graph })),
            )
          }),
        ),
      open: (client, graph, wait) =>
        Effect.gen(function* () {
          const now = yield* SubscriptionRef.get(yield* viewOf(client))
          if (now._tag !== "Open" || now.graph !== graph) {
            yield* leave(client, View.Idle())
            const { shared, first } = yield* guarded(join(client, graph, wait))
            const session = yield* Deferred.await(shared.opened)
            yield* guarded(
              shared.users.has(client) ? show(client, View.Open({ graph, session })) : Effect.void,
            )
            return {
              graph,
              pages: yield* session.graph.pages,
              skipped: first ? session.skipped : [],
            }
          }
          return { graph, pages: yield* now.session.graph.pages, skipped: [] }
        }),
      current: (client) =>
        Effect.flatMap(viewOf(client), (view) =>
          Effect.flatMap(SubscriptionRef.get(view), (now) =>
            now._tag === "Open" ? Effect.succeed(now.session) : Effect.fail(new GraphNotOpen()),
          ),
        ),
      following: (client, watch) =>
        Stream.unwrap(Effect.map(viewOf(client), SubscriptionRef.changes)).pipe(
          Stream.takeWhile((now) => now._tag !== "Gone"),
          Stream.switchMap((now) => (now._tag === "Open" ? watch(now.session) : Stream.empty)),
        ),
    })
  }),
)

const pageChanges = (session: Session, pageId: PageId) =>
  SubscriptionRef.changes(session.touched).pipe(
    Stream.zipWithIndex,
    Stream.filter(([touched, at]) => at === 0 || touched.has(pageId)),
    Stream.as(undefined),
  )

const CoreHandlers = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const { attach, open, current, following } = yield* Sessions
    const places = yield* GraphPlaces
    const dispatchAll = (client: number, commands: ReadonlyArray<Command>) =>
      Effect.flatMap(current(client), (session) =>
        Effect.forEach(commands, (command) => withReferenceEdits(session, command)).pipe(
          Effect.flatMap((expanded) =>
            session.record(session.graph.dispatchAll(expanded.flat(), String(client))),
          ),
        ),
      )
    return CoreRpcs.of({
      Attach: ({ tab }, { client }) => attach(client.id, tab),
      OpenGraph: ({ graph, wait }, { client }) => open(client.id, graph, wait ?? false),
      ForgetGraph: ({ graph }) => places.forget(graph),
      Dispatch: ({ command }, { client }) => dispatchAll(client.id, [command]),
      DispatchAll: ({ commands }, { client }) => dispatchAll(client.id, commands),
      GetPages: (_, { client }) =>
        Effect.flatMap(current(client.id), (session) => session.graph.pages),
      GetPage: ({ pageId }, { client }) =>
        Effect.flatMap(current(client.id), (session) => session.graph.page(pageId)),
      GetBlock: ({ blockId }, { client }) =>
        Effect.flatMap(current(client.id), (session) =>
          Effect.flatMap(session.blocks([blockId]), ([found]) =>
            found === undefined
              ? Effect.fail(new BlockNotFound({ blockId }))
              : Effect.succeed(found),
          ),
        ),
      WatchPage: ({ pageId }, { client }) =>
        following(client.id, (session) =>
          pageChanges(session, pageId).pipe(
            Stream.filterMapEffect(() => Effect.result(session.graph.page(pageId))),
          ),
        ),
      WatchQuery: ({ query }, { client }) =>
        following(client.id, (session) => Stream.unwrap(watchQuery(session, query))),
      WatchSaveState: (_, { client }) =>
        following(client.id, (session) => SubscriptionRef.changes(session.saving)),
      WatchBlockRefCounts: (_, { client }) =>
        following(client.id, (session) => Stream.orDie(session.index.watchBlockRefCounts)),
      WatchBlockReferences: ({ uuid }, { client }) =>
        following(client.id, (session) =>
          session.index.watchBlockReferences(uuid).pipe(
            Stream.orDie,
            Stream.mapEffect((hits) => session.blocks(hits.map((hit) => hit.blockId))),
          ),
        ),
      Search: ({ text }, { client }) =>
        Effect.gen(function* () {
          const session = yield* current(client.id)
          const hits = yield* Effect.orDie(session.index.search(text))
          return {
            pages: yield* pagesOf(
              session,
              hits.pages.map((hit) => hit.pageId),
            ),
            blocks: yield* session.blocks(hits.blocks.map((hit) => hit.blockId)),
          }
        }),
    })
  }),
)

const journalTitled = (title: string) =>
  Option.isSome(parseJournalDay(title, defaultConfig.journalTitleFormat))

const graphNodeOf = (page: GraphPage): GraphNode => ({
  name: page.name,
  title: page.title,
  kind: page.tag
    ? "tag"
    : page.day !== null || (!page.exists && journalTitled(page.title))
      ? "journal"
      : "page",
  created: page.created,
})

const PageHandlers = PageRpcs.toLayer(
  Effect.gen(function* () {
    const { current, following } = yield* Sessions
    return PageRpcs.of({
      WatchReferences: ({ pageId }, { client }) =>
        following(client.id, (session) =>
          session.index.watchBacklinks(pageId).pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchNameReferences: ({ name }, { client }) =>
        following(client.id, (session) =>
          session.index.watchBacklinksToName(name).pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchUnlinkedReferences: ({ pageId }, { client }) =>
        following(client.id, (session) =>
          session.index
            .watchUnlinkedReferences(pageId)
            .pipe(Stream.map(referencesOf), Stream.orDie),
        ),
      WatchPageStats: (_, { client }) =>
        following(client.id, (session) => Stream.orDie(session.index.watchPageStats)),
      WatchReferencedPages: (_, { client }) =>
        following(client.id, (session) =>
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
      WatchPagesGraph: (_, { client }) =>
        following(client.id, (session) =>
          session.index.watchPagesGraph.pipe(
            Stream.map(({ pages, links }) => ({ nodes: pages.map(graphNodeOf), links })),
            Stream.orDie,
          ),
        ),
      Ancestors: ({ blockIds }, { client }) =>
        Effect.flatMap(current(client.id), (session) => ancestorsOf(session, blockIds)),
    })
  }),
)

export const RealCore = Layer.mergeAll(CoreHandlers, PageHandlers).pipe(Layer.provide(SessionsLive))
