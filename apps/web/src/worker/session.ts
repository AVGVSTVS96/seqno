import { Context, Effect, Layer, Option, Schedule } from "effect"
import type { GraphEvent } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { Index } from "@seqno/index"
import { LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { Storage, Vault, layer as vaultLayer } from "@seqno/vault"
import { todaysJournal } from "./journal.ts"
import { Device, layerFolder, type GraphPlace } from "./place.ts"

export interface Session {
  readonly graph: Graph["Service"]
  readonly index: Index["Service"]
  readonly record: (events: ReadonlyArray<GraphEvent>) => Effect.Effect<void>
}

const serviceOf = <I, S, E, R>(tag: Context.Key<I, S>, layer: Layer.Layer<I, E, R>) =>
  Effect.map(Layer.build(layer), (context) => Context.get(context, tag))

const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.asVoid(Effect.catchCause(effect, (cause) => Effect.logError(cause)))

export const openSession = (place: GraphPlace, changed: Effect.Effect<void>) =>
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

    const record = (events: ReadonlyArray<GraphEvent>) =>
      events.length === 0
        ? Effect.void
        : graph.version.pipe(
            Effect.flatMap((version) =>
              index.apply(events, JSON.stringify([...version].toSorted())),
            ),
            Effect.orDie,
            Effect.andThen(changed),
          )

    const replica = vaultReplica({
      ...graph,
      merge: (blobs) => Effect.tap(graph.merge(blobs), record),
    })
    const save = graph.flush((update) => vault.writeUpdate(update.bytes))

    const fresh = (yield* place.storage.list("")).length === 0
    if (fresh) {
      yield* Effect.forEach(place.starter, (file) =>
        place.storage.write(file.path, new TextEncoder().encode(file.text)),
      )
    }
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
