import {
  Cause,
  Clock,
  Context,
  Schedule,
  Effect,
  Exit,
  Latch,
  Layer,
  Option,
  PubSub,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { SecureRandom } from "effect/crypto"
import { BlockId, GraphEvent, PageId } from "@seqno/domain"
import type { Block } from "@seqno/domain"
import { Graph, inBackground, newPeerId, vaultReplica } from "@seqno/graph"
import { Index, PropertySettings } from "@seqno/index"
import type { IndexError } from "@seqno/index"
import {
  defaultPropertyConfig,
  propertyConfigKey,
  readPropertyConfig,
  writeConfigFlag,
} from "@seqno/syntax"
import {
  ImportIssue,
  LogseqSyntax,
  LogseqSyntaxLive,
  configPath,
  defaultConfig,
  importGraph,
  parseConfig,
  refsIn,
} from "@seqno/interop"
import type { SkippedFile } from "@seqno/rpc"
import { Storage, Vault, layer as vaultLayer } from "@seqno/vault"
import type { StorageFailed } from "@seqno/vault"
import { openAssetFiles } from "./assets.ts"
import type { AssetFiles } from "./assets.ts"
import { openAppFiles } from "./files.ts"
import type { AppFiles } from "./files.ts"
import { openGit } from "./git.ts"
import type { GraphGit } from "./git.ts"
import { todaysJournal } from "./journal.ts"
import { hasEditLog, openEditLog, removeFiles } from "./layout.ts"
import { openMergeBack } from "./merge-back.ts"
import { openMirror } from "./mirror.ts"
import type { Mirror, MirrorDeps } from "./mirror.ts"
import { openSaveLog } from "./saving.ts"
import type { SaveLog } from "./saving.ts"
import { openWriters, outweighed, staleSince } from "./writer.ts"
import { Device, layerFolder } from "./place.ts"
import type { GraphPlace, Starter } from "./place.ts"
import { hasReason } from "./reason.ts"

export interface Committed {
  readonly events: readonly GraphEvent[]
  readonly client: number | null
  readonly pages: ReadonlySet<PageId>
}

export interface Session {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly blocks: (ids: readonly BlockId[]) => Effect.Effect<readonly Block[]>
  readonly blocksByRef: (uuids: readonly string[]) => Effect.Effect<readonly Block[]>
  readonly touched: SubscriptionRef.SubscriptionRef<Touched>
  readonly changes: PubSub.PubSub<Committed>
  readonly saving: SaveLog
  readonly assets: AssetFiles
  readonly appFiles: AppFiles
  readonly skipped: readonly SkippedFile[]
  readonly newPageFormat: "org" | undefined
  readonly record: <E, R>(
    change: Effect.Effect<readonly GraphEvent[], E, R>,
    client?: number,
  ) => Effect.Effect<readonly GraphEvent[], E, R>
  readonly indexed: Effect.Effect<void>
  readonly rebuildIndex: Effect.Effect<void>
  readonly setConfigFlag: (key: string, value: boolean) => Effect.Effect<void, StorageFailed>
  readonly mirror: Mirror
  readonly writeFilesHere: Effect.Effect<void>
  readonly gaveWay: Effect.Effect<void>
  readonly closing: Effect.Effect<void>
  readonly git: GraphGit | null
}

const skippedFile = ImportIssue.match({
  NotDownloaded: ({ path }) => ({ path, reason: "isn't downloaded from iCloud yet" }),
  Unreadable: ({ path, reason }) => ({ path, reason: `couldn't be read: ${reason}` }),
  Unsupported: ({ path }) => ({ path, reason: "isn't a Markdown or Org page" }),
  DuplicatePage: ({ path, name }) => ({
    path,
    reason: `has the same page name as an earlier file: ${name}`,
  }),
  DuplicateBlockId: ({ path, id }) => ({
    path,
    reason: `repeats the block id ${id}, so that block got a new one`,
  }),
})

const refsOf = (event: GraphEvent): readonly string[] =>
  event._tag === "BlockUpserted"
    ? [event.block.text, ...Object.values(event.block.props)].flatMap(refsIn)
    : []

const reasonOf = (cause: unknown): string =>
  hasReason(cause) ? String(cause.reason) : cause instanceof Error ? cause.message : String(cause)

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

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

const BLOCKS_WITH_ID_PROPERTY = `
SELECT b.id FROM props p JOIN blocks b ON b.rid = p.block
WHERE p.key = 'id' AND p.value IN (SELECT value FROM json_each(?))`

const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.asVoid(Effect.catchCause(effect, (cause) => Effect.logError(cause)))

const IndexStamp = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Record(Schema.String, Schema.Int),
    pageMs: Schema.Number,
    properties: Schema.optionalKey(Schema.String),
  }),
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

    if (Option.contains(stamp, starter.version)) {
      return
    }

    const stale = Option.isSome(stamp) || (yield* hasEditLog(storage))

    if (stale) {
      yield* removeFiles(storage, "")
    }

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
    const changes = yield* PubSub.unbounded<Committed>()
    const saving = yield* openSaveLog
    const unsaved = yield* Latch.make(false)
    const filling = { running: false, marked: false }

    if (place.starter !== null) {
      yield* layStarter(place.storage, place.starter)
    }

    const log = yield* openEditLog(place.storage, place.layout, device)
    const graph = yield* serviceOf(Graph, log.graph({ peer, snapshot: Option.none(), updates: [] }))

    const configFile = yield* place.storage.read(configPath).pipe(
      Effect.map((bytes) => decoder.decode(bytes)),
      Effect.option,
    )

    const configText = Option.getOrElse(configFile, () => "")
    const config = Option.match(configFile, { onNone: () => defaultConfig, onSome: parseConfig })
    const properties = readPropertyConfig(configText)
    const newPageFormat = config.preferredFormat === "org" ? "org" : undefined
    const propertiesKey = propertyConfigKey(properties)

    const index = yield* serviceOf(
      Index,
      Index.layer.pipe(
        Layer.provide(place.sqlite),
        Layer.provide(Layer.succeed(PropertySettings, properties)),
      ),
    )

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

    const pagesOfBlocks = (blocks: readonly string[]) =>
      blocks.length === 0
        ? Effect.succeed([])
        : Effect.map(index.query(PAGES_OF_BLOCKS, [JSON.stringify(blocks)]), (rows) =>
            rows.flatMap(([id]) => Option.toArray(decodePageId(id))),
          )

    const blocks = (ids: readonly BlockId[]) =>
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

    const movedFrom = (events: readonly GraphEvent[]) =>
      pagesOfBlocks(events.flatMap((event) => (event._tag === "BlockMoved" ? [event.blockId] : [])))

    const indexing = yield* Semaphore.make(1)
    const quiet = yield* Latch.make(false)
    const recording = { pending: 0 }
    const sinceSave = { pages: new Set<PageId>(), rewritten: 0 }
    const costs = { pageMs: Option.none<number>(), saveMs: Option.none<number>() }

    const indexEvents = (events: readonly GraphEvent[], client: number | null) =>
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

            for (const page of pages) {
              sinceSave.pages.add(page)
            }

            yield* SubscriptionRef.set(touched, pages)
            yield* PubSub.publish(changes, { events, client, pages })
            yield* saving.edited
            yield* unsaved.open
          }).pipe(Effect.orDie)

    const record = <E, R>(change: Effect.Effect<readonly GraphEvent[], E, R>, client?: number) =>
      Effect.suspend(() => {
        recording.pending += 1

        return indexing.withPermits(1)(
          Effect.tap(change, (events) => indexEvents(events, client ?? null)),
        )
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
                encodeIndexStamp({
                  version: Object.fromEntries(version),
                  pageMs,
                  properties: propertiesKey,
                }),
              )

              sinceSave.pages.clear()
              sinceSave.rewritten = 0

              return Option.some(bytes)
            }),
          )

          if (Option.isSome(image)) {
            yield* place.indexFile.write(image.value)
          }

          return image
        }),
      )

      if (Option.isSome(saved)) {
        costs.saveMs = Option.some(ms)
      }
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
    const opened = yield* Latch.make(false)
    const scope = yield* Effect.scope

    const loaded = Effect.gen(function* () {
      const [image, ms] = yield* timed(place.indexFile.read)
      yield* opened.await

      if (Option.isNone(image)) {
        return false
      }

      return yield* indexing.withPermits(1)(
        Effect.gen(function* () {
          const stamp = Option.flatMap(yield* index.load(image.value), decodeIndexStamp)

          if (Option.isNone(stamp)) {
            return false
          }

          const builtWith = stamp.value.properties ?? propertyConfigKey(defaultPropertyConfig)

          if (builtWith !== propertiesKey) {
            return false
          }

          const changed = yield* graph.changedSince(new Map(Object.entries(stamp.value.version)))

          if (Option.isNone(changed)) {
            return false
          }

          const pages = new Set([
            ...changed.value.pages,
            ...(yield* pagesOfBlocks([...changed.value.blocks])),
          ])

          if (pages.size > 0) {
            yield* index.owe([...pages], pagesIn(pages))
          }

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

        if (unwritten.size === 0) {
          filling.running = false
        }

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

        if (long) {
          costs.pageMs = Option.some(ms / count)
        }

        pages = yield* owed
      }
    })

    const fillIndex = (fresh: boolean) =>
      Effect.andThen(
        Effect.andThen(
          indexed.close,
          Effect.sync(() => {
            filling.running = true
            filling.marked = false
          }),
        ),
        Effect.forkIn(
          Effect.andThen(
            fresh ? started : Effect.flatMap(loaded, (caught) => (caught ? Effect.void : started)),
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

    const openIndex = fillIndex(false)

    const restore = (blobs: readonly Uint8Array[]) =>
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
      const at = yield* saving.started
      const exit = yield* Effect.exit(save)

      if (Exit.isFailure(exit)) {
        yield* Effect.logError(exit.cause)
        yield* saving.failed(reasonOf(Cause.squash(exit.cause)))
      } else {
        yield* saving.saved(at)
      }
    })

    const writers = yield* openWriters({
      me: device,
      synced: place.synced,
      setMirror: vault.setMirror,
    })

    const lineage = Effect.map(graph.roots, (roots) => {
      const imported = roots.filter((root) => root.imported)
      const [only, ...rest] = imported.length > 0 ? imported : roots

      return only !== undefined && rest.length === 0 ? only.peer : null
    })

    const gaveWay = yield* Latch.make(false)
    const synced = yield* vault.sync(replica)
    yield* writers.heard(synced, yield* lineage)
    const skipped: SkippedFile[] = []

    if (synced.merged.length === 0 && synced.waiting.length === 0) {
      const imported = yield* importGraph.pipe(
        Effect.provide(Layer.merge(layerFolder(place.storage), LogseqSyntaxLive)),
      )

      skipped.push(
        ...imported.issues
          .map(skippedFile)
          .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      )
      yield* place.mirrorStore.clear
      const seeded = yield* graph.seed(log.incoming(imported.pages))

      if (Option.isSome(seeded.update)) {
        yield* vault.writeUpdate(seeded.update.value.bytes)
      }

      yield* record(Effect.succeed(seeded.events))
    }

    yield* record(
      Effect.flatMap(todaysJournal(graph, newPageFormat), (pages) =>
        graph.load(log.incoming(pages)),
      ),
    )
    yield* save

    yield* Effect.forkScoped(Effect.forever(Effect.andThen(unsaved.await, saveNow)))
    const mayWrite = Effect.map(SubscriptionRef.get(writers.state), (state) => state.mayWrite)

    const git =
      place.git === undefined ? null : yield* openGit(yield* place.git, place.storage, mayWrite)

    const assets = yield* openAssetFiles(place.storage, place.file, git?.touched)
    const appFiles = yield* openAppFiles(place.storage, place.changed, git?.touched)
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* quiet.await
          yield* quiet.close

          if (worthSaving()) {
            yield* saveIndexNow
          }
        }),
      ),
    )
    yield* Effect.addFinalizer(() => Effect.andThen(logged(save), saveIndexNow))

    const blocksByRef = (uuids: readonly string[]) =>
      Effect.gen(function* () {
        const wanted = [...new Set(uuids.map((uuid) => uuid.toLowerCase()))]
        const direct = yield* blocks(wanted.flatMap((uuid) => Option.toArray(decodeBlockId(uuid))))
        const missing = wanted.filter((uuid) => !direct.some((block) => block.id === uuid))

        if (missing.length === 0) {
          return direct
        }

        yield* indexed.await

        const rows = yield* index
          .query(BLOCKS_WITH_ID_PROPERTY, [JSON.stringify(missing)])
          .pipe(Effect.orElseSucceed(() => []))

        const written = yield* blocks(rows.flatMap(([id]) => Option.toArray(decodeBlockId(id))))

        return [...direct, ...written]
      })

    const crypto = yield* SecureRandom.SecureRandom

    const baseVersion = Effect.gen(function* () {
      const stored = yield* place.mirrorStore.version

      if (Option.isSome(stored)) {
        return stored
      }

      const { previous } = yield* SubscriptionRef.get(writers.state)

      if (Option.isSome(previous)) {
        return previous
      }

      return Option.map(yield* graph.origin, (origin) => Object.fromEntries(origin))
    })

    const mergeBack = openMergeBack({ graph, record, blocks, synced: place.synced, baseVersion })

    const mirrorDeps: MirrorDeps = {
      graph,
      index,
      storage: place.storage,
      file: place.file,
      store: place.mirrorStore,
      config,
      syntax: yield* serviceOf(LogseqSyntax, LogseqSyntaxLive),
      indexed: indexed.await,
      mayWrite,
      writer: Effect.map(SubscriptionRef.get(writers.state), (state) => state.writer),
      outside: (change) =>
        Effect.provideService(mergeBack(change), SecureRandom.SecureRandom, crypto),
      baseVersion,
    }

    const mirrored = yield* openMirror(
      git === null ? mirrorDeps : { ...mirrorDeps, wrote: git.touched },
    )

    yield* Effect.forkScoped(
      Stream.runForEach(place.changed, (paths) =>
        Effect.andThen(
          git === null ? Effect.void : git.touched(paths),
          mirrored.mirror.check(paths.includes("") ? undefined : paths),
        ),
      ),
    )
    const committed = yield* PubSub.subscribe(changes)
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const batch = yield* PubSub.takeAll(committed)
          yield* mirrored.mirror.touch(batch.flatMap((one) => [...one.pages]))
          const refs = batch.flatMap((one) => one.events.flatMap(refsOf))

          if (refs.length > 0) {
            const targets = yield* blocksByRef(refs)
            yield* mirrored.mirror.touch(targets.map((block) => block.pageId))
          }
        }),
      ),
    )
    yield* Effect.forkScoped(mirrored.loop)

    const syncOnce = Effect.gen(function* () {
      yield* writers.mirrorVersion(yield* place.mirrorStore.version)
      const report = yield* vault.sync(replica)
      const became = yield* writers.heard(report, yield* lineage)
      const now = yield* SubscriptionRef.get(writers.state)

      if (became && staleSince(yield* place.mirrorStore.version, now.previous)) {
        yield* mirrored.mirror.forget
      }

      const root = yield* lineage

      if (
        root !== null &&
        now.mayWrite &&
        outweighed(device, root, report, yield* graph.version) &&
        (yield* mirrored.mirror.idle)
      ) {
        yield* vault.abandon
        yield* Effect.repeat(mirrored.mirror.idle, {
          until: (idle) => idle,
          schedule: Schedule.spaced("200 millis"),
        })
        yield* place.mirrorStore.clear
        yield* gaveWay.open

        return
      }

      yield* mirrored.mirror.check([])
    })

    const syncPass = place.synced
      ? Effect.andThen(logged(syncOnce), assets.refresh)
      : logged(syncOnce)

    yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep("5 seconds"), syncPass)))

    const session: Session = {
      graph,
      newPageFormat,
      index,
      blocks,
      blocksByRef,
      touched,
      changes,
      saving,
      assets,
      appFiles,
      skipped,
      record,
      indexed: indexed.await,
      rebuildIndex: Effect.andThen(fillIndex(true), indexed.await),
      setConfigFlag: (key, value) =>
        place.storage.read("logseq/config.edn").pipe(
          Effect.map((bytes) => decoder.decode(bytes)),
          Effect.orElseSucceed(() => ""),
          Effect.flatMap((text) =>
            appFiles.write({ path: "logseq/config.edn", text: writeConfigFlag(text, key, value) }),
          ),
        ),
      mirror: mirrored.mirror,
      writeFilesHere: Effect.andThen(writers.takeOver, syncPass),
      gaveWay: gaveWay.await,
      closing: saveIndexNow,
      git,
    }

    yield* opened.open

    return session
  })
