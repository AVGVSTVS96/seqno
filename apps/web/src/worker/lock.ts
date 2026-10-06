import { Context, Effect, Layer, type Scope } from "effect"

export class GraphLocks extends Context.Service<
  GraphLocks,
  {
    readonly hold: (graph: string, wait: boolean) => Effect.Effect<boolean, never, Scope.Scope>
  }
>()("@seqno/web/worker/GraphLocks") {}

const lockName = (graph: string) => `seqno/graph/${graph}`

export const layerWebLocks = Layer.succeed(
  GraphLocks,
  GraphLocks.of({
    hold: (graph, wait) =>
      Effect.gen(function* () {
        const release = Promise.withResolvers<void>()
        const settled = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => {
            release.resolve()
            return settled.promise
          }),
        )
        return yield* Effect.callback<boolean>((resume, signal) => {
          const granted = (lock: Lock | null) => {
            resume(Effect.succeed(lock !== null))
            return lock === null ? undefined : release.promise
          }
          const asked = wait
            ? navigator.locks.request(lockName(graph), { signal }, granted)
            : navigator.locks.request(lockName(graph), { ifAvailable: true }, granted)
          asked.then(settled.resolve, () => settled.resolve())
        })
      }),
  }),
)
