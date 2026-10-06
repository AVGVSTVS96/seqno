import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"
import { Schema } from "effect"
import { bugs } from "../src/loro-vault.ts"

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "8" },
    ops: { type: "string", default: "1000" },
    workers: { type: "string", default: "4" },
  },
})

const Summary = Schema.fromJsonString(
  Schema.Struct({
    seeds: Schema.Number,
    passed: Schema.Number,
    violations: Schema.Record(Schema.String, Schema.Number),
  }),
)

const run = new URL("./run.ts", import.meta.url).pathname

const report = bugs.map((bug) => {
  const { stdout } = spawnSync(
    process.execPath,
    [
      run,
      "--bug",
      bug,
      "--seeds",
      values.seeds,
      "--ops",
      values.ops,
      "--hours",
      "48",
      "--workers",
      values.workers,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 },
  )
  const summary = Schema.decodeUnknownSync(Summary)(stdout)
  return {
    bug,
    seeds: summary.seeds,
    seedsCaught: summary.seeds - summary.passed,
    fired: Object.fromEntries(Object.entries(summary.violations).filter(([, n]) => n > 0)),
  }
})

const allCaught = report.every((r) => r.seedsCaught > 0)
process.stdout.write(`${JSON.stringify({ allCaught, bugs: report }, null, 2)}\n`)
process.exitCode = allCaught ? 0 : 1
