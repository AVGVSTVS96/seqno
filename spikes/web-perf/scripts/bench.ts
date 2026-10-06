import { mkdtemp, readFile, rm } from "node:fs/promises"
import { cpus, loadavg, tmpdir, totalmem } from "node:os"
import { join, normalize } from "node:path"
import { chromium, type CDPSession } from "playwright"
import { build, preview, type Plugin } from "vite"
import { generateGraph } from "../../shared/fixture/src/index.ts"
import type { Bench } from "../src/main.ts"
import { median } from "../src/stats.ts"
import { LORO_VERSION, prepareFixture } from "./prep.ts"

const SEED = Number(process.argv[2] ?? 20261006)
const BLOCKS = Number(process.argv[3] ?? 50_000)
const COLD_OPENS = 5
const KEYSTROKES = 2_000
const MOVES = 500
const EDITS_PER_SAVE = 25
const MB = 1024 * 1024

const root = join(import.meta.dirname, "..")
const log = (message: string) => console.error(`[web-perf] ${message}`)
const round = (n: number) => Math.round(n * 100) / 100

const serveFixture = (dir: string): Plugin => ({
  name: "serve-fixture",
  configurePreviewServer: (server) => {
    server.middlewares.use("/fixture", (req, res) => {
      readFile(join(dir, normalize(decodeURIComponent(new URL(req.url!, "http://x").pathname)))).then(
        (body) => res.end(body),
        () => res.writeHead(404).end(),
      )
    })
  },
})

const targetSession = async (cdp: CDPSession, targetId: string) => {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false })
  let nextId = 0
  return <T>(method: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const onMessage = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return
        const reply = JSON.parse(event.message)
        if (reply.id !== id) return
        cdp.off("Target.receivedMessageFromTarget", onMessage)
        if (reply.error) reject(new Error(reply.error.message))
        else resolve(reply.result)
      }
      cdp.on("Target.receivedMessageFromTarget", onMessage)
      void cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method }) })
    })
}

log(`preparing fixture seed=${SEED} blocks=${BLOCKS}`)
const fixture = await prepareFixture(join(root, ".cache"), SEED, BLOCKS)
log("building")
await build({ root, logLevel: "warn" })
const server = await preview({ root, logLevel: "warn", plugins: [serveFixture(fixture.dir)], preview: { port: 0 } })
const profile = await mkdtemp(join(tmpdir(), "seqno-web-perf-"))
const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true })

