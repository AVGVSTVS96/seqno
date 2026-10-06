import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "8" },
    ops: { type: "string", default: "1000" },
    workers: { type: "string", default: "4" },
  },
})

const bugs = ["placeholder-as-empty", "gc-without-acks", "gc-without-witness", "gc-unconfirmed-snapshot", "gc-any-device"]
const run = new URL("./run.ts", import.meta.url).pathname

const report = Object.fromEntries(
  bugs.map((bug) => {
    const { stdout } = spawnSync(process.execPath, [run, "--bug", bug, "--seeds", values.seeds, "--ops", values.ops, "--workers", values.workers], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 << 20,
    })
    const summary = JSON.parse(stdout)
    const fired = Object.fromEntries(Object.entries(summary.violations as Record<string, number>).filter(([, n]) => n > 0))
    return [bug, { seeds: summary.seeds, seedsCaught: summary.seeds - summary.passed, violations: fired }]
  }),
)

const allCaught = Object.values(report).every((r) => r.seedsCaught > 0)
console.log(JSON.stringify({ allCaught, bugs: report }, null, 2))
process.exitCode = allCaught ? 0 : 1
