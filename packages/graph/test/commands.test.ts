import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { BlockId, Command } from "@seqno/domain"
import { createdBlock, createdPage, nth, openGraph, outline, seedPage, tags } from "./support.ts"

const rejection = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) =>
    "reason" in error ? String(error.reason) : error._tag,
  )

const withGraph = <A, E>(
  body: (graph: Effect.Success<ReturnType<typeof openGraph>>) => Effect.Effect<A, E>,
) => Effect.scoped(Effect.flatMap(openGraph("1"), body))

describe("pages", () => {
  it.effect("creates, renames and lists pages", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const created = yield* graph.dispatch({ _tag: "CreatePage", title: "Project X" })
        const pageId = createdPage(created)
        assert.deepStrictEqual(created, [
          {
            _tag: "PageUpserted",
            page: {
              id: pageId,
              name: "project x",
              title: "Project X",
              journalDay: null,
              props: {},
            },
          },
        ])
        yield* graph.dispatch({ _tag: "RenamePage", pageId, title: "Project Y" })
        assert.deepStrictEqual(yield* graph.pages, [
          { id: pageId, name: "project y", title: "Project Y", journalDay: null, props: {} },
        ])
      }),
    ),
  )

  it.effect("rejects empty and duplicate page names", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        yield* graph.dispatch({ _tag: "CreatePage", title: "Inbox" })
        const other = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title: "Other" }))
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "CreatePage", title: "  inbox " })),
          'a page named "inbox" already exists',
        )
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "RenamePage", pageId: other, title: "INBOX" })),
          'a page named "inbox" already exists',
        )
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "CreatePage", title: "   " })),
          "a page title cannot be empty",
        )
      }),
    ),
  )

  it.effect("deletes a page with all of its blocks", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Doomed", ["a", "  b"])
        const events = yield* graph.dispatch({ _tag: "DeletePage", pageId })
        assert.deepStrictEqual(events, [
          { _tag: "BlockDeleted", blockId: nth(ids, 0), pageId },
          { _tag: "BlockDeleted", blockId: nth(ids, 1), pageId },
          { _tag: "PageDeleted", pageId },
        ])
        assert.deepStrictEqual(yield* graph.pages, [])
        assert.strictEqual(yield* rejection(graph.page(pageId)), "PageNotFound")
      }),
    ),
  )

  it.effect("sets and clears page properties", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const pageId = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title: "Tagged" }))
        const target = { _tag: "PageTarget", pageId } as const
        yield* graph.dispatch({ _tag: "SetProperty", target, key: "tags", value: "work" })
        yield* graph.dispatch({ _tag: "SetProperty", target, key: "alias", value: "job" })
        const cleared = yield* graph.dispatch({
          _tag: "SetProperty",
          target,
          key: "alias",
          value: null,
        })
        assert.deepStrictEqual(cleared, [
          {
            _tag: "PageUpserted",
            page: {
              id: pageId,
              name: "tagged",
              title: "Tagged",
              journalDay: null,
              props: { tags: "work" },
            },
          },
        ])
      }),
    ),
  )
})

