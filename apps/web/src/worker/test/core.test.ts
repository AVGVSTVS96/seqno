import { cp, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { Crypto, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Scope, Stream } from "effect"
import { RpcTest } from "effect/rpc"
import { DeviceId } from "@seqno/domain"
import { layerNode } from "@seqno/index/node"
import { CoreRpcs, PageRpcs } from "@seqno/rpc"
import { nodeStorage } from "@seqno/vault/node"
import { RealCore } from "../core.ts"
import { layerWebLocks } from "../lock.ts"
import { Device, GraphPlaces } from "../place.ts"

const fixture = fileURLToPath(
  new URL("../../../../../fixtures/graphs/og-syntax-mix/", import.meta.url),
)

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the core"),
  }),
)

const coreOn = (root: string) =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(
      RealCore.pipe(
        Layer.provide(
          Layer.succeed(GraphPlaces, {
            open: () =>
              Effect.succeed({ storage: nodeStorage(root), sqlite: layerNode(), starter: [] }),
          }),
        ),
        Layer.provide(Layer.succeed(Device, { device: DeviceId.make("laptop"), peer: "42" })),
        Layer.provide(layerWebLocks),
        Layer.provide(WebCrypto),
      ),
    )
    return yield* Effect.provide(RpcTest.makeClient(CoreRpcs.merge(PageRpcs)), handlers)
  })

const copyOfFixture = Effect.promise(async () => {
  const root = await mkdtemp(join(tmpdir(), "seqno-core-"))
  await cp(fixture, root, { recursive: true })
  return root
})

const named = <A extends { readonly title: string }>(items: ReadonlyArray<A>, title: string) =>
  items.find((item) => item.title === title) ?? assert.fail(`no page titled ${title}`)

