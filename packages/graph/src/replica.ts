import { Effect, Option } from "effect"
import type { Graph } from "./graph.ts"

const mergeEach = (graph: Graph["Service"], blobs: ReadonlyArray<Uint8Array>) =>
  Effect.forEach(blobs, (blob) =>
    graph.merge([blob]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  )

export const vaultReplica = (graph: Graph["Service"]) => ({
  version: Effect.map(graph.version, (version) => Object.fromEntries(version)),
  merge: (blobs: ReadonlyArray<Uint8Array>) =>
    graph.merge(blobs).pipe(
      Effect.as(blobs.map(() => true)),
      Effect.catch(() => mergeEach(graph, blobs)),
    ),
  restore: (snapshot: Uint8Array) =>
    graph.restore([snapshot]).pipe(
      Effect.map((version) => Option.some(Object.fromEntries(version))),
      Effect.orElseSucceed(() => Option.none()),
    ),
  snapshot: graph.snapshot,
})
