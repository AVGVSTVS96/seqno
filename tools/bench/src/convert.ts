import { readFile, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { convertOneTree, journalPageId } from "@seqno/graph"
import { emptyGraph, emptyPagesGraph } from "./graph.ts"

const maxRssMB = () => Math.round(process.resourceUsage().maxRSS / 1024)

const read = (file: string) => Effect.promise(() => readFile(file))

export const convertFile = (from: string, to: string) =>
  Effect.gen(function* () {
    const source = yield* read(from)
    const started = performance.now()
    const converted = yield* convertOneTree([source])
    const convertMs = Math.round(performance.now() - started)
    yield* Effect.promise(() => writeFile(to, converted.snapshot))
    return {
      pages: converted.pages,
      blocks: converted.blocks,
      convertMs,
      oneTreeMB: Math.round(source.length / 1e5) / 10,
      treePerPageMB: Math.round(converted.snapshot.length / 1e5) / 10,
      maxRssMB: maxRssMB(),
    }
  })

export const compareFiles = (oneTree: string, treePerPage: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const v1 = yield* emptyGraph("1")
      yield* v1.restore([yield* read(oneTree)])
      const v2 = yield* emptyPagesGraph("2")
      yield* v2.restore([yield* read(treePerPage)])
      const pages = yield* v1.pages
      const converted = new Set((yield* v2.pages).map((page) => page.id))
      let blocks = 0
      const different: Array<string> = []
      for (const page of pages) {
        const journal = page.journalDay === null ? page.id : journalPageId(page.journalDay)
        const target = converted.has(journal) ? journal : page.id
        const events = yield* v1.pageEvents(page.id)
        const before = JSON.stringify(events).replaceAll(page.id, target)
        if (before !== JSON.stringify(yield* v2.pageEvents(target))) different.push(page.title)
        blocks += events.length - 1
      }
      return {
        pages: pages.length,
        convertedPages: converted.size,
        blocks,
        different: different.slice(0, 10),
        differentCount: different.length,
        maxRssMB: maxRssMB(),
      }
    }),
  )

if (import.meta.main) {
  const [step = "", first = "", second = ""] = process.argv.slice(2)
  const run: Effect.Effect<unknown, unknown> =
    step === "compare" ? compareFiles(first, second) : convertFile(first, second)
  Effect.runPromise(run).then(
    (result) => console.log(JSON.stringify(result)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
