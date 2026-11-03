import { assert, describe, it } from "@effect/vitest"
import { Crypto, Effect, FileSystem, Layer, Path } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import type { PageTree } from "@seqno/rpc"
import { LogseqSyntaxLive, importGraph, layerFileSystem, renderMirror } from "@seqno/interop"

const counter = { value: 0 }
const SequentialCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => {
      counter.value += 1
      return Uint8Array.from({ length: size }, (_, index) => (counter.value * 31 + index) % 256)
    },
    digest: () => Effect.die("digest is not used by import"),
  }),
)

const Node = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const keptId = "01920000-0000-7000-8000-000000000001"
const legacyId = "6512a3f0-1111-4222-8333-444455556666"

const journal = [
  `- Met with [[Project X]] about ((${keptId}))`,
  "\t- TODO follow up",
  "\t  SCHEDULED: <2026-10-07 Wed>",
].join("\n")

const projectX = [
  "title:: Project X",
  "tags:: work",
  "",
  "- Plan",
  `  id:: ${keptId}`,
  "  collapsed:: true",
  "\t- step one",
  "- {{embed [[other]]}}",
  `  id:: ${legacyId}`,
].join("\n")

const namespaced = "- child of a namespace"

const graphFiles: Record<string, string> = {
  "logseq/config.edn": '{:file/name-format :triple-lowbar\n :hidden ["/pages/private"]}',
  "journals/2026_10_06.md": journal,
  "pages/Project X.md": projectX,
  "pages/a___b%3F.md": namespaced,
  "pages/.Later.md.icloud": "",
  "pages/notes.org": "* org",
  "pages/private/secret.md": "- hidden",
  "pages/project x.md": "- same name as Project X",
}

const withGraph = <A, E, R>(files: Record<string, string>, use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped()
    yield* Effect.forEach(Object.entries(files), ([relative, text]) =>
      Effect.andThen(
        fs.makeDirectory(path.dirname(path.join(root, relative)), { recursive: true }),
        fs.writeFileString(path.join(root, relative), text),
      ),
    )
    return yield* Effect.provide(use, layerFileSystem(root))
  }).pipe(Effect.scoped, Effect.provide(Node))

const shape = ({ page, blocks }: PageTree) => ({
  title: page.title,
  name: page.name,
  journalDay: page.journalDay,
  props: page.props,
  blocks: blocks.map((block) => ({
    parent: blocks.findIndex((other) => other.id === block.parentId),
    text: block.text,
    collapsed: block.collapsed,
    props: block.props,
  })),
})

const imported = withGraph(graphFiles, importGraph).pipe(
  Effect.provide(LogseqSyntaxLive),
  Effect.provide(SequentialCrypto),
)

describe("import", () => {
  it.effect("turns a Logseq folder into pages and ordered blocks", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      assert.deepStrictEqual(graph.pages.map(shape), [
        {
          title: "Oct 6th, 2026",
          name: "oct 6th, 2026",
          journalDay: 20261006,
          props: {},
          blocks: [
            {
              parent: -1,
              text: `Met with [[Project X]] about ((${keptId}))`,
              collapsed: false,
              props: {},
            },
            {
              parent: 0,
              text: "TODO follow up\nSCHEDULED: <2026-10-07 Wed>",
              collapsed: false,
              props: {},
            },
          ],
        },
        {
          title: "Project X",
          name: "project x",
          journalDay: null,
          props: { title: "Project X", tags: "work" },
          blocks: [
            { parent: -1, text: "Plan", collapsed: true, props: { id: keptId } },
            { parent: 0, text: "step one", collapsed: false, props: {} },
            { parent: -1, text: "{{embed [[other]]}}", collapsed: false, props: { id: legacyId } },
          ],
        },
        {
          title: "a/b?",
          name: "a/b?",
          journalDay: null,
          props: {},
          blocks: [{ parent: -1, text: "child of a namespace", collapsed: false, props: {} }],
        },
        {
          title: "notes",
          name: "notes",
          journalDay: null,
          props: {},
          blocks: [{ parent: -1, text: "org", collapsed: false, props: {} }],
        },
      ])
      assert.deepStrictEqual(graph.issues, [
        { _tag: "NotDownloaded", path: "pages/Later.md" },
        { _tag: "DuplicatePage", path: "pages/project x.md", name: "project x" },
      ])
    }),
  )

  it.effect("keeps UUIDv7 ids, mints new ids for legacy ones, and links children", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const [, project] = graph.pages
      const [plan, step, embed] = project?.blocks ?? []
      assert.strictEqual(plan?.id, keptId)
      assert.strictEqual(step?.parentId, keptId)
      assert.match(
        embed?.id ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      assert.notStrictEqual(embed?.id, legacyId)
      assert.deepStrictEqual(
        project?.blocks.map((block) => block.pageId),
        [project?.page.id, project?.page.id, project?.page.id],
      )
    }),
  )
})

describe("mirror", () => {
  it.effect("writes imported pages back byte for byte", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const files = yield* renderMirror(graph.pages, graph.config)
      assert.deepStrictEqual(Object.fromEntries(files), {
        "journals/2026_10_06.md": journal,
        "pages/Project X.md": projectX,
        "pages/a___b%3F.md": namespaced,
        "pages/notes.org": "* org",
      })
    }).pipe(Effect.provide(LogseqSyntaxLive)),
  )

  it.effect("adds an id line to a block that another block references", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const [journalPage, project] = graph.pages
      const step = project?.blocks[1]
      const refer = (pages: ReadonlyArray<PageTree>): ReadonlyArray<PageTree> =>
        pages.map((tree) =>
          tree === journalPage
            ? {
                ...tree,
                blocks: tree.blocks.map((block, index) =>
                  index === 0 ? { ...block, text: `see ((${step?.id}))` } : block,
                ),
              }
            : tree,
        )
      const files = yield* renderMirror(refer(graph.pages), graph.config)
      assert.strictEqual(
        files.get("pages/Project X.md"),
        projectX.replace("\t- step one", `\t- step one\n\t  id:: ${step?.id}`),
      )
    }).pipe(Effect.provide(LogseqSyntaxLive)),
  )

  it.effect("skips Chrome's swap files and seqno's staging files without listing them", () =>
    Effect.gen(function* () {
      const graph = yield* withGraph(
        {
          "pages/Plans.md": "- plan",
          "pages/Plans.md.crswap": "- half",
          "pages/Plans.md.seqno-tmp": "- staged",
          "pages/.Plans.md.crswap.icloud": "",
        },
        importGraph,
      )
      assert.deepStrictEqual(
        { pages: graph.pages.map((tree) => tree.page.title), issues: graph.issues },
        { pages: ["Plans"], issues: [] },
      )
    }).pipe(Effect.provide(LogseqSyntaxLive), Effect.provide(SequentialCrypto)),
  )
})