describe("blocks", () => {
  it.effect("inserts blocks as first child, after a sibling and nested", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Outline", ["one", "  child", "three"])
        const first = yield* graph.dispatch({
          _tag: "InsertBlock",
          pageId,
          parentId: null,
          text: "zero",
        })
        assert.deepStrictEqual(first, [
          {
            _tag: "BlockUpserted",
            block: {
              id: createdBlock(first),
              pageId,
              parentId: null,
              text: "zero",
              collapsed: false,
              props: {},
            },
            createdAt: 0,
            updatedAt: 0,
          },
        ])
        yield* graph.dispatch({
          _tag: "InsertBlock",
          pageId,
          parentId: null,
          after: nth(ids, 0),
          text: "two",
        })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), [
          "zero",
          "one",
          "  child",
          "two",
          "three",
        ])
      }),
    ),
  )

  it.effect("rejects a parent from another page", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const home = yield* seedPage(graph, "Home", ["a"])
        const away = yield* seedPage(graph, "Away", [])
        const parentId = nth(home.ids, 0)
        assert.strictEqual(
          yield* rejection(
            graph.dispatch({ _tag: "InsertBlock", pageId: away.pageId, parentId, text: "x" }),
          ),
          `block ${parentId} is not on page ${away.pageId}`,
        )
      }),
    ),
  )

  it.effect("edits text with UTF-16 offsets and stamps the update time", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Edit", ["a😀c"])
        const blockId = nth(ids, 0)
        yield* TestClock.adjust("5 seconds")
        const events = yield* graph.dispatch({
          _tag: "EditText",
          blockId,
          from: 1,
          to: 3,
          insert: "b",
        })
        assert.deepStrictEqual(events, [
          {
            _tag: "BlockUpserted",
            block: {
              id: blockId,
              pageId,
              parentId: null,
              text: "abc",
              collapsed: false,
              props: {},
            },
            createdAt: 0,
            updatedAt: 5000,
          },
        ])
        assert.strictEqual(
          yield* rejection(
            graph.dispatch({ _tag: "EditText", blockId, from: 2, to: 9, insert: "" }),
          ),
          "range 2-9 is outside the block text",
        )
      }),
    ),
  )

  it.effect("splits a block into a next sibling, an empty block above, or a first child", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Split", ["hello world", "parent", "  kid"])
        const [hello, parent] = [nth(ids, 0), nth(ids, 1)]
        yield* graph.dispatch({ _tag: "SplitBlock", blockId: hello, at: 5 })
        yield* graph.dispatch({ _tag: "SplitBlock", blockId: hello, at: 0 })
        yield* graph.dispatch({ _tag: "SplitBlock", blockId: parent, at: 3 })
        const tree = yield* graph.page(pageId)
        assert.deepStrictEqual(outline(tree), ["", "hello", " world", "par", "  ent", "  kid"])
        assert.strictEqual(tree.blocks[1]?.id, hello)
      }),
    ),
  )

  it.effect("merges into the previous visible block and keeps the children in place", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Merge", [
          "a",
          "  a1",
          "b",
          "  b1",
          "  b2",
          "    b2x",
        ])
        const [a, b, b2] = [nth(ids, 0), nth(ids, 2), nth(ids, 4)]
        const merged = yield* graph.dispatch({ _tag: "MergeWithPrevious", blockId: b })
        assert.deepStrictEqual(tags(merged), [
          "BlockMoved",
          "BlockMoved",
          "BlockUpserted",
          "BlockDeleted",
        ])
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), [
          "a",
          "  a1b",
          "    b1",
          "    b2",
          "      b2x",
        ])
        yield* graph.dispatch({ _tag: "MergeWithPrevious", blockId: b2 })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), [
          "a",
          "  a1b",
          "    b1b2",
          "      b2x",
        ])
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "MergeWithPrevious", blockId: a })),
          "the first block of a page has nothing to merge into",
        )
      }),
    ),
  )

  it.effect("indents a run of siblings under the previous sibling", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Indent", ["a", "  a1", "b", "c", "d"])
        const [a, b, c] = [nth(ids, 0), nth(ids, 2), nth(ids, 3)]
        const events = yield* graph.dispatch({
          _tag: "Indent",
          blockIds: [c, b],
        })
        assert.deepStrictEqual(events, [
          { _tag: "BlockMoved", blockId: b, pageId, parentId: a },
          { _tag: "BlockMoved", blockId: c, pageId, parentId: a },
        ])
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a", "  a1", "  b", "  c", "d"])
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "Indent", blockIds: [a] })),
          "a block without a previous sibling cannot be indented",
        )
      }),
    ),
  )

  it.effect("outdents a block and adopts its following siblings", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Outdent", ["p", "  a", "  b", "  c", "  d"])
        const [p, b, c] = [nth(ids, 0), nth(ids, 2), nth(ids, 3)]
        yield* graph.dispatch({
          _tag: "Outdent",
          blockIds: [b, c],
        })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["p", "  a", "b", "c", "  d"])
        assert.strictEqual(
          yield* rejection(graph.dispatch({ _tag: "Outdent", blockIds: [p] })),
          "a top-level block cannot be outdented",
        )
      }),
    ),
  )

  it.effect("moves blocks to another page and re-pages their descendants", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const from = yield* seedPage(graph, "From", ["keep", "go", "  along"])
        const to = yield* seedPage(graph, "To", ["first", "last"])
        const [keep, go, along] = [nth(from.ids, 0), nth(from.ids, 1), nth(from.ids, 2)]
        const first = nth(to.ids, 0)
        const events = yield* graph.dispatch({
          _tag: "MoveBlocks",
          blockIds: [go],
          parentId: null,
          after: first,
        })
        assert.deepStrictEqual(events, [
          { _tag: "BlockMoved", blockId: go, pageId: to.pageId, parentId: null },
          { _tag: "BlockMoved", blockId: along, pageId: to.pageId, parentId: go },
        ])
        assert.deepStrictEqual(outline(yield* graph.page(to.pageId)), [
          "first",
          "go",
          "  along",
          "last",
        ])
        assert.deepStrictEqual(outline(yield* graph.page(from.pageId)), ["keep"])
        assert.strictEqual(
          yield* rejection(
            graph.dispatch({
              _tag: "MoveBlocks",
              blockIds: [go],
              parentId: along,
            }),
          ),
          "blocks cannot move inside themselves",
        )
        yield* graph.dispatch({
          _tag: "MoveBlocks",
          blockIds: [go],
          parentId: keep,
        })
        assert.deepStrictEqual(outline(yield* graph.page(from.pageId)), [
          "keep",
          "  go",
          "    along",
        ])
      }),
    ),
  )

  it.effect("deletes blocks with their subtrees", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Delete", ["a", "  a1", "b"])
        const [a, a1] = [nth(ids, 0), nth(ids, 1)]
        const events = yield* graph.dispatch({
          _tag: "DeleteBlocks",
          blockIds: [a1, a],
        })
        assert.deepStrictEqual(events, [
          { _tag: "BlockDeleted", blockId: a, pageId },
          { _tag: "BlockDeleted", blockId: a1, pageId },
        ])
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["b"])
        assert.strictEqual(yield* rejection(graph.block(a)), "BlockNotFound")
      }),
    ),
  )

  it.effect("collapses blocks and sets block properties", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Props", ["task"])
        const blockId = nth(ids, 0)
        yield* graph.dispatch({ _tag: "SetCollapsed", blockId, collapsed: true })
        const target = { _tag: "BlockTarget", blockId } as const
        yield* graph.dispatch({ _tag: "SetProperty", target, key: "status", value: "doing" })
        assert.deepStrictEqual(yield* graph.block(blockId), {
          id: blockId,
          pageId,
          parentId: null,
          text: "task",
          collapsed: true,
          props: { status: "doing" },
        })
      }),
    ),
  )
})

