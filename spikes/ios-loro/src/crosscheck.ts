import { applyEdits, generateEdits, generateGraph, graphDigest } from "../vendor/fixture/index.ts"
import type { Engine } from "./engine.ts"
import { applyEdit, openSession, toGraph } from "./session.ts"

export const CROSSCHECK = { graphSeed: 20261006, blocks: 50_000, editSeed: 777, count: 10_000, peer: 7n } as const

export const hashText = (s: string) => {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13)
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
      : value

export const stateDigest = (state: unknown) => hashText(JSON.stringify(canonical(state)))

export const runCrosscheck = async (engine: Engine, snapshot: Uint8Array) => {
  const { graphSeed, blocks, editSeed, count, peer } = CROSSCHECK
  const graph = generateGraph({ seed: graphSeed, blocks })
  const edits = generateEdits(graph, { seed: editSeed, count })
  const doc = engine.createDoc()
  doc.importBytes(snapshot)
  const session = openSession(doc)
  doc.setPeer(peer)
  const t0 = performance.now()
  for (const edit of edits) applyEdit(session, edit)
  await Promise.resolve()
  const applyMs = Math.round(performance.now() - t0)
  const state = doc.toJSON()
  const exported = doc.exportSnapshot()
  session.close()
  return {
    engine: engine.name,
    loro: engine.version,
    editsDigest: hashText(JSON.stringify(edits)),
    kinds: edits.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {}),
    applyMs,
    version: doc.versionJSON(),
    frontiers: doc.frontiersJSON(),
    stateDigest: stateDigest(state),
    blockMapDigest: graphDigest(toGraph(session.map, graph.options)),
    modelDigest: graphDigest(applyEdits(graph, edits)),
    snapshotBytes: exported.byteLength,
    state,
    snapshot: exported,
  }
}
