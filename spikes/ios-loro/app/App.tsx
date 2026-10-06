import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { Directory, File, Paths } from "expo-file-system"
import { runBench, type BenchMode, type FixtureMeta } from "../src/bench.ts"
import { runCrosscheck } from "../src/crosscheck.ts"
import type { Engine } from "../src/engine.ts"
import { jsEngine, type LoroJsModule } from "../src/js-engine.ts"
import { rnEngine } from "./rn-engine.ts"

interface Job {
  readonly id: string
  readonly task: "bench" | "crosscheck"
  readonly engine: "loro-react-native" | "loro.js"
  readonly fixture: string
  readonly mode: BenchMode
}

declare const HermesInternal: { getInstrumentedStats?: () => Record<string, number> } | undefined

const engines: Record<Job["engine"], () => Engine> = {
  "loro-react-native": () => rnEngine,
  "loro.js": () => jsEngine("loro.js", "0.3.0", require("loro.js") as LoroJsModule),
}

const out = new Directory(Paths.document, "out")
const outFile = (job: Job, name: string) => new File(out, `${job.id}.${name}`)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const gc = (globalThis as { gc?: () => void }).gc

const checkpoint = (job: Job) => async (name: string) => {
  gc?.()
  outFile(job, `checkpoint-${name}`).write(String(Date.now()))
  const ack = outFile(job, `ack-${name}`)
  for (let waited = 0; !ack.exists && waited < 60_000; waited += 25) await sleep(25)
}

const heap = () => {
  const s = typeof HermesInternal === "undefined" ? undefined : HermesInternal.getInstrumentedStats?.()
  return s === undefined ? {} : { gcAvailable: gc === undefined ? 0 : 1, jsHeapMB: Math.round(s.js_heapSize / 1e5) / 10, jsAllocatedMB: Math.round(s.js_allocatedBytes / 1e5) / 10 }
}

const run = async (job: Job) => {
  const engine = engines[job.engine]()
  const fixture = new Directory(Paths.document, "fixtures", job.fixture)
  const snapshot = new File(fixture, "snapshot.loro").bytesSync()
  if (job.task === "bench") {
    const meta = JSON.parse(new File(fixture, "meta.json").textSync()) as FixtureMeta
    const [first, warm, concurrent] = ["merge.loro", "merge2.loro", "merge3.loro"].map((f) => new File(fixture, f).bytesSync())
    return runBench(engine, { snapshot, merges: [first!, warm!, concurrent!], meta }, { checkpoint: checkpoint(job), heap }, job.mode)
  }
  const { state, snapshot: exported, ...result } = await runCrosscheck(engine, snapshot)
  outFile(job, "state.json").write(JSON.stringify(state))
  outFile(job, "snapshot.loro").write(exported)
  return result
}

export default function App() {
  const [status, setStatus] = useState("idle")
  useEffect(() => {
    const jobFile = new File(Paths.document, "job.json")
    if (!jobFile.exists) return
    const job = JSON.parse(jobFile.textSync()) as Job
    if (!out.exists) out.create({ intermediates: true })
    setStatus(`running ${job.task} ${job.engine} ${job.mode}`)
    setTimeout(() => {
      run(job)
        .then((result) => ({ ok: true, job, result }))
        .catch((error: unknown) => ({ ok: false, job, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) }))
        .then((report) => {
          outFile(job, "result.json").write(JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))
          setStatus(report.ok ? "done" : "failed")
        })
    }, 500)
  }, [])
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>{status}</Text>
    </View>
  )
}
