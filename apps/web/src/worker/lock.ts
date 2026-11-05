import { Context, Effect, Latch, Layer, Match, Option } from "effect"
import type { Scope } from "effect"
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

const options = (mode: Mode, signal: AbortSignal): LockOptions =>
  Match.value(mode).pipe(
    Match.when("now", () => ({ ifAvailable: true })),
    Match.when("steal", () => ({ steal: true })),
    Match.when("wait", () => ({ signal })),
    Match.exhaustive,
  )

const lock = (name: string, mode: Mode) =>
  Effect.gen(function* () {
    const release = yield* Latch.make(false)
    const settled = yield* Latch.make(false)
    const lost = yield* Latch.make(false)
    yield* Effect.addFinalizer(() => Effect.andThen(release.open, settled.await))

    const held = yield* Effect.callback<boolean>((resume, signal) => {
      void navigator.locks
        .request(name, options(mode, signal), async (granted) => {
          resume(Effect.succeed(granted !== null))

          if (granted !== null) {
            await Effect.runPromise(release.await)
          }
        })
        .catch(() => lost.openUnsafe())
        .finally(() => {
          settled.openUnsafe()
        })
    })

    return { held, lost: lost.await }
  })

const handsOver = (graph: string) =>
  Effect.map(
    Effect.promise(async () => await navigator.locks.query()),
    ({ held }) => (held ?? []).some((info) => info.name === handoverLock(graph)),
  )

export const layerWebLocks = Layer.succeed(
  GraphLocks,
  GraphLocks.of({
    hold: (graph, wait) =>
      Effect.gen(function* () {
        if (!(yield* lock(graphLock(graph), "now")).held) {
          if (!wait && !(yield* handsOver(graph))) {
            return Option.none()
          }

          yield* Effect.scoped(lock(handoverLock(graph), "steal"))
          yield* lock(graphLock(graph), "wait")
        }

        const handover = yield* lock(handoverLock(graph), "wait")

        return Option.some(handover.lost)
      }),
    tabClosed: (tab) =>
      Effect.promise(async () => {
        await navigator.locks.request(tabLock(tab), () => {})
      }),
  }),
)
