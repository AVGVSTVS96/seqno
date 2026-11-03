import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { LogseqSyntaxLive, importGraph, layerFileSystem, renderMirror } from "@seqno/interop"

const Node = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const fixture = new URL("../../../fixtures/graphs/pdf-highlights/", import.meta.url).pathname
const hlsFile = "pages/hls__Paper_1700000000000_0.md"

describe("PDF highlight pages", () => {
  it.effect("import a Logseq hls__ page and write it back byte for byte", () =>
    Effect.gen(function* () {
      const graph = yield* Effect.provide(
        importGraph,
        Layer.mergeAll(layerFileSystem(fixture), LogseqSyntaxLive),
      )
      const hls = graph.pages.find(({ page }) => page.name === "hls__paper_1700000000000_0")
      assert.deepStrictEqual(hls?.page.props, {
        file: "[Paper_1700000000000_0.pdf](../assets/Paper_1700000000000_0.pdf)",
        "file-path": "../assets/Paper_1700000000000_0.pdf",
      })
      assert.deepStrictEqual(
        hls?.blocks.map((block) => block.props),
        [
          {
            "ls-type": "annotation",
            "hl-page": "1",
            "hl-color": "green",
            id: "6ae9edd1-3d4a-41b9-b238-ec88d1525352",
          },
          {
            "ls-type": "annotation",
            "hl-page": "2",
            "hl-color": "purple",
            id: "6ae9edd5-8708-4843-820f-da66eb9673cd",
            "hl-type": "area",
            "hl-stamp": "1793715669070",
          },
        ],
      )
      const files = yield* Effect.provide(renderMirror(graph.pages, graph.config), LogseqSyntaxLive)
      const original = yield* Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.readFileString(`${fixture}${hlsFile}`),
      )
      assert.strictEqual(files.get(hlsFile), original)
    }).pipe(Effect.provide(Node)),
  )
})
