import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { LogseqSyntaxLive, importGraph, layerFileSystem, renderMirror } from "../src/index.ts"

const fixture = new URL("../../../fixtures/graphs/org-and-front-matter/", import.meta.url).pathname

const Node = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const imported = Effect.provide(
  importGraph,
  Layer.mergeAll(layerFileSystem(fixture), LogseqSyntaxLive),
)

describe("Org and front matter pages", () => {
  it.effect("import with Logseq's titles, page properties and formats", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      assert.deepStrictEqual(
        graph.pages.map(({ page }) => [page.title, page.format ?? "md", page.frontMatter ?? false]),
        [
          ["Nov 2nd, 2026", "org", false],
          ["Garden Plan", "md", false],
          ["Reading list", "org", false],
          ["Field Notes", "md", true],
          ["yaml list", "md", false],
        ],
      )
      assert.deepStrictEqual(graph.issues, [])
    }).pipe(Effect.provide(Node)),
  )

  it.effect("write every page back byte for byte", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const files = yield* Effect.provide(renderMirror(graph.pages, graph.config), LogseqSyntaxLive)
      const fs = yield* FileSystem.FileSystem
      for (const path of [
        "pages/field.md",
        "pages/Reading list.org",
        "pages/Garden Plan.md",
        "journals/2026_11_02.org",
      ]) {
        const original = yield* fs.readFileString(`${fixture}${path}`)
        const written = files.get(path === "pages/field.md" ? "pages/Field Notes.md" : path)
        assert.strictEqual(written, original, path)
      }
    }).pipe(Effect.provide(Node)),
  )
})
