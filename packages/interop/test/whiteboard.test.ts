import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path, Result } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { BlockId, PageId, shapeOf, shapeProps, shapeRaw, whiteboardProps } from "@seqno/domain"
import type { Block } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import {
  LogseqSyntaxLive,
  defaultConfig,
  importGraph,
  layerFileSystem,
  printEdn,
  readEdn,
  clonedWhiteboard,
  readWhiteboard,
  renderMirror,
  GraphFolder,
  whiteboardBlocks,
} from "@seqno/interop"
import { entriesOf, itemsOf } from "../src/edn.ts"

const Node = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const fixture = new URL("../../../fixtures/graphs/whiteboards/", import.meta.url).pathname

const read = (relative: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(`${fixture}${relative}`))

const imported = Effect.provide(
  importGraph,
  Layer.mergeAll(layerFileSystem(fixture), LogseqSyntaxLive),
)

const must = <A>(value: A | undefined): A => {
  if (value === undefined) {
    throw new Error("expected a value")
  }

  return value
}

const boardNamed = (pages: readonly PageTree[], name: string) =>
  must(pages.find(({ page }) => page.name === name))

const fileParts = (text: string) => {
  const edn = Result.getOrElse(readEdn(text), () => null)

  return {
    blocks: itemsOf(entriesOf(edn).get("blocks")).map(printEdn).toSorted(),
    pages: itemsOf(entriesOf(edn).get("pages")).map(printEdn),
  }
}

const blockOf = (blocks: readonly Block[], logseqId: string) =>
  blocks.find((block) => (block.props["id"] ?? block.id) === logseqId)

