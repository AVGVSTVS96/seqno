import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import type { GraphEvent, PageId } from "@seqno/domain"
import { convertOneTree, journalPageId, type Graph } from "@seqno/graph"
import { emptyGraph, emptyPagesGraph } from "./graph.ts"

const rssMB = () => Math.round(process.memoryUsage().rss / 1024 / 1024)

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const started = performance.now()
    const value = yield* effect
    return [value, Math.round(performance.now() - started)] as const
  })

const opened = (graph: Graph["Service"], snapshot: Uint8Array) =>
  Effect.as(graph.restore([snapshot]), graph)

const sameAfterConverting = (
  before: ReadonlyArray<GraphEvent>,
  after: ReadonlyArray<GraphEvent>,
  from: PageId,
  to: PageId,
) => JSON.stringify(before).replaceAll(from, to) === JSON.stringify(after)

export const checkConversion = (file: string, twice: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() => readFile(file))
      const [converted, convertMs] = yield* timed(convertOneTree([source]))
      const afterConvert = rssMB()
      const v1 = yield* opened(yield* emptyGraph("1"), source)
      const v2 = yield* opened(yield* emptyPagesGraph("2"), converted.snapshot)
      const pages = yield* v1.pages
      const journalIds = new Map(
        (yield* v2.pages).flatMap((page) =>
          page.journalDay === null ? [] : [[page.journalDay, page.id] as const],
        ),
      )
      let blocks = 0
      const different: Array<string> = []
      for (const page of pages) {
        const target =
          page.journalDay !== null &&
          journalIds.get(page.journalDay) === journalPageId(page.journalDay)
            ? journalPageId(page.journalDay)
            : page.id
        const before = yield* v1.pageEvents(page.id)
        const after = yield* v2.pageEvents(target)
        const day = page.journalDay
        const renamed =
          day !== null && target !== page.id
            ? sameAfterConverting(before, after, page.id, target)
            : JSON.stringify(before) === JSON.stringify(after)
        if (!renamed) different.push(page.title)
        blocks += before.length - 1
      }
      const again = twice ? yield* convertOneTree([source]) : undefined
      return {
        pages: pages.length,
        blocks,
        convertedPages: converted.pages,
        convertedBlocks: converted.blocks,
        different: different.slice(0, 10),
        differentCount: different.length,
        convertMs,
        oneTreeMB: Math.round(source.length / 1e5) / 10,
        treePerPageMB: Math.round(converted.snapshot.length / 1e5) / 10,
        sameBytesTwice:
          again === undefined
            ? "not checked"
            : Buffer.compare(Buffer.from(again.snapshot), Buffer.from(converted.snapshot)) === 0,
        rssAfterConvertMB: afterConvert,
        rssMB: rssMB(),
        maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
      }
    }),
  )

if (import.meta.main) {
  const [file = "", twice = "no"] = process.argv.slice(2)
  Effect.runPromise(checkConversion(file, twice === "twice")).then(
    (result) => console.log(JSON.stringify(result)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