describe("the core worker on the real graph, vault and index", () => {
  it.effect("imports a Logseq folder on first open and writes its first update file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const core = yield* coreOn(root)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const titles = opened.pages
          .filter((page) => page.journalDay === null || page.journalDay === 20250309)
          .map((page) => page.title)
          .toSorted()
        assert.deepStrictEqual(titles, [
          "Café NFD",
          "Mar 9th, 2025",
          "Title Property Wins",
          "crlf line endings",
          "headings",
          "no trailing newline",
          "project/Alpha",
          "project/Beta",
          "queries",
          "tasks",
          "two-space indent",
        ])
        const journal = yield* core.GetPage({ pageId: named(opened.pages, "Mar 9th, 2025").id })
        assert.deepStrictEqual(
          journal.blocks.map((block) => block.text),
          [
            "journal links to [[project/Alpha]] and [[Alpha Project]]",
            "journal uses a namespaced tag #project/Alpha",
            "time-tracked task\n:LOGBOOK:\nCLOCK: [2025-03-09 Sun 10:00:00]--[2025-03-09 Sun 10:30:00] =>  00:30:00\n:END:",
          ],
        )
        assert.deepStrictEqual(
          yield* Effect.promise(() => readdir(join(root, "updates", "laptop"))),
          ["0.loro"],
        )
      }),
    ),
  )

  it.effect("an edit survives closing and reopening the graph", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const block = yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* coreOn(root)
            const opened = yield* first.OpenGraph({ graph: "og" })
            const tasks = yield* first.GetPage({ pageId: named(opened.pages, "tasks").id })
            const third = tasks.blocks[2] ?? assert.fail("tasks has no third block")
            yield* first.Dispatch({
              command: { _tag: "EditText", blockId: third.id, from: 0, to: 1, insert: "We" },
            })
            yield* first.OpenGraph({ graph: "og" })
            return third
          }),
        )

        const second = yield* coreOn(root)
        yield* second.OpenGraph({ graph: "og" })
        assert.strictEqual(
          (yield* second.GetBlock({ blockId: block.id })).text,
          "We recorded a [[voice note]].",
        )
      }),
    ),
  )

  it.effect("search and live queries read the index", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        yield* core.OpenGraph({ graph: "og" })
        const found = yield* core.Search({ text: "voice" })
        assert.deepStrictEqual(
          found.blocks.map((block) => block.text),
          ["I recorded a [[voice note]]."],
        )
        const results = yield* core
          .WatchQuery({ query: "{{query (task NOW DOING)}}" })
          .pipe(Stream.take(1), Stream.runCollect)
        assert.deepStrictEqual(
          results.map((result) =>
            result._tag === "BlockRows" ? result.blocks.map((block) => block.text) : [],
          ),
          [["NOW now item", "DOING doing item"]],
        )
      }),
    ),
  )

  it.effect("linked references follow edits, grouped by page with journals first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const alpha = named(opened.pages, "project/Alpha")
        const tasks = yield* core.GetPage({ pageId: named(opened.pages, "tasks").id })
        const first = yield* Deferred.make<void>()
        const updates = yield* core.WatchReferences({ pageId: alpha.id }).pipe(
          Stream.tap(() => Deferred.succeed(first, undefined)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        )
        yield* Deferred.await(first)
        const block = tasks.blocks[0] ?? assert.fail("tasks has no first block")
        yield* core.Dispatch({
          command: {
            _tag: "EditText",
            blockId: block.id,
            from: block.text.length,
            to: block.text.length,
            insert: " for [[project/Alpha]]",
          },
        })
        const texts = yield* Effect.forEach(yield* Fiber.join(updates), (references) =>
          Effect.forEach(references, (reference) =>
            Effect.map(core.GetBlock({ blockId: reference.blockId }), (found) => [
              named(opened.pages, "Mar 9th, 2025").id === reference.pageId ? "journal" : "page",
              found.text,
            ]),
          ),
        )
        assert.deepStrictEqual(texts, [
          [
            ["journal", "journal links to [[project/Alpha]] and [[Alpha Project]]"],
            ["journal", "journal uses a namespaced tag #project/Alpha"],
            ["page", "{{query (and [[project/Alpha]] (task NOW LATER))}}"],
          ],
          [
            ["journal", "journal links to [[project/Alpha]] and [[Alpha Project]]"],
            ["journal", "journal uses a namespaced tag #project/Alpha"],
            ["page", "{{query (and [[project/Alpha]] (task NOW LATER))}}"],
            ["page", "TODO for [[project/Alpha]]"],
          ],
        ])
      }),
    ),
  )

  it.effect("unlinked references find the name or an alias written as plain text", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const alpha = named(opened.pages, "project/Alpha")
        yield* core.Dispatch({
          command: {
            _tag: "InsertBlock",
            pageId: named(opened.pages, "tasks").id,
            parentId: null,
            text: "ask about the Alpha Project budget",
          },
        })
        const unlinked = yield* core
          .WatchUnlinkedReferences({ pageId: alpha.id })
          .pipe(Stream.take(1), Stream.runCollect)
        const texts = yield* Effect.forEach(unlinked.flat(), (reference) =>
          Effect.map(core.GetBlock({ blockId: reference.blockId }), (found) => found.text),
        )
        assert.deepStrictEqual(texts, ["ask about the Alpha Project budget"])
      }),
    ),
  )

  it.effect("page stats count backlinks per page, and ancestors walk up the tree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const stats = yield* core.WatchPageStats().pipe(Stream.take(1), Stream.runCollect)
        const backlinks = new Map(
          stats.flat().map((stat) => [stat.pageId, stat.backlinks] as const),
        )
        assert.strictEqual(backlinks.get(named(opened.pages, "project/Alpha").id), 3)
        assert.strictEqual(backlinks.get(named(opened.pages, "project/Beta").id), 1)
        assert.strictEqual(backlinks.get(named(opened.pages, "tasks").id), 0)
        const tasks = yield* core.GetPage({ pageId: named(opened.pages, "tasks").id })
        const child =
          tasks.blocks.find((block) => block.parentId !== null) ?? assert.fail("no nested block")
        assert.deepStrictEqual(
          (yield* core.Ancestors({ blockIds: [child.id] })).map((block) => block.text),
          ["I recorded a [[voice note]]."],
        )
      }),
    ),
  )

  it.live("a page watch wakes for its own page only, and for blocks moved away from it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const tasks = named(opened.pages, "tasks").id
        const headings = named(opened.pages, "headings").id
        const watched = yield* Stream.toQueue(core.WatchPage({ pageId: tasks }), {
          capacity: "unbounded",
        })
        const first = (yield* Queue.take(watched)).blocks[0] ?? assert.fail("tasks is empty")
        const elsewhere =
          (yield* core.GetPage({ pageId: headings })).blocks[0] ?? assert.fail("headings is empty")
        yield* core.Dispatch({
          command: { _tag: "EditText", blockId: elsewhere.id, from: 0, to: 0, insert: "x" },
        })
        yield* Effect.sleep("20 millis")
        assert.strictEqual(yield* Queue.size(watched), 0)
        yield* core.Dispatch({
          command: { _tag: "EditText", blockId: first.id, from: 0, to: 0, insert: "x" },
        })
        assert.strictEqual((yield* Queue.take(watched)).blocks[0]?.text, `x${first.text}`)
        yield* core.Dispatch({
          command: { _tag: "MoveBlocks", blockIds: [first.id], parentId: elsewhere.id },
        })
        assert.isFalse((yield* Queue.take(watched)).blocks.some((block) => block.id === first.id))
      }),
    ),
  )

  it.live("a second core waits for a graph until the first one closes it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const firstScope = yield* Scope.make()
        const first = yield* Scope.provide(coreOn(root), firstScope)
        yield* first.OpenGraph({ graph: "og-locked" })
        const second = yield* coreOn(root)
        const refused = yield* Effect.flip(second.OpenGraph({ graph: "og-locked" }))
        assert.strictEqual(refused._tag, "GraphLocked")
        const waiting = yield* Effect.forkChild(
          second.OpenGraph({ graph: "og-locked", wait: true }),
        )
        assert.isTrue(Option.isNone(yield* Fiber.await(waiting).pipe(Effect.timeoutOption(50))))
        yield* Scope.close(firstScope, Exit.void)
        assert.strictEqual((yield* Fiber.join(waiting)).graph, "og-locked")
      }),
    ),
  )
})
