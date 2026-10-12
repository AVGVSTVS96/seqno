import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { BlockId, Command } from "@seqno/domain"
import { nth, openGraph, outline, seedPage } from "./support.ts"

type Opened = Effect.Success<ReturnType<typeof openGraph>>

const flushed = (graph: Opened) =>
  Effect.map(
    graph.flush(() => Effect.void),
    (update) => Option.toArray(Option.map(update, ({ bytes }) => bytes)),
  )

const typed = (blockId: BlockId, at: number, text: string): ReadonlyArray<Command> =>
  [...text].map((char, offset) => ({
    _tag: "EditText",
    blockId,
    from: at + offset,
    to: at + offset,
    insert: char,
  }))

const type = (graph: Opened, blockId: BlockId, at: number, text: string, client?: string) =>
  Effect.forEach(typed(blockId, at, text), (command) => graph.dispatch(command, client), {
    discard: true,
  })

const devices = Effect.gen(function* () {
  const left = yield* openGraph("1")
  const { pageId, ids } = yield* seedPage(left, "Shared", ["alpha", "beta", "  beta child"])
  const right = yield* openGraph("2", { snapshot: yield* left.snapshot })
  yield* flushed(left)
  return { left, right, pageId, ids }
})

const textOf = (graph: Opened, blockId: BlockId) =>
  Effect.map(graph.block(blockId), (block) => block.text)

describe("undo with edits from another device", () => {
  it.effect("takes back only this device's typing, keeping what the other typed inside it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, ids } = yield* devices
        const alpha = nth(ids, 0)
        yield* type(left, alpha, 5, " hello")
        yield* right.merge(yield* flushed(left))
        yield* right.dispatch({ _tag: "EditText", blockId: alpha, from: 8, to: 8, insert: "X" })
        yield* right.dispatch({ _tag: "EditText", blockId: alpha, from: 0, to: 0, insert: ">" })
        yield* left.merge(yield* flushed(right))
        assert.strictEqual(yield* textOf(left, alpha), ">alpha heXllo")

        yield* left.dispatch({ _tag: "Undo" })
        assert.strictEqual(yield* textOf(left, alpha), ">alphaX")
        yield* left.dispatch({ _tag: "Redo" })
        assert.strictEqual(yield* textOf(left, alpha), ">alpha heXllo")
      }),
    ),
  )

  it.effect("puts deleted text back where it was after the other device typed before it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, ids } = yield* devices
        const beta = nth(ids, 1)
        yield* left.dispatch({ _tag: "EditText", blockId: beta, from: 1, to: 3, insert: "" })
        yield* right.dispatch({ _tag: "EditText", blockId: beta, from: 0, to: 0, insert: "12" })
        yield* right.dispatch({ _tag: "EditText", blockId: beta, from: 6, to: 6, insert: "!" })
        yield* left.merge(yield* flushed(right))
        assert.strictEqual(yield* textOf(left, beta), "12ba!")

        yield* left.dispatch({ _tag: "Undo" })
        assert.strictEqual(yield* textOf(left, beta), "12beta!")
        yield* right.merge(yield* flushed(left))
        assert.strictEqual(yield* textOf(right, beta), "12beta!")
      }),
    ),
  )

  it.effect(
    "puts a deleted block back after the block it followed when blocks were added above",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { left, right, pageId, ids } = yield* devices
          yield* left.dispatch({ _tag: "DeleteBlocks", blockIds: [nth(ids, 1)] })
          yield* right.dispatch({ _tag: "InsertBlock", pageId, parentId: null, text: "top" })
          yield* left.merge(yield* flushed(right))
          yield* left.dispatch({ _tag: "Undo" })
          assert.deepStrictEqual(outline(yield* left.page(pageId)), [
            "top",
            "alpha",
            "beta",
            "  beta child",
          ])
        }),
      ),
  )

  it.effect("leaves a property and a block alone once the other device changed them after", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, pageId, ids } = yield* devices
        const [alpha, beta] = [nth(ids, 0), nth(ids, 1)]
        const target = { _tag: "BlockTarget", blockId: alpha } as const
        yield* left.dispatch({ _tag: "SetProperty", target, key: "owner", value: "left" })
        yield* left.dispatch({ _tag: "Indent", blockIds: [beta] })
        yield* right.merge(yield* flushed(left))
        yield* right.dispatch({ _tag: "SetProperty", target, key: "owner", value: "right" })
        yield* right.dispatch({ _tag: "Outdent", blockIds: [beta] })
        yield* left.merge(yield* flushed(right))

        yield* left.dispatch({ _tag: "Undo" })
        yield* left.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual((yield* left.block(alpha)).props, { owner: "right" })
        assert.deepStrictEqual(outline(yield* left.page(pageId)), ["alpha", "beta", "  beta child"])
      }),
    ),
  )

  it.effect("keeps one typing step when edits from another device land in the middle of it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { left, right, ids } = yield* devices
        const [alpha, beta] = [nth(ids, 0), nth(ids, 1)]
        yield* type(left, alpha, 5, "12")
        yield* right.dispatch({ _tag: "EditText", blockId: beta, from: 4, to: 4, insert: "?" })
        yield* left.merge(yield* flushed(right))
        yield* type(left, alpha, 7, "34")
        yield* left.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(
          [yield* textOf(left, alpha), yield* textOf(left, beta)],
          ["alpha", "beta?"],
        )
      }),
    ),
  )
})

