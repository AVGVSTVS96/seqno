import { Context, Deferred, Effect, Exit, Layer, Option, type Scope } from "effect"
import { tabLock } from "@seqno/rpc"

export class GraphLocks extends Context.Service<
  GraphLocks,
  {
    readonly hold: (
      graph: string,
      wait: boolean,
    ) => Effect.Effect<Option.Option<Effect.Effect<void>>, never, Scope.Scope>
    readonly tabClosed: (tab: string) => Effect.Effect<void>
  }
>()("@seqno/web/worker/GraphLocks") {}

const graphLock = (graph: string) => `seqno/graph/${graph}`
const handoverLock = (graph: string) => `seqno/graph/${graph}/handover`

type Mode = "now" | "wait" | "steal"

const ask = (
  name: string,
  mode: Mode,
  signal: AbortSignal,
  granted: LockGrantedCallback<unknown>,
) =>
  mode === "now"
    ? navigator.locks.request(name, { ifAvailable: true }, granted)
    : mode === "steal"
      ? navigator.locks.request(name, { steal: true }, granted)
      : navigator.locks.request(name, { signal }, granted)

const lock = (name: string, mode: Mode) =>
  Effect.gen(function* () {
    const release = Promise.withResolvers<void>()
    const settled = Promise.withResolvers<void>()
    const lost = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => {
        release.resolve()
        return settled.promise
      }),
    )
    const held = yield* Effect.callback<boolean>((resume, signal) => {
      ask(name, mode, signal, (granted) => {
        resume(Effect.succeed(granted !== null))
        return granted === null ? undefined : release.promise
      }).then(
        () => settled.resolve(),
        () => {
          settled.resolve()
          Deferred.doneUnsafe(lost, Exit.void)
        },
      )
    })
    return { held, lost: Deferred.await(lost) }
  })

const handsOver = (graph: string) =>
  Effect.map(
    Effect.promise(() => navigator.locks.query()),
    ({ held }) => (held ?? []).some((info) => info.name === handoverLock(graph)),
  )

export const layerWebLocks = Layer.succeed(
  GraphLocks,
  GraphLocks.of({
    hold: (graph, wait) =>
      Effect.gen(function* () {
        if (!(yield* lock(graphLock(graph), "now")).held) {
          if (!wait && !(yield* handsOver(graph))) return Option.none()
          yield* Effect.scoped(lock(handoverLock(graph), "steal"))
          yield* lock(graphLock(graph), "wait")
        }
        const handover = yield* lock(handoverLock(graph), "wait")
        return Option.some(handover.lost)
      }),
    tabClosed: (tab) =>
      Effect.promise(() => navigator.locks.request(tabLock(tab), () => undefined)),
  }),
)
