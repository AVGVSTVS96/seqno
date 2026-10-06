import { fork } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import type { Bug } from "../src/engine.ts"
import { runSeed, type SeedResult, type SimConfig } from "../src/sim.ts"

type Done = SeedResult & { readonly rssMB: number }
type Crash = { readonly seed: number; readonly crash: string }

const child = process.env.SYNC_SIM_SEED
if (child !== undefined) {
  const cfg = JSON.parse(child) as SimConfig
  process.on("disconnect", () => process.exit(1))
  let message: Done | Crash
  try {
    const result = runSeed(cfg)
    message = { ...result, rssMB: Math.round(process.resourceUsage().maxRSS / 1024) }
  } catch (e) {
    message = { seed: cfg.seed, crash: String(e instanceof Error ? (e.stack ?? e.message) : e).split("\n").slice(0, 3).join(" ") }
  }
  process.send!(message, () => process.exit(0))
} else {
  const { values } = parseArgs({
    options: {
      seeds: { type: "string", default: "1000" },
      from: { type: "string", default: "1" },
      ops: { type: "string", default: "10000" },
      devices: { type: "string", default: "5" },
      hours: { type: "string", default: "48" },
      compaction: { type: "string", default: "on" },
      bug: { type: "string" },
      base: { type: "string", default: "small" },
      workers: { type: "string", default: String(Math.min(4, availableParallelism())) },
      out: { type: "string" },
      "timeout-s": { type: "string", default: "900" },
    },
  })
  const count = Number(values.seeds)
  const from = Number(values.from)
  const seeds = Array.from({ length: count }, (_, i) => from + i)
  const workers = Math.min(Number(values.workers), count)
  const base = {
    ops: Number(values.ops),
    devices: Number(values.devices),
    hours: Number(values.hours),
    compaction: values.compaction !== "off",
    bug: values.bug as Bug | undefined,
    base: values.base === "fixture" ? ("fixture" as const) : ("small" as const),
  }

  const started = performance.now()
  const out = values.out
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, "")
  }
  const stream = (line: object) => out && appendFileSync(out, `${JSON.stringify(line)}\n`)
  const results: Done[] = []
  const crashes: Crash[] = []
  const queue = [...seeds]
  /** One process per seed: wasm memory never shrinks, and worker threads were seen to leak ~3 MB per seed. */
  const runOne = (seed: number) =>
    new Promise<void>((resolve) => {
      const worker = fork(fileURLToPath(import.meta.url), [], {
        env: { ...process.env, SYNC_SIM_SEED: JSON.stringify({ ...base, seed } satisfies SimConfig) },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      })
      let reported = false
      const timer = setTimeout(() => {
        crash(`still running after ${values["timeout-s"]}s`)
        worker.kill("SIGKILL")
      }, Number(values["timeout-s"]) * 1000)
      const crash = (message: string) => {
        if (reported) return
        reported = true
        crashes.push({ seed, crash: message })
        stream({ seed, crash: message })
        process.stderr.write(`seed ${seed} CRASHED: ${message}\n`)
      }
      worker.on("message", (r: Done | Crash) => {
        if ("crash" in r) return crash(r.crash)
        reported = true
        results.push(r)
        stream({ ...r, files: { ...r.files, series: undefined } })
        if (!r.ok) process.stderr.write(`seed ${r.seed} FAILED: ${r.problems.slice(0, 3).join(" | ")}\n`)
        if (results.length % 10 === 0)
          process.stderr.write(`${results.length}/${count} seeds, ${results.length - results.filter((x) => x.ok).length} failed, ${crashes.length} crashed, ${((performance.now() - started) / 1000).toFixed(0)}s, runner rss ${Math.round(process.memoryUsage().rss / 2 ** 20)}MB, max seed rss ${Math.max(...results.map((x) => x.rssMB))}MB\n`)
      })
      worker.on("error", (e) => crash(String(e)))
      worker.on("exit", (code, signal) => {
        clearTimeout(timer)
        if (!reported) crash(`seed process exited with ${code ?? signal}`)
        resolve()
      })
    })
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) await runOne(seed)
    }),
  )
  results.sort((a, b) => a.seed - b.seed)
  if (results.length === 0) {
    console.log(JSON.stringify({ seeds: crashes.length, passed: 0, crashed: crashes }, null, 2))
    process.exit(1)
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(p * s.length))]!
  }
  const minutes = (ms: number) => +(ms / 60_000).toFixed(1)
  const failed = results.filter((r) => !r.ok)
  const allCatchUps = results.flatMap((r) => r.catchUps.map((c) => ({ seed: r.seed, ...c })))
  const catchUps = allCatchUps.filter((c) => !c.interrupted)
  const worst = catchUps.reduce((a, b) => (b.catchUpMs > a.catchUpMs ? b : a), catchUps[0]!)
  const violationTotals = Object.fromEntries(
    Object.keys(results[0]!.violations).map((k) => [k, sum(results.map((r) => r.violations[k as keyof SeedResult["violations"]]))]),
  )
  const totals = <T extends object>(pick: (r: SeedResult) => T) =>
    Object.fromEntries(Object.keys(pick(results[0]!)).map((k) => [k, sum(results.map((r) => pick(r)[k as keyof T] as number))]))
  const files = (key: keyof SeedResult["files"]) => results.map((r) => r.files[key] as number)
  const at = (r: SeedResult, hour: number) => r.files.series.findLast(([h]) => h <= hour)
  const lastHour = Math.max(...results.map((r) => r.files.series.at(-1)?.[0] ?? 0))
  const filesOverTime = Array.from({ length: Math.floor(lastHour / 6) + 1 }, (_, i) => {
    const samples = results.flatMap((r) => {
      const sample = at(r, i * 6)
      return sample && r.files.series.at(-1)![0] >= i * 6 ? [sample] : []
    })
    return {
      hour: i * 6,
      seeds: samples.length,
      count: { mean: Math.round(sum(samples.map((x) => x[1])) / samples.length), max: Math.max(...samples.map((x) => x[1])) },
      bytes: { mean: Math.round(sum(samples.map((x) => x[2])) / samples.length), max: Math.max(...samples.map((x) => x[2])) },
    }
  }).filter((x) => x.seeds > 0)

  const summary = {
    config: { ...base, seeds: `${from}..${from + count - 1}`, workers },
    seeds: results.length + crashes.length,
    passed: results.length - failed.length,
    crashed: crashes,
    failed: failed.map((r) => ({ seed: r.seed, problems: r.problems.slice(0, 4) })).slice(0, 20),
    violations: violationTotals,
    opsPerSeed: { min: Math.min(...results.map((r) => sum(Object.values(r.ops)) - r.ops.rejected - r.ops.cyclePairs)), total: totals((r) => r.ops) },
    convergenceAfterQuiescenceMin: {
      p50: minutes(pct(results.map((r) => r.quiescenceToConvergeMs), 0.5)),
      p99: minutes(pct(results.map((r) => r.quiescenceToConvergeMs), 0.99)),
      max: minutes(Math.max(...results.map((r) => r.quiescenceToConvergeMs))),
    },
    catchUpAfterLongOffline: {
      events: catchUps.length,
      excludedWentOfflineAgainFirst: allCatchUps.length - catchUps.length,
      offlineHours: { min: Math.min(...catchUps.map((c) => c.offlineH)), max: Math.max(...catchUps.map((c) => c.offlineH)) },
      neverCaughtUp: catchUps.filter((c) => c.catchUpMs < 0).length,
      catchUpMin: { p50: minutes(pct(catchUps.map((c) => c.catchUpMs), 0.5)), p99: minutes(pct(catchUps.map((c) => c.catchUpMs), 0.99)), max: minutes(worst?.catchUpMs ?? 0) },
      othersSeeItsOfflineEditsMin: {
        p50: minutes(pct(catchUps.map((c) => c.publishMs), 0.5)),
        max: minutes(Math.max(...catchUps.map((c) => c.publishMs))),
      },
      filesImported: { p50: pct(catchUps.map((c) => c.filesImported), 0.5), max: Math.max(...catchUps.map((c) => c.filesImported)) },
      bytesImported: { p50: pct(catchUps.map((c) => c.bytesImported), 0.5), max: Math.max(...catchUps.map((c) => c.bytesImported)) },
      mergeCpuMs: { p50: pct(catchUps.map((c) => c.cpuMs), 0.5), max: Math.max(...catchUps.map((c) => c.cpuMs)) },
      worst,
    },
    cloudFiles: {
      peakCount: { mean: Math.round(sum(files("peakCount")) / results.length), max: Math.max(...files("peakCount")) },
      peakBytes: { mean: Math.round(sum(files("peakBytes")) / results.length), max: Math.max(...files("peakBytes")) },
      finalCount: { mean: Math.round(sum(files("finalCount")) / results.length), max: Math.max(...files("finalCount")) },
      finalBytes: { mean: Math.round(sum(files("finalBytes")) / results.length), max: Math.max(...files("finalBytes")) },
      docSnapshotBytes: { mean: Math.round(sum(results.map((r) => r.docSnapshotBytes)) / results.length) },
      sameSnapshotFromTwoDevices: { total: sum(results.map((r) => r.sameSnapshotFromTwoDevices)), seeds: results.filter((r) => r.sameSnapshotFromTwoDevices > 0).length },
      overTime: filesOverTime,
    },
    icloudFaults: totals((r) => r.drive),
    engines: totals((r) => r.engines),
    cpu: { meanSeedMs: Math.round(sum(results.map((r) => r.cpuMs)) / results.length), wallS: +((performance.now() - started) / 1000).toFixed(1), maxSeedRssMB: Math.max(...results.map((r) => r.rssMB)) },
  }

  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = failed.length + crashes.length > 0 ? 1 : 0
}