describe("whiteboard import", () => {
  it.effect(
    "reads each Logseq whiteboard as a whiteboard page, its shapes in Logseq's z-order",
    () =>
      Effect.gen(function* () {
        const graph = yield* imported
        assert.deepStrictEqual(graph.issues, [])
        assert.deepStrictEqual(
          graph.pages.map(({ page, blocks }) => [page.title, page.props["ls-type"], blocks.length]),
          [
            ["colloquium 2", "whiteboard-page", 82],
            ["Test Whiteboard", "whiteboard-page", 80],
          ],
        )
        const docs = boardNamed(graph.pages, "test whiteboard")
        assert.deepStrictEqual(
          docs.blocks
            .slice(0, 5)
            .map((block) => [shapeRaw(block)["type"], shapeRaw(block)["index"]]),
          [
            ["box", 0],
            ["box", 1],
            ["box", 2],
            ["text", 3],
            ["text", 4],
          ],
        )
        assert.deepStrictEqual(docs.page.props["created-at"], "1679679225782")
        assert.deepStrictEqual(docs.page.props["updated-at"], "1680021548135")
      }).pipe(Effect.provide(Node)),
  )

  it.effect("moves each shape's words into its block's text and keeps Logseq's id", () =>
    Effect.gen(function* () {
      const board = boardNamed((yield* imported).pages, "colloquium 2")
      const text = (id: string) => blockOf(board.blocks, id)?.text
      assert.deepStrictEqual(
        text("1b2004f0-ec65-11ef-8259-89f20a5587ec"),
        "[[Open Questions Colloquium]]",
      )
      assert.deepStrictEqual(
        text("43c83760-edf5-11ef-9b5c-0da4171c3d1b"),
        "((67b47f01-ed4b-44ca-b8b8-222c82aaa1c9))",
      )
      assert.deepStrictEqual(
        text("8d3af870-edf4-11ef-9b5c-0da4171c3d1b"),
        "Written Hand In\n4th of April",
      )
      const portal = blockOf(board.blocks, "1b2004f0-ec65-11ef-8259-89f20a5587ec")
      assert.deepStrictEqual(
        Option.map(shapeOf(must(portal)), (s) => s.type),
        Option.some("logseq-portal"),
      )
      assert.deepStrictEqual(
        ["pageId", "label", "text"].filter((key) => key in shapeRaw(must(portal))),
        [],
      )
      assert.deepStrictEqual(portal?.props["created-at"], "1740435659664")
    }).pipe(Effect.provide(Node)),
  )

  it.effect("points each member of a Logseq group at the block it names", () =>
    Effect.gen(function* () {
      const board = boardNamed((yield* imported).pages, "colloquium 2")
      const grouped = must(blockOf(board.blocks, "e7c68c10-f055-11ef-a173-dd256d1a9cd8"))
      const children = shapeRaw(grouped)["children"]
      const ids = Array.isArray(children) ? children : []
      assert.strictEqual(ids.length, 13)
      assert.deepStrictEqual(
        ids.filter((child) => !board.blocks.some((block) => block.id === child)),
        [],
      )
    }).pipe(Effect.provide(Node)),
  )

  it.effect("points each bound connector handle at the block it is bound to", () =>
    Effect.gen(function* () {
      const board = boardNamed((yield* imported).pages, "test whiteboard")
      const line = blockOf(board.blocks, "07b85b2a-ca6a-11ed-8caa-efa6679223ca")
      const target = blockOf(board.blocks, "07b7befd-ca6a-11ed-8caa-efa6679223ca")
      assert.deepStrictEqual(shapeRaw(must(line))["handles"], {
        start: { id: "start", canBind: true, point: [41.57, 0] },
        end: {
          id: "end",
          canBind: true,
          point: [0, 0.29],
          bindingId: "07b8823c-ca6a-11ed-8caa-efa6679223ca",
          bindTo: must(target).id,
        },
      })
    }).pipe(Effect.provide(Node)),
  )

  it.effect("keeps a board's plain blocks as an outline after its shapes", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const docs = boardNamed(graph.pages, "test whiteboard")
      assert.deepStrictEqual(
        docs.blocks.at(-1)?.text,
        "#+BEGIN_WARNING\nChanges you make in whiteboards are not saved\n#+END_WARNING",
      )
      const board = boardNamed(graph.pages, "colloquium 2")
      const parent = blockOf(board.blocks, "67b22d63-71b5-4393-bfc9-8e2ce5190d9c")
      const child = blockOf(board.blocks, "67b47c4f-7fcf-4e5c-a537-dfe3197c3cb5")
      const published = blockOf(board.blocks, "ee6b90f6-cc94-4039-a4a4-bec3d88c246c")
      assert.deepStrictEqual(
        [published?.text, published?.props],
        ["", { public: "true", id: "ee6b90f6-cc94-4039-a4a4-bec3d88c246c" }],
      )
      assert.deepStrictEqual([parent?.text, parent?.parentId], ["", null])
      assert.deepStrictEqual(
        [child?.text, child?.parentId],
        ["Archive Design Requirements", parent?.id],
      )
    }).pipe(Effect.provide(Node)),
  )

  it.effect("reports a whiteboard file that isn't EDN, and a non-EDN file in whiteboards/", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      yield* fs.makeDirectory(path.join(root, "whiteboards"))
      yield* fs.writeFileString(path.join(root, "whiteboards", "Broken.edn"), "{:blocks (")
      yield* fs.writeFileString(path.join(root, "whiteboards", "Notes.md"), "- a")

      const graph = yield* Effect.provide(
        importGraph,
        Layer.mergeAll(layerFileSystem(root), LogseqSyntaxLive),
      )

      assert.deepStrictEqual(graph.issues, [
        { _tag: "Unsupported", path: "whiteboards/Notes.md" },
        { _tag: "Unreadable", path: "whiteboards/Broken.edn", reason: "missing ) at 10" },
      ])
    }).pipe(Effect.scoped, Effect.provide(Node)),
  )
})

const pageId = PageId.make("01920000-0000-7000-8000-00000000b0a1")
const id = (n: number) => BlockId.make(`01920000-0000-7000-8000-0000000000b${n}`)

const drawnBlock = (n: number, text: string, props: Block["props"]): Block => ({
  id: id(n),
  pageId,
  parentId: null,
  text,
  collapsed: false,
  props,
})

const drawn: PageTree = {
  page: { id: pageId, name: "plans", title: "Plans", journalDay: null, props: whiteboardProps },
  blocks: [
    drawnBlock(1, "Idea", shapeProps({ type: "box", point: [0, 0], size: [200, 100] })),
    drawnBlock(
      2,
      "[[Project X]]",
      shapeProps({ type: "logseq-portal", point: [400, 0], size: [400, 0] }),
    ),
    drawnBlock(
      3,
      "leads to",
      shapeProps({
        type: "line",
        point: [200, 50],
        handles: {
          start: { point: [0, 0], bindTo: id(1) },
          end: { point: [200, 0], bindTo: id(2) },
        },
        decorations: { end: "arrow" },
      }),
    ),
    drawnBlock(4, "Remember the **milk**", {}),
  ],
}