try {
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(server.resolvedUrls!.local[0]!)
  await page.waitForFunction(() => "bench" in window)
  const cdp = await context.newCDPSession(page)
  const chrome = (await cdp.send("Browser.getVersion")).product
  const run = <K extends keyof Bench>(name: K, ...arg: Parameters<Bench[K]>): Promise<Awaited<ReturnType<Bench[K]>>> =>
    page.evaluate(([name, arg]) => (window.bench[name] as (arg: unknown) => unknown)(arg), [name, arg[0]] as const) as never

  const repeat = async <T>(label: string, once: () => Promise<T>) => {
    const runs: T[] = []
    for (let i = 0; i < COLD_OPENS; i++) {
      log(`cold open ${label} ${i + 1}/${COLD_OPENS}`)
      runs.push(await once())
    }
    return runs
  }
  const openSnapshot = await repeat("snapshot", () => run("coldOpen", "snapshot"))
  const openUpdates = await repeat("snapshot + updates", () => run("coldOpen", "snapshotThenUpdates"))
  const openUpdatesBatch = await repeat("importBatch(snapshot + updates)", () => run("coldOpen", "importBatch"))
  const blocksPerPage = Map.groupBy(generateGraph({ seed: SEED, blocks: BLOCKS }).blocks, (b) => b.pageId)
  const [biggestPage, biggestPageBlocks] = [...blocksPerPage].reduce((a, b) => (b[1].length > a[1].length ? b : a))
  const firstPage = await repeat("first page only", () => run("coldOpenFirstPage", biggestPage))

  log("session: open, measure memory")
  const sessionOpen = await run("openSession")
  const { targetInfos } = await cdp.send("Target.getTargets")
  const workerTarget = targetInfos.find((t) => t.type === "worker" && t.url.includes("worker"))
  if (workerTarget === undefined) throw new Error(`no worker target among ${targetInfos.map((t) => t.type).join(", ")}`)
  const worker = await targetSession(cdp, workerTarget.targetId)
  await worker("HeapProfiler.enable")
  await cdp.send("HeapProfiler.enable")
  const memory = async () => {
    await worker("HeapProfiler.collectGarbage")
    await cdp.send("HeapProfiler.collectGarbage")
    const workerJsHeap = (await worker<{ usedSize: number }>("Runtime.getHeapUsage")).usedSize
    const mainJsHeap = (await cdp.send("Runtime.getHeapUsage")).usedSize
    const wasm = await run("wasmMemoryBytes")
    const mb = (bytes: number) => round(bytes / MB)
    return { workerJsHeapMB: mb(workerJsHeap), wasmMB: mb(wasm), mainJsHeapMB: mb(mainJsHeap), totalMB: mb(workerJsHeap + wasm + mainJsHeap) }
  }
  const memoryAfterOpen = await memory()

  log(`session: ${fixture.meta.localEdits} local edits`)
  const localEdits = await run("localEdits", EDITS_PER_SAVE)
  const memoryAfterEdits = await memory()

  log(`session: ${KEYSTROKES} keystrokes`)
  const keystrokes = await run("keystrokes", { count: KEYSTROKES, seed: SEED + 10 })
  log(`session: ${MOVES} subtree moves`)
  const moves = await run("moves", { count: MOVES, seed: SEED + 11 })
  const blockMapMatchesLoro = await run("blockMapMatchesLoro")
  const sizesAfterSession = await run("sizes")
  log("session: sqlite index")
  const sqlite = await run("sqliteIndex")

  const merges = openUpdates.map((r) => r.merge!)
  const mergesAfterImportBatch = openUpdatesBatch.map((r) => r.merge!)
  const openSnapshotMedian = median(openSnapshot.map((r) => r.openMs))
  const openUpdatesMedian = median(openUpdates.map((r) => r.openMs))
  const mergeMedian = median(merges.map((m) => m.ms))
  const peakMemory = Math.max(memoryAfterOpen.totalMB, memoryAfterEdits.totalMB)
  const bar = (name: string, value: number, limit: number, unit: string) => ({ name, value: round(value), bar: `<= ${limit} ${unit}`, pass: value <= limit })
  const digestsOk =
    [...openSnapshot, ...openUpdates, ...openUpdatesBatch, sessionOpen].every((r) => r.digestOk) &&
    [...merges, ...mergesAfterImportBatch].every((m) => m.digestOk) &&
    localEdits.digestOk &&
    blockMapMatchesLoro
  const rounded = <T extends object>(r: T) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? round(v) : v]))

  const summary = (runs: typeof openSnapshot) => ({
    openMsMedian: round(median(runs.map((r) => r.openMs))),
    importMsMedian: round(median(runs.map((r) => r.importMs))),
    blockMapMsMedian: round(median(runs.map((r) => r.blockMapMs))),
    spawnToBlockMapMsMedian: round(median(runs.map((r) => r.spawnToBlockMapMs))),
    wasmMBAfterBlockMapMax: Math.max(...runs.map((r) => r.wasmAfterBlockMapMB)),
    runs: runs.map(({ merge: _, ...r }) => rounded(r)),
  })

  const result = {
    env: {
      chrome,
      headless: true,
      loro: LORO_VERSION,
      sqliteWasm: "3.53.4-build2",
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      ramGB: round(totalmem() / 1024 ** 3),
      loadavg1m: round(loadavg()[0]!),
      date: new Date().toISOString(),
    },
    fixture: { seed: SEED, blocks: BLOCKS, treeNodes: sessionOpen.treeNodes, digest: fixture.meta.graphDigest },
    bars: [
      bar("open: snapshot -> full block map, median of cold workers", openSnapshotMedian, 1000, "ms"),
      bar("open: snapshot + 200 update files -> full block map, median of cold workers", openUpdatesMedian, 1000, "ms"),
      bar("keystroke p95, main thread -> worker (insert, commit, event -> block map) -> main thread", keystrokes.roundTrip.p95, 16, "ms"),
      bar("merge 1k remote edits (import + events -> block map), median", mergeMedian, 50, "ms"),
      bar("memory: worker JS heap + WASM + main JS heap, peak of after-open / after-10k-edits", peakMemory, 150, "MB"),
    ],
    allStateChecksPass: digestsOk,
    open: {
      snapshotOnly: summary(openSnapshot),
      snapshotThen200Updates: summary(openUpdates),
      importBatchSnapshotAnd200Updates: summary(openUpdatesBatch),
      firstPageOnly: {
        note: "no full block map: snapshot + 200 updates, then page list + every block of the biggest page",
        page: biggestPage,
        fixtureBlocks: biggestPageBlocks.length,
        firstPageReadyMsMedian: round(median(firstPage.map((r) => r.firstPageReadyMs))),
        runs: firstPage.map(rounded),
      },
    },
    keystroke: keystrokes,
    move: { ...moves, note: "subtree moves to a different parent, no official bar; 16 ms frame budget for reference" },
    merge: {
      edits: fixture.meta.mergeEdits,
      kinds: fixture.meta.mergeKinds,
      loroOps: fixture.meta.mergeLoroOps,
      bytes: fixture.meta.mergeBytes,
      msMedian: round(mergeMedian),
      msRuns: merges.map((m) => round(m.ms)),
      afterImportBatchOpen: {
        note: "same merge into a doc opened with importBatch (fully built state, ~3x the WASM memory)",
        msMedian: round(median(mergesAfterImportBatch.map((m) => m.ms))),
        msRuns: mergesAfterImportBatch.map((m) => round(m.ms)),
      },
    },
    localEdits,
    memory: { afterOpen: memoryAfterOpen, afterLocalEdits: memoryAfterEdits },
    sizes: {
      initial: {
        snapshotBytes: fixture.meta.snapshotBytes,
        shallowSnapshotBytes: fixture.meta.shallowSnapshotBytes,
        updateFiles: fixture.meta.updateFiles.length,
        editsInUpdateFiles: fixture.meta.updateEdits,
        updateFileBytes: fixture.meta.updateBytes,
      },
      afterSession: sizesAfterSession,
    },
    sqliteIndex: sqlite,
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  await context.close()
  await server.close()
  await rm(profile, { recursive: true, force: true })
}
