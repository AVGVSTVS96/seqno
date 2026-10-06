import { generateGraph, graphDigest, graphStats } from "../src/index.ts"

const seed = Number(process.argv[2] ?? 20261006)
const started = performance.now()
const graph = generateGraph({ seed })
console.log(JSON.stringify({ seed, digest: graphDigest(graph), generateMs: Math.round(performance.now() - started), ...graphStats(graph) }, null, 2))
