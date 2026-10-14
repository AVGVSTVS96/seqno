import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { DeviceId } from "@seqno/domain"
import { journalsByDay } from "@seqno/graph"
import { editLogDir, seenPath, snapshotName, snapshotPath, treePerPageMarker } from "@seqno/vault"
import { emptyGraph, emptyPagesGraph } from "./graph.ts"
import { loadYears } from "./years.ts"

const writer = DeviceId.make("bench")

export type Layout = "one-tree" | "tree-per-page"

const layouts: Record<
  Layout,
  {
    readonly empty: typeof emptyGraph
    readonly log: string
    readonly incoming: typeof journalsByDay
  }
> = {
  "one-tree": { empty: emptyGraph, log: "", incoming: (pages) => pages },
  "tree-per-page": { empty: emptyPagesGraph, log: editLogDir, incoming: journalsByDay },
}

const write = (path: string, bytes: Uint8Array) =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  })

export const writeYears = (
  out: string,
  years: number,
  longPage: number,
  layout: Layout = "one-tree",
) =>
  Effect.gen(function* () {
    const started = performance.now()
    const { empty, log, incoming } = layouts[layout]
    const graph = yield* empty("1")
    const shape = yield* loadYears(graph, { years, until: new Date(), longPage }, incoming)
    const snapshot = yield* graph.snapshot
    const version = Object.fromEntries(yield* graph.version)
    const name = yield* Effect.promise(() => snapshotName(writer, snapshot))
    yield* write(join(out, log, snapshotPath(name)), snapshot)
    yield* write(
      join(out, log, seenPath(writer)),
      new TextEncoder().encode(
        JSON.stringify({ vv: version, verified: [], snapshots: [[name, version]] }),
      ),
    )
    if (layout === "tree-per-page") {
      yield* write(
        join(out, treePerPageMarker.path),
        new TextEncoder().encode(treePerPageMarker.text),
      )
    }
    return { ...shape, bytes: snapshot.length, ms: Math.round(performance.now() - started) }
  })

if (import.meta.main) {
  const [out = "years", years = "10", longPage = "0", layout] = process.argv.slice(2)
  Effect.runPromise(
    Effect.scoped(
      writeYears(
        out,
        Number(years),
        Number(longPage),
        layout === "tree-per-page" ? layout : "one-tree",
      ),
    ),
  ).then(
    (shape) => console.log(JSON.stringify(shape)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
