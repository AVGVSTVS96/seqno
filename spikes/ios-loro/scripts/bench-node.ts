import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runBench, type BenchMode } from "../src/bench.ts"
import { engineNamed } from "./engines.ts"
import { MERGE_FILES, prepareFixture } from "./prep.ts"

const engine = engineNamed(process.argv[2] ?? "loro-crdt")
const mode = (process.argv[3] ?? "full") as BenchMode
const { dir, meta } = await prepareFixture(20261006, 50_000)
const rss: Record<string, number> = {}
const mb = (n: number) => Math.round(n / 1e5) / 10
const [snapshot, ...merges] = await Promise.all(["snapshot.loro", ...MERGE_FILES].map((f) => readFile(join(dir, f))))
const result = await runBench(engine, { snapshot: snapshot!, merges: merges as [Buffer, Buffer, Buffer], meta }, {
  checkpoint: async (name) => {
    globalThis.gc?.()
    rss[name] = mb(process.memoryUsage().rss)
  },
  heap: () => {
    const m = process.memoryUsage()
    return { jsHeapMB: mb(m.heapUsed), externalMB: mb(m.external + m.arrayBuffers) }
  },
}, mode)
console.log(JSON.stringify({ host: `node ${process.version} ${process.platform}-${process.arch}`, ...result, rssMB: rss }, null, 2))
