import { Crypto, Effect, Option, Semaphore, Stream, SubscriptionRef } from "effect"
import { CoreRpcs, BlockNotFound, GraphNotOpen } from "@seqno/rpc"
import { applyCommand, pageTree, searchBlocks, type GraphState } from "./graph-state.ts"
import { GraphLocations } from "./locations.ts"
import { seedGraph } from "./seed.ts"

export const StubCore = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const locations = yield* GraphLocations
    const crypto = yield* Crypto.Crypto
    const state = yield* SubscriptionRef.make(Option.none<GraphState>())
    const writes = yield* Semaphore.make(1)
    const current = Effect.flatMap(SubscriptionRef.get(state), (graph) =>
      Option.match(graph, {
        onNone: () => Effect.fail(new GraphNotOpen()),
        onSome: Effect.succeed,
      }),
    )
    const live = <A, E>(read: (graph: GraphState) => Effect.Effect<A, E>) =>
      SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((graph): Effect.Effect<A, E | GraphNotOpen> =>
          Option.match(graph, {
            onNone: () => Effect.fail(new GraphNotOpen()),
            onSome: read,
          }),
        ),
        Stream.changes,
      )
    return CoreRpcs.of({
      OpenGraph: ({ graph }) =>
        Effect.gen(function* () {
          const location = yield* locations.resolve(graph)
          const seeded = yield* seedGraph(graph, location._tag === "OpfsGraph")
          yield* SubscriptionRef.set(state, Option.some(seeded))
          return { graph, pages: seeded.pages }
        }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
      Dispatch: ({ command }) =>
        Semaphore.withPermit(
          writes,
          Effect.gen(function* () {
            const [next, events] = yield* applyCommand(yield* current, command)
            yield* SubscriptionRef.set(state, Option.some(next))
            return events
          }),
        ).pipe(Effect.provideService(Crypto.Crypto, crypto)),
      GetPages: () => Effect.map(current, (graph) => graph.pages),
      GetPage: ({ pageId }) => Effect.flatMap(current, (graph) => pageTree(graph, pageId)),
      GetBlock: ({ blockId }) =>
        Effect.flatMap(current, (graph) =>
          Option.match(
            Option.fromNullishOr(graph.entries.find((entry) => entry.block.id === blockId)),
            {
              onNone: () => Effect.fail(new BlockNotFound({ blockId })),
              onSome: (entry) => Effect.succeed(entry.block),
            },
          ),
        ),
      WatchPage: ({ pageId }) => live((graph) => pageTree(graph, pageId)),
      WatchQuery: ({ query }) =>
        live((graph) =>
          Effect.succeed({ _tag: "BlockRows" as const, blocks: searchBlocks(graph, query) }),
        ),
    })
  }),
)
