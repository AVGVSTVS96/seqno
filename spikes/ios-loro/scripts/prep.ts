import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { applyEdits, generateEdits, generateGraph, graphDigest, type Edit } from "../vendor/fixture/index.ts"
import type { FixtureMeta } from "../src/bench.ts"
import { applyEdit, importGraph, openSession, toGraph } from "../src/session.ts"
import { engineNamed } from "./engines.ts"

const MERGE_EDITS = 1_000
export const MERGE_FILES = ["merge.loro", "merge2.loro", "merge3.loro"] as const

export const fixtureDir = (seed: number, blocks: number) =>
  join(import.meta.dirname, "..", "fixtures", `graph-${seed}-${blocks}`)

export const prepareFixture = async (seed: number, blocks: number) => {
  const dir = fixtureDir(seed, blocks)
  if (existsSync(join(dir, "meta.json"))) return { dir, meta: JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as FixtureMeta }
  await mkdir(dir, { recursive: true })
  const engine = engineNamed("loro-crdt")
  const graph = generateGraph({ seed, blocks })

  const doc = engine.createDoc()
  doc.setPeer(1n)
  importGraph(doc, graph)
  const snapshot = doc.exportSnapshot()

  const remote = engine.createDoc()
  remote.importBytes(snapshot)
  remote.setPeer(3n)
  const session = openSession(remote)
  const batches: Edit[][] = []
  const updates: Uint8Array[] = []
  for (const [i, seedOffset] of [2, 5, 6].entries()) {
    const base = remote.oplogVersion()
    const batch = generateEdits(graph, { seed: seed + seedOffset, count: MERGE_EDITS, prior: batches.flat() })
    for (const edit of batch) applyEdit(session, edit)
    batches.push(batch)
    updates.push(remote.exportUpdatesSince(base))
    if (graphDigest(toGraph(session.map, graph.options)) !== graphDigest(applyEdits(graph, batches.flat())))
      throw new Error(`remote block map diverged from the fixture model after batch ${i}`)
  }

  const meta: FixtureMeta = {
    seed,
    blocks,
    loro: engine.version,
    graphDigest: graphDigest(graph),
    afterMergeDigest: graphDigest(applyEdits(graph, batches[0]!)),
    afterMerge2Digest: graphDigest(applyEdits(graph, [...batches[0]!, ...batches[1]!])),
    mergeEdits: MERGE_EDITS,
  }
  await Promise.all(updates.map((u, i) => writeFile(join(dir, MERGE_FILES[i]!), u)))
  await writeFile(join(dir, "snapshot.loro"), snapshot)
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2))
  return { dir, meta }
}

if (import.meta.main) {
  const { dir, meta } = await prepareFixture(Number(process.argv[2] ?? 20261006), Number(process.argv[3] ?? 50_000))
  console.log(JSON.stringify({ dir, ...meta }, null, 2))
}
