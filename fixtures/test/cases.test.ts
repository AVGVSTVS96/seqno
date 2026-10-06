import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { edgeCase, edgeCases, graphsDir } from "../src/cases.ts"
import { largeFlatGraph, ogGeneratedGraph, readGraph, type GraphFile } from "../src/index.ts"

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)))

const committedFiles = (name: string) => {
  const found = edgeCase(name)
  if (found?.source._tag !== "Committed") throw new Error(`${name} is not a committed case`)
  return run(readGraph(found.source.dir))
}

const file = (files: ReadonlyArray<GraphFile>, path: string) => files.find((f) => f.path === path)?.content

const sha = (files: ReadonlyArray<GraphFile>) =>
  createHash("sha256")
    .update(files.map((f) => `${f.path}\n${f.content}`).join("\0"))
    .digest("hex")
    .slice(0, 16)

describe("edge-case manifest", () => {
  it("lists every committed graph folder exactly once", async () => {
    const folders = await run(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readDirectory(graphsDir)))
    expect(folders.toSorted()).toEqual(
      edgeCases
        .filter((c) => c.source._tag === "Committed")
        .map((c) => c.name)
        .toSorted(),
    )
  })

  it("covers every case heading in logseq docs/og_import_graph_cases.md", () => {
    expect(new Set(edgeCases.flatMap((c) => (c.upstreamCase === null ? [] : [c.upstreamCase])))).toEqual(
      new Set([
        "Legacy journal filename refs",
        "Missing block refs",
        "Forward block refs",
        "Duplicated block ids",
        "Generated Markdown file graphs",
        "Recursive block refs",
        "Missing pages",
        "Mixed repeated deadline and scheduled timestamps",
        "Linked external PDF annotations",
        "Windows and remote HTTPS linked PDF annotations",
        "Missing local PDF asset links",
        "Large flat files",
        "Empty imported files",
      ]),
    )
  })

  it("gives every committed graph a logseq/config.edn", async () => {
    for (const c of edgeCases.filter((c) => c.source._tag === "Committed"))
      expect(file(await committedFiles(c.name), "logseq/config.edn")).toContain(":preferred-format")
  })
})

describe("generated OG graphs", () => {
  it("keeps the committed seed 1309 graph identical to the generator", async () => {
    expect(await committedFiles("og-generated-1309")).toEqual(ogGeneratedGraph(1309).toSorted((a, b) => (a.path < b.path ? -1 : 1)))
  })

  it("matches upstream logseq output for seeds 42 and 8675309 (checked with nbb on 2026-10-06)", () => {
    expect(sha(ogGeneratedGraph(42))).toBe("046524ade98ffce0")
    expect(sha(ogGeneratedGraph(8675309))).toBe("01242e636b6f914a")
  })

  it("writes the large flat file as upstream does", () => {
    expect(largeFlatGraph(2)).toEqual([
      { path: "logseq/config.edn", content: "{}\n" },
      { path: "pages/large.md", content: "- large line 0 #tag\n- large line 1 #tag\n" },
    ])
    expect(largeFlatGraph()[1]?.content.split("\n").length).toBe(45_001)
  })
})

describe("committed graphs keep their edge", () => {
  it("empty-files has 0- and 1-byte files", async () => {
    const files = await committedFiles("empty-files")
    expect(Object.fromEntries(files.filter((f) => f.content.length < 2).map((f) => [f.path, f.content]))).toEqual({
      "journals/2025_11_11.md": "\n",
      "journals/2025_11_12.md": "",
      "pages/empty page.md": "",
      "pages/empty-org.org": "",
      "pages/one-dash.md": "-",
    })
  })

  it("og-syntax-mix keeps CRLF, an NFD file name and a missing final newline", async () => {
    const files = await committedFiles("og-syntax-mix")
    expect(file(files, "pages/crlf line endings.md")).toBe("- first line with CRLF\r\n  continuation line\r\n\t- child with CRLF\r\n")
    expect(files.map((f) => f.path)).toContain("pages/Café NFD.md")
    expect(file(files, "pages/no trailing newline.md")).toBe("- last line has no newline")
  })

  it("duplicated-block-ids repeats one id three times across two files", async () => {
    const files = await committedFiles("duplicated-block-ids")
    expect(files.map((f) => f.content.split("id:: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").length - 1)).toEqual([0, 2, 1])
  })

  it("missing-block-refs points at ids that no file defines", async () => {
    const text = (await committedFiles("missing-block-refs")).map((f) => f.content).join("\n")
    const defined = new Set([...text.matchAll(/id:: (\S+)/g)].map((m) => m[1]))
    const referenced = [...text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)].map((m) => m[1])
    expect(referenced.filter((id) => !defined.has(id))).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "55555555-5555-5555-5555-555555555555",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ])
  })
})