describe("whiteboard mirror", () => {
  it.effect(
    "writes Logseq's docs whiteboard back with every block and the page byte for byte",
    () =>
      Effect.gen(function* () {
        const graph = yield* imported

        const files = yield* Effect.provide(
          renderMirror(graph.pages, graph.config),
          LogseqSyntaxLive,
        )

        const original = yield* read("whiteboards/Test Whiteboard.edn")
        const written = files.get("whiteboards/Test Whiteboard.edn") ?? ""
        assert.deepStrictEqual(fileParts(written), fileParts(original))
        assert.deepStrictEqual(written.length, original.length)
      }).pipe(Effect.provide(Node)),
  )

  it.effect("writes a real portal board back the same, apart from properties Logseq left out", () =>
    Effect.gen(function* () {
      const graph = yield* imported
      const files = yield* Effect.provide(renderMirror(graph.pages, graph.config), LogseqSyntaxLive)
      const before = fileParts(yield* read("whiteboards/Colloquium 2.edn"))
      const after = fileParts(files.get("whiteboards/colloquium 2.edn") ?? "")
      assert.deepStrictEqual(after.pages, before.pages)
      const changed = after.blocks.filter((block) => !before.blocks.includes(block))
      assert.deepStrictEqual(
        changed.map((block) => /:block\/uuid #uuid "([^"]+)"\}$/u.exec(block)?.[1]),
        [
          "67b22d63-71b5-4393-bfc9-8e2ce5190d9c",
          "67b87c75-abde-4c73-8d14-ce3da4a40003",
          "67b47c4f-7fcf-4e5c-a537-dfe3197c3cb5",
        ],
      )
      assert.deepStrictEqual(
        changed.map((block) => block.replace(":block/properties \n{}\n", "")),
        before.blocks.filter((block) => !after.blocks.includes(block)),
      )
    }).pipe(Effect.provide(Node)),
  )

  it.effect("writes a board drawn in seqno as the EDN file Logseq writes", () =>
    Effect.gen(function* () {
      const files = yield* renderMirror([drawn], defaultConfig)
      assert.deepStrictEqual([...files.keys()], ["whiteboards/Plans.edn"])
      assert.strictEqual(
        files.get("whiteboards/Plans.edn"),
        [
          "{:blocks (",
          "{:block/properties ",
          "{:ls-type :whiteboard-shape",
          ":logseq.tldraw.shape ",
          '{:type "box"',
          ":point [0 0]",
          ":size [200 100]",
          ':id "01920000-0000-7000-8000-0000000000b1"',
          ":index 0",
          ":nonce 1",
          ':label "Idea"}}} ',
          "{:block/properties ",
          "{:ls-type :whiteboard-shape",
          ":logseq.tldraw.shape ",
          '{:type "logseq-portal"',
          ":point [400 0]",
          ":size [400 0]",
          ':id "01920000-0000-7000-8000-0000000000b2"',
          ":index 1",
          ":nonce 1",
          ':blockType "P"',
          ':pageId "Project X"}}} ',
          "{:block/properties ",
          "{:ls-type :whiteboard-shape",
          ":logseq.tldraw.shape ",
          '{:type "line"',
          ":point [200 50]",
          ":handles ",
          "{:start ",
          '{:id "start"',
          ":canBind true",
          ":point [0 0]",
          ':bindingId "90176c22-3e54-4af4-a17b-efc280718ddd"}',
          ":end ",
          '{:id "end"',
          ":canBind true",
          ":point [200 0]",
          ':bindingId "b25bc749-e462-44f8-8fdc-5e7cf4724c3c"}}',
          ":decorations ",
          '{:end "arrow"}',
          ':id "01920000-0000-7000-8000-0000000000b3"',
          ":index 2",
          ":nonce 1",
          ':label "leads to"}}} ',
          '{:block/content "Remember the **milk**"',
          ":block/format :markdown",
          ":block/left ",
          '{:block/uuid #uuid "01920000-0000-7000-8000-00000000b0a1"}',
          ":block/parent ",
          '{:block/uuid #uuid "01920000-0000-7000-8000-00000000b0a1"}',
          ":block/properties ",
          "{}",
          ':block/uuid #uuid "01920000-0000-7000-8000-0000000000b4"})',
          ":pages (",
          '{:block/name "plans"',
          ':block/original-name "Plans"',
          ":block/properties ",
          "{:ls-type :whiteboard-page",
          ":logseq.tldraw.page ",
          '{:id "01920000-0000-7000-8000-00000000b0a1"',
          ':name "plans"',
          ":bindings ",
          "{:90176c22-3e54-4af4-a17b-efc280718ddd ",
          '{:id "90176c22-3e54-4af4-a17b-efc280718ddd"',
          ':type "line"',
          ':fromId "01920000-0000-7000-8000-0000000000b3"',
          ':toId "01920000-0000-7000-8000-0000000000b1"',
          ':handleId "start"',
          ":point [0.5 0.5]",
          ":distance 4}",
          ":b25bc749-e462-44f8-8fdc-5e7cf4724c3c ",
          '{:id "b25bc749-e462-44f8-8fdc-5e7cf4724c3c"',
          ':type "line"',
          ':fromId "01920000-0000-7000-8000-0000000000b3"',
          ':toId "01920000-0000-7000-8000-0000000000b2"',
          ':handleId "end"',
          ":point [0.5 0.5]",
          ":distance 4}}",
          ":nonce 1",
          ":assets []",
          ':shapes-index ("01920000-0000-7000-8000-0000000000b1" "01920000-0000-7000-8000-0000000000b2" "01920000-0000-7000-8000-0000000000b3")}}',
          ':block/type "whiteboard"',
          ':block/uuid #uuid "01920000-0000-7000-8000-00000000b0a1"})}',
        ].join("\n"),
      )
    }).pipe(Effect.provide(LogseqSyntaxLive)),
  )

  it.effect("lists a dropped image and PDF in the board's assets, typed as Logseq types them", () =>
    Effect.gen(function* () {
      const media: PageTree = {
        page: drawn.page,
        blocks: [
          drawnBlock(
            5,
            "",
            shapeProps({
              type: "image",
              point: [0, 0],
              size: [200, 120],
              assetId: "a1",
              src: "../assets/beds_1_0.png",
            }),
          ),
          drawnBlock(
            6,
            "",
            shapeProps({
              type: "pdf",
              point: [300, 0],
              size: [298, 421],
              assetId: "a2",
              src: "../assets/plan_1_1.pdf",
            }),
          ),
        ],
      }

      const files = yield* renderMirror([media], defaultConfig)
      const file = files.get("whiteboards/Plans.edn") ?? ""
      const assets = file.slice(file.indexOf(":assets "), file.indexOf(":shapes-index"))
      assert.strictEqual(
        assets,
        [
          ":assets [",
          '{:id "a1"',
          ':type "image"',
          ':src "../assets/beds_1_0.png"',
          ":size [200 120]} ",
          '{:id "a2"',
          ':type "pdf"',
          ':src "../assets/plan_1_1.pdf"',
          ":size [298 421]}]",
          "",
        ].join("\n"),
      )
      assert.isFalse(file.slice(0, file.indexOf(":pages")).includes(":src"))
    }).pipe(Effect.provide(LogseqSyntaxLive)),
  )

  it.effect("reads its own whiteboard file back to the same blocks, bindings and portals", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped()
      const folder = layerFileSystem(root)
      const written = yield* renderMirror([drawn], defaultConfig)
      yield* Effect.provide(
        Effect.forEach(written, ([path, text]) =>
          Effect.gen(function* () {
            yield* (yield* GraphFolder).write(path, text)
          }),
        ),
        folder,
      )
      const graph = yield* Effect.provide(importGraph, Layer.mergeAll(folder, LogseqSyntaxLive))
      const board = boardNamed(graph.pages, "plans")
      assert.deepStrictEqual(
        board.blocks.map((b) => [b.id, b.text, b.props["id"]]),
        drawn.blocks.map((b) => [b.id, b.text, undefined]),
      )
      const handles = shapeRaw(must(board.blocks[2]))["handles"]
      assert.deepStrictEqual(handles, {
        start: {
          id: "start",
          canBind: true,
          point: [0, 0],
          bindingId: "90176c22-3e54-4af4-a17b-efc280718ddd",
          bindTo: id(1),
        },
        end: {
          id: "end",
          canBind: true,
          point: [200, 0],
          bindingId: "b25bc749-e462-44f8-8fdc-5e7cf4724c3c",
          bindTo: id(2),
        },
      })
      const again = yield* renderMirror(graph.pages, graph.config)
      assert.deepStrictEqual(
        again.get("whiteboards/Plans.edn"),
        (yield* renderMirror([drawn], defaultConfig)).get("whiteboards/Plans.edn"),
      )
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(Node, LogseqSyntaxLive))),
  )

  it.effect("gives a rebound handle a new binding and drops the binding to a deleted shape", () =>
    Effect.gen(function* () {
      const line = must(drawn.blocks[2])

      const moved: PageTree = {
        ...drawn,
        blocks: [
          must(drawn.blocks[1]),
          {
            ...line,
            props: shapeProps({
              ...shapeRaw(line),
              handles: { start: { point: [5, 5] }, end: { point: [200, 0], bindTo: id(2) } },
            }),
          },
        ],
      }

      const text = (yield* renderMirror([moved], defaultConfig)).get("whiteboards/Plans.edn") ?? ""
      assert.deepStrictEqual(
        [...text.matchAll(/:bindingId "([^"]+)"/gu)].map((match) => match[1]),
        ["b25bc749-e462-44f8-8fdc-5e7cf4724c3c"],
      )
      assert.deepStrictEqual(
        [...text.matchAll(/:toId "([^"]+)"/gu)].map((match) => match[1]),
        ["01920000-0000-7000-8000-0000000000b2"],
      )
      assert.include(
        text,
        ':shapes-index ("01920000-0000-7000-8000-0000000000b2" "01920000-0000-7000-8000-0000000000b3")',
      )
    }).pipe(Effect.provide(LogseqSyntaxLive)),
  )
})

