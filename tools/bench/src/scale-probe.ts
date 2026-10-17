import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import v8 from "node:v8"
import { Effect, Layer, Stream } from "effect"
import type { PageId } from "@seqno/domain"
import { Index } from "@seqno/index"
import { layerNode } from "@seqno/index/node"
import { layerWasmMemory } from "@seqno/index/wasm"
import { emptyGraph, emptyPagesGraph, serviceOf } from "./graph.ts"
import { existsSync } from "node:fs"

const [folder = "", driver = "node", until = "filled"] = process.argv.slice(2)
const t0 = performance.now()
const mb = (n: number) => Math.round(n / 1e6)
const mark = (what: string, extra: object = {}) => {
  const heap = v8.getHeapStatistics()
  console.log(
    JSON.stringify({
      what,
      s: Math.round((performance.now() - t0) / 10) / 100,
      externalMB: mb(heap.external_memory),
      heapMB: mb(heap.used_heap_size),
      rssMB: mb(process.memoryUsage.rss()),
      ...extra,
    }),
  )
}

const once = (round: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const pagesLayout = existsSync(join(folder, "edit-log"))
      const dir = join(folder, pagesLayout ? "edit-log" : "", "snapshots")
      const [name = ""] = yield* Effect.promise(() => readdir(dir))
      const snapshot = yield* Effect.promise(() => readFile(join(dir, name)))
      mark("read", { snapshotMB: mb(snapshot.length) })
      const graph = yield* (pagesLayout ? emptyPagesGraph : emptyGraph)("9")
      const opened = performance.now()
      yield* graph.restore([snapshot])
      const pages = yield* graph.pages
      const today = pages.reduce(
        (latest, page) => ((page.journalDay ?? 0) > (latest?.journalDay ?? 0) ? page : latest),
        pages[0],
      )
      if (today === undefined) return yield* Effect.die("no pages")
      yield* graph.page(today.id)
      mark("open", { openMs: Math.round(performance.now() - opened), pages: pages.length })
      if (until === "open") return
      const index = yield* serviceOf(
        Index,
        Index.layer.pipe(Layer.provide(driver === "wasm" ? layerWasmMemory : layerNode())),
      )
      const filling = performance.now()
      let done = 0
      yield* index.start(graph.pages)
      const unwritten = yield* index.unwritten
      yield* index.refresh(
        Stream.fromIterable(unwritten).pipe(
          Stream.mapEffect((page: PageId) =>
            Effect.map(graph.pageEvents(page), (events) => {
              done++
              if (done % 2000 === 0) mark("fill", { done })
              return [page, events] as const
            }),
          ),
        ),
      )
      mark("filled", { fillMs: Math.round(performance.now() - filling) })
      const image = yield* index.image("{}")
      mark("image", { imageMB: mb(image.length), round })
    }),
  )

Effect.runPromise(
  Effect.gen(function* () {
    for (let round = 0; round < Number(process.env["ROUNDS"] ?? 1); round++) {
      yield* once(round)
      mark("closed", { round })
    }
  }),
).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
