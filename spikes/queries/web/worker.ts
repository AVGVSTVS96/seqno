import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
import { runBench, type BenchOptions } from "../src/bench.ts"
import { wasmDb } from "./wasm-db.ts"

const PRAGMAS = {
  durable: "PRAGMA journal_mode = truncate; PRAGMA synchronous = normal;",
  relaxed: "PRAGMA journal_mode = memory; PRAGMA synchronous = off;",
}

addEventListener("message", async (event: MessageEvent<Partial<BenchOptions> & { relaxed?: number }>) => {
  try {
    const sqlite3 = await sqlite3InitModule()
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "seqno-queries-bench", clearOnInit: true })
    const db = wasmDb(new pool.OpfsSAHPoolDb("/index.sqlite3"))
    const mode = event.data.relaxed ? "relaxed" : "durable"
    db.exec(`${PRAGMAS[mode]} PRAGMA temp_store = memory; PRAGMA cache_size = -32000;`)
    const version = String(db.all("SELECT sqlite_version()")[0]![0])
    const chrome = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]
    postMessage({ ok: runBench(db, `sqlite-wasm ${version} opfs-sahpool (${mode}: ${PRAGMAS[mode]}) ${chrome}`, event.data) })
  } catch (e) {
    postMessage({ error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) })
  }
})
