import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { LoroDoc, type VersionVector } from "loro-crdt"
import { applyEdits, createRng, generateEdits, generateGraph, graphDigest, type EditMix } from "../../shared/fixture/src/index.ts"
import { applyEdit, importGraph, openSession, toGraph } from "../src/schema.ts"

export const LORO_VERSION = "1.16.2"
const PREP_VERSION = 2

export interface FixtureMeta {
  readonly seed: number
  readonly blocks: number
  readonly loro: string
  readonly graphDigest: string
  readonly afterUpdatesDigest: string
  readonly importMs: number
  readonly snapshotBytes: number
  readonly shallowSnapshotBytes: number
  readonly updateFiles: readonly string[]
  readonly updateEdits: number
  readonly updateBytes: { readonly mean: number; readonly min: number; readonly max: number; readonly total: number }
  readonly mergeEdits: number
  readonly mergeLoroOps: number
  readonly mergeKinds: Readonly<Record<string, number>>
  readonly mergeBytes: number
  readonly afterMergeDigest: string
  readonly localEdits: number
  readonly afterLocalEditsDigest: string
}

const UPDATE_FILES = 200
const MERGE_EDITS = 1_000
const LOCAL_EDITS = 10_000
const saveMix: Partial<EditMix> = { insertText: 0.85, deleteText: 0.08, createBlock: 0.05, moveBlock: 0.015, deleteBlock: 0.005 }

const opsBetween = (from: VersionVector, to: VersionVector) => {
  let ops = 0
  for (const [peer, counter] of to.toJSON()) ops += counter - (from.get(peer) ?? 0)
  return ops
}

export const prepareFixture = async (root: string, seed: number, blocks: number): Promise<{ dir: string; meta: FixtureMeta }> => {
  const dir = join(root, `fixture-${seed}-${blocks}-loro${LORO_VERSION}-v${PREP_VERSION}`)
  if (existsSync(join(dir, "meta.json"))) return { dir, meta: JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) }
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, "updates"), { recursive: true })

  const graph = generateGraph({ seed, blocks })
  const doc = new LoroDoc()
  doc.setPeerId(1n)
  const started = performance.now()
  importGraph(doc, graph)
  const importMs = performance.now() - started
  const snapshot = doc.export({ mode: "snapshot" })
  const shallow = doc.export({ mode: "shallow-snapshot", frontiers: doc.oplogFrontiers() })
  await writeFile(join(dir, "snapshot.loro"), snapshot)

  const rng = createRng(seed + 1)
  const batchSizes = Array.from({ length: UPDATE_FILES }, () => rng.int(1, 30))
  const updates = generateEdits(graph, { seed: seed + 1, count: batchSizes.reduce((a, b) => a + b, 0), mix: saveMix })
  const session = openSession(doc)
  const updateFiles: string[] = []
  const updateSizes: number[] = []
  let at = 0
  for (const [i, size] of batchSizes.entries()) {
    doc.setPeerId(i % 2 === 0 ? 10n : 11n)
    const from = doc.oplogVersion()
    for (const edit of updates.slice(at, at + size)) applyEdit(session, edit)
    at += size
    const bytes = doc.export({ mode: "update", from })
    const name = `updates/${String(i).padStart(4, "0")}.loro`
    await writeFile(join(dir, name), bytes)
    updateFiles.push(name)
    updateSizes.push(bytes.byteLength)
  }
  const afterUpdatesDigest = graphDigest(applyEdits(graph, updates))
  const sessionDigest = graphDigest(toGraph(session.map))
  if (sessionDigest !== afterUpdatesDigest) throw new Error(`event-driven block map diverged: ${sessionDigest} != ${afterUpdatesDigest}`)

  const remote = doc.fork()
  remote.setPeerId(3n)
  const remoteSession = openSession(remote)
  const merge = generateEdits(graph, { seed: seed + 2, count: MERGE_EDITS, prior: updates })
  const base = remote.oplogVersion()
  for (const edit of merge) applyEdit(remoteSession, edit)
  const mergeBytes = remote.export({ mode: "update", from: base })
  await writeFile(join(dir, "merge.loro"), mergeBytes)
  const afterMergeDigest = graphDigest(applyEdits(graph, [...updates, ...merge]))
  if (graphDigest(toGraph(remoteSession.map)) !== afterMergeDigest) throw new Error("remote peer state diverged from the fixture model")

  const localEdits = generateEdits(graph, { seed: seed + 3, count: LOCAL_EDITS, prior: updates })
  await writeFile(join(dir, "local-edits.json"), JSON.stringify(localEdits))

  const meta: FixtureMeta = {
    seed,
    blocks,
    loro: LORO_VERSION,
    graphDigest: graphDigest(graph),
    afterUpdatesDigest,
    importMs: Math.round(importMs),
    snapshotBytes: snapshot.byteLength,
    shallowSnapshotBytes: shallow.byteLength,
    updateFiles,
    updateEdits: updates.length,
    updateBytes: {
      mean: Math.round(updateSizes.reduce((a, b) => a + b, 0) / updateSizes.length),
      min: Math.min(...updateSizes),
      max: Math.max(...updateSizes),
      total: updateSizes.reduce((a, b) => a + b, 0),
    },
    mergeEdits: merge.length,
    mergeLoroOps: opsBetween(base, remote.oplogVersion()),
    mergeKinds: merge.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {}),
    mergeBytes: mergeBytes.byteLength,
    afterMergeDigest,
    localEdits: localEdits.length,
    afterLocalEditsDigest: graphDigest(applyEdits(graph, [...updates, ...localEdits])),
  }
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2))
  return { dir, meta }
}

if (import.meta.main) {
  const { meta } = await prepareFixture(join(import.meta.dirname, "..", ".cache"), Number(process.argv[2] ?? 20261006), Number(process.argv[3] ?? 50_000))
  console.log(JSON.stringify({ ...meta, updateFiles: meta.updateFiles.length }, null, 2))
}