const seeded = (seed: number) => {
  let state = seed
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state % below
  }
}

const randomEdit = (random: (below: number) => number, blockId: BlockId, text: string): Command => {
  const at = random(text.length + 1)
  return random(4) === 0 && at < text.length
    ? { _tag: "EditText", blockId, from: at, to: at + 1, insert: "" }
    : { _tag: "EditText", blockId, from: at, to: at, insert: "abcdefgh"[random(8)] ?? "a" }
}

const randomSession = (seed: number, rounds: number, withRight: boolean) =>
  Effect.gen(function* () {
    const left = yield* openGraph("1")
    const { ids } = yield* seedPage(left, "Random", ["0123"])
    const block = nth(ids, 0)
    const right = yield* openGraph("2", { snapshot: yield* left.snapshot })
    yield* flushed(left)
    const random = seeded(seed)
    let typedByRight = 0
    for (let round = 0; round < rounds; round++) {
      for (let key = 0; key < 1 + random(4); key++) {
        yield* left.dispatch(randomEdit(random, block, yield* textOf(left, block)))
      }
      yield* left.dispatch({ _tag: "SetCollapsed", blockId: block, collapsed: round % 2 === 0 })
      if (!withRight) continue
      for (let key = 0; key < random(3); key++) {
        const at = random((yield* textOf(right, block)).length + 1)
        yield* right.dispatch({ _tag: "EditText", blockId: block, from: at, to: at, insert: "X" })
        typedByRight++
      }
      if (random(3) === 0) yield* left.merge(yield* flushed(right))
      if (random(3) === 0) yield* right.merge(yield* flushed(left))
    }
    yield* left.merge(yield* flushed(right))
    const edited = yield* textOf(left, block)
    for (let step = 0; step < rounds * 2; step++) yield* left.dispatch({ _tag: "Undo" })
    const undone = yield* textOf(left, block)
    for (let step = 0; step < rounds * 2; step++) yield* left.dispatch({ _tag: "Redo" })
    const redone = yield* textOf(left, block)
    yield* right.merge(yield* flushed(left))
    return { edited, undone, redone, typedByRight, onRight: yield* textOf(right, block) }
  })

