import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { snapshotName, snapshotPath } from "@seqno/vault"
import { emptyGraph } from "./graph.ts"
import { loadYears } from "./years.ts"

export const writeYears = (out: string, years: number, longPage: number) =>
  Effect.gen(function* () {
    const started = performance.now()
    const graph = yield* emptyGraph("1")
    const shape = yield* loadYears(graph, { years, until: new Date(), longPage })
    const snapshot = yield* graph.snapshot
    const path = join(
      out,
      snapshotPath(yield* Effect.promise(() => snapshotName("bench", snapshot))),
    )
    yield* Effect.promise(() => mkdir(dirname(path), { recursive: true }))
    yield* Effect.promise(() => writeFile(path, snapshot))
    return { ...shape, bytes: snapshot.length, ms: Math.round(performance.now() - started) }
  })

if (import.meta.main) {
  const [out = "years", years = "10", longPage = "0"] = process.argv.slice(2)
  Effect.runPromise(Effect.scoped(writeYears(out, Number(years), Number(longPage)))).then(
    (shape) => console.log(JSON.stringify(shape)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
