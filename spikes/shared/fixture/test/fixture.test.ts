import { describe, expect, it } from "vitest"
import { applyEdits, generateEdits, generateGraph, graphDigest, graphStats } from "../src/index.ts"

const graph = generateGraph()

describe("generateGraph", () => {
  it("is deterministic per seed", () => {
    expect(graphDigest(generateGraph())).toBe(graphDigest(graph))
    expect(graphDigest(generateGraph({ seed: 2 }))).not.toBe(graphDigest(graph))
  })

  it("pins the default fixture so every platform can check it generated the same graph", () => {
    expect(graphDigest(graph)).toMatchInlineSnapshot(`"5405c909c0dd19e2"`)
  })

  it("has the requested shape", () => {
    const stats = graphStats(graph)
    expect(stats).toMatchObject({ pages: 1_500, journals: 365, blocks: 50_000 })
    expect(stats.contentLength.min).toBeGreaterThanOrEqual(10)
    expect(stats.contentLength.max).toBeLessThanOrEqual(300)
    expect(Math.max(...Object.keys(stats.depth).map(Number))).toBe(10)
    const shallow = [1, 2, 3, 4].reduce((sum, d) => sum + stats.depth[d]!, 0)
    expect(shallow / stats.blocks).toBeGreaterThan(0.9)
    for (const key of ["pageRefs", "tags", "blockRefs", "tasks", "properties"] as const) expect(stats[key]).toBeGreaterThan(1_000)
  })

  it("lists parents before children and only references things that exist", () => {
    const pageNames = new Set(graph.pages.map((p) => p.name))
    const seen = new Set<string>()
    for (const b of graph.blocks) {
      if (b.parentId !== null) expect(seen.has(b.parentId)).toBe(true)
      seen.add(b.id)
      for (const [, name] of b.content.matchAll(/\[\[([^\]]+)\]\]/g)) expect(pageNames.has(name!)).toBe(true)
    }
    for (const b of graph.blocks)
      for (const [, id] of b.content.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)) expect(seen.has(id!)).toBe(true)
    expect(/[^\x00-\x7f]/.test(graph.blocks.map((b) => b.content).join(""))).toBe(false)
  })
})

describe("generateEdits", () => {
  const first = generateEdits(graph, { seed: 1, count: 10_000 })

  it("is deterministic and covers every edit kind", () => {
    expect(generateEdits(graph, { seed: 1, count: 10_000 })).toEqual(first)
    expect(new Set(first.map((e) => e.kind))).toEqual(new Set(["insertText", "deleteText", "createBlock", "moveBlock", "deleteBlock"]))
  })

  it("only produces edits that are valid against the evolving state", () => {
    const after = applyEdits(graph, first)
    const ids = new Set(after.blocks.map((b) => b.id))
    expect(ids.size).toBe(after.blocks.length)
    const second = generateEdits(graph, { seed: 2, count: 2_000, prior: first })
    expect(() => applyEdits(graph, [...first, ...second])).not.toThrow()
  })

  it("pins the 10k-edit result so platforms can compare final state", () => {
    expect(graphDigest(applyEdits(graph, first))).toMatchInlineSnapshot(`"a9197d2c91dfba7c"`)
  })
})