describe("undo against random edits", () => {
  it.effect("takes back every step exactly and redoes them on one device", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (let seed = 1; seed <= 30; seed++) {
          const { edited, undone, redone } = yield* randomSession(seed, 12, false)
          assert.deepStrictEqual([seed, undone, redone], [seed, "0123", edited])
        }
      }),
    ),
  )

  it.effect("never takes back a character the other device typed, and redoes exactly", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (let seed = 1; seed <= 30; seed++) {
          const session = yield* randomSession(seed, 12, true)
          const { edited, undone, redone, typedByRight, onRight } = session
          assert.deepStrictEqual(
            [seed, undone.replace(/[^0-3]/g, "").length, undone.replace(/[^X]/g, "").length],
            [seed, 4, typedByRight],
          )
          assert.deepStrictEqual([redone, onRight], [edited, edited])
        }
      }),
    ),
  )
})

describe("undo per client", () => {
  it.effect("never takes back what another client typed into the same block", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { ids } = yield* seedPage(graph, "Tabs", ["one"])
        const one = nth(ids, 0)
        yield* type(graph, one, 3, " first", "a")
        yield* type(graph, one, 0, "second ", "b")
        yield* type(graph, one, 16, " third", "a")
        assert.strictEqual(yield* textOf(graph, one), "second one first third")

        yield* graph.dispatch({ _tag: "Undo" }, "a")
        assert.strictEqual(yield* textOf(graph, one), "second one")
        yield* graph.dispatch({ _tag: "Undo" }, "b")
        assert.strictEqual(yield* textOf(graph, one), "one")
        yield* graph.dispatch({ _tag: "Redo" }, "a")
        assert.strictEqual(yield* textOf(graph, one), "one first third")
      }),
    ),
  )
})

describe("undo and redo", () => {
  it.effect("drops the redo history once a new edit is made", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { ids } = yield* seedPage(graph, "Redo", ["a", "b"])
        const [a, b] = [nth(ids, 0), nth(ids, 1)]
        yield* type(graph, a, 1, "1")
        yield* graph.dispatch({ _tag: "Undo" })
        yield* type(graph, b, 1, "2")
        yield* graph.dispatch({ _tag: "Redo" })
        assert.deepStrictEqual([yield* textOf(graph, a), yield* textOf(graph, b)], ["a", "b2"])
      }),
    ),
  )

  it.effect("puts a removed property back in its place among the others", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { ids } = yield* seedPage(graph, "Props", ["bed"])
        const target = { _tag: "BlockTarget", blockId: nth(ids, 0) } as const
        for (const key of ["zeta", "alpha", "mid"]) {
          yield* graph.dispatch({ _tag: "SetProperty", target, key, value: key })
        }
        yield* graph.dispatch({ _tag: "SetCollapsed", blockId: nth(ids, 0), collapsed: true })
        yield* graph.dispatch({ _tag: "SetProperty", target, key: "alpha", value: null })
        yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(Object.keys((yield* graph.block(nth(ids, 0))).props), [
          "zeta",
          "alpha",
          "mid",
        ])
      }),
    ),
  )

  it.effect("splits and merges back to the same blocks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { pageId, ids } = yield* seedPage(graph, "Split", ["head", "  child", "tail"])
        const tail = nth(ids, 2)
        yield* graph.dispatch({ _tag: "MergeWithPrevious", blockId: tail })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["head", "  childtail"])
        yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["head", "  child", "tail"])
        assert.strictEqual((yield* graph.block(tail)).text, "tail")
        yield* graph.dispatch({ _tag: "Redo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["head", "  childtail"])
      }),
    ),
  )

  it.effect("leaves nothing behind from a batch that was rejected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* openGraph("1")
        const { pageId, ids } = yield* seedPage(graph, "Batch", ["a", "b"])
        const [a, b] = [nth(ids, 0), nth(ids, 1)]
        const rejected = yield* Effect.flip(
          graph.dispatchAll([
            { _tag: "EditText", blockId: a, from: 1, to: 1, insert: "!" },
            { _tag: "DeleteBlocks", blockIds: [b] },
            { _tag: "EditText", blockId: a, from: 9, to: 9, insert: "?" },
          ]),
        )
        assert.strictEqual(rejected.reason, "range 9-9 is outside the block text")
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a", "b"])
        yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a"])
      }),
    ),
  )
})
