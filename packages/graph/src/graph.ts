import {
  Clock,
  Context,
  Crypto,
  Effect,
  Latch,
  Layer,
  Option,
  PubSub,
  Schema,
  Semaphore,
  Stream,
} from "effect"
import {
  LoroDoc,
  UndoManager,
  VersionVector,
  type LoroEventBatch,
  type LoroTreeNode,
} from "loro-crdt"
import type { Block, BlockId, Command, GraphEvent, Page, PageId } from "@seqno/domain"
import { BlockNotFound, CommandRejected, PageNotFound, type PageTree } from "@seqno/rpc"
import { applyCommand, type Workspace } from "./commands.ts"
import { translate } from "./events.ts"
import { emptyRegistry } from "./registry.ts"
import {
  TREE,
  blockIdOf,
  loadPage,
  pageIdOf,
  placementOf,
  readBlock,
  readPage,
  walkBlocks,
  type Placement,
} from "./tree.ts"

export const PeerId = Schema.String.check(
  Schema.isPattern(/^[1-9][0-9]{0,19}$/),
  Schema.makeFilter((peer: string) => BigInt(peer) < 2n ** 64n - 1n, {
    expected: "a Loro peer id below 2^64 - 1",
  }),
).pipe(Schema.brand("PeerId"))
export type PeerId = typeof PeerId.Type

export class ImportFailed extends Schema.TaggedError<ImportFailed>()("ImportFailed", {
  reason: Schema.String,
}) {}

export interface GraphSource {
  readonly peer: PeerId
  readonly snapshot: Option.Option<Uint8Array>
  readonly updates: ReadonlyArray<Uint8Array>
  readonly undoMergeMs?: number
}

export interface LocalUpdate {
  readonly peer: PeerId
  readonly start: number
  readonly end: number
  readonly bytes: Uint8Array
}

