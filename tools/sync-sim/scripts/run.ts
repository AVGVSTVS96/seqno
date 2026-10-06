import { fork } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { Effect, Schema } from "effect"
import { bugs } from "../src/loro-vault.ts"
import type { SeedResult } from "../src/sim.ts"
import { decodeSeedJob, runJob, SeedJob, suites } from "../src/suite.ts"
import { summarize, type Finished } from "../src/summary.ts"

const childJob = process.env["SYNC_SIM_JOB"]

const send = (message: unknown) => process.send?.(message, () => process.exit(0)) ?? process.exit(1)

const runChild = async (raw: string) => {
  const job = decodeSeedJob(raw)
  try {
    const result = await Effect.runPromise(runJob(job))
    send({ ...result, rssMB: Math.round(process.resourceUsage().maxRSS / 1024) })
  } catch (error) {
    send({
      seed: job.seed,
      crash: String(error instanceof Error ? (error.stack ?? error.message) : error)
        .split("\n")
        .slice(0, 3)
        .join(" "),
    })
  }
}

const Options = Schema.Struct({
  suite: Schema.optionalKey(Schema.Literals(["ci", "1k", "10k"])),
  seeds: Schema.optionalKey(Schema.FiniteFromString),
  from: Schema.FiniteFromString,
  ops: Schema.optionalKey(Schema.FiniteFromString),
  hours: Schema.optionalKey(Schema.FiniteFromString),
  devices: Schema.FiniteFromString,
  compaction: Schema.Literals(["on", "off"]),
  bug: Schema.optionalKey(Schema.Literals(bugs)),
  vault: Schema.Literals(["stand-in", "real"]),
  workers: Schema.FiniteFromString,
  out: Schema.optionalKey(Schema.String),
  "timeout-s": Schema.FiniteFromString,
})

const runParent = async () => {
  const { values } = parseArgs({
    options: {
      suite: { type: "string" },
      seeds: { type: "string" },
      from: { type: "string", default: "1" },
      ops: { type: "string" },
      hours: { type: "string" },
      devices: { type: "string", default: "5" },
      compaction: { type: "string", default: "on" },
      bug: { type: "string" },
      vault: { type: "string", default: "stand-in" },
      workers: { type: "string", default: "4" },
      out: { type: "string" },
      "timeout-s": { type: "string", default: "900" },
    },
  })
  const options = Schema.decodeUnknownSync(Options)(values)
  const preset = suites[options.suite ?? "ci"]
  const count = options.seeds ?? preset.seeds
  const base = {
    ops: options.ops ?? preset.ops,
    hours: options.hours ?? preset.hours,
    devices: options.devices,
    compaction: options.compaction === "on",
    bug: options.bug ?? null,
    vault: options.vault,
  }
  const workers = Math.min(4, options.workers, count)
  const started = performance.now()
  const out = options.out
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, "")
  }
  const stream = (line: object) => {
    if (out !== undefined) {
      appendFileSync(out, `${JSON.stringify(line)}\n`)
    }
  }
  const results: Finished[] = []
  const crashes: Array<{ readonly seed: number; readonly crash: string }> = []
  const queue = Array.from({ length: count }, (_, i) => options.from + i)
  const report = () =>
    process.stderr.write(
      `${results.length + crashes.length}/${count} seeds, ${results.filter((r) => !r.ok).length} failed, ${crashes.length} crashed, ${((performance.now() - started) / 1000).toFixed(0)}s, max seed rss ${Math.max(0, ...results.map((r) => r.rssMB))}MB\n`,
    )

  const runOne = (seed: number) =>
    new Promise<void>((resolve) => {
      const job: SeedJob = { ...base, seed }
      const child = fork(fileURLToPath(import.meta.url), [], {
        env: { ...process.env, SYNC_SIM_JOB: JSON.stringify(Schema.encodeSync(SeedJob)(job)) },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
        execArgv: ["--max-old-space-size=1024"],
      })
      let reported = false
      const crash = (message: string) => {
        if (reported) {
          return
        }
        reported = true
        crashes.push({ seed, crash: message })
        stream({ seed, crash: message })
        process.stderr.write(`seed ${seed} CRASHED: ${message}\n`)
      }
      const timer = setTimeout(() => {
        crash(`still running after ${options["timeout-s"]}s`)
        child.kill("SIGKILL")
      }, options["timeout-s"] * 1000)
      child.on(
        "message",
        (
          message:
            | (SeedResult & { readonly rssMB: number })
            | { readonly seed: number; readonly crash: string },
        ) => {
          if ("crash" in message) {
            crash(message.crash)
            return
          }
          reported = true
          results.push(message)
          stream(message)
          if (!message.ok) {
            process.stderr.write(
              `seed ${message.seed} FAILED: ${message.problems.slice(0, 3).join(" | ")}\n`,
            )
          }
          if (results.length % 10 === 0) {
            report()
          }
        },
      )
      child.on("error", (error) => crash(String(error)))
      child.on("exit", (code, signal) => {
        clearTimeout(timer)
        if (!reported) {
          crash(`seed process exited with ${code ?? signal}`)
        }
        resolve()
      })
    })

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
        await runOne(seed)
      }
    }),
  )
  report()
  const summary = summarize(
    { ...base, seeds: `${options.from}..${options.from + count - 1}`, workers },
    results,
    crashes,
    (performance.now() - started) / 1000,
  )
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exitCode = summary.passed === count ? 0 : 1
}

await (childJob === undefined ? runParent() : runChild(childJob))
