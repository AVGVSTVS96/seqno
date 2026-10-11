import {
  Cause,
  Context,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  Schedule,
  Schema,
  SubscriptionRef,
} from "effect"
import { GraphEvent, PageId } from "@seqno/domain"
import { Graph, newPeerId, vaultReplica } from "@seqno/graph"
import { Index } from "@seqno/index"
import { ImportIssue, LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { SaveState, type SkippedFile } from "@seqno/rpc"
import { Entry, Storage, Vault, layer as vaultLayer, type StorageFailed } from "@seqno/vault"
import { todaysJournal } from "./journal.ts"
import { Device, layerFolder, type GraphPlace, type Starter } from "./place.ts"

export interface Session {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly touched: SubscriptionRef.SubscriptionRef<Touched>
  readonly saving: SubscriptionRef.SubscriptionRef<SaveState>
  readonly skipped: ReadonlyArray<SkippedFile>
  readonly record: (events: ReadonlyArray<GraphEvent>) => Effect.Effect<void>
  readonly indexed: Effect.Effect<void>
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

const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.asVoid(Effect.catchCause(effect, (cause) => Effect.logError(cause)))

const starterStamp = "starter-version"
const decodeStamp = Schema.decodeUnknownOption(Schema.FiniteFromString)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const stampOf = (storage: Storage["Service"]) =>
  storage.read(starterStamp).pipe(
    Effect.map((bytes) => decodeStamp(decoder.decode(bytes))),
    Effect.catchTag("FileUnavailable", () => Effect.succeedNone),
  )

const hasEditLog = (storage: Storage["Service"]) =>
  Effect.map(
    Effect.all([storage.list("updates"), storage.list("snapshots")]),
    ([updates, snapshots]) => updates.length + snapshots.length > 0,
  )

const removeFiles = (
  storage: Storage["Service"],
  dir: string,
): Effect.Effect<void, StorageFailed> =>
  Effect.flatMap(storage.list(dir), (entries) =>
    Effect.forEach(
      entries,
      (entry) => {
        const path = dir === "" ? entry.name : `${dir}/${entry.name}`
        return Entry.$match(entry, {
          File: () => storage.remove(path),
          Directory: () => removeFiles(storage, path),
        })
      },
      { discard: true },
    ),
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
    const graph = yield* serviceOf(
      Graph,
      Graph.layer({ peer, snapshot: Option.none(), updates: [] }),
    )
    const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(place.sqlite)))
    const storage = Layer.succeed(Storage, place.storage)
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

    const movedFrom = (events: ReadonlyArray<GraphEvent>) => {
      const moved = events.flatMap((event) => (event._tag === "BlockMoved" ? [event.blockId] : []))
      return moved.length === 0
        ? Effect.succeed([])
        : Effect.map(index.query(PAGES_OF_BLOCKS, [JSON.stringify(moved)]), (rows) =>
            rows.flatMap(([id]) => Option.toArray(decodePageId(id))),
          )
    }

    const record = (events: ReadonlyArray<GraphEvent>) =>
      events.length === 0
        ? Effect.void
        : Effect.gen(function* () {
            const pages = new Set([...events.map(ownPage), ...(yield* movedFrom(events))])
            const version = yield* graph.version
            yield* index.apply(events, JSON.stringify([...version].toSorted()))
            yield* SubscriptionRef.set(touched, pages)
            edits.count += 1
            yield* SubscriptionRef.set(saving, SaveState.cases.Unsaved.make({}))
            yield* unsaved.open
          }).pipe(Effect.orDie)

    const indexed = yield* Latch.make(true)
    const scope = yield* Effect.scope
    const fillIndex = Effect.andThen(
      indexed.close,
      Effect.forkIn(
        index.fill(graph.everything).pipe(logged, Effect.ensuring(indexed.open)),
        scope,
      ),
    )
    const replica = vaultReplica({
      ...graph,
      merge: (blobs) =>
        Effect.flatMap(graph.version, (version) =>
          version.size === 0
            ? graph
                .restore(blobs)
                .pipe(
                  Effect.ensuring(
                    Effect.flatMap(graph.version, (now) =>
                      now.size > 0 ? fillIndex : Effect.void,
                    ),
                  ),
                  Effect.as([]),
                )
            : Effect.tap(graph.merge(blobs), record),
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

    if (place.starter !== null) yield* layStarter(place.storage, place.starter)
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
      const seeded = yield* graph.seed(imported.pages)
      if (Option.isSome(seeded.update)) yield* vault.writeUpdate(seeded.update.value.bytes)
      yield* record(seeded.events)
    }
    yield* record(yield* graph.load(yield* todaysJournal(graph)))
    yield* save

    yield* Effect.forkScoped(Effect.forever(Effect.andThen(unsaved.await, saveNow)))
    yield* Effect.forkScoped(
      Effect.repeat(logged(vault.sync(replica)), Schedule.spaced("5 seconds")),
    )
    yield* Effect.addFinalizer(() => logged(save))

    const session: Session = {
      graph,
      index,
      touched,
      saving,
      skipped,
      record,
      indexed: indexed.await,
    }
    return session
  })
