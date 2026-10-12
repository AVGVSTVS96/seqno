import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { emptyPagesGraph } from "./graph.ts"
import { loadYears } from "./years.ts"

const until = new Date(2026, 9, 12)
const OPENS = 3

export const writeYearsAsPages = (years: number, longPage: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const graph = yield* emptyPagesGraph("60")
      const shape = yield* loadYears(graph, { years, until, longPage })
      return { shape, snapshot: yield* graph.snapshot }
    }),
  )

const openOnce = (snapshot: Uint8Array, peer: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = performance.now()
      const graph = yield* emptyPagesGraph(peer)
      yield* graph.restore([snapshot])
      const pages = yield* graph.pages
      const today = pages.reduce(
        (latest, page) => ((page.journalDay ?? 0) > (latest?.journalDay ?? 0) ? page : latest),
        pages[0],
      )
      if (today === undefined) return yield* Effect.die("the years have no pages")
      const { blocks } = yield* graph.page(today.id)
      if (blocks.length === 0) return yield* Effect.die("today's journal has no blocks")
      return performance.now() - started
    }),
  )

const Opens = Schema.fromJsonString(Schema.Array(Schema.Finite))

export const opensInFreshProcess = (snapshot: Uint8Array) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-bench-pages-"))),
    (folder) =>
      Effect.gen(function* () {
        const file = join(folder, "pages.loro")
        yield* Effect.promise(() => writeFile(file, snapshot))
        const output = execFileSync(process.execPath, [import.meta.filename, file], {
          encoding: "utf8",
        })
        return yield* Schema.decodeUnknownEffect(Opens)(output.trim().split("\n").at(-1) ?? "")
      }),
    (folder) => Effect.promise(() => rm(folder, { recursive: true })),
  )

if (import.meta.main) {
  const [file = ""] = process.argv.slice(2)
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Effect.promise(() => readFile(file))
      const opens: Array<number> = []
      for (let run = 0; run < OPENS; run++) opens.push(yield* openOnce(snapshot, String(70 + run)))
      console.log(JSON.stringify(opens))
    }),
  ).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
