import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { BlockId, PageId } from "@seqno/domain"
import { emptyPagesGraph } from "./graph.ts"
import type { Size } from "./size.ts"
import { writeSlicesInFreshProcesses } from "./years.ts"

const until = new Date(2026, 9, 12)
const OPENS = 3

export const writeYearsAsPages = (size: Size, longPage: number) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-bench-years-"))),
    (folder) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { snapshot } = yield* Effect.promise(() =>
            writeSlicesInFreshProcesses(folder, { ...size, until, longPage }, "tree-per-page"),
          )
          const graph = yield* emptyPagesGraph("60")
          yield* graph.restore([snapshot])
          const long = (yield* graph.pages).find((page) => page.name === "long page")
          const last = long === undefined ? undefined : (yield* graph.page(long.id)).blocks.at(-1)
          if (last === undefined) return yield* Effect.die("the years have no long page")
          return { snapshot, last }
        }),
      ),
    (folder) => Effect.promise(() => rm(folder, { recursive: true })),
  )

const Last = Schema.Struct({ blockId: BlockId, pageId: PageId })
type Last = typeof Last.Type

const openOnce = (snapshot: Uint8Array, last: Last, peer: string) =>
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
      const opened = performance.now()
      const rssMb = process.memoryUsage.rss() / 1e6
      yield* graph.block(last.blockId, last.pageId)
      return { openMs: opened - started, blockMs: performance.now() - opened, rssMb }
    }),
  )

const Opens = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ openMs: Schema.Finite, blockMs: Schema.Finite, rssMb: Schema.Finite }),
  ),
)

export const opensInFreshProcess = (snapshot: Uint8Array, last: Last) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-bench-pages-"))),
    (folder) =>
      Effect.gen(function* () {
        const file = join(folder, "pages.loro")
        yield* Effect.promise(() => writeFile(file, snapshot))
        const output = execFileSync(
          process.execPath,
          [...process.execArgv, import.meta.filename, file, last.blockId, last.pageId],
          { encoding: "utf8" },
        )
        return yield* Schema.decodeUnknownEffect(Opens)(output.trim().split("\n").at(-1) ?? "")
      }),
    (folder) => Effect.promise(() => rm(folder, { recursive: true })),
  )

if (import.meta.main) {
  const [file = "", blockId, pageId] = process.argv.slice(2)
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Effect.promise(() => readFile(file))
      const last = yield* Schema.decodeUnknownEffect(Last)({ blockId, pageId })
      const opens: Array<(typeof Opens.Type)[number]> = []
      for (let run = 0; run < OPENS; run++) {
        opens.push(yield* openOnce(snapshot, last, String(70 + run)))
      }
      console.log(JSON.stringify(opens))
    }),
  ).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
