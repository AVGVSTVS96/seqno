import { describe, expect, it } from "vitest"
import { generateEdits, generateGraph } from "../../shared/fixture/src/index.ts"
import { createIndex } from "../src/index.ts"
import { liveSet } from "../src/live-set.ts"
import { createLive } from "../src/live.ts"
import { openNodeDb } from "../src/node-db.ts"
import { typing } from "../src/typing.ts"

const small = () => generateGraph({ blocks: 6_000, pages: 400, journals: 120 })

const setup = () => {
  const graph = small()
  const index = createIndex(openNodeDb(), graph)
  const live = createLive(index.db)
  for (const q of liveSet) live.add(q.name, q.query, q.ctx)
  return { graph, index, live }
}

describe("live queries never go stale", () => {
  it("under random structural edits (create/move/delete/insert/delete text)", () => {
    const { graph, index, live } = setup()
    let woken = 0
    let reran = 0
    for (const edit of generateEdits(graph, { seed: 11, count: 600 })) {
      const tick = live.apply(index.apply(edit))
      woken += tick.woken
      reran += tick.reran.length
      expect(live.stale().map((q) => q.name)).toEqual([])
    }
    expect(reran).toBeLessThan(woken)
  })

  it("while typing tags, refs, markers, deadlines and properties into result blocks", () => {
    const { index, live } = setup()
    const rids = [...new Set(live.live.flatMap((q) => (q.query.find === "blocks" ? q.rows.slice(0, 50).map((r) => r[0]) : [])))]
    const pool = index.db.all(`SELECT id FROM blocks WHERE rid IN (${rids.join(",")})`).map((r) => String(r[0]))
    const keys = typing(index.model, 3, () => pool)
    let reran = 0
    for (let k = 0; k < 1_500; k++) {
      const tick = live.apply(index.apply(keys.next().value!.edit))
      reran += tick.reran.length
      expect(live.stale().map((q) => q.name)).toEqual([])
    }
    expect(reran / 1_500).toBeLessThan(2)
  })
})
