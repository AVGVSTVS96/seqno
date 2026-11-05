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
import { LoroDoc, VersionVector } from "loro-crdt"
import type { LoroTreeNode } from "loro-crdt"
import { importMessage } from "@seqno/domain"
import type { Block, BlockId, Command, GraphEvent, Page, PageId, Root } from "@seqno/domain"
import { BlockNotFound, CommandRejected, PageNotFound } from "@seqno/rpc"
import type { PageTree } from "@seqno/rpc"
import { inBackground } from "./background.ts"
import { changedSince, loroVersion } from "./changes.ts"
import type { Changed } from "./changes.ts"
import { applyCommand, mergeTargetOf, trashOf } from "./commands.ts"
import type { Unresolved } from "./commands.ts"
import { collectChanges, emptyPending, translate } from "./events.ts"
import { histories } from "./history.ts"
import type { Place } from "./history.ts"
import { loader } from "./loader.ts"
import { emptyRegistry } from "./registry.ts"
import { repairAll, repairPages, repairUnseen } from "./repair.ts"
import type { LivePages } from "./repair.ts"
import {
  TREE,
  blockIdOf,
  livePages,
  loadPage,
  livePageIdOf,
  placementOf,
  readBlock,
  readPage,
  walkBlocks,
} from "./tree.ts"
import type { Placement } from "./tree.ts"

export const PeerId = Schema.String.check(
  Schema.isPattern(/^[1-9][0-9]{0,19}$/),
  Schema.makeFilter((peer: string) => BigInt(peer) < 2n ** 64n - 1n, {
    expected: "a Loro peer id below 2^64 - 1",
  }),
).pipe(Schema.brand("PeerId"))

export type PeerId = typeof PeerId.Type

const peerCount = 2n ** 64n - 2n

export const peerOf = (bytes: Uint8Array) =>
  PeerId.make(
    String(
      (bytes.slice(0, 8).reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n) % peerCount) + 1n,
    ),
  )

export const newPeerId = Effect.map(
  Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomBytes(8)),
  peerOf,
)

export const SEED_FORMAT = "seqno-seed-1"

export const seedTime = (pages: readonly PageTree[]) => {
  const day = Math.max(0, ...pages.map(({ page }) => page.journalDay ?? 0))

  return Math.max(
    0,
    Date.UTC(Math.floor(day / 10_000), (Math.floor(day / 100) % 100) - 1, day % 100, 12),
  )
}

export class ImportFailed extends Schema.TaggedError<ImportFailed>()("ImportFailed", {
  reason: Schema.String,
}) {}

export interface GraphSource {
  readonly peer: PeerId
  readonly snapshot: Option.Option<Uint8Array>
  readonly updates: readonly Uint8Array[]
}

export interface LocalUpdate {
  readonly peer: PeerId
  readonly start: number
  readonly end: number
  readonly bytes: Uint8Array
}

export interface Seeded {
  readonly events: readonly GraphEvent[]
  readonly update: Option.Option<LocalUpdate>
}