describe("undo and redo", () => {
  it.effect("undoes and redoes text edits and structure changes", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "History", ["a", "b"])
        const [a, b] = [nth(ids, 0), nth(ids, 1)]
        const steps: ReadonlyArray<Command> = [
          { _tag: "EditText", blockId: a, from: 1, to: 1, insert: "!" },
          { _tag: "Indent", blockIds: [b] },
        ]
        for (const step of steps) yield* graph.dispatch(step)
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a!", "  b"])
        yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a!", "b"])
        yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a", "b"])
        yield* graph.dispatch({ _tag: "Redo" })
        yield* graph.dispatch({ _tag: "Redo" })
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a!", "  b"])
      }),
    ),
  )

  it.effect("brings a deleted subtree back under its old ids", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const { pageId, ids } = yield* seedPage(graph, "Restore", ["a", "  a1"])
        const [a, a1] = [nth(ids, 0), nth(ids, 1)]
        yield* graph.dispatch({ _tag: "DeleteBlocks", blockIds: [a] })
        const restored = yield* graph.dispatch({ _tag: "Undo" })
        assert.deepStrictEqual(
          restored.flatMap((event) => (event._tag === "BlockUpserted" ? [event.block.id] : [])),
          [a, a1],
        )
        assert.deepStrictEqual(outline(yield* graph.page(pageId)), ["a", "  a1"])
        const edited = yield* graph.dispatch({
          _tag: "EditText",
          blockId: a1,
          from: 2,
          to: 2,
          insert: "!",
        })
        assert.deepStrictEqual(tags(edited), ["BlockUpserted"])
      }),
    ),
  )

  it.effect("does nothing when there is nothing to undo", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* graph.dispatch({ _tag: "Undo" }), [])
        assert.deepStrictEqual(yield* graph.dispatch({ _tag: "Redo" }), [])
      }),
    ),
  )
})

describe("events", () => {
  it.effect("streams every dispatched change to subscribers", () =>
    withGraph((graph) =>
      Effect.gen(function* () {
        const seen = yield* graph.events.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
        yield* Effect.yieldNow
        const pageId = createdPage(yield* graph.dispatch({ _tag: "CreatePage", title: "Live" }))
        const blockId: BlockId = createdBlock(
          yield* graph.dispatch({ _tag: "InsertBlock", pageId, parentId: null, text: "hi" }),
        )
        assert.deepStrictEqual(
          (yield* Fiber.join(seen)).map((event) =>
            event._tag === "BlockUpserted" ? event.block.id : event._tag,
          ),
          ["PageUpserted", blockId],
        )
      }),
    ),
  )
})
