import { Clock, Crypto, Effect, Latch, Layer, Option, PubSub, Semaphore, Stream } from "effect"
import { LoroDoc, VersionVector } from "loro-crdt"
import type { Block, BlockId, Command, GraphEvent, PageId } from "@seqno/domain"
import { BlockNotFound, CommandRejected, PageNotFound, type PageTree } from "@seqno/rpc"
import type { Unresolved } from "../commands.ts"
import {
  Graph,
  LOADED,
  REPAIRED,
  SEED_FORMAT,
  clientOrigin,
  importer,
  peerOf,
  seedTime,
  typedBlock,
  typedInOneBlock,
  type GraphSource,
  type LocalUpdate,
} from "../graph.ts"
import { histories, type Place, type Recorder } from "../history.ts"
import { readBlock } from "../tree.ts"
import { changedSince } from "./changes.ts"
import { applyCommand, mergeTargetOf, outliner, type Lookup, type Workspace } from "./commands.ts"
import { collectChanges, emptyKnown, emptyPending, remember, translate } from "./events.ts"
import { parseKey } from "./layout.ts"
import { locate, makeTrees, readView } from "./outline.ts"
import { movedHomes, repairCycles, repairNames, spotsOf } from "./repair.ts"
import { writePage } from "./write.ts"

