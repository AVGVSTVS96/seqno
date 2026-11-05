import { assert, describe, it } from "@effect/vitest"
import * as fc from "fast-check"
import { Context, Effect, Layer, Option, Result } from "effect"
import { SecureRandom } from "effect/crypto"
import { BlockId } from "@seqno/domain"
import { Graph, PeerId } from "@seqno/graph"
import type { PageTree } from "@seqno/rpc"
import {
  LogseqSyntax,
  LogseqSyntaxLive,
  defaultConfig,
  merge3Text,
  mergePage,
  preorder,
  printPage,
  readFileTree,
} from "@seqno/interop"
import type { FileTree } from "@seqno/interop"

const WebCrypto = Layer.succeed(
  SecureRandom.SecureRandom,
  SecureRandom.make((size) => globalThis.crypto.getRandomValues(new Uint8Array(size))),
)

const syntax = Effect.runSync(
  Effect.map(Layer.build(LogseqSyntaxLive).pipe(Effect.scoped), (context) =>
    Context.get(context, LogseqSyntax),
  ),
)

const fileTree = (text: string): FileTree =>
  Result.getOrThrow(
    readFileTree(
      { path: "pages/plans.md", body: "plans", kind: "page" },
      text,
      defaultConfig,
      syntax,
    ),
  )

const hex = (n: number) => n.toString(16).padStart(12, "0")

const minter = (start: number) => {
  let next = start

  return () => BlockId.make(`01920000-0000-7000-8000-${hex(next++)}`)
}

const render = (tree: PageTree) => printPage(syntax, tree, { referenced: new Set() })

interface Case {
  readonly base: string
  readonly disk: string
  readonly seqno: (graph: Graph["Service"], tree: PageTree) => Effect.Effect<void>
}

const merged = ({ base, disk, seqno }: Case) =>
  Effect.scoped(
    Effect.gen(function* () {
      const graph = Context.get(
        yield* Layer.build(
          Graph.layer({ peer: PeerId.make("7"), snapshot: Option.none(), updates: [] }).pipe(
            Layer.provide(WebCrypto),
          ),
        ),
        Graph,
      )

      const file = fileTree(base)
      yield* graph.load([file.tree])
      const id = file.tree.page.id
      const before = yield* Effect.orDie(graph.page(id))
      yield* seqno(graph, before)
      const page = yield* Effect.orDie(graph.page(id))

      const { batches: commands, ids } = mergePage({
        base: { file, ids: preorder(before.blocks).map((block) => block.id) },
        disk: fileTree(disk),
        page,
        mint: minter(1000),
        taken: new Set(),
      })

      const applied = yield* Effect.result(
        Effect.forEach(commands, (batch) => graph.dispatchAll(batch)),
      )

      if (Result.isFailure(applied)) {
        return yield* Effect.die(
          new Error(
            `${applied.failure.reason}\n${base}\n---\n${disk}\n${JSON.stringify(commands, null, 1)}`,
          ),
        )
      }

      const after = yield* Effect.orDie(graph.page(id))

      const again = mergePage({
        base: { file: fileTree(disk), ids },
        disk: fileTree(disk),
        page: after,
        mint: minter(5000),
        taken: new Set(),
      })

      return { text: render(after), commands, before, after, ids, again: again.batches }
    }),
  )

const nothing = () => Effect.void

const edit = (at: number, insert: string) => (graph: Graph["Service"], tree: PageTree) => {
  const block = preorder(tree.blocks)[at]

  if (block === undefined) {
    return Effect.die("no such block")
  }

  return Effect.asVoid(
    Effect.orDie(
      graph.dispatch({
        _tag: "EditText",
        blockId: block.id,
        from: block.text.length,
        to: block.text.length,
        insert,
      }),
    ),
  )
}

const plan = "- a\n- b\n\t- b1\n- c"

const line = (depth: number, text: string) => `${"\t".repeat(depth)}- ${text}`

