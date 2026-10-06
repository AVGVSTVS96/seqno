import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  applyEdits,
  generateEdits,
  generateGraph,
  graphDigest,
  graphStats,
  logseqConfig,
  readGraph,
  toLogseqFiles,
  type GeneratedGraph,
} from "../src/index.ts"

const graph = generateGraph()

describe("generateGraph", () => {
  it("is deterministic per seed", () => {
    expect(graphDigest(generateGraph())).toBe(graphDigest(graph))
    expect(graphDigest(generateGraph({ seed: 2 }))).not.toBe(graphDigest(graph))
  })

  it("matches the phase 0 fixture digest, so spike numbers stay comparable", () => {
    expect(graphDigest(graph)).toBe("5405c909c0dd19e2")
  })

  it("has the requested shape", () => {
    const stats = graphStats(graph)
    expect(stats).toMatchObject({ pages: 1_500, journals: 365, blocks: 50_000 })
    expect(stats.textLength.min).toBeGreaterThanOrEqual(10)
    expect(stats.textLength.max).toBeLessThanOrEqual(300)
    expect(Math.max(...Object.keys(stats.depth).map(Number))).toBe(10)
    const shallow = [1, 2, 3, 4].reduce((sum, d) => sum + stats.depth[d]!, 0)
    expect(shallow / stats.blocks).toBeGreaterThan(0.9)
    expect(Math.min(stats.pageRefs, stats.tags, stats.blockRefs, stats.tasks, stats.properties)).toBeGreaterThan(1_000)
  })

  it("lists parents before children and only references things that exist", () => {
    const pageNames = new Set(graph.pages.map((p) => p.name))
    const seen = new Set<string>()
    for (const b of graph.blocks) {
      if (b.parentId !== null) expect(seen.has(b.parentId)).toBe(true)
      seen.add(b.id)
      for (const [, name] of b.text.matchAll(/\[\[([^\]]+)\]\]/g)) expect(pageNames.has(name!)).toBe(true)
    }
    for (const b of graph.blocks) for (const [, id] of b.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)) expect(seen.has(id!)).toBe(true)
    expect(/[^\x00-\x7f]/.test(graph.blocks.map((b) => b.text).join(""))).toBe(false)
  })
})

describe("generateEdits", () => {
  const first = generateEdits(graph, { seed: 1, count: 10_000 })

  it("is deterministic and covers every edit tag", () => {
    expect(generateEdits(graph, { seed: 1, count: 10_000 })).toEqual(first)
    expect(new Set(first.map((e) => e._tag))).toEqual(new Set(["InsertText", "DeleteText", "CreateBlock", "MoveBlock", "DeleteBlock"]))
  })

  it("only produces edits that are valid against the evolving state", () => {
    const after = applyEdits(graph, first)
    const ids = new Set(after.blocks.map((b) => b.id))
    expect(ids.size).toBe(after.blocks.length)
    const second = generateEdits(graph, { seed: 2, count: 2_000, prior: first })
    expect(() => applyEdits(graph, [...first, ...second])).not.toThrow()
  })

  it("matches the phase 0 digest after 10k edits", () => {
    expect(graphDigest(applyEdits(graph, first))).toBe("a9197d2c91dfba7c")
  })
})

describe("toLogseqFiles", () => {
  it("writes pages, journals, nesting, multi-line text and id:: for referenced blocks", () => {
    const target = "00000000-0000-4000-8000-000000000002"
    const small: GeneratedGraph = {
      options: { seed: 1, blocks: 4, pages: 1, journals: 1 },
      pages: [
        { id: "p1", name: "project/Alpha", journalDay: null },
        { id: "p2", name: "Jan 2nd, 2025", journalDay: 20250102 },
      ],
      blocks: [
        { id: "b1", pageId: "p1", parentId: null, text: "type:: project\nstatus:: active" },
        { id: target, pageId: "p1", parentId: null, text: "TODO ship it\nSCHEDULED: <2025-01-03 Fri>\nsecond line" },
        { id: "b3", pageId: "p1", parentId: target, text: "child" },
        { id: "b4", pageId: "p2", parentId: null, text: `see ((${target}))` },
      ],
    }
    expect(toLogseqFiles(small)).toEqual([
      { path: "logseq/config.edn", content: logseqConfig },
      {
        path: "pages/project___Alpha.md",
        content: `- type:: project\n  status:: active\n- TODO ship it\n  SCHEDULED: <2025-01-03 Fri>\n  id:: ${target}\n  second line\n\t- child\n`,
      },
      { path: "journals/2025_01_02.md", content: `- see ((${target}))\n` },
    ])
  })

  it("gives every page of the 50k graph its own file", () => {
    const files = toLogseqFiles(graph)
    expect(files.length).toBe(1 + 1_500 + 365)
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length)
    expect(files.find((f) => f.path === "journals/2025_12_31.md")?.content.startsWith("- ")).toBe(true)
  })
})

describe("cli generate", () => {
  it("writes the same Logseq folder that toLogseqFiles returns", async () => {
    const options = { seed: 7, blocks: 300, pages: 20, journals: 5 }
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
    const written = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const out = yield* fs.makeTempDirectoryScoped({ prefix: "seqno-fixtures-" })
          const args = ["generate", "--seed", "7", "--blocks", "300", "--pages", "20", "--journals", "5", "--out", out]
          const printed = yield* spawner.string(ChildProcess.make("node", [cli, ...args]))
          return { printed: JSON.parse(printed), files: yield* readGraph(out) }
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    )
    const expected = toLogseqFiles(generateGraph(options))
    expect(written.printed.files).toBe(26)
    expect(written.printed.digest).toBe(graphDigest(generateGraph(options)))
    expect(written.files).toEqual([...expected].sort((a, b) => (a.path < b.path ? -1 : 1)))
  })
})
