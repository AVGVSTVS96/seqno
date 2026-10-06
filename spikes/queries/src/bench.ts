import { generateGraph } from "../../shared/fixture/src/index.ts"
import { compile } from "./compile.ts"
import type { Db } from "./db.ts"
import { createIndex } from "./index.ts"
import { liveSet, measured } from "./live-set.ts"
import { createLive } from "./live.ts"
import { typing } from "./typing.ts"

export interface BenchOptions {
  readonly seed: number
  readonly runs: number
  readonly warmup: number
  readonly keystrokes: number
  readonly typingSeed: number
  readonly verifyEvery: number
}

export const defaultBench: BenchOptions = { seed: 20261006, runs: 40, warmup: 5, keystrokes: 2000, typingSeed: 7, verifyEvery: 0 }

const stats = (xs: ReadonlyArray<number>, digits = 2) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
  const r = (x: number) => Number(x.toFixed(digits))
  return { mean: r(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), p50: r(at(0.5)), p95: r(at(0.95)), max: r(s.at(-1) ?? 0) }
}

export const runBench = (db: Db, engine: string, options: Partial<BenchOptions> = {}) => {
  const o = { ...defaultBench, ...options }
  const graph = generateGraph({ seed: o.seed })
  const t0 = performance.now()
  const index = createIndex(db, graph)
  const buildMs = Math.round(performance.now() - t0)

  const queries = measured.map(({ name, query, ctx }) => {
    const c = compile(query, ctx)
    let rows = 0
    for (let i = 0; i < o.warmup; i++) rows = db.all(c.sql, c.params).length
    const times = Array.from({ length: o.runs }, () => {
      const s = performance.now()
      db.all(c.sql, c.params)
      return performance.now() - s
    })
    const { p50, p95, max } = stats(times)
    return { name, rows, p50, p95, max }
  })

  const live = createLive(db)
  const t1 = performance.now()
  for (const q of liveSet) live.add(q.name, q.query, q.ctx)
  const openMs = Math.round(performance.now() - t1)

  let pool: string[] = []
  const refreshPool = () => {
    const rids = [...new Set(live.live.filter((q) => q.query.find === "blocks").flatMap((q) => q.rows.slice(0, 200).map((r) => r[0])))]
    pool = rids.length === 0 ? [] : db.all(`SELECT id FROM blocks WHERE rid IN (${rids.join(",")})`).map((r) => String(r[0]))
  }
  refreshPool()
  const keys = typing(index.model, o.typingSeed, () => pool)
  const woken: number[] = []
  const reran: number[] = []
  const indexMs: number[] = []
  const liveMs: number[] = []
  const totalMs: number[] = []
  const rerunsBy = new Map<string, number>()
  let stale = 0
  for (let k = 0; k < o.keystrokes; k++) {
    if (k % 250 === 0) refreshPool()
    const { edit } = keys.next().value!
    const s = performance.now()
    const changes = index.apply(edit)
    const m = performance.now()
    const tick = live.apply(changes)
    const e = performance.now()
    woken.push(tick.woken)
    reran.push(tick.reran.length)
    indexMs.push(m - s)
    liveMs.push(e - m)
    totalMs.push(e - s)
    for (const q of tick.reran) rerunsBy.set(q.name, (rerunsBy.get(q.name) ?? 0) + 1)
    if (o.verifyEvery > 0 && k % o.verifyEvery === 0) stale += live.stale().length
  }

  return {
    engine,
    graph: { seed: o.seed, blocks: graph.blocks.length, pages: graph.pages.length },
    buildMs,
    queryRuns: o.runs,
    queries,
    worstQueryP95: Math.max(...queries.map((q) => q.p95)),
    live: {
      queries: liveSet.length,
      openMs,
      keystrokes: o.keystrokes,
      rerunsPerKeystroke: { ...stats(reran), zeroPct: Math.round((100 * reran.filter((x) => x === 0).length) / reran.length) },
      wokenByKeysOnly: stats(woken),
      naive: liveSet.length,
      indexMs: stats(indexMs),
      liveMs: stats(liveMs),
      keystrokeMs: stats(totalMs),
      rerunsByQuery: Object.fromEntries([...rerunsBy].sort((a, b) => b[1] - a[1])),
      ...(o.verifyEvery > 0 ? { staleResults: stale, verifiedEvery: o.verifyEvery } : {}),
    },
  }
}
