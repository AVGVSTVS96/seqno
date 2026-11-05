import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { BlockId, Command, PageId } from "@seqno/domain"
import { nth, openGraph, outline, seedPage } from "./support.ts"

type Opened = Effect.Success<ReturnType<typeof openGraph>>

const flushed = (graph: Opened) =>
  Effect.map(
    graph.flush(() => Effect.void),
    (update) => Option.toArray(Option.map(update, ({ bytes }) => bytes)),
  )

const sync = (...graphs: readonly Opened[]) =>
  Effect.gen(function* () {
    for (let round = 0; round < 4; round++) {
      const sent = yield* Effect.forEach(graphs, flushed)

      if (sent.every((bytes) => bytes.length === 0)) {
        return
      }

      for (const [at, graph] of graphs.entries()) {
        yield* graph.merge(sent.flatMap((bytes, from) => (from === at ? [] : bytes)))
      }
    }
  })

const view = (graph: Opened) =>
  Effect.gen(function* () {
    const pages = (yield* graph.pages).toSorted((a, b) => (a.title < b.title ? -1 : 1))

    const lines = yield* Effect.forEach(pages, (page) =>
      Effect.map(graph.page(page.id), (tree) => [page.title, ...outline(tree)].join(" ")),
    )

    return lines.join(" | ")
  })

const devices = (peers: readonly string[]) =>
  Effect.gen(function* () {
    const first = yield* openGraph(nth(peers, 0))
    const x = yield* seedPage(first, "X", ["a", "b", "  b1", "c"])
    const y = yield* seedPage(first, "Y", ["y"])
    const snapshot = yield* first.snapshot
    const rest = yield* Effect.forEach(peers.slice(1), (peer) => openGraph(peer, { snapshot }))
    yield* flushed(first)
    const [a, b, b1, c] = [nth(x.ids, 0), nth(x.ids, 1), nth(x.ids, 2), nth(x.ids, 3)]

    return {
      graphs: [first, ...rest],
      snapshot,
      x: x.pageId,
      y: y.pageId,
      a,
      b,
      b1,
      c,
      yy: nth(y.ids, 0),
    }
  })

type On = Effect.Success<ReturnType<typeof devices>>

const move = (blockId: BlockId, parentId: BlockId | null, after?: BlockId): Command => {
  const command = { _tag: "MoveBlocks", blockIds: [blockId], parentId } as const

  return after === undefined ? command : { ...command, after }
}

const remove = (blockId: BlockId): Command => ({ _tag: "DeleteBlocks", blockIds: [blockId] })

const type = (blockId: BlockId): Command => ({
  _tag: "EditText",
  blockId,
  from: 1,
  to: 1,
  insert: "!",
})

interface Case {
  readonly before?: (on: On) => Command
  readonly change: (on: On) => Command
  readonly remove: (on: On) => Command
  readonly after: string
}

const deletePage = (pageId: PageId): Command => ({ _tag: "DeletePage", pageId })

const cases = {
  "a block dragged below its sibling stays where it was dragged": {
    change: ({ b, c }) => move(b, null, c),
    remove: ({ b }) => remove(b),
    after: "X a c b   b1 | Y y",
  },
  "an indented block stays indented": {
    change: ({ b }) => ({ _tag: "Indent", blockIds: [b] }),
    remove: ({ b }) => remove(b),
    after: "X a   b     b1 c | Y y",
  },
  "a block moved to another page stays there": {
    change: ({ b, yy }) => move(b, null, yy),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y b   b1",
  },
  "a moved-in block indented on its new page stays indented": {
    before: ({ b, yy }) => move(b, null, yy),
    change: ({ b }) => ({ _tag: "Indent", blockIds: [b] }),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y   b     b1",
  },
  "a block moved under the deleted one takes its place": {
    change: ({ b, b1, c }) => move(c, b, b1),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y",
  },
  "a block indented under the deleted one takes its place": {
    change: ({ c }) => ({ _tag: "Indent", blockIds: [c] }),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y",
  },
  "a block indented under another deleted block takes that block's place": {
    change: ({ c }) => ({ _tag: "Indent", blockIds: [c] }),
    remove: ({ b, c }) => ({ _tag: "DeleteBlocks", blockIds: [b, c] }),
    after: "X a c | Y y",
  },
  "a block from another page moved under the deleted one takes its place": {
    change: ({ b, yy }) => move(yy, b),
    remove: ({ b }) => remove(b),
    after: "X a y c | Y",
  },
  "a child moved to another page stays there": {
    change: ({ b1, yy }) => move(b1, null, yy),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y b1",
  },
  "a new child takes the deleted block's place": {
    change: ({ x, b, b1 }) => ({
      _tag: "InsertBlock",
      pageId: x,
      parentId: b,
      after: b1,
      text: "new",
    }),
    remove: ({ b }) => remove(b),
    after: "X a new c | Y y",
  },
  "text typed into the block brings it back": {
    change: ({ b }) => type(b),
    remove: ({ b }) => remove(b),
    after: "X a b!   b1 c | Y y",
  },
  "text typed into a child keeps just that child": {
    change: ({ b1 }) => type(b1),
    remove: ({ b }) => remove(b),
    after: "X a b!1 c | Y y",
  },
  "text typed into a block merged away keeps just the new text": {
    change: ({ b }) => type(b),
    remove: ({ b }) => ({ _tag: "MergeWithPrevious", blockId: b }),
    after: "X ab   b1 ! c | Y y",
  },
  "a block moved onto a deleted page brings the page back": {
    change: ({ b, yy }) => move(b, null, yy),
    remove: ({ y }) => deletePage(y),
    after: "X a c | Y y b   b1",
  },
  "a block moved off a deleted page stays where it went": {
    change: ({ b, yy }) => move(b, null, yy),
    remove: ({ x }) => deletePage(x),
    after: "Y y b   b1",
  },
  "collapsing the block does not bring it back": {
    change: ({ b }) => ({ _tag: "SetCollapsed", blockId: b, collapsed: true }),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y",
  },
  "two devices deleting the same block both win": {
    change: ({ b }) => remove(b),
    remove: ({ b }) => remove(b),
    after: "X a c | Y y",
  },
} satisfies Record<string, Case>

