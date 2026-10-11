import { cp, mkdir, mkdtemp, readdir, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { Clock, Crypto, Deferred, Effect, Fiber, Layer, Option, Queue, Stream } from "effect"
import { RpcClient, type RpcGroup, type RpcMessage, RpcServer, RpcTest } from "effect/rpc"
import { DeviceId } from "@seqno/domain"
import { layerNode } from "@seqno/index/node"
import { CoreRpcs, PageRpcs, tabLock } from "@seqno/rpc"
import { nodeStorage } from "@seqno/vault/node"
import { RealCore } from "../core.ts"
import { demoGraph } from "../demo.ts"
import { developerGraph } from "../developer.ts"
import { journalDayOf } from "../journal.ts"
import { layerWebLocks } from "../lock.ts"
import { Device, GraphPlaces, type Starter } from "../place.ts"

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

const coreLayer = (root: string, starter: Starter | null) =>
  RealCore.pipe(
    Layer.provide(
      Layer.succeed(GraphPlaces, {
        open: () => Effect.succeed({ storage: nodeStorage(root), sqlite: layerNode(), starter }),
      }),
    ),
    Layer.provide(Layer.succeed(Device, { device: DeviceId.make("laptop"), formerPeers: [] })),
    Layer.provide(layerWebLocks),
    Layer.provide(WebCrypto),
  )

const AllRpcs = CoreRpcs.merge(PageRpcs)

const coreOn = (root: string, starter: Starter | null = null) =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(coreLayer(root, starter))
    return yield* Effect.provide(RpcTest.makeClient(AllRpcs), handlers)
  })

const tabsOn = (root: string) =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(coreLayer(root, null))
    const replies = new Map<
      number,
      (message: RpcMessage.FromServer<RpcGroup.Rpcs<typeof AllRpcs>>) => Effect.Effect<void>
    >()
    const server = yield* Effect.provide(
      RpcServer.makeNoSerialization(AllRpcs, {
        onFromServer: (message) => replies.get(message.clientId)?.(message) ?? Effect.void,
      }),
      handlers,
    )
    return (id: number) =>
      Effect.gen(function* () {
        const made = yield* RpcClient.makeNoSerialization(AllRpcs, {
          supportsAck: true,
          onFromClient: ({ message }) => server.write(id, message),
        })
        replies.set(id, made.write)
        return made.client
      })
  })

const holdLock = (name: string) =>
  Effect.gen(function* () {
    const release = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
    yield* Effect.callback<void>((resume) => {
      void navigator.locks.request(name, () => {
        resume(Effect.void)
        return release.promise
      })
    })
    return Effect.sync(() => release.resolve())
  })

const heldLocks = Effect.map(
  Effect.promise(() => navigator.locks.query()),
  ({ held }) => (held ?? []).flatMap((info) => (info.name === undefined ? [] : [info.name])),
)

const copyOfFixture = Effect.promise(async () => {
  const root = await mkdtemp(join(tmpdir(), "seqno-core-"))
  await cp(fixture, root, { recursive: true })
  return root
})

const emptyFolder = Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-starter-")))

const tour = (version: number, line: string): Starter => ({
  version,
  files: [{ path: "pages/Welcome.md", text: `- ${line}` }],
})

const welcomeOn = (root: string, starter: Starter | null) =>
  Effect.scoped(
    Effect.gen(function* () {
      const core = yield* coreOn(root, starter)
      const opened = yield* core.OpenGraph({ graph: "demo" })
      const welcome = opened.pages.find((page) => page.title === "Welcome")
      if (welcome === undefined) return opened.pages.map((page) => page.title).toSorted()
      return (yield* core.GetPage({ pageId: welcome.id })).blocks.map((block) => block.text)
    }),
  )

const editWelcome = (root: string, starter: Starter) =>
  Effect.scoped(
    Effect.gen(function* () {
      const core = yield* coreOn(root, starter)
      const opened = yield* core.OpenGraph({ graph: "demo" })
      const welcome = yield* core.GetPage({ pageId: named(opened.pages, "Welcome").id })
      const first = welcome.blocks[0] ?? assert.fail("Welcome has no block")
      yield* core.Dispatch({
        command: { _tag: "EditText", blockId: first.id, from: 0, to: 0, insert: "my " },
      })
      yield* core.OpenGraph({ graph: "demo" })
    }),
  )

