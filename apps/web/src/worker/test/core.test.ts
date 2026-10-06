import { cp, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { Crypto, Effect, Layer, Stream } from "effect"
import { RpcTest } from "effect/rpc"
import { DeviceId } from "@seqno/domain"
import { layerNode } from "@seqno/index/node"
import { CoreRpcs } from "@seqno/rpc"
import { nodeStorage } from "@seqno/vault/node"
import { RealCore } from "../core.ts"
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
  RpcTest.makeClient(CoreRpcs).pipe(
    Effect.provide(
      RealCore.pipe(
        Layer.provide(
          Layer.succeed(GraphPlaces, {
            open: () =>
              Effect.succeed({ storage: nodeStorage(root), sqlite: layerNode(), starter: [] }),
          }),
        ),
        Layer.provide(Layer.succeed(Device, { device: DeviceId.make("laptop"), peer: "42" })),
        Layer.provide(WebCrypto),
      ),
    ),
  )

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
        const first = yield* coreOn(root)
        const opened = yield* first.OpenGraph({ graph: "og" })
        const tasks = yield* first.GetPage({ pageId: named(opened.pages, "tasks").id })
        const block = tasks.blocks[2] ?? assert.fail("tasks has no third block")
        yield* first.Dispatch({
          command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
        })
        yield* first.OpenGraph({ graph: "og" })

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
})
