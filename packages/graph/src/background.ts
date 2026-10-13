import { Context, Effect, Scheduler } from "effect"

export const Background = Context.Reference<Scheduler.Scheduler>("@seqno/graph/Background", {
  defaultValue: () => new Scheduler.MixedScheduler(),
})

export const inBackground = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.service(Background), (scheduler) =>
    Effect.provideService(effect, Scheduler.Scheduler, scheduler),
  )
