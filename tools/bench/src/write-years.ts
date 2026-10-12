import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { DeviceId } from "@seqno/domain"
import { seenPath, snapshotName, snapshotPath } from "@seqno/vault"
import { emptyGraph } from "./graph.ts"
import { loadYears } from "./years.ts"

const writer = DeviceId.make("bench")

const write = (path: string, bytes: Uint8Array) =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  })

export const writeYears = (out: string, years: number, longPage: number) =>
  Effect.gen(function* () {
    const started = performance.now()
    const graph = yield* emptyGraph("1")
    const shape = yield* loadYears(graph, { years, until: new Date(), longPage })
    const snapshot = yield* graph.snapshot
    const version = Object.fromEntries(yield* graph.version)
    const name = yield* Effect.promise(() => snapshotName(writer, snapshot))
    yield* write(join(out, snapshotPath(name)), snapshot)
    yield* write(
      join(out, seenPath(writer)),
      new TextEncoder().encode(
        JSON.stringify({ vv: version, verified: [], snapshots: [[name, version]] }),
      ),
    )
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
