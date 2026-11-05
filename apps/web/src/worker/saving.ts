import { Effect, Stream, SubscriptionRef } from "effect"
import { SaveState } from "@seqno/rpc"

interface Snapshot {
  readonly state: SaveState
  readonly through: ReadonlyMap<number, number>
}

export interface SaveLog {
  readonly edited: Effect.Effect<void>
  readonly started: Effect.Effect<number>
  readonly saved: (at: number) => Effect.Effect<void>
  readonly failed: (reason: string) => Effect.Effect<void>
  readonly handled: (client: number, seq: number) => Effect.Effect<void>
  readonly watch: (client: number) => Stream.Stream<SaveState>
}

export const makeSaveLog = Effect.gen(function* () {
  const edits = { count: 0 }
  const handled = new Map<number, number>()

  const ref = yield* SubscriptionRef.make<Snapshot>({
    state: SaveState.cases.Saved.make({}),
    through: new Map(),
  })

  const publish = (state: SaveState) =>
    SubscriptionRef.set(ref, { state, through: new Map(handled) })

  const log: SaveLog = {
    edited: Effect.suspend(() => {
      edits.count += 1

      return publish(SaveState.cases.Unsaved.make({}))
    }),
    started: Effect.sync(() => edits.count),
    saved: (at) =>
      Effect.suspend(() =>
        edits.count === at ? publish(SaveState.cases.Saved.make({})) : Effect.void,
      ),
    failed: (reason) => publish(SaveState.cases.Failed.make({ reason })),
    handled: (client, seq) =>
      Effect.flatMap(SubscriptionRef.get(ref), ({ state }) => {
        handled.set(client, Math.max(handled.get(client) ?? 0, seq))

        return publish(state)
      }),
    watch: (client) =>
      Stream.map(SubscriptionRef.changes(ref), ({ state, through }) => {
        const mine = through.get(client)

        return state._tag === "Saved" && mine !== undefined
          ? SaveState.cases.Saved.make({ through: mine })
          : state
      }),
  }

  return log
})