describe("a delete removes only what the deleting device saw", () => {
  for (const [name, one] of Object.entries<Case>(cases)) {
    it.effect(name, () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const changer of [0, 1]) {
            const on = yield* devices(["1", "2"])
            const [left, right] = [nth(on.graphs, 0), nth(on.graphs, 1)]

            if (one.before !== undefined) {
              yield* left.dispatch(one.before(on))
              yield* sync(left, right)
            }

            yield* nth(on.graphs, changer).dispatch(one.change(on))
            yield* nth(on.graphs, 1 - changer).dispatch(one.remove(on))
            yield* sync(left, right)
            assert.strictEqual(yield* view(left), one.after)
            assert.strictEqual(yield* view(right), one.after)
          }
        }),
      ),
    )
  }

  it.effect("a delete made after the move arrived still deletes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const on = yield* devices(["1", "2"])
        const [left, right] = [nth(on.graphs, 0), nth(on.graphs, 1)]
        yield* left.dispatch(move(on.b, null, on.c))
        yield* sync(left, right)
        yield* right.dispatch(remove(on.b))
        yield* sync(left, right)
        assert.strictEqual(yield* view(left), "X a c | Y y")
        assert.strictEqual(yield* view(right), "X a c | Y y")
      }),
    ),
  )

  it.effect("a delete that saw one move loses to a later move it did not see", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const on = yield* devices(["1", "2"])
        const [left, right] = [nth(on.graphs, 0), nth(on.graphs, 1)]
        yield* left.dispatch({ _tag: "Indent", blockIds: [on.b] })
        yield* sync(left, right)
        yield* left.dispatch(move(on.b, null, on.c))
        yield* right.dispatch(remove(on.b))
        yield* sync(left, right)
        assert.strictEqual(yield* view(left), "X a c b   b1 | Y y")
        assert.strictEqual(yield* view(right), "X a c b   b1 | Y y")
      }),
    ),
  )

  it.effect("a third device that hears of both at once agrees with the other two", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const on = yield* devices(["1", "2", "3"])
        const [left, right, third] = [nth(on.graphs, 0), nth(on.graphs, 1), nth(on.graphs, 2)]
        yield* left.dispatch(move(on.c, on.b, on.b1))
        yield* right.dispatch(remove(on.b))
        const [moved, deleted] = [yield* flushed(left), yield* flushed(right)]
        yield* third.merge([...moved, ...deleted])
        assert.strictEqual(yield* view(third), "X a c | Y y")
        yield* left.merge(deleted)
        yield* right.merge(moved)
        yield* sync(left, right, third)

        for (const graph of on.graphs) {
          assert.strictEqual(yield* view(graph), "X a c | Y y")
        }
      }),
    ),
  )

  it.effect("a device that opens from the saved files finds the block kept", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const on = yield* devices(["1", "2"])
        const [left, right] = [nth(on.graphs, 0), nth(on.graphs, 1)]
        yield* left.dispatch(move(on.b, null, on.c))
        yield* right.dispatch(remove(on.b))
        const files = [on.snapshot, ...(yield* flushed(left)), ...(yield* flushed(right))]
        const opened = yield* openGraph("3")
        yield* opened.restore(files)
        assert.strictEqual(yield* view(opened), "X a c b   b1 | Y y")
      }),
    ),
  )
})