describe("edn", () => {
  it("prints a map of more than eight keys in ClojureScript's hash order, as Logseq wrote this group", () => {
    const written = [
      "{:children []",
      ":index 76",
      ":scale [1 1]",
      ':type "group"',
      ":size [0 0]",
      ':id "e7c68c10-f055-11ef-a173-dd256d1a9cd8"',
      ":point [-80 32]",
      ':parentId "67b0c670-d163-45b2-867b-e630a151f914"',
      ":nonce 1740143722403}",
    ]

    const reversed = `{${written
      .map((line) => line.replaceAll(/^\{|\}$/gu, ""))
      .toReversed()
      .join(" ")}}`

    assert.strictEqual(
      printEdn(Result.getOrElse(readEdn(reversed), () => null)),
      `\n${written.join("\n")}`,
    )
  })

  it("reads and writes the ##NaN Logseq leaves on a shape it gave no nonce", () => {
    assert.strictEqual(
      printEdn(Result.getOrElse(readEdn("{:nonce ##NaN :a ##-Inf}"), () => null)),
      "\n{:nonce ##NaN\n:a ##-Inf}",
    )
  })

  it("clones a board as Logseq's onboarding does: new ids, bindings kept only for the line that owns them", () => {
    const edn = `{:blocks
 ({:block/created-at 1 :block/updated-at 1 :block/properties {:ls-type :whiteboard-shape :logseq.tldraw.shape {:id "a1" :type "box" :index 0 :point [0 0] :size [100 100]}}}
  {:block/properties {:ls-type :whiteboard-shape :logseq.tldraw.shape {:id "l1" :type "line" :index 1 :point [200 50] :handles {:start {:id "start" :point [0 0]} :end {:id "end" :point [-90 0] :bindingId "b1"}}}}}
  {:block/properties {:ls-type :whiteboard-shape :logseq.tldraw.shape {:id "l2" :type "line" :index 2 :point [200 80] :handles {:start {:id "start" :point [0 0] :bindingId "gone"} :end {:id "end" :point [-90 0] :bindingId "b1"}}}}})
 :pages ({:block/uuid #uuid "637239f2-9680-4c82-802c-8858d9835c80" :block/name "637239f2-9680-4c82-802c-8858d9835c80" :block/type "whiteboard" :block/properties {:ls-type :whiteboard-page :logseq.tldraw.page {:id "637239f2-9680-4c82-802c-8858d9835c80" :bindings {:b1 {:id "b1" :type "line" :fromId "l1" :toId "a1" :handleId "end" :point [0.5 0.5] :distance 4}} :assets []}}})}`

    const board = Result.getOrThrow(readWhiteboard(edn))
    const minted = [1, 2, 3, 4, 5, 6].map(id)
    const fresh = minted.values()
    const clone = clonedWhiteboard(board, () => fresh.next().value ?? "")
    assert.deepStrictEqual(
      clone.shapes.map((entry) => [entry.id, entry.shape["id"]]),
      [
        [id(1), id(1)],
        [id(2), id(2)],
        [id(3), id(3)],
      ],
    )
    assert.deepStrictEqual(Object.keys(clone.bindings), [id(4)])
    const blocks = whiteboardBlocks(clone, pageId, (written) => BlockId.make(written ?? ""))
    const handles = blocks.map((block) => shapeRaw(block)["handles"])
    assert.deepStrictEqual(handles[1], {
      start: { id: "start", point: [0, 0] },
      end: { id: "end", point: [-90, 0], bindingId: id(4), bindTo: id(1) },
    })
    assert.deepStrictEqual(handles[2], {
      start: { id: "start", point: [0, 0], bindingId: "gone" },
      end: { id: "end", point: [-90, 0], bindingId: "b1" },
    })
    assert.deepStrictEqual(
      blocks.map((block) => Object.keys(block.props).toSorted()),
      [0, 1, 2].map(() => ["logseq.tldraw.shape", "ls-type"]),
    )
  })
})