const make = (source: GraphSource) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const doc = new LoroDoc()
    doc.setPeerId(BigInt(source.peer))
    const importAll = importer(doc)
    yield* importAll([...Option.toArray(source.snapshot), ...source.updates])
    const trees = makeTrees(doc)
    const known = emptyKnown()
    const lookup: Lookup = {
      trees,
      homes: {
        home: (id) => Option.fromUndefinedOr(known.homes.get(id)),
        onPage: (page) => {
          const seen = new Map<string, BlockId>()
          for (const id of known.byPage.get(page) ?? []) {
            const key = known.homes.get(id)
            if (key !== undefined) seen.set(key, id)
          }
          return seen
        },
      },
    }
    const places = new Map<PageId, Place>()
    const placeOf = (page: PageId): Place => {
      const found = places.get(page)
      if (found !== undefined) return found
      const made: Place = {
        doc,
        roots: () => trees.tree(page).roots(),
        root: (index) => trees.tree(page).createNode(undefined, index),
        trash: () => trees.trash(page, () => lookup.homes.onPage(page)),
      }
      places.set(page, made)
      return made
    }
    const history = histories()
    let pending = emptyPending()
    let unsubscribe: (() => void) | undefined
    const listen = () => {
      unsubscribe ??= doc.subscribe((batch) => {
        if (collectChanges(batch, pending)) trees.relist()
        history.observe(doc, batch)
      })
    }
    if (doc.oplogVersion().length() > 0) listen()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe?.()
        doc.free()
      }),
    )
    const rememberPages = () => {
      for (const [id, page] of trees.listing().live) known.pages.set(id, page)
    }
    rememberPages()

    const pubsub = yield* PubSub.unbounded<GraphEvent>()
    const lock = yield* Semaphore.make(1)
    const flushing = yield* Semaphore.make(1)
    const filled = yield* Latch.make(false)
    const serial = lock.withPermits(1)
    const peer = doc.peerIdStr
    let flushed = doc.oplogVersion().get(peer) ?? 0
    const loaded = new Set<PageId>()

    const repair = Effect.sync(() => {
      const names = repairNames(trees, pending.pages)
      const cycles = repairCycles(trees, spotsOf(trees, [...pending.nodes, ...pending.data]))
      if (names || cycles) doc.commit({ origin: REPAIRED })
    })

    const drain = Effect.suspend(() => {
      const taken = pending
      pending = emptyPending()
      const events = translate(trees, taken, known)
      return Effect.as(PubSub.publishAll(pubsub, events), events)
    })

    const readPage = (id: PageId) => {
      const reads = readView(trees, id)
      remember(known, id, reads)
      loaded.add(id)
      return reads
    }

    const register = (id: PageId) => {
      if (!loaded.has(id) && trees.listing().live.has(id)) readPage(id)
    }

    const scope = yield* Effect.scope
    const fill = Effect.suspend(() =>
      Effect.forEach(
        [...trees.listing().live.keys()],
        (id) => Effect.sync(() => register(id)).pipe(Effect.andThen(Effect.yieldNow)),
        { discard: true },
      ),
    ).pipe(Effect.andThen(filled.open), Effect.forkIn(scope))
    yield* fill

    const livePages = () =>
      [...trees.listing().live.values()].toSorted((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      )

    const pages = serial(Effect.sync(livePages))

    const page = (id: PageId) =>
      serial(
        Effect.suspend(() =>
          Option.match(Option.fromUndefinedOr(trees.listing().live.get(id)), {
            onNone: () => Effect.fail(new PageNotFound({ pageId: id })),
            onSome: (found) =>
              Effect.succeed({ page: found, blocks: readPage(id).map(({ block }) => block) }),
          }),
        ),
      )

    const findBlock = (id: BlockId) =>
      Effect.suspend(() => {
        const home = Option.flatMap(Option.fromUndefinedOr(known.homes.get(id)), (key) =>
          Option.flatMap(parseKey(key), ([at, node]) =>
            Option.map(trees.node(at, node), (found) => ({ page: at, node: found, key })),
          ),
        )
        const found = Option.flatMap(home, (spot) => {
          const where = locate(trees, spot)
          return where._tag === "Live"
            ? readBlock(spot.node, { pageId: where.page, parentId: where.parentId })
            : Option.none()
        })
        return Option.match(found, {
          onNone: () => Effect.fail(new BlockNotFound({ blockId: id })),
          onSome: ({ block }): Effect.Effect<Block> => Effect.succeed(block),
        })
      })

    const block = (id: BlockId, on?: PageId) =>
      serial(
        Effect.suspend(() => {
          if (on !== undefined && !known.homes.has(id)) register(on)
          return findBlock(id)
        }),
      ).pipe(
        Effect.catchTag("BlockNotFound", (missing) =>
          known.homes.has(id)
            ? Effect.fail(missing)
            : Effect.andThen(filled.await, serial(findBlock(id))),
        ),
      )

    const transact = (
      client: string,
      commands: ReadonlyArray<Command>,
      typing: BlockId | null,
    ): Effect.Effect<void, CommandRejected | Unresolved, Crypto.Crypto> =>
      Effect.suspend(() => {
        listen()
        const tx = history.begin(client, typing, () => doc.commit({ origin: clientOrigin(client) }))
        const recorders = new Map<PageId, Recorder>()
        const ws: Workspace = {
          ...lookup,
          record: (at) => {
            const found = recorders.get(at)
            if (found !== undefined) return found
            const made = tx.record(placeOf(at))
            recorders.set(at, made)
            return made
          },
          undo: tx.undo,
          redo: tx.redo,
        }
        return Effect.forEach(commands, (command) => applyCommand(ws, outliner(ws), command), {
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

    const dispatchAll = (commands: ReadonlyArray<Command>, client = "") => {
      const [first, ...rest] = commands
      if (first === undefined) return Effect.succeed([])
      if (rest.length === 0) return dispatch(first, client)
      return serial(
        Effect.andThen(filled.await, transact(client, commands, typedInOneBlock(commands))).pipe(
          committed,
        ),
      )
    }

    const release = (client: string) => serial(Effect.sync(() => history.release(client)))

    const ownCounter = () => doc.oplogVersion().get(peer) ?? 0

    const importing = (updates: ReadonlyArray<Uint8Array>) =>
      Effect.suspend(() => {
        listen()
        const caughtUp = ownCounter() === flushed
        return importAll(updates).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              trees.relist()
              if (caughtUp) flushed = ownCounter()
            }),
          ),
          Effect.tap(() => repair),
        )
      })

    const merge = (updates: ReadonlyArray<Uint8Array>) =>
      serial(Effect.andThen(importing(updates), drain))

    const restore = (updates: ReadonlyArray<Uint8Array>) =>
      serial(
        Effect.suspend(() => {
          if (unsubscribe !== undefined || doc.oplogVersion().length() > 0) {
            return Effect.tap(importing(updates), () => drain)
          }
          return importAll(updates).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (doc.oplogVersion().length() > 0) listen()
              }),
            ),
            Effect.andThen((reached) =>
              Effect.sync(() => {
                flushed = ownCounter()
                trees.relist()
                const names = repairNames(trees, trees.listing().live.keys())
                const cycles = repairCycles(trees, movedHomes(trees))
                if (names || cycles) doc.commit({ origin: REPAIRED })
                pending = emptyPending()
                rememberPages()
                return reached
              }),
            ),
            Effect.tap(filled.close),
            Effect.tap(fill),
          )
        }),
      )

    const pageEvents = (id: PageId): ReadonlyArray<GraphEvent> =>
      Option.match(Option.fromUndefinedOr(trees.listing().live.get(id)), {
        onNone: () => [],
        onSome: (found): ReadonlyArray<GraphEvent> => [
          { _tag: "PageUpserted", page: found },
          ...readPage(id).map((read): GraphEvent => ({
            _tag: "BlockUpserted",
            block: read.block,
            createdAt: read.createdAt,
            updatedAt: read.updatedAt,
          })),
        ],
      })

    const eventsOf = (id: PageId) => serial(Effect.sync(() => pageEvents(id)))

    const everything = Stream.fromIterableEffect(
      serial(Effect.sync(() => livePages().map(({ id }) => id))),
    ).pipe(Stream.mapEffect(eventsOf))

    const place = (pagesIn: ReadonlyArray<PageTree>, at: number) => {
      listen()
      for (const tree of pagesIn) {
        writePage(trees, tree.page.id, {
          page: tree.page,
          blocks: tree.blocks.map((one) => ({ block: one, createdAt: at, updatedAt: at })),
        })
        doc.commit({ origin: LOADED })
      }
    }

    const settled = Effect.andThen(repair, drain)

    const load = (pagesIn: ReadonlyArray<PageTree>) =>
      serial(
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Effect.andThen(
            Effect.sync(() => place(pagesIn, now)),
            settled,
          ),
        ),
      )

    const seed = (seeded: ReadonlyArray<PageTree>) =>
      Effect.gen(function* () {
        const digest = yield* Effect.promise(() =>
          globalThis.crypto.subtle.digest(
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
                place(seeded, seedTime(seeded))
                const end = doc.oplogVersion().get(doc.peerIdStr) ?? 0
                return { peer: writer, start: 0, end, bytes: doc.export({ mode: "update" }) }
              } finally {
                doc.setPeerId(BigInt(source.peer))
              }
            })
            return { events: yield* settled, update: Option.some(update) }
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
            Effect.suspend(() => mergeTargetOf(lookup, id)),
          ).pipe(Effect.orElseSucceed(() => Option.none())),
        ),
      load,
      seed,
      events: Stream.fromPubSub(pubsub),
      flush,
      snapshot: serial(Effect.sync(() => doc.export({ mode: "snapshot" }))),
      version: serial(Effect.sync(() => new Map(doc.oplogVersion().toJSON()))),
      changedSince: (version) => serial(Effect.sync(() => changedSince(trees, version))),
      loaded: filled.await,
    })
  })

export const graphV2Layer = (source: GraphSource) => Layer.effect(Graph, make(source))