describe("merging a file changed outside seqno", () => {
  it.effect("gives no commands when the file is the base, or says what the page says", () =>
    Effect.gen(function* () {
      const same = yield* merged({ base: plan, disk: plan, seqno: edit(0, " seqno") })

      const both = yield* merged({
        base: plan,
        disk: "- a seqno\n- b\n\t- b1\n- c",
        seqno: edit(0, " seqno"),
      })

      assert.deepStrictEqual(
        { same: same.commands, both: both.commands, text: both.text },
        { same: [], both: [], text: "- a seqno\n- b\n\t- b1\n- c" },
      )
    }),
  )

  it.effect("takes an edit made on both sides once", () =>
    Effect.gen(function* () {
      const result = yield* merged({
        base: plan,
        disk: "- a!\n- b\n\t- b1\n- c changed",
        seqno: edit(0, "!"),
      })

      assert.strictEqual(result.text, "- a!\n- b\n\t- b1\n- c changed")
    }),
  )

  it.effect("keeps seqno's edit and Logseq's edit, add and delete on one page", () =>
    Effect.gen(function* () {
      const result = yield* merged({
        base: plan,
        disk: "- a\n- b edited in Logseq\n\t- b1\n\t- b2 added in Logseq",
        seqno: edit(0, " typed in seqno"),
      })

      const kept = (text: string) =>
        result.before.blocks.find((block) => block.text === text)?.id ?? "missing"

      assert.deepStrictEqual(
        {
          text: result.text,
          ids: result.after.blocks.map((block) => block.id).slice(0, 3),
        },
        {
          text: "- a typed in seqno\n- b edited in Logseq\n\t- b1\n\t- b2 added in Logseq",
          ids: [kept("a"), kept("b"), kept("b1")],
        },
      )
    }),
  )

  it.effect("merges a block both sides changed character by character", () =>
    Effect.gen(function* () {
      const result = yield* merged({
        base: "- the quick fox",
        disk: "- the quick brown fox",
        seqno: edit(0, " jumps"),
      })

      assert.strictEqual(result.text, "- the quick brown fox jumps")
    }),
  )

  it.effect("keeps a block seqno typed into even when the file deleted it", () =>
    Effect.gen(function* () {
      const result = yield* merged({ base: plan, disk: "- b\n\t- b1\n- c", seqno: edit(0, "!") })
      assert.strictEqual(result.text, "- a!\n- b\n\t- b1\n- c")
    }),
  )

  it.effect("moves a block the file moved and indents one it indented", () =>
    Effect.gen(function* () {
      const result = yield* merged({
        base: plan,
        disk: "- c\n- a\n\t- b\n\t\t- b1",
        seqno: nothing,
      })

      const id = (text: string) => result.before.blocks.find((block) => block.text === text)?.id
      assert.deepStrictEqual(
        {
          text: result.text,
          kept: ["a", "b", "b1", "c"].map((text) =>
            result.after.blocks.some((block) => block.id === id(text) && block.text === text),
          ),
        },
        { text: "- c\n- a\n\t- b\n\t\t- b1", kept: [true, true, true, true] },
      )
    }),
  )

  it.effect("keeps the id of a short block rewritten in the file, by its children", () =>
    Effect.gen(function* () {
      const result = yield* merged({
        base: plan,
        disk: "- b rewritten in Logseq\n\t- b1\n- c",
        seqno: nothing,
      })

      const id = (text: string) => result.before.blocks.find((block) => block.text === text)?.id
      assert.deepStrictEqual(
        result.after.blocks.map((block) => [block.id, block.text]),
        [
          [id("b"), "b rewritten in Logseq"],
          [id("b1"), "b1"],
          [id("c"), "c"],
        ],
      )
    }),
  )

  it("merges text: overlapping edits keep the file's, separate ones keep both", () => {
    assert.deepStrictEqual(
      [
        merge3Text("abc def ghi", "abc DEF ghi", "abc def GHI"),
        merge3Text("abc def", "abc XYZ", "abc QRS"),
        merge3Text("abc", "abc!", "abc!"),
        merge3Text("ab", "aXb", "aYb"),
      ],
      ["abc DEF GHI", "abc XYZ", "abc!", "aXYb"],
    )
  })

  it.effect(
    "random edits on both sides of a page both survive, and untouched blocks keep ids",
    () =>
      Effect.gen(function* () {
        const outline = fc
          .array(fc.integer({ min: 0, max: 2 }), { minLength: 2, maxLength: 9 })
          .map((depths) => {
            let depth = -1

            return depths.map((wanted, at) => {
              depth = Math.min(wanted, depth + 1)

              return { depth, text: `block ${at}` }
            })
          })

        const choices = fc.array(fc.constantFrom("disk", "seqno", "both", "none", "add", "drop"), {
          minLength: 9,
          maxLength: 9,
        })

        const samples = fc.sample(fc.tuple(outline, choices), { numRuns: 300, seed: 7 })
        const failures: string[] = []

        for (const [blocks, sides] of samples) {
          const base = blocks.map((block) => line(block.depth, block.text)).join("\n")
          const leafy = (at: number) => (blocks[at + 1]?.depth ?? -1) <= (blocks[at]?.depth ?? 0)

          const disk = blocks
            .flatMap((block, at) => {
              const side = sides[at]

              if (side === "drop" && leafy(at)) {
                return []
              }

              const text = side === "disk" || side === "both" ? `${block.text} disk` : block.text
              const own = line(block.depth, text)

              return side === "add" ? [own, line(block.depth + 1, `new ${at}`)] : [own]
            })
            .join("\n")

          const result = yield* merged({
            base,
            disk,
            seqno: (graph, tree) =>
              Effect.forEach(
                preorder(tree.blocks),
                (block, at) =>
                  sides[at] === "seqno" || sides[at] === "both"
                    ? Effect.asVoid(
                        Effect.orDie(
                          graph.dispatch({
                            _tag: "EditText",
                            blockId: block.id,
                            from: block.text.length,
                            to: block.text.length,
                            insert: sides[at] === "both" ? " disk" : " seqno",
                          }),
                        ),
                      )
                    : Effect.void,
                { discard: true },
              ),
          })

          const expected = blocks
            .flatMap((block, at) => {
              const side = sides[at]

              if (side === "drop" && leafy(at)) {
                return []
              }

              const text =
                side === "disk" || side === "both"
                  ? `${block.text} disk`
                  : side === "seqno"
                    ? `${block.text} seqno`
                    : block.text

              const own = line(block.depth, text)

              return side === "add" ? [own, line(block.depth + 1, `new ${at}`)] : [own]
            })
            .join("\n")

          const untouched = result.before.blocks.filter((_, at) => sides[at] === "none")

          const idsKept = untouched.every((block) =>
            result.after.blocks.some((after) => after.id === block.id && after.text === block.text),
          )

          if (result.text !== expected || !idsKept || result.again.length > 0) {
            failures.push(
              JSON.stringify({
                base,
                disk,
                plan: sides,
                got: result.text,
                expected,
                idsKept,
                again: result.again,
              }),
            )
          }
        }

        assert.deepStrictEqual(failures, [])
      }),
  )
})