const named = <A extends { readonly title: string }>(items: ReadonlyArray<A>, title: string) =>
  items.find((item) => item.title === title) ?? assert.fail(`no page titled ${title}`)

describe("the core worker on the real graph, vault and index", () => {
  it.effect(
    "the Getting started graph imports whole, every link has a page and its queries match",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const today = journalDayOf(yield* Clock.currentTimeMillis)
          const core = yield* coreOn(yield* emptyFolder, { version: 1, files: demoGraph(today) })
          const opened = yield* core.OpenGraph({ graph: "demo" })
          assert.deepStrictEqual(
            opened.pages
              .filter((page) => page.journalDay === null)
              .map((page) => page.title)
              .toSorted(),
            [
              "Aliases",
              "As We May Think",
              "Basil",
              "Block refs and embeds",
              "Compost",
              "Contents",
              "Digital gardens",
              "Garden",
              "Getting started",
              "Harvest log",
              "Ideas",
              "Linking",
              "Namespaces",
              "Properties",
              "Queries",
              "Reading list",
              "Tasks",
              "Three Sisters",
              "Tomatoes",
              "projects/Cold frame",
              "projects/Seed swap",
              "recipes/Basil pesto",
              "recipes/Roasted tomato sauce",
            ],
          )
          assert.strictEqual(opened.pages.filter((page) => page.journalDay !== null).length, 15)
          const trees = yield* Effect.forEach(opened.pages, (page) =>
            core.GetPage({ pageId: page.id }),
          )
          assert.deepStrictEqual(
            trees
              .filter((tree) => !tree.blocks.some((block) => block.text.trim() !== ""))
              .map((tree) => tree.page.title),
            [],
          )
          const referenced = yield* core
            .WatchReferencedPages()
            .pipe(Stream.take(1), Stream.runCollect)
          assert.deepStrictEqual(
            referenced.flat().map((page) => page.name),
            ["question"],
          )
          const blocks = trees.flatMap((tree) => tree.blocks)
          const ids = new Set(blocks.flatMap((block) => [block.id, block.props["id"] ?? ""]))
          const refs = blocks.flatMap((block) =>
            [...block.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)].map((match) => match[1] ?? ""),
          )
          assert.strictEqual(refs.length, 7)
          assert.deepStrictEqual(
            refs.filter((ref) => !ids.has(ref)),
            [],
          )
          const results = (query: string) =>
            core.WatchQuery({ query }).pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.map((found) =>
                found.flatMap((result) =>
                  result._tag === "BlockRows"
                    ? result.blocks.map((block) => block.text.split("\n")[0] ?? "")
                    : result.pages.map((page) => page.title),
                ),
              ),
            )
          assert.deepStrictEqual((yield* results("{{query (task NOW DOING)}}")).toSorted(), [
            "DOING Type `/` for dates, priorities, headings, code blocks and more",
            "NOW [Braiding Sweetgrass](https://en.wikipedia.org/wiki/Braiding_Sweetgrass)",
          ])
          assert.deepStrictEqual(
            (yield* results("{{query (and [[harvest]] (between -7d today))}}")).toSorted(),
            [
              "Far too many at once. Next time, sow a short row every two weeks instead of one long one: [succession planting](https://en.wikipedia.org/wiki/Succession_planting).",
              "Picked 1.4 kg of tomatoes, the most in one go so far #harvest",
              "Pulled the first radishes #harvest",
              "The basil was about to flower, so it all came in at once #harvest",
            ],
          )
          assert.deepStrictEqual(
            (yield* results("{{query (property crop [[Tomatoes]])}}")).toSorted(),
            [
              "First ripe tomato! One Sungold, eaten standing next to the bed #harvest",
              "Picked 1.4 kg of tomatoes, the most in one go so far #harvest",
            ],
          )
          assert.deepStrictEqual(
            (yield* results(
              "{{query (and (task TODO DOING) (task.deadline <= +14d))}}",
            )).toSorted(),
            ["TODO [#A] Hinge the window onto the frame", "TODO [#B] Bring the seeds to the swap"],
          )
          assert.deepStrictEqual(
            (yield* results("{{query (and (namespace projects) (task TODO DOING))}}")).toSorted(),
            [
              "TODO Cut the boards so the back is taller than the front, for a sloping lid that sheds rain",
              "TODO Label the envelopes: variety, year, plot 14",
              "TODO [#A] Hinge the window onto the frame",
              "TODO [#B] Bring the seeds to the swap",
            ],
          )
          assert.deepStrictEqual(yield* results("LIST WHERE task.status = waiting"), [
            "WAITING Hear back from the garden committee about a second tap at the far end",
          ])
          assert.deepStrictEqual(
            (yield* results("{{query (page-property type recipe)}}")).toSorted(),
            ["recipes/Basil pesto", "recipes/Roasted tomato sauce"],
          )
          assert.deepStrictEqual(
            (yield* results("{{query (page-property type plant)}}")).toSorted(),
            ["Basil", "Three Sisters", "Tomatoes"],
          )
        }),
      ),
  )

  it.effect(
    "the developer demo graph imports whole, its block refs resolve and its queries match",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const today = journalDayOf(yield* Clock.currentTimeMillis)
          const core = yield* coreOn(yield* emptyFolder, {
            version: 1,
            files: developerGraph(today),
          })
          const opened = yield* core.OpenGraph({ graph: "developer" })
          assert.deepStrictEqual(
            opened.pages
              .filter((page) => page.journalDay === null)
              .map((page) => page.title)
              .toSorted(),
            [
              "About this graph",
              "Anthony Fu",
              "Brian Klaas",
              "CGP Grey",
              "CRDTs",
              "Contents",
              "Emil Kowalski",
              "Historia Civilis",
              "Jacob Geller",
              "Martin Kleppmann",
              "Quinn's Ideas",
              "Rome",
              "Ryan Norbauer",
              "SF",
              "ThePrimeagen",
              "Theo Browne",
              "Wes Billman",
              "dark mode",
              "design",
              "exurb1a",
              "history",
              "keyboards",
              "learning to code",
              "making things",
              "motion design",
              "naming",
              "notes apps",
              "open source",
              "people",
              "philosophy",
              "projects/PATCH.md",
              "projects/astro-fouc-killer",
              "projects/better-github-skill",
              "projects/brand-it",
              "projects/codexbar",
              "projects/commonplace",
              "projects/dotfiles",
              "projects/fastgpt",
              "projects/hex",
              "projects/openleaf",
              "projects/persistence-scope.nvim",
              "projects/portfolio",
              "projects/prompt-picker",
              "projects/react-shiki",
              "projects/seqno",
              "projects/seqno/numbers",
              "projects/vim-herdr-navigator",
              "prompting",
              "racing",
              "reading",
              "review",
              "sci-fi",
              "snippets",
              "systems of power",
              "terminal",
              "watching",
            ],
          )
          assert.strictEqual(opened.pages.filter((page) => page.journalDay !== null).length, 184)
          const blocks = (yield* Effect.forEach(opened.pages, (page) =>
            core.GetPage({ pageId: page.id }),
          )).flatMap((tree) => tree.blocks)
          const ids = new Set(blocks.flatMap((block) => [block.id, block.props["id"] ?? ""]))
          const refs = blocks.flatMap((block) =>
            [...block.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/g)].map((match) => match[1] ?? ""),
          )
          assert.strictEqual(refs.length, 23)
          assert.deepStrictEqual(
            refs.filter((ref) => !ids.has(ref)),
            [],
          )
          const texts = (query: string) =>
            core.WatchQuery({ query }).pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.map((results) =>
                results.flatMap((result) =>
                  result._tag === "BlockRows" ? result.blocks.map((block) => block.text) : [],
                ),
              ),
            )
          assert.deepStrictEqual((yield* texts("{{query (task NOW DOING)}}")).toSorted(), [
            "DOING go through every hex instruction file for only/never [[projects/hex]]",
            "NOW seqno lazy open, first step of hardening [[projects/seqno]]",
          ])
          assert.deepStrictEqual(
            (yield* texts("{{query (and [[decision]] [[seqno]])}}"))
              .filter((text) => text.includes("#decision"))
              .map((text) => text.slice(0, text.indexOf(" #decision")))
              .toSorted(),
            [
              "Loro is the source of truth, markdown is the mirror",
              "SQLite is a cache: `journal_mode=memory`, `synchronous=off`",
              "desktop = Electron",
              "one writer per file in the synced folder. delete only after another device confirms the snapshot",
              "queries: Logseq syntax first, Dataview second",
            ],
          )
          const decided = (project: string) =>
            Effect.map(
              texts(`{{query (and [[decision]] [[${project}]])}}`),
              (rows) => rows.filter((text) => text.includes(`#decision #${project}`)).length,
            )
          assert.deepStrictEqual(
            yield* Effect.forEach(
              [
                "react-shiki",
                "portfolio",
                "seqno",
                "openleaf",
                "hex",
                "fastgpt",
                "dotfiles",
                "patch-md",
                "commonplace",
                "better-github-skill",
                "persistence-scope",
                "vim-herdr-navigator",
                "astro-fouc-killer",
                "codexbar",
                "prompt-picker",
              ],
              decided,
            ),
            [16, 10, 5, 5, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1],
          )
        }),
      ),
  )

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
        const written = yield* Effect.promise(() => readdir(join(root, "updates", "laptop")))
        assert.deepStrictEqual(
          written.map((name) => name.replace(/^\d+-/, "<peer>-")),
          ["<peer>-0.loro"],
        )
      }),
    ),
  )

  it.effect(
    "a demo graph keeps a visitor's edits until newer content ships, then starts over",
    () =>
      Effect.gen(function* () {
        const root = yield* emptyFolder
        yield* editWelcome(root, tour(1, "first tour"))
        assert.deepStrictEqual(yield* welcomeOn(root, tour(1, "first tour")), ["my first tour"])
        assert.deepStrictEqual(yield* welcomeOn(root, tour(2, "second tour")), ["second tour"])
        assert.deepStrictEqual(yield* welcomeOn(root, tour(2, "second tour")), ["second tour"])
      }),
  )

  it.effect("a demo graph opened before content versions existed starts over once", () =>
    Effect.gen(function* () {
      const root = yield* emptyFolder
      yield* Effect.promise(async () => {
        await mkdir(join(root, "pages"))
        await writeFile(join(root, "pages", "Welcome.md"), "- old tour")
      })
      assert.deepStrictEqual(yield* welcomeOn(root, null), ["old tour"])
      assert.deepStrictEqual(yield* welcomeOn(root, tour(1, "new tour")), ["new tour"])
    }),
  )

  it.effect("a folder of markdown with no edit log yet is imported as it is, not replaced", () =>
    Effect.gen(function* () {
      const root = yield* emptyFolder
      yield* Effect.promise(async () => {
        await mkdir(join(root, "pages"))
        await writeFile(join(root, "pages", "Garden.md"), "- beds run north to south")
      })
      const titles = yield* welcomeOn(root, tour(1, "tour"))
      assert.deepStrictEqual(
        titles.filter((title) => !/\d{4}$/.test(title)),
        ["Garden"],
      )
    }),
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

  it.effect(
    "edits made while one of this device's own update files is missing merge with it once it is back",
    () =>
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const typeAt = (at: (text: string) => number, insert: string) =>
          Effect.scoped(
            Effect.gen(function* () {
              const core = yield* coreOn(root)
              const opened = yield* core.OpenGraph({ graph: "og" })
              const tasks = yield* core.GetPage({ pageId: named(opened.pages, "tasks").id })
              const third = tasks.blocks[2] ?? assert.fail("tasks has no third block")
              const offset = at(third.text)
              yield* core.Dispatch({
                command: { _tag: "EditText", blockId: third.id, from: offset, to: offset, insert },
              })
              yield* core.OpenGraph({ graph: "og" })
              return third.id
            }),
          )
        const own = join(root, "updates", "laptop")
        const away = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-away-")))
        yield* Effect.scoped(
          Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })),
        )
        const filesBefore = new Set(yield* Effect.promise(() => readdir(own)))
        yield* typeAt(() => 0, "A ")
        const firstEdit = (yield* Effect.promise(() => readdir(own))).filter(
          (name) => !filesBefore.has(name),
        )
        yield* Effect.promise(() =>
          Promise.all(firstEdit.map((name) => rename(join(own, name), join(away, name)))),
        )
        const blockId = yield* typeAt((text) => text.length, " B")
        yield* Effect.promise(() =>
          Promise.all(firstEdit.map((name) => rename(join(away, name), join(own, name)))),
        )
        const text = yield* Effect.scoped(
          Effect.gen(function* () {
            const core = yield* coreOn(root)
            yield* core.OpenGraph({ graph: "og" })
            return (yield* core.GetBlock({ blockId })).text
          }),
        )
        assert.deepStrictEqual(firstEdit.length, 1)
        assert.strictEqual(text, "A I recorded a [[voice note]]. B")
      }),
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

  it.effect("names that are only referenced come back as pages, titled as written", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        yield* core.OpenGraph({ graph: "og" })
        const referenced = yield* core
          .WatchReferencedPages()
          .pipe(Stream.take(1), Stream.runCollect)
        assert.deepStrictEqual(
          referenced.flat().map((page) => [page.name, page.title, page.backlinks]),
          [
            ["hashtag-not-heading", "hashtag-not-heading", 1],
            ["multi word tag", "multi word tag", 1],
            ["page ref", "page ref", 1],
            ["tag", "tag", 1],
            ["voice note", "voice note", 1],
          ],
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

  it.live("a page watch stays open while undo removes its page, and redo brings it back", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        yield* core.OpenGraph({ graph: "og" })
        const created = yield* core.Dispatch({ command: { _tag: "CreatePage", title: "Probe" } })
        const pageId =
          created.flatMap((event) => (event._tag === "PageUpserted" ? [event.page.id] : []))[0] ??
          assert.fail("no page was created")
        const watched = yield* Stream.toQueue(core.WatchPage({ pageId }), {
          capacity: "unbounded",
        })
        assert.strictEqual((yield* Queue.take(watched)).page.title, "Probe")
        yield* core.Dispatch({ command: { _tag: "Undo" } })
        yield* core.Dispatch({ command: { _tag: "Redo" } })
        assert.strictEqual((yield* Queue.take(watched)).page.title, "Probe")
      }),
    ),
  )

  it.effect("renaming a page rewrites the references to it in one undo step", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        yield* core.OpenGraph({ graph: "og" })
        const created = (title: string) =>
          Effect.map(
            core.Dispatch({ command: { _tag: "CreatePage", title } }),
            (events) =>
              events.flatMap((event) =>
                event._tag === "PageUpserted" ? [event.page.id] : [],
              )[0] ?? assert.fail(`no page ${title}`),
          )
        const garden = yield* created("Garden Plan")
        const notes = yield* created("Notes")
        yield* core.Dispatch({
          command: {
            _tag: "InsertBlock",
            pageId: notes,
            parentId: null,
            text: "see [[Garden Plan]] and #[[garden plan]]",
          },
        })
        yield* core.Dispatch({
          command: {
            _tag: "SetProperty",
            target: { _tag: "PageTarget", pageId: notes },
            key: "tags",
            value: "Garden Plan, compost",
          },
        })
        yield* core.Dispatch({
          command: { _tag: "RenamePage", pageId: garden, title: "Garden Plan X" },
        })
        const renamed = yield* core.GetPage({ pageId: notes })
        assert.deepStrictEqual(
          [renamed.page.props["tags"], ...renamed.blocks.map((block) => block.text)],
          ["Garden Plan X, compost", "see [[Garden Plan X]] and #[[Garden Plan X]]"],
        )
        yield* core.Dispatch({ command: { _tag: "Undo" } })
        const restored = yield* core.GetPage({ pageId: notes })
        assert.deepStrictEqual(
          [restored.page.props["tags"], ...restored.blocks.map((block) => block.text)],
          ["Garden Plan, compost", "see [[Garden Plan]] and #[[garden plan]]"],
        )
        assert.strictEqual((yield* core.GetPage({ pageId: garden })).page.title, "Garden Plan")
      }),
    ),
  )

  it.live("two tabs share one graph: what one types, the other sees at once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tab = yield* tabsOn(yield* copyOfFixture)
        const first = yield* tab(0)
        const second = yield* tab(1)
        const opened = yield* first.OpenGraph({ graph: "og-shared" })
        yield* second.OpenGraph({ graph: "og-shared" })
        const tasks = named(opened.pages, "tasks").id
        const block = (yield* first.GetPage({ pageId: tasks })).blocks[2] ?? assert.fail("no block")
        const watching = yield* Deferred.make<void>()
        const seen = yield* second.WatchPage({ pageId: tasks }).pipe(
          Stream.tap(() => Deferred.succeed(watching, undefined)),
          Stream.map((tree) => tree.blocks[2]?.text),
          Stream.takeUntil((text) => text === "We recorded a [[voice note]] today."),
          Stream.runCollect,
          Effect.forkChild,
        )
        yield* Deferred.await(watching)
        yield* first.Dispatch({
          command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
        })
        yield* second.Dispatch({
          command: {
            _tag: "EditText",
            blockId: block.id,
            from: 28,
            to: 29,
            insert: " today.",
          },
        })
        assert.deepStrictEqual(yield* Fiber.join(seen), [
          "I recorded a [[voice note]].",
          "We recorded a [[voice note]].",
          "We recorded a [[voice note]] today.",
        ])
        assert.strictEqual(
          (yield* first.GetBlock({ blockId: block.id })).text,
          "We recorded a [[voice note]] today.",
        )
      }),
    ),
  )

  it.live("closing one tab leaves the graph to the other, and the last one saves it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const tab = yield* tabsOn(root)
        const first = yield* tab(0)
        const second = yield* tab(1)
        const closeFirst = yield* holdLock(tabLock("first"))
        const closeSecond = yield* holdLock(tabLock("second"))
        const firstAttached = yield* Effect.forkChild(
          Stream.runDrain(first.Attach({ tab: "first" })),
        )
        const secondAttached = yield* Effect.forkChild(
          Stream.runDrain(second.Attach({ tab: "second" })),
        )
        const opened = yield* first.OpenGraph({ graph: "og-closing" })
        yield* second.OpenGraph({ graph: "og-closing" })
        const tasks = yield* first.GetPage({ pageId: named(opened.pages, "tasks").id })
        const block = tasks.blocks[2] ?? assert.fail("tasks has no third block")
        yield* first.Dispatch({
          command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
        })
        yield* closeFirst
        yield* Fiber.join(firstAttached)
        yield* second.Dispatch({
          command: { _tag: "EditText", blockId: block.id, from: 28, to: 29, insert: " today." },
        })
        assert.strictEqual(
          (yield* second.GetBlock({ blockId: block.id })).text,
          "We recorded a [[voice note]] today.",
        )
        assert.include(yield* heldLocks, "seqno/graph/og-closing")
        yield* closeSecond
        yield* Fiber.join(secondAttached)
        yield* Effect.scoped(holdLock("seqno/graph/og-closing"))

        const reopened = yield* coreOn(root)
        yield* reopened.OpenGraph({ graph: "og-closing" })
        assert.strictEqual(
          (yield* reopened.GetBlock({ blockId: block.id })).text,
          "We recorded a [[voice note]] today.",
        )
      }),
    ),
  )

  it.live("a core of another version takes the graph over once the first one saved it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const older = yield* tabsOn(root)
        const tab = yield* older(0)
        yield* holdLock(tabLock("older"))
        const moves = yield* tab
          .Attach({ tab: "older" })
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
        const opened = yield* tab.OpenGraph({ graph: "og-moved" })
        const tasks = yield* tab.GetPage({ pageId: named(opened.pages, "tasks").id })
        const block = tasks.blocks[2] ?? assert.fail("tasks has no third block")
        yield* tab.Dispatch({
          command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
        })

        const newer = yield* coreOn(root)
        yield* newer.OpenGraph({ graph: "og-moved" })
        assert.strictEqual(
          (yield* newer.GetBlock({ blockId: block.id })).text,
          "We recorded a [[voice note]].",
        )
        assert.deepStrictEqual(yield* Fiber.join(moves), [{ graph: "og-moved" }])
        assert.strictEqual((yield* Effect.flip(tab.GetPages()))._tag, "GraphNotOpen")
      }),
    ),
  )

  it.live("a graph an older seqno holds waits until that tab lets go", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const letGo = yield* holdLock("seqno/graph/og-locked")
        const core = yield* coreOn(yield* copyOfFixture)
        const refused = yield* Effect.flip(core.OpenGraph({ graph: "og-locked" }))
        assert.strictEqual(refused._tag, "GraphLocked")
        const waiting = yield* Effect.forkChild(core.OpenGraph({ graph: "og-locked", wait: true }))
        assert.isTrue(Option.isNone(yield* Fiber.await(waiting).pipe(Effect.timeoutOption(50))))
        yield* letGo
        assert.strictEqual((yield* Fiber.join(waiting)).graph, "og-locked")
      }),
    ),
  )
})
