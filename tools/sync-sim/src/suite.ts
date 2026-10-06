import { Effect, Layer, Schema } from "effect"
import { LoroGraphs } from "./loro-graph.ts"
import { bugs, loroVaults, type Bug } from "./loro-vault.ts"
import { runSeed, type SeedResult, type SimConfig } from "./sim.ts"

export const suites = {
  ci: { seeds: 50, ops: 200, hours: 12 },
  "1k": { seeds: 1000, ops: 1000, hours: 48 },
  "10k": { seeds: 100, ops: 10000, hours: 48 },
} as const

export type SuiteName = keyof typeof suites

export const SeedJob = Schema.Struct({
  seed: Schema.Int,
  ops: Schema.Int,
  devices: Schema.Int,
  hours: Schema.Finite,
  compaction: Schema.Boolean,
  bug: Schema.NullOr(Schema.Literals(bugs)),
})
export type SeedJob = typeof SeedJob.Type

export const decodeSeedJob = Schema.decodeUnknownSync(Schema.fromJsonString(SeedJob))

export const simLayer = (bug: Bug | null) => Layer.mergeAll(LoroGraphs, loroVaults(bug ?? undefined))

export const runJob = (job: SeedJob): Effect.Effect<SeedResult> => {
  const cfg: SimConfig = {
    seed: job.seed,
    ops: job.ops,
    devices: job.devices,
    hours: job.hours,
    compaction: job.compaction,
  }
  return runSeed(cfg).pipe(Effect.provide(simLayer(job.bug)))
}