export class Graph extends Context.Service<
  Graph,
  {
    readonly pages: Effect.Effect<readonly Page[]>
    readonly page: (id: PageId) => Effect.Effect<PageTree, PageNotFound>
    readonly block: (id: BlockId, page?: PageId) => Effect.Effect<Block, BlockNotFound>
    readonly dispatch: (
      command: Command,
      client?: string,
    ) => Effect.Effect<readonly GraphEvent[], CommandRejected>
    readonly dispatchAll: (
      commands: readonly Command[],
      client?: string,
    ) => Effect.Effect<readonly GraphEvent[], CommandRejected>
    readonly release: (client: string) => Effect.Effect<void>
    readonly merge: (
      updates: readonly Uint8Array[],
    ) => Effect.Effect<readonly GraphEvent[], ImportFailed>
    readonly restore: (
      updates: readonly Uint8Array[],
    ) => Effect.Effect<ReadonlyMap<string, number>, ImportFailed>
    readonly everything: Stream.Stream<readonly GraphEvent[]>
    readonly pageEvents: (id: PageId) => Effect.Effect<readonly GraphEvent[]>
    readonly mergeTarget: (id: BlockId) => Effect.Effect<Option.Option<BlockId>>
    readonly load: (pages: readonly PageTree[]) => Effect.Effect<readonly GraphEvent[]>
    readonly seed: (pages: readonly PageTree[]) => Effect.Effect<Seeded>
    readonly events: Stream.Stream<GraphEvent>
    readonly flush: <E, R>(
      write: (update: LocalUpdate) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<Option.Option<LocalUpdate>, E, R>
    readonly snapshot: Effect.Effect<Uint8Array>
    readonly version: Effect.Effect<ReadonlyMap<string, number>>
    readonly changedSince: (
      version: ReadonlyMap<string, number>,
    ) => Effect.Effect<Option.Option<Changed>>
    readonly pagesAt: (
      version: ReadonlyMap<string, number>,
      wanted: (page: Page) => boolean,
    ) => Effect.Effect<readonly PageTree[]>
    readonly origin: Effect.Effect<Option.Option<ReadonlyMap<string, number>>>
    readonly roots: Effect.Effect<readonly Root[]>
    readonly rootsIn: (bytes: Uint8Array) => readonly Root[]
    readonly loaded: Effect.Effect<void>
  }
>()("@seqno/graph/Graph") {
  static readonly layer = (source: GraphSource) => Layer.effect(Graph, make(source))
}

export const LOADED = "seqno:load"
export const REPAIRED = "seqno:repair"

export const clientOrigin = (client: string) => `seqno:client:${client};`

export const typedBlock = (command: Command): BlockId | null =>
  command._tag === "EditText"
    ? command.blockId
    : command._tag === "SetProperty" && command.target._tag === "BlockTarget"
      ? command.target.blockId
      : null

export const typedInOneBlock = (commands: readonly Command[]): BlockId | null => {
  const [first = null, ...rest] = commands.map(typedBlock)

  return rest.every((block) => block === first) ? first : null
}

export const atVersion = <A>(
  doc: LoroDoc,
  version: ReadonlyMap<string, number>,
  read: (fork: LoroDoc) => A,
): A => {
  const fork = doc.forkAt(doc.vvToFrontiers(loroVersion(version)))

  try {
    return read(fork)
  } finally {
    fork.free()
  }
}

export const rootsOf = (doc: LoroDoc): readonly Root[] =>
  [...doc.oplogVersion().toJSON().keys()].flatMap((peer) => {
    const change = doc.getChangeAt({ peer, counter: 0 })

    return change.deps.length === 0 ? [{ peer, imported: change.message === importMessage }] : []
  })

export const rootsInBlob = (
  bytes: Uint8Array,
  pagesOf: (doc: LoroDoc) => readonly Page[],
): readonly Root[] => {
  const doc = new LoroDoc()

  try {
    doc.import(bytes)
    const roots = rootsOf(doc)
    const notes = pagesOf(doc).some((page) => page.journalDay === null)

    return roots.map((root) => ({ ...root, imported: root.imported || notes }))
  } catch {
    return []
  } finally {
    doc.free()
  }
}

const pagesOfTree = (doc: LoroDoc): readonly Page[] =>
  doc
    .getTree(TREE)
    .roots()
    .flatMap((root) => Option.toArray(Option.flatMap(livePageIdOf(root), () => readPage(root))))

export const originOf = (doc: LoroDoc): Option.Option<ReadonlyMap<string, number>> => {
  const version = doc.oplogVersion().toJSON()

  const roots = [...version].filter(
    ([peer]) => doc.getChangeAt({ peer, counter: 0 }).deps.length === 0,
  )

  const [only, ...rest] = roots

  return only === undefined || rest.length > 0 ? Option.none() : Option.some(new Map([only]))
}

export const importer = (doc: LoroDoc) => {
  const load = loader(doc)

  return (files: readonly Uint8Array[]) =>
    Effect.try({
      try: () => {
        load(files)

        return new Map(doc.oplogVersion().toJSON())
      },
      catch: (cause) => new ImportFailed({ reason: String(cause) }),
    })
}

const make = (source: GraphSource) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const doc = new LoroDoc()
    doc.setPeerId(BigInt(source.peer))
    const importAll = importer(doc)
    yield* importAll([...Option.toArray(source.snapshot), ...source.updates])
    const tree = doc.getTree(TREE)
    const registry = emptyRegistry()

    const registerPages = () => {
      for (const root of tree.roots()) {
        Option.map(livePageIdOf(root), (id) => registry.pages.set(id, root.id))
      }
    }

    registerPages()

    const treePlace: Place = {
      doc,
      roots: () => tree.roots(),
      root: (index) => tree.createNode(undefined, index),
      trash: () => trashOf({ tree, registry }),
    }

    const history = histories()
    let pending = emptyPending()
    let unsubscribe: (() => void) | undefined

    const listen = () => {
      unsubscribe ??= doc.subscribe((batch) => {
        collectChanges(batch, pending)
        history.observe(doc, batch)
      })
    }

    if (doc.oplogVersion().length() > 0) {
      listen()
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe?.()
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

    let cached: { readonly at: string; readonly pages: ReturnType<LivePages> } | undefined

    const listed: LivePages = () => {
      const at = JSON.stringify(doc.frontiers())

      if (cached?.at !== at) {
        cached = { at, pages: livePages(tree) }
      }

      return cached.pages
    }

    const repair = Effect.sync(() => {
      repairUnseen(doc, tree, () => {
        doc.commit({ origin: REPAIRED })
      })

      if (repairPages(tree, pending, listed)) {
        doc.commit({ origin: REPAIRED })
      }
    })

    const drain = Effect.suspend(() => {
      const taken = pending
      pending = emptyPending()
      const events = translate(tree, taken, registry)

      return Effect.as(PubSub.publishAll(pubsub, events), events)
    })

    const indexPage = (
      id: PageId,
      visit: (child: LoroTreeNode, at: Placement) => Option.Option<BlockId>,
    ) => {
      const node = Option.flatMap(Option.fromUndefinedOr(registry.pages.get(id)), (nodeId) =>
        Option.fromUndefinedOr(tree.getNodeByID(nodeId)),
      )

      Option.map(node, (page) => {
        walkBlocks(page, { pageId: id, parentId: null }, (child, at) =>
          Option.map(visit(child, at), (blockId) => {
            registry.blocks.set(blockId, child.id)

            return blockId
          }),
        )
      })
      registry.loaded.add(id)
    }

    const register = (id: PageId) => {
      if (registry.pages.has(id) && !registry.loaded.has(id)) {
        indexPage(id, blockIdOf)
      }
    }

    const scope = yield* Effect.scope

    const fill = Effect.suspend(() =>
      Effect.forEach(
        [...registry.pages.keys()],
        (id) =>
          Effect.sync(() => {
            register(id)
          }).pipe(Effect.andThen(Effect.yieldNow)),
        { discard: true },
      ),
    ).pipe(Effect.andThen(filled.open), inBackground, Effect.forkIn(scope))

    yield* fill

    const pages = serial(Effect.sync(() => listed().map(([, page]) => page)))

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
              const blocks: Block[] = []
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

    const block = (id: BlockId, on?: PageId) =>
      serial(
        Effect.suspend(() => {
          if (on !== undefined && !registry.blocks.has(id)) {
            register(on)
          }

          return findBlock(id)
        }),
      ).pipe(
        Effect.catchTag("BlockNotFound", (missing) =>
          registry.blocks.has(id)
            ? Effect.fail(missing)
            : Effect.andThen(filled.await, serial(findBlock(id))),
        ),
      )

    const transact = (
      client: string,
      commands: readonly Command[],
      typing: BlockId | null,
    ): Effect.Effect<void, CommandRejected | Unresolved, Crypto.Crypto> =>
      Effect.suspend(() => {
        listen()

        const tx = history.begin(client, typing, () => {
          doc.commit({ origin: clientOrigin(client) })
        })

        const ws = { tree, registry, record: tx.record(treePlace), undo: tx.undo, redo: tx.redo }

        return Effect.forEach(commands, (command) => applyCommand(ws, command), {
          discard: true,
        }).pipe(
          Effect.onError(() => Effect.sync(tx.abort)),
          Effect.andThen(Effect.sync(tx.close)),
        )
      })

    const committed = (applied: Effect.Effect<void, CommandRejected | Unresolved, Crypto.Crypto>) =>
      applied.pipe(
        Effect.catchTag("Unresolved", ({ id }) =>
          Effect.fail(new CommandRejected({ reason: `block ${id} does not exist` })),
        ),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.andThen(repair),
        Effect.andThen(drain),
      )

    const dispatch = (command: Command, client = "") =>
      serial(
        transact(client, [command], typedBlock(command)).pipe(
          Effect.catchTag("Unresolved", () =>
            Effect.andThen(filled.await, transact(client, [command], typedBlock(command))),
          ),
          committed,
        ),
      )

    const dispatchAll = (commands: readonly Command[], client = "") => {
      const [first, ...rest] = commands

      if (first === undefined) {
        return Effect.succeed([])
      }

      if (rest.length === 0) {
        return dispatch(first, client)
      }

      return serial(
        Effect.andThen(filled.await, transact(client, commands, typedInOneBlock(commands))).pipe(
          committed,
        ),
      )
    }

    const release = (client: string) =>
      serial(
        Effect.sync(() => {
          history.release(client)
        }),
      )

    const ownCounter = () => doc.oplogVersion().get(peer) ?? 0

    const importing = (updates: readonly Uint8Array[]) =>
      Effect.suspend(() => {
        listen()
        const caughtUp = ownCounter() === flushed

        return importAll(updates).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (caughtUp) {
                flushed = ownCounter()
              }
            }),
          ),
          Effect.tap(() => repair),
        )
      })

    const mergeNow = (updates: readonly Uint8Array[]) => Effect.andThen(importing(updates), drain)

    const merge = (updates: readonly Uint8Array[]) => serial(mergeNow(updates))

    const versionNow = () => new Map(doc.oplogVersion().toJSON())

    const restore = (updates: readonly Uint8Array[]) =>
      serial(
        Effect.suspend(() => {
          if (unsubscribe !== undefined || doc.oplogVersion().length() > 0) {
            return Effect.tap(importing(updates), () => drain)
          }

          return importAll(updates).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (doc.oplogVersion().length() > 0) {
                  listen()
                }
              }),
            ),
            Effect.andThen((reached) =>
              Effect.sync(() => {
                flushed = ownCounter()
                repairUnseen(doc, tree, () => {
                  doc.commit({ origin: REPAIRED })
                })

                if (repairAll(tree, listed)) {
                  doc.commit({ origin: REPAIRED })
                }

                pending = emptyPending()
                registerPages()

                return reached
              }),
            ),
            Effect.tap(filled.close),
            Effect.tap(fill),
          )
        }),
      )

    const pageEvents = (id: PageId): readonly GraphEvent[] => {
      const node = Option.flatMap(Option.fromUndefinedOr(registry.pages.get(id)), (nodeId) =>
        tree.isNodeDeleted(nodeId)
          ? Option.none()
          : Option.fromUndefinedOr(tree.getNodeByID(nodeId)),
      )

      return Option.match(Option.flatMap(node, readPage), {
        onNone: () => [],
        onSome: (found) => {
          const events: GraphEvent[] = [{ _tag: "PageUpserted", page: found }]
          indexPage(id, (child, at) =>
            Option.map(readBlock(child, at), (read) => {
              events.push({ _tag: "BlockUpserted", ...read })

              return read.block.id
            }),
          )

          return events
        },
      })
    }

    const eventsOf = (id: PageId) => serial(Effect.sync(() => pageEvents(id)))

    const everything = Stream.fromIterableEffect(
      serial(Effect.sync(() => [...registry.pages.keys()])),
    ).pipe(Stream.mapEffect(eventsOf))

    const place = (loaded: readonly PageTree[], at: number, message?: string) => {
      listen()
      loaded.forEach((one) => {
        loadPage(tree, one, at)
      })
      doc.commit(message === undefined ? { origin: LOADED } : { origin: LOADED, message })
    }

    const settled = Effect.andThen(repair, drain)

    const load = (loaded: readonly PageTree[]) =>
      serial(
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.andThen(
            Effect.sync(() => {
              place(loaded, now)
            }),
            settled,
          ),
        ),
      )

    const seed = (seeded: readonly PageTree[]) =>
      Effect.gen(function* () {
        const digest = yield* Effect.promise(
          async () =>
            await globalThis.crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify([SEED_FORMAT, seeded])),
            ),
        )

        const writer = peerOf(new Uint8Array(digest))
        const now = yield* Clock.currentTimeMillis

        return yield* serial(
          Effect.gen(function* () {
            if (doc.oplogVersion().length() > 0) {
              place(seeded, now)

              return { events: yield* settled, update: Option.none() }
            }

            const update = yield* Effect.sync((): LocalUpdate => {
              doc.setPeerId(BigInt(writer))

              try {
                place(seeded, seedTime(seeded), importMessage)
                const end = doc.oplogVersion().get(doc.peerIdStr) ?? 0

                return { peer: writer, start: 0, end, bytes: doc.export({ mode: "update" }) }
              } finally {
                doc.setPeerId(BigInt(source.peer))
              }
            })

            return {
              events: yield* settled,
              update: Option.liftPredicate(update, (written) => written.end > 0),
            }
          }),
        )
      })

    const flush = <E, R>(write: (update: LocalUpdate) => Effect.Effect<void, E, R>) =>
      flushing.withPermits(1)(
        Effect.gen(function* () {
          const update = yield* serial(
            Effect.sync(() => {
              const version = doc.oplogVersion()
              const end = version.get(peer) ?? 0

              if (end === flushed) {
                return Option.none<LocalUpdate>()
              }

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
      dispatchAll,
      release,
      merge,
      restore,
      everything,
      pageEvents: eventsOf,
      mergeTarget: (id) =>
        serial(
          Effect.andThen(
            filled.await,
            Effect.suspend(() => mergeTargetOf({ tree, registry }, id)),
          ).pipe(Effect.orElseSucceed(() => Option.none())),
        ),
      load,
      seed,
      events: Stream.fromPubSub(pubsub),
      flush,
      snapshot: serial(Effect.sync(() => doc.export({ mode: "snapshot" }))),
      version: serial(Effect.sync(versionNow)),
      changedSince: (version) => serial(Effect.sync(() => changedSince(doc, tree, version))),
      pagesAt: (version, wanted) =>
        serial(
          Effect.sync(() =>
            atVersion(doc, version, (fork) =>
              fork
                .getTree(TREE)
                .roots()
                .flatMap((root) =>
                  Option.toArray(
                    Option.flatMap(livePageIdOf(root), (id) =>
                      Option.map(Option.filter(readPage(root), wanted), (found): PageTree => {
                        const blocks: Block[] = []
                        walkBlocks(root, { pageId: id, parentId: null }, (child, at) =>
                          Option.map(readBlock(child, at), (state) => {
                            blocks.push(state.block)

                            return state.block.id
                          }),
                        )

                        return { page: found, blocks }
                      }),
                    ),
                  ),
                ),
            ),
          ),
        ),
      origin: serial(Effect.sync(() => originOf(doc))),
      roots: serial(Effect.sync(() => rootsOf(doc))),
      rootsIn: (bytes) => rootsInBlob(bytes, pagesOfTree),
      loaded: filled.await,
    })
  })
