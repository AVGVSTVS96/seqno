import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  Schedule,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { GraphEvent, PageId, type Block, type BlockId } from "@seqno/domain"
import { Graph, inBackground, newPeerId, vaultReplica } from "@seqno/graph"
import { Index, type IndexError } from "@seqno/index"
import { ImportIssue, LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { SaveState, type SkippedFile } from "@seqno/rpc"
import { Storage, Vault, layer as vaultLayer } from "@seqno/vault"
import { todaysJournal } from "./journal.ts"
import { hasEditLog, openEditLog, removeFiles } from "./layout.ts"
import { Device, layerFolder, type GraphPlace, type Starter } from "./place.ts"

export interface Session {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly blocks: (ids: ReadonlyArray<BlockId>) => Effect.Effect<ReadonlyArray<Block>>
  readonly touched: SubscriptionRef.SubscriptionRef<Touched>
  readonly saving: SubscriptionRef.SubscriptionRef<SaveState>
  readonly skipped: ReadonlyArray<SkippedFile>
  readonly record: <E, R>(
    change: Effect.Effect<ReadonlyArray<GraphEvent>, E, R>,
  ) => Effect.Effect<ReadonlyArray<GraphEvent>, E, R>
  readonly indexed: Effect.Effect<void>
  readonly closing: Effect.Effect<void>
}

const skippedFile = ImportIssue.match({
  NotDownloaded: ({ path }) => ({ path, reason: "isn't downloaded from iCloud yet" }),
  Unreadable: ({ path, reason }) => ({ path, reason: `couldn't be read: ${reason}` }),
  Unsupported: ({ path }) => ({ path, reason: "isn't a Markdown page" }),
  DuplicatePage: ({ path, name }) => ({
    path,
    reason: `has the same page name as an earlier file: ${name}`,
  }),
  DuplicateBlockId: ({ path, id }) => ({
    path,
    reason: `repeats the block id ${id}, so that block got a new one`,
  }),
})

const reasonOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : error instanceof Error
      ? error.message
      : String(error)

const serviceOf = <I, S, E, R>(tag: Context.Key<I, S>, layer: Layer.Layer<I, E, R>) =>
  Effect.map(Layer.build(layer), (context) => Context.get(context, tag))

export type Touched = ReadonlySet<PageId>

const decodePageId = Schema.decodeUnknownOption(PageId)

const ownPage = (event: GraphEvent): PageId =>
  GraphEvent.match(event, {
    PageUpserted: ({ page }) => page.id,
    PageDeleted: ({ pageId }) => pageId,
    BlockUpserted: ({ block }) => block.pageId,
    BlockMoved: ({ pageId }) => pageId,
    BlockDeleted: ({ pageId }) => pageId,
  })

const PAGES_OF_BLOCKS = `
SELECT DISTINCT p.id FROM blocks b JOIN pages p ON p.rid = b.page
WHERE b.id IN (SELECT value FROM json_each(?))`

const BLOCK_PAGES = `
SELECT b.id, p.id FROM blocks b JOIN pages p ON p.rid = b.page
WHERE b.id IN (SELECT value FROM json_each(?))`

const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.asVoid(Effect.catchCause(effect, (cause) => Effect.logError(cause)))

const IndexStamp = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Record(Schema.String, Schema.Int), pageMs: Schema.Number }),
)
const decodeIndexStamp = Schema.decodeUnknownOption(IndexStamp)
const encodeIndexStamp = Schema.encodeSync(IndexStamp)

const timed = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    const value = yield* effect
    return [value, (yield* Clock.currentTimeMillis) - started] as const
  })

const starterStamp = "starter-version"
const decodeStamp = Schema.decodeUnknownOption(Schema.FiniteFromString)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const stampOf = (storage: Storage["Service"]) =>
  storage.read(starterStamp).pipe(
    Effect.map((bytes) => decodeStamp(decoder.decode(bytes))),
    Effect.catchTag("FileUnavailable", () => Effect.succeedNone),
  )