export class Graph extends Context.Service<
  Graph,
  {
    readonly pages: Effect.Effect<ReadonlyArray<Page>>
    readonly page: (id: PageId) => Effect.Effect<PageTree, PageNotFound>
    readonly block: (id: BlockId) => Effect.Effect<Block, BlockNotFound>
    readonly dispatch: (
      command: Command,
    ) => Effect.Effect<ReadonlyArray<GraphEvent>, CommandRejected>
    readonly merge: (
      updates: ReadonlyArray<Uint8Array>,
    ) => Effect.Effect<ReadonlyArray<GraphEvent>, ImportFailed>
    readonly load: (pages: ReadonlyArray<PageTree>) => Effect.Effect<ReadonlyArray<GraphEvent>>
    readonly events: Stream.Stream<GraphEvent>
    readonly flush: <E, R>(
      write: (update: LocalUpdate) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<Option.Option<LocalUpdate>, E, R>
    readonly snapshot: Effect.Effect<Uint8Array>
    readonly version: Effect.Effect<ReadonlyMap<string, number>>
    readonly loaded: Effect.Effect<void>
  }
>()("@seqno/graph/Graph") {
  static readonly layer = (source: GraphSource) => Layer.effect(Graph, make(source))
}

const LOADED = "seqno:load"

const importAll = (doc: LoroDoc, files: ReadonlyArray<Uint8Array>) =>
  Effect.try({
    try: () => files.forEach((bytes) => doc.import(bytes)),
    catch: (cause) => new ImportFailed({ reason: String(cause) }),
  })

const make = (source: GraphSource) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const doc = new LoroDoc()
    doc.setPeerId(BigInt(source.peer))
    yield* importAll(doc, [...Option.toArray(source.snapshot), ...source.updates])
    const tree = doc.getTree(TREE)
    const registry = emptyRegistry()
    for (const root of tree.roots()) {
      Option.map(pageIdOf(root), (id) => registry.pages.set(id, root.id))
    }
    const undo = new UndoManager(doc, {
      mergeInterval: source.undoMergeMs ?? 1000,
      excludeOriginPrefixes: [LOADED],
    })
    const ws: Workspace = { tree, registry, undo }
    const batches: Array<LoroEventBatch> = []
    const unsubscribe = doc.subscribe((batch) => void batches.push(batch))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        undo.free()
        doc.free()
      }),
    )

    const pubsub = yield* PubSub.unbounded<GraphEvent>()
    const lock = yield* Semaphore.make(1)
    const flushing = yield* Semaphore.make(1)
    const filled = yield* Latch.make(false)
    const serial = lock.withPermits(1)
    const peer = doc.peerIdStr
    let flushed = doc.oplogVersion().get(peer) ?? 0

    const drain = Effect.suspend(() => {
      const events = translate(tree, batches.splice(0), registry)
      return Effect.as(PubSub.publishAll(pubsub, events), events)
    })

    const indexPage = (
      id: PageId,
      visit: (child: LoroTreeNode, at: Placement) => Option.Option<BlockId>,
    ) => {
      const node = Option.flatMap(Option.fromUndefinedOr(registry.pages.get(id)), (nodeId) =>
        Option.fromUndefinedOr(tree.getNodeByID(nodeId)),
      )
      Option.map(node, (page) =>
        walkBlocks(page, { pageId: id, parentId: null }, (child, at) =>
          Option.map(visit(child, at), (blockId) => {
            registry.blocks.set(blockId, child.id)
            return blockId
          }),
        ),
      )
      registry.loaded.add(id)
    }

    yield* Effect.forEach(
      [...registry.pages.keys()],
      (id) =>
        Effect.sync(() => {
          if (!registry.loaded.has(id)) indexPage(id, blockIdOf)
        }).pipe(Effect.andThen(Effect.yieldNow)),
      { discard: true },
    ).pipe(Effect.andThen(filled.open), Effect.forkScoped)

    const pages = serial(
      Effect.sync(() =>
        tree
          .roots()
          .flatMap((root) => (tree.isNodeDeleted(root.id) ? [] : Option.toArray(readPage(root)))),
      ),
    )

    const page = (id: PageId) =>
      serial(
        Effect.suspend(() => {
          const node = Option.flatMap(Option.fromUndefinedOr(registry.pages.get(id)), (nodeId) =>
            tree.isNodeDeleted(nodeId)
              ? Option.none()
              : Option.fromUndefinedOr(tree.getNodeByID(nodeId)),
          )
          return Option.match(Option.flatMap(node, readPage), {
            onNone: () => Effect.fail(new PageNotFound({ pageId: id })),
            onSome: (found) => {
              const blocks: Array<Block> = []
              indexPage(id, (child, at) =>
                Option.map(readBlock(child, at), ({ block }) => {
                  blocks.push(block)
                  return block.id
                }),
              )
              return Effect.succeed({ page: found, blocks })
            },
          })
        }),
      )

    const findBlock = (id: BlockId) =>
      Effect.suspend(() => {
        const node = Option.flatMap(Option.fromUndefinedOr(registry.blocks.get(id)), (nodeId) =>
          tree.isNodeDeleted(nodeId)
            ? Option.none()
            : Option.fromUndefinedOr(tree.getNodeByID(nodeId)),
        )
        const found = Option.flatMap(node, (at) =>
          Option.flatMap(placementOf(at), (placement) => readBlock(at, placement)),
        )
        return Option.match(found, {
          onNone: () => Effect.fail(new BlockNotFound({ blockId: id })),
          onSome: ({ block }) => Effect.succeed(block),
        })
      })

    const block = (id: BlockId) =>
      serial(
        findBlock(id).pipe(
          Effect.catchTag("BlockNotFound", (missing) =>
            registry.blocks.has(id)
              ? Effect.fail(missing)
              : Effect.andThen(filled.await, findBlock(id)),
          ),
        ),
      )

    const dispatch = (command: Command) =>
      serial(
        applyCommand(ws, command).pipe(
          Effect.catchTag("Unresolved", () =>
            Effect.andThen(filled.await, applyCommand(ws, command)),
          ),
          Effect.catchTag("Unresolved", ({ id }) =>
            Effect.fail(new CommandRejected({ reason: `block ${id} does not exist` })),
          ),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.andThen(Effect.sync(() => doc.commit())),
          Effect.andThen(drain),
        ),
      )

    const ownCounter = () => doc.oplogVersion().get(peer) ?? 0

    const merge = (updates: ReadonlyArray<Uint8Array>) =>
      serial(
        Effect.suspend(() => {
          const caughtUp = ownCounter() === flushed
          return importAll(doc, updates).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (caughtUp) flushed = ownCounter()
              }),
            ),
            Effect.andThen(drain),
          )
        }),
      )

    const load = (loaded: ReadonlyArray<PageTree>) =>
      serial(
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            Effect.sync(() => {
              loaded.forEach((one) => loadPage(tree, one, now))
              doc.commit({ origin: LOADED })
            }),
          ),
          Effect.andThen(drain),
        ),
      )

    const flush = <E, R>(write: (update: LocalUpdate) => Effect.Effect<void, E, R>) =>
      flushing.withPermits(1)(
        Effect.gen(function* () {
          const update = yield* serial(
            Effect.sync(() => {
              const version = doc.oplogVersion()
              const end = version.get(peer) ?? 0
              if (end === flushed) return Option.none<LocalUpdate>()
              const from = version.toJSON()
              from.set(peer, flushed)
              const bytes = doc.export({ mode: "update", from: VersionVector.parseJSON(from) })
              return Option.some({ peer: source.peer, start: flushed, end, bytes })
            }),
          )
          if (Option.isSome(update)) {
            yield* write(update.value)
            flushed = update.value.end
          }
          return update
        }),
      )

    return Graph.of({
      pages,
      page,
      block,
      dispatch,
      merge,
      load,
      events: Stream.fromPubSub(pubsub),
      flush,
      snapshot: serial(Effect.sync(() => doc.export({ mode: "snapshot" }))),
      version: serial(Effect.sync(() => new Map(doc.oplogVersion().toJSON()))),
      loaded: filled.await,
    })
  })
