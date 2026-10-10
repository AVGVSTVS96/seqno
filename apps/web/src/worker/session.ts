import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { GraphEvent, PageId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Index } from "@seqno/index"
import { LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { Entry, Storage, Vault, layer as vaultLayer, type StorageFailed } from "@seqno/vault"
import { todaysJournal } from "./journal.ts"
import { Device, layerFolder, type GraphPlace, type Starter } from "./place.ts"

export interface Session {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly record: (events: ReadonlyArray<GraphEvent>) => Effect.Effect<void>
}

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

export const openSession = (
  place: GraphPlace,
  changed: (touched: Touched) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const { device, peer } = yield* Device
    const graph = yield* serviceOf(
      Graph,
      Graph.layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }),
    )
    const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(place.sqlite)))
    const storage = Layer.succeed(Storage, place.storage)
    const vault = yield* serviceOf(
      Vault,
      vaultLayer({
        device,
        peer,
        members: [device],
        compactAfterFiles: 100,
        compactEvery: "1 hour",
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
            const touched = new Set([...events.map(ownPage), ...(yield* movedFrom(events))])
            const version = yield* graph.version
            yield* index.apply(events, JSON.stringify([...version].toSorted()))
            yield* changed(touched)
          }).pipe(Effect.orDie)

    const replica = vaultReplica({
      ...graph,
      merge: (blobs) => Effect.tap(graph.merge(blobs), record),
    })
    const save = graph.flush((update) => vault.writeUpdate(update.bytes))

    if (place.starter !== null) yield* layStarter(place.storage, place.starter)
    const opened = yield* vault.sync(replica)
    if (opened.merged.length === 0 && opened.waiting.length === 0) {
      const imported = yield* importGraph.pipe(
        Effect.provide(Layer.merge(layerFolder(place.storage), LogseqSyntaxLive)),
      )
      yield* record(yield* graph.load(imported.pages))
    }
    yield* record(yield* graph.load(yield* todaysJournal(graph)))
    yield* save

    yield* Effect.forkScoped(Effect.repeat(logged(save), Schedule.spaced("250 millis")))
    yield* Effect.forkScoped(
      Effect.repeat(logged(vault.sync(replica)), Schedule.spaced("5 seconds")),
    )
    yield* Effect.addFinalizer(() => logged(save))

    const session: Session = { graph, index, record }
    return session
  })