const layStarter = (storage: Storage["Service"], starter: Starter) =>
  Effect.gen(function* () {
    const stamp = yield* stampOf(storage)
    if (Option.contains(stamp, starter.version)) return
    const stale = Option.isSome(stamp) || (yield* hasEditLog(storage))
    if (stale) yield* removeFiles(storage, "")
    if (stale || (yield* storage.list("")).length === 0) {
      yield* Effect.forEach(
        starter.files,
        (file) => storage.write(file.path, encoder.encode(file.text)),
        { discard: true },
      )
    }
    yield* storage.write(starterStamp, encoder.encode(String(starter.version)))
  })

export const openSession = (place: GraphPlace) =>
  Effect.gen(function* () {
    const { device, formerPeers } = yield* Device
    const peer = yield* newPeerId
    const touched = yield* SubscriptionRef.make<Touched>(new Set())
    const saving = yield* SubscriptionRef.make<SaveState>(SaveState.cases.Saved.make({}))
    const unsaved = yield* Latch.make(false)
    const edits = { count: 0 }
    const filling = { running: false, marked: false }
    if (place.starter !== null) yield* layStarter(place.storage, place.starter)
    const log = yield* openEditLog(place.storage, place.layout, device)
    const graph = yield* serviceOf(Graph, log.graph({ peer, snapshot: Option.none(), updates: [] }))
    const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(place.sqlite)))
    const storage = Layer.succeed(Storage, log.storage)
    const vault = yield* serviceOf(
      Vault,
      vaultLayer({
        device,
        formerPeers,
        synced: place.synced,
        members: [device],
        compactAfterFiles: 100,
        compactEvery: place.synced ? "1 hour" : 0,
      }).pipe(Layer.provide(storage)),
    )

    const pagesOfBlocks = (blocks: ReadonlyArray<string>) =>
      blocks.length === 0
        ? Effect.succeed([])
        : Effect.map(index.query(PAGES_OF_BLOCKS, [JSON.stringify(blocks)]), (rows) =>
            rows.flatMap(([id]) => Option.toArray(decodePageId(id))),
          )

    const blocks = (ids: ReadonlyArray<BlockId>) =>
      Effect.gen(function* () {
        const rows =
          ids.length === 0
            ? []
            : yield* index
                .query(BLOCK_PAGES, [JSON.stringify(ids)])
                .pipe(Effect.orElseSucceed(() => []))
        const pageOf = new Map(
          rows.flatMap(([block, page]) =>
            Option.toArray(Option.map(decodePageId(page), (id) => [block, id] as const)),
          ),
        )
        const found = yield* Effect.forEach(ids, (id) =>
          Effect.option(graph.block(id, pageOf.get(id))),
        )
        return found.flatMap(Option.toArray)
      })

    const movedFrom = (events: ReadonlyArray<GraphEvent>) =>
      pagesOfBlocks(events.flatMap((event) => (event._tag === "BlockMoved" ? [event.blockId] : [])))

    const indexing = yield* Semaphore.make(1)
    const quiet = yield* Latch.make(false)
    const recording = { pending: 0 }
    const sinceSave = { pages: new Set<PageId>(), rewritten: 0 }
    const costs = { pageMs: Option.none<number>(), saveMs: Option.none<number>() }

    const indexEvents = (events: ReadonlyArray<GraphEvent>) =>
      events.length === 0
        ? Effect.void
        : Effect.gen(function* () {
            const pages = new Set([...events.map(ownPage), ...(yield* movedFrom(events))])
            yield* index
              .apply(events)
              .pipe(
                Effect.catchTag("IndexError", (error) =>
                  filling.running ? index.owe([...pages], Effect.succeed([])) : Effect.fail(error),
                ),
              )
            pages.forEach((page) => sinceSave.pages.add(page))
            yield* SubscriptionRef.set(touched, pages)
            edits.count += 1
            yield* SubscriptionRef.set(saving, SaveState.cases.Unsaved.make({}))
            yield* unsaved.open
          }).pipe(Effect.orDie)

    const record = <E, R>(change: Effect.Effect<ReadonlyArray<GraphEvent>, E, R>) =>
      Effect.suspend(() => {
        recording.pending += 1
        return indexing.withPermits(1)(Effect.tap(change, indexEvents))
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            recording.pending -= 1
            return recording.pending === 0 ? quiet.open : Effect.void
          }),
        ),
      )

    const saveIndex = Effect.gen(function* () {
      const [saved, ms] = yield* timed(
        Effect.gen(function* () {
          const image = yield* indexing.withPermits(1)(
            Effect.gen(function* () {
              if (
                (filling.running && !filling.marked) ||
                (sinceSave.rewritten === 0 && sinceSave.pages.size === 0)
              ) {
                return Option.none<Uint8Array<ArrayBuffer>>()
              }
              const version = yield* graph.version
              const pageMs = Option.getOrElse(costs.pageMs, () => 0)
              const bytes = yield* index.image(
                encodeIndexStamp({ version: Object.fromEntries(version), pageMs }),
              )
              sinceSave.pages.clear()
              sinceSave.rewritten = 0
              return Option.some(bytes)
            }),
          )
          if (Option.isSome(image)) yield* place.indexFile.write(image.value)
          return image
        }),
      )
      if (Option.isSome(saved)) costs.saveMs = Option.some(ms)
    }).pipe(logged)

    const savingIndex = yield* Semaphore.make(1)
    const saveIndexNow = savingIndex.withPermits(1)(Effect.uninterruptible(saveIndex))

    const worthSaving = () =>
      Option.isSome(costs.pageMs) &&
      Option.isSome(costs.saveMs) &&
      sinceSave.pages.size * costs.pageMs.value > costs.saveMs.value

    const pagesIn = (ids: ReadonlySet<PageId>) =>
      Effect.map(graph.pages, (pages) => pages.filter((page) => ids.has(page.id)))

    const indexed = yield* Latch.make(true)
    const scope = yield* Effect.scope

    const loaded = Effect.gen(function* () {
      const [image, ms] = yield* timed(place.indexFile.read)
      if (Option.isNone(image)) return false
      return yield* indexing.withPermits(1)(
        Effect.gen(function* () {
          const stamp = Option.flatMap(yield* index.load(image.value), decodeIndexStamp)
          if (Option.isNone(stamp)) return false
          const changed = yield* graph.changedSince(new Map(Object.entries(stamp.value.version)))
          if (Option.isNone(changed)) return false
          const pages = new Set([
            ...changed.value.pages,
            ...(yield* pagesOfBlocks([...changed.value.blocks])),
          ])
          if (pages.size > 0) yield* index.owe([...pages], pagesIn(pages))
          costs.saveMs = Option.some(ms)
          costs.pageMs = Option.some(stamp.value.pageMs)
          filling.marked = true
          return true
        }),
      )
    })

    const started = indexing.withPermits(1)(
      Effect.andThen(
        index.start(graph.pages),
        Effect.sync(() => {
          filling.marked = true
        }),
      ),
    )

    const progress = { written: 0, savedAt: 0, saving: false }
    const wrote = (savesProgress: boolean) =>
      Effect.suspend(() => {
        sinceSave.rewritten += 1
        progress.written += 1
        if (!savesProgress || progress.saving || progress.written < 2 * progress.savedAt) {
          return Effect.void
        }
        progress.saving = true
        progress.savedAt = progress.written
        return Effect.forkIn(
          Effect.ensuring(
            saveIndexNow,
            Effect.sync(() => {
              progress.saving = false
            }),
          ),
          scope,
        )
      })

    const owed = indexing.withPermits(1)(
      Effect.gen(function* () {
        const unwritten = new Set(yield* index.unwritten)
        if (unwritten.size === 0) filling.running = false
        const inOrder = (yield* graph.pages).flatMap((page) =>
          unwritten.delete(page.id) ? [page.id] : [],
        )
        return [...inOrder, ...unwritten]
      }),
    )

    const writeOwed: Effect.Effect<void, IndexError> = Effect.gen(function* () {
      let pages = yield* owed
      while (pages.length > 0) {
        const count = pages.length
        const long = Option.match(Option.all([costs.pageMs, costs.saveMs]), {
          onNone: () => true,
          onSome: ([pageMs, saveMs]) => count * pageMs > saveMs,
        })
        progress.written = 0
        progress.savedAt = Math.ceil(count / 32)
        const [, ms] = yield* timed(
          index.refresh(
            Stream.fromIterable(pages).pipe(
              Stream.mapEffect((page) =>
                Effect.map(graph.pageEvents(page), (events) => [page, events] as const),
              ),
            ),
            () => wrote(long),
          ),
        )
        if (long) costs.pageMs = Option.some(ms / count)
        pages = yield* owed
      }
    })

    const openIndex = Effect.andThen(
      Effect.andThen(
        indexed.close,
        Effect.sync(() => {
          filling.running = true
          filling.marked = false
        }),
      ),
      Effect.forkIn(
        Effect.andThen(
          Effect.flatMap(loaded, (caught) => (caught ? Effect.void : started)),
          writeOwed,
        ).pipe(
          logged,
          Effect.ensuring(
            Effect.andThen(
              Effect.sync(() => {
                filling.running = false
              }),
              indexed.open,
            ),
          ),
          Effect.andThen(saveIndexNow),
          inBackground,
        ),
        scope,
      ),
    )
    const restore = (blobs: ReadonlyArray<Uint8Array>) =>
      graph
        .restore(blobs)
        .pipe(
          Effect.ensuring(
            Effect.flatMap(graph.version, (now) => (now.size > 0 ? openIndex : Effect.void)),
          ),
        )
    const replica = vaultReplica({
      ...graph,
      restore,
      merge: (blobs) =>
        Effect.flatMap(graph.version, (version) =>
          version.size === 0 ? Effect.as(restore(blobs), []) : record(graph.merge(blobs)),
        ),
    })
    const save = graph.flush((update) => vault.writeUpdate(update.bytes))
    const saveNow = Effect.gen(function* () {
      yield* unsaved.close
      const at = edits.count
      const exit = yield* Effect.exit(save)
      if (Exit.isFailure(exit)) {
        yield* Effect.logError(exit.cause)
        yield* SubscriptionRef.set(
          saving,
          SaveState.cases.Failed.make({ reason: reasonOf(Cause.squash(exit.cause)) }),
        )
      } else if (edits.count === at) {
        yield* SubscriptionRef.set(saving, SaveState.cases.Saved.make({}))
      }
    })

    const opened = yield* vault.sync(replica)
    const skipped: Array<SkippedFile> = []
    if (opened.merged.length === 0 && opened.waiting.length === 0) {
      const imported = yield* importGraph.pipe(
        Effect.provide(Layer.merge(layerFolder(place.storage), LogseqSyntaxLive)),
      )
      skipped.push(
        ...imported.issues
          .map(skippedFile)
          .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      )
      const seeded = yield* graph.seed(log.incoming(imported.pages))
      if (Option.isSome(seeded.update)) yield* vault.writeUpdate(seeded.update.value.bytes)
      yield* record(Effect.succeed(seeded.events))
    }
    yield* record(Effect.flatMap(todaysJournal(graph), (pages) => graph.load(log.incoming(pages))))
    yield* save

    yield* Effect.forkScoped(Effect.forever(Effect.andThen(unsaved.await, saveNow)))
    yield* Effect.forkScoped(
      Effect.repeat(logged(vault.sync(replica)), Schedule.spaced("5 seconds")),
    )
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* quiet.await
          yield* quiet.close
          if (worthSaving()) yield* saveIndexNow
        }),
      ),
    )
    yield* Effect.addFinalizer(() => Effect.andThen(logged(save), saveIndexNow))

    const session: Session = {
      graph,
      index,
      blocks,
      touched,
      saving,
      skipped,
      record,
      indexed: indexed.await,
      closing: saveIndexNow,
    }
    return session
  })
