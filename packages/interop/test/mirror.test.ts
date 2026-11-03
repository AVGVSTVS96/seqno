import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import type { PageTree } from "@seqno/rpc"
import {
  LogseqSyntaxLive,
  defaultConfig,
  hasFile,
  importGraph,
  layerFileSystem,
  mirrorPath,
  refsIn,
  renderMirror,
  renderPage,
} from "@seqno/interop"

const Node = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const graphs = fileURLToPath(new URL("../../../fixtures/graphs/", import.meta.url))
const fixtures = readdirSync(graphs, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const importFrom = (root: string) =>
  Effect.provide(importGraph, Layer.mergeAll(layerFileSystem(root), LogseqSyntaxLive))

const refCounts = (pages: ReadonlyArray<PageTree>) => {
  const counts = new Map<string, number>()
  for (const { blocks } of pages) {
    for (const block of blocks) {
      const content = [block.text, ...Object.values(block.props)].join("\n")
      for (const target of new Set(refsIn(content)))
        counts.set(target, (counts.get(target) ?? 0) + 1)
    }
  }
  return counts
}

describe("rendering one page at a time", () => {
  it.effect("gives every fixture graph the same bytes as rendering the whole graph", () =>
    Effect.gen(function* () {
      const differing: Array<string> = []
      let rendered = 0
      for (const name of fixtures) {
        const graph = yield* importFrom(`${graphs}${name}`)
        const whole = yield* renderMirror(graph.pages, graph.config)
        const counts = refCounts(graph.pages)
        for (const tree of graph.pages.filter(hasFile)) {
          const referenced = new Set(
            tree.blocks.flatMap((block) =>
              (counts.get(block.id.toLowerCase()) ?? 0) > 0 ? [block.id.toLowerCase()] : [],
            ),
          )
          const path = mirrorPath(tree.page, graph.config)
          if ((yield* renderPage(tree, { referenced })) !== whole.get(path)) {
            differing.push(`${name}/${path}`)
          }
          rendered += 1
        }
      }
      assert.deepStrictEqual({ differing, rendered }, { differing: [], rendered: 65 })
    }).pipe(Effect.provide(Layer.merge(Node, LogseqSyntaxLive))),
  )

  it.effect("keeps an id line it wrote before, once nothing references the block any more", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      yield* fs.makeDirectory(path.join(root, "pages"))
      yield* fs.writeFileString(path.join(root, "pages", "Plans.md"), "- plan\n\t- step")
      const graph = yield* importFrom(root)
      const [tree] = graph.pages
      if (tree === undefined) return assert.fail("Plans was not imported")
      const step = tree.blocks[1]?.id ?? assert.fail("the step was not imported")
      const none = new Set<string>()
      assert.deepStrictEqual(
        [
          yield* renderPage(tree, { referenced: new Set([step]) }),
          yield* renderPage(tree, { referenced: none, keepIds: new Set([step]) }),
          yield* renderPage(tree, { referenced: none }),
        ],
        [
          `- plan\n\t- step\n\t  id:: ${step}`,
          `- plan\n\t- step\n\t  id:: ${step}`,
          "- plan\n\t- step",
        ],
      )
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(Node, LogseqSyntaxLive))),
  )

  it.effect("renders a .markdown page and a page titled apart from its file name as written", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      const files = {
        "pages/notes.markdown": "- a markdown file",
        "pages/old name.md": "title:: New Name\n\n- renamed in its title",
      }
      yield* fs.makeDirectory(path.join(root, "pages"))
      yield* Effect.forEach(Object.entries(files), ([relative, text]) =>
        fs.writeFileString(path.join(root, relative), text),
      )
      const graph = yield* importFrom(root)
      const rendered = yield* Effect.forEach(graph.pages, (tree) =>
        Effect.map(renderPage(tree, { referenced: new Set() }), (text) => [
          tree.page.title,
          mirrorPath(tree.page, defaultConfig),
          text,
        ]),
      )
      assert.deepStrictEqual(rendered, [
        ["notes", "pages/notes.md", "- a markdown file"],
        ["New Name", "pages/New Name.md", "title:: New Name\n\n- renamed in its title"],
      ])
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(Node, LogseqSyntaxLive))),
  )
})
