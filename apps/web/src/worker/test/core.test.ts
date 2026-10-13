import { cp, mkdir, mkdtemp, readdir, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import {
  Clock,
  Context,
  Crypto,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Schedule,
  Stream,
} from "effect"
import { RpcClient, type RpcGroup, type RpcMessage, RpcServer, RpcTest } from "effect/rpc"
import { DeviceId } from "@seqno/domain"
import { Graph, PeerId } from "@seqno/graph"
import { layerNode } from "@seqno/index/node"
import { CoreRpcs, PageRpcs, tabLock, type SaveState } from "@seqno/rpc"
import { StorageFailed, type Storage } from "@seqno/vault"
import { nodeStorage } from "@seqno/vault/node"
import { RealCore } from "../core.ts"
import { demoGraph } from "../demo.ts"
import { developerGraph } from "../developer.ts"
import { journalDayOf, todaysJournal } from "../journal.ts"
import { GraphLocks, layerWebLocks } from "../lock.ts"
import { Device, GraphPlaces, type IndexFile, type Starter } from "../place.ts"

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

const savedIndexes = new Map<string, Uint8Array>()

const indexFileOf = (key: string): IndexFile => ({
  read: Effect.sync(() => Option.fromUndefinedOr(savedIndexes.get(key))),
  write: (image) => Effect.sync(() => void savedIndexes.set(key, image)),
})

const editSavedIndex = (key: string, sql: string) =>
  Effect.sync(() => {
    const db = new DatabaseSync(":memory:")
    db.deserialize(savedIndexes.get(key) ?? assert.fail(`no index saved for ${key}`))
    db.exec(sql)
    savedIndexes.set(key, db.serialize())
    db.close()
  })

const POISON_VOICE_NOTE = `
DELETE FROM fts WHERE rowid = (SELECT rid FROM blocks WHERE content = 'I recorded a [[voice note]].');
INSERT INTO fts (rowid, content) SELECT rid, 'poison' FROM blocks WHERE content = 'I recorded a [[voice note]].';`

const HEADINGS_BLOCKS = `SELECT b.rid FROM blocks b JOIN pages p ON p.rid = b.page WHERE p.name_lc = 'headings'`

const HEADINGS_NOT_WRITTEN = `
INSERT INTO unwritten SELECT id FROM pages WHERE name_lc = 'headings';
DELETE FROM fts WHERE rowid IN (${HEADINGS_BLOCKS});
DELETE FROM refs WHERE block IN (${HEADINGS_BLOCKS});
DELETE FROM props WHERE block IN (${HEADINGS_BLOCKS});
DELETE FROM tasks WHERE block IN (${HEADINGS_BLOCKS});
DELETE FROM blocks WHERE rid IN (${HEADINGS_BLOCKS});`

const coreLayer = (
  root: string,
  starter: Starter | null,
  device = "laptop",
  storage: Storage["Service"] = nodeStorage(root),
  locks: Layer.Layer<GraphLocks> = layerWebLocks,
) =>
  RealCore.pipe(
    Layer.provide(
      Layer.succeed(GraphPlaces, {
        open: () =>
          Effect.succeed({
            storage,
            synced: true,
            sqlite: layerNode(),
            indexFile: indexFileOf(`${device}:${root}`),
            starter,
          }),
        forget: () => Effect.sync(() => void savedIndexes.delete(`${device}:${root}`)),
      }),
    ),
    Layer.provide(Layer.succeed(Device, { device: DeviceId.make(device), formerPeers: [] })),
    Layer.provide(locks),
    Layer.provide(WebCrypto),
  )

const AllRpcs = CoreRpcs.merge(PageRpcs)

const coreOn = (root: string, starter: Starter | null = null, device = "laptop") =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(coreLayer(root, starter, device))
    return yield* Effect.provide(RpcTest.makeClient(AllRpcs), handlers)
  })

const tabsOn = (
  root: string,
  storage: Storage["Service"] = nodeStorage(root),
  locks: Layer.Layer<GraphLocks> = layerWebLocks,
) =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(coreLayer(root, null, "laptop", storage, locks))
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

const pagesOn = (root: string, device: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const core = yield* coreOn(root, null, device)
      const opened = yield* core.OpenGraph({ graph: "og" })
      const tasks = yield* core.GetPage({ pageId: named(opened.pages, "tasks").id })
      return {
        titles: opened.pages.map((page) => page.title).toSorted(),
        tasks: tasks.blocks.map((block) => block.text),
      }
    }),
  )

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
          assert.strictEqual(opened.pages.filter((page) => page.journalDay !== null).length, 227)
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
            [16, 13, 5, 5, 4, 5, 3, 3, 2, 2, 2, 2, 1, 1, 1],
          )
        }),
      ),
  )

  it.effect(
    "imports a Logseq folder on first open and writes the import and the new journal as two files",
    () =>
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
          assert.deepStrictEqual(opened.skipped, [])
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
            ["<peer>-0.loro", "<peer>-0.loro"],
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

  it.effect("the open that imports a folder lists the files it left out, once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* emptyFolder
        yield* Effect.promise(async () => {
          await mkdir(join(root, "pages"))
          await writeFile(join(root, "pages", "Garden.md"), "- beds")
          await writeFile(join(root, "pages", "garden.md"), "- same name")
          await writeFile(join(root, "pages", "notes.org"), "* org")
        })
        const first = yield* coreOn(root)
        const opened = yield* first.OpenGraph({ graph: "og" })
        assert.deepStrictEqual(opened.skipped, [
          { path: "pages/garden.md", reason: "has the same page name as an earlier file: garden" },
          { path: "pages/notes.org", reason: "isn't a Markdown page" },
        ])
        assert.deepStrictEqual((yield* first.OpenGraph({ graph: "og" })).skipped, [])
      }),
    ),
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

  it.effect(
    "a graph where two devices each made today's journal opens with one journal holding both",
    () =>
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        yield* Effect.scoped(
          Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })),
        )
        const phone = yield* Effect.scoped(
          Effect.gen(function* () {
            const graph = yield* Effect.map(
              Layer.build(
                Graph.layer({ peer: PeerId.make("7"), snapshot: Option.none(), updates: [] }).pipe(
                  Layer.provide(WebCrypto),
                ),
              ),
              (context) => Context.get(context, Graph),
            )
            const [journal] = yield* Effect.provide(todaysJournal(graph), WebCrypto)
            if (journal === undefined) return assert.fail("an empty graph has no journal yet")
            yield* graph.load([journal])
            const block = journal.blocks[0] ?? assert.fail("a new journal has a block")
            yield* graph.dispatch({
              _tag: "EditText",
              blockId: block.id,
              from: 0,
              to: 0,
              insert: "from the phone",
            })
            return yield* graph.flush(() => Effect.void)
          }),
        )
        if (Option.isNone(phone)) return assert.fail("the phone wrote nothing")
        yield* Effect.promise(async () => {
          await mkdir(join(root, "updates", "phone"), { recursive: true })
          await writeFile(join(root, "updates", "phone", "7-0.loro"), phone.value.bytes)
        })
        const today = journalDayOf(yield* Clock.currentTimeMillis)
        const journals = yield* Effect.scoped(
          Effect.gen(function* () {
            const core = yield* coreOn(root)
            const opened = yield* core.OpenGraph({ graph: "og" })
            const todays = opened.pages.filter((page) => page.journalDay === today)
            return yield* Effect.forEach(todays, (page) =>
              Effect.map(core.GetPage({ pageId: page.id }), (tree) =>
                tree.blocks.map((block) => block.text),
              ),
            )
          }),
        )
        assert.strictEqual(journals.length, 1)
        assert.deepStrictEqual(journals[0]?.toSorted(), ["", "from the phone"])
      }),
  )

  it.effect("two devices that import one folder before syncing end up with one copy of it", () =>
    Effect.gen(function* () {
      const laptopRoot = yield* copyOfFixture
      const phoneRoot = yield* copyOfFixture
      const alone = yield* pagesOn(laptopRoot, "laptop")
      yield* pagesOn(phoneRoot, "phone")
      yield* Effect.promise(() =>
        cp(join(phoneRoot, "updates", "phone"), join(laptopRoot, "updates", "phone"), {
          recursive: true,
        }),
      )
      const together = yield* pagesOn(laptopRoot, "laptop")
      assert.deepStrictEqual(together, alone)
      assert.strictEqual(new Set(together.titles).size, together.titles.length)
    }),
  )

  it.effect("save state follows each edit to disk, and a failing write shows its reason", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const disk = nodeStorage(root)
        const full = { now: false }
        const storage: Storage["Service"] = {
          ...disk,
          write: (path, bytes) =>
            full.now
              ? Effect.fail(new StorageFailed({ path, reason: "the disk is full" }))
              : disk.write(path, bytes),
        }
        const handlers = yield* Layer.build(coreLayer(root, null, "laptop", storage))
        const core = yield* Effect.provide(RpcTest.makeClient(AllRpcs), handlers)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const tasks = yield* core.GetPage({ pageId: named(opened.pages, "tasks").id })
        const third = tasks.blocks[2] ?? assert.fail("tasks has no third block")
        const reach = (tag: SaveState["_tag"]) =>
          core.WatchSaveState().pipe(
            Stream.filter((state) => state._tag === tag),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          )
        const type = (insert: string) =>
          core.Dispatch({
            command: { _tag: "EditText", blockId: third.id, from: 0, to: 0, insert },
          })

        full.now = true
        yield* type("lost? ")
        assert.deepStrictEqual(yield* reach("Failed"), {
          _tag: "Failed",
          reason: "the disk is full",
        })
        full.now = false
        yield* type("kept ")
        assert.deepStrictEqual(yield* reach("Saved"), { _tag: "Saved" })
        const reopened = yield* Effect.scoped(
          Effect.gen(function* () {
            const again = yield* coreOn(root)
            yield* again.OpenGraph({ graph: "og" })
            return (yield* again.GetBlock({ blockId: third.id })).text
          }),
        )
        assert.strictEqual(reopened, "kept lost? I recorded a [[voice note]].")
      }),
    ),
  )

  it.live(
    "a reopened graph reads its saved index and re-indexes only the pages changed since",
    () =>
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        const laptop = `laptop:${root}`
        yield* Effect.scoped(
          Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })),
        )
        yield* editSavedIndex(laptop, POISON_VOICE_NOTE)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const phone = yield* coreOn(root, null, "phone")
            const opened = yield* phone.OpenGraph({ graph: "og" })
            const headings = yield* phone.GetPage({ pageId: named(opened.pages, "headings").id })
            const first = headings.blocks[0] ?? assert.fail("headings has no blocks")
            yield* phone.Dispatch({
              command: { _tag: "EditText", blockId: first.id, from: 0, to: 0, insert: "zephyr " },
            })
          }),
        )
        const found = yield* Effect.scoped(
          Effect.gen(function* () {
            const core = yield* coreOn(root)
            yield* core.OpenGraph({ graph: "og" })
            const edited = yield* core.Search({ text: "zephyr" }).pipe(
              Effect.repeat({
                until: (hits) => hits.blocks.length > 0,
                schedule: Schedule.spaced("10 millis"),
              }),
            )
            const kept = yield* core.Search({ text: "poison" })
            return [edited, kept].map((hits) => hits.blocks.map((block) => block.text.slice(0, 7)))
          }),
        )
        assert.deepStrictEqual(found, [["zephyr "], ["I recor"]])
      }),
  )

  it.live("a reopened graph writes the pages its saved index still owes, and keeps the rest", () =>
    Effect.gen(function* () {
      const root = yield* copyOfFixture
      yield* Effect.scoped(Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })))
      yield* editSavedIndex(`laptop:${root}`, `${POISON_VOICE_NOTE}${HEADINGS_NOT_WRITTEN}`)
      const found = yield* Effect.scoped(
        Effect.gen(function* () {
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          const written = yield* core.Search({ text: "List H3" }).pipe(
            Effect.repeat({
              until: (hits) => hits.blocks.length > 0,
              schedule: Schedule.spaced("10 millis"),
            }),
          )
          const kept = yield* core.Search({ text: "poison" })
          return [written, kept].map((hits) => hits.blocks.map((block) => block.text))
        }),
      )
      assert.deepStrictEqual(found, [["### List H3"], ["I recorded a [[voice note]]."]])
    }),
  )

  it.live("a saved index from another edit log is dropped and filled again", () =>
    Effect.gen(function* () {
      const root = yield* copyOfFixture
      const laptop = `laptop:${root}`
      yield* Effect.scoped(Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })))
      yield* editSavedIndex(
        laptop,
        `${POISON_VOICE_NOTE}
UPDATE meta SET value = '{"version":{"999":1},"pageMs":0}' WHERE key = 'stamp';`,
      )
      const found = yield* Effect.scoped(
        Effect.gen(function* () {
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          const refilled = yield* core.Search({ text: "voice" }).pipe(
            Effect.repeat({
              until: (hits) => hits.blocks.length > 0,
              schedule: Schedule.spaced("10 millis"),
            }),
          )
          const poisoned = yield* core.Search({ text: "poison" })
          return [refilled, poisoned].map((hits) => hits.blocks.map((block) => block.text))
        }),
      )
      assert.deepStrictEqual(found, [["I recorded a [[voice note]]."], []])
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

  it.effect("blocks moved while a reopened graph fills its index end up in the index", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* copyOfFixture
        yield* Effect.scoped(
          Effect.flatMap(coreOn(root), (core) => core.OpenGraph({ graph: "og" })),
        )
        const core = yield* coreOn(root)
        const opened = yield* core.OpenGraph({ graph: "og" })
        const [target, ...others] = yield* Effect.forEach(opened.pages, (page) =>
          core.GetPage({ pageId: page.id }),
        )
        const anchor = target?.blocks[0] ?? assert.fail("the first page has no blocks")
        const moved = others.toReversed().flatMap((tree) => tree.blocks.slice(0, 1))
        yield* Effect.forEach(
          moved,
          (block) =>
            core.Dispatch({
              command: {
                _tag: "MoveBlocks",
                blockIds: [block.id],
                parentId: null,
                after: anchor.id,
              },
            }),
          { discard: true },
        )
        const onTarget = yield* core
          .WatchQuery({ query: `{{query (page "${target?.page.name}")}}` })
          .pipe(
            Stream.map((result) =>
              result._tag === "BlockRows" ? result.blocks.map((block) => block.id) : [],
            ),
            Stream.filter((ids) => moved.every((block) => ids.includes(block.id))),
            Stream.take(1),
            Stream.runCollect,
          )
        assert.strictEqual(onTarget.length, 1)
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

  it.effect("merging a referenced block points its references at the block it merged into", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* coreOn(yield* copyOfFixture)
        yield* core.OpenGraph({ graph: "og" })
        const pageId =
          (yield* core.Dispatch({ command: { _tag: "CreatePage", title: "Merges" } })).flatMap(
            (event) => (event._tag === "PageUpserted" ? [event.page.id] : []),
          )[0] ?? assert.fail("no page")
        const insert = (text: string) =>
          Effect.map(
            core.Dispatch({ command: { _tag: "InsertBlock", pageId, parentId: null, text } }),
            (events) =>
              events.flatMap((event) =>
                event._tag === "BlockUpserted" ? [event.block.id] : [],
              )[0] ?? assert.fail(`no block ${text}`),
          )
        const citing = yield* insert("cite")
        const second = yield* insert("second")
        const first = yield* insert("first")
        yield* core.Dispatch({
          command: {
            _tag: "EditText",
            blockId: citing,
            from: 4,
            to: 4,
            insert: ` ((${second})) twice ((${second.toUpperCase()}))`,
          },
        })
        yield* core.Dispatch({
          command: {
            _tag: "SetProperty",
            target: { _tag: "BlockTarget", blockId: citing },
            key: "source",
            value: `((${second}))`,
          },
        })
        yield* core.Dispatch({ command: { _tag: "MergeWithPrevious", blockId: second } })
        const cited = yield* core.GetBlock({ blockId: citing })
        assert.deepStrictEqual(
          [cited.text, cited.props["source"], (yield* core.GetBlock({ blockId: first })).text],
          [`cite ((${first})) twice ((${first}))`, `((${first}))`, "firstsecond"],
        )
        yield* core.Dispatch({ command: { _tag: "Undo" } })
        const restored = yield* core.GetBlock({ blockId: citing })
        assert.deepStrictEqual(
          [restored.text, restored.props["source"]],
          [`cite ((${second})) twice ((${second.toUpperCase()}))`, `((${second}))`],
        )
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

  it.live("each tab undoes only its own edits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tab = yield* tabsOn(yield* copyOfFixture)
        const first = yield* tab(0)
        const second = yield* tab(1)
        const opened = yield* first.OpenGraph({ graph: "og-undo" })
        yield* second.OpenGraph({ graph: "og-undo" })
        const tasks = named(opened.pages, "tasks").id
        const block = (yield* first.GetPage({ pageId: tasks })).blocks[2] ?? assert.fail("no block")
        const type = (core: typeof first, from: number, insert: string) =>
          core.Dispatch({
            command: { _tag: "EditText", blockId: block.id, from, to: from, insert },
          })
        const current = Effect.map(first.GetBlock({ blockId: block.id }), (found) => found.text)
        yield* type(first, 0, "A ")
        yield* type(second, 2, "B ")
        assert.strictEqual(yield* current, "A B I recorded a [[voice note]].")
        yield* first.Dispatch({ command: { _tag: "Undo" } })
        assert.strictEqual(yield* current, "B I recorded a [[voice note]].")
        yield* first.Dispatch({ command: { _tag: "Undo" } })
        assert.strictEqual(yield* current, "B I recorded a [[voice note]].")
        yield* first.Dispatch({ command: { _tag: "Redo" } })
        assert.strictEqual(yield* current, "A B I recorded a [[voice note]].")
        yield* second.Dispatch({ command: { _tag: "Undo" } })
        assert.strictEqual(yield* current, "A I recorded a [[voice note]].")
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

  it.live(
    "a reloaded tab reopens its graph in the same worker once the closing session saved it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOfFixture
          const disk = nodeStorage(root)
          const held = { writes: false }
          const written = yield* Deferred.make<void>()
          const storage: Storage["Service"] = {
            ...disk,
            write: (path, bytes) =>
              held.writes
                ? Effect.andThen(Deferred.await(written), disk.write(path, bytes))
                : disk.write(path, bytes),
          }
          const tab = yield* tabsOn(root, storage)
          const closing = yield* tab(0)
          const reopening = yield* tab(1)
          const close = yield* holdLock(tabLock("closing"))
          const attached = yield* Effect.forkChild(
            Stream.runDrain(closing.Attach({ tab: "closing" })),
          )
          const opened = yield* closing.OpenGraph({ graph: "og-reopened" })
          const tasks = yield* closing.GetPage({ pageId: named(opened.pages, "tasks").id })
          const block = tasks.blocks[2] ?? assert.fail("tasks has no third block")
          held.writes = true
          yield* closing.Dispatch({
            command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
          })
          yield* close
          yield* Fiber.join(attached)
          const reopened = yield* Effect.forkChild(reopening.OpenGraph({ graph: "og-reopened" }))
          assert.isTrue(Option.isNone(yield* Fiber.await(reopened).pipe(Effect.timeoutOption(50))))
          held.writes = false
          yield* Deferred.succeed(written, undefined)
          assert.strictEqual((yield* Fiber.join(reopened)).graph, "og-reopened")
          assert.strictEqual(
            (yield* reopening.GetBlock({ blockId: block.id })).text,
            "We recorded a [[voice note]].",
          )
        }),
      ),
  )

  it.live(
    "a reloaded tab waits for the session its worker is still closing, even when the graph looks held by an older seqno",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOfFixture
          const disk = nodeStorage(root)
          const held = { writes: false }
          const written = yield* Deferred.make<void>()
          const storage: Storage["Service"] = {
            ...disk,
            write: (path, bytes) =>
              held.writes
                ? Effect.andThen(Deferred.await(written), disk.write(path, bytes))
                : disk.write(path, bytes),
          }
          const handoverTooLate = Layer.effect(
            GraphLocks,
            Effect.map(Effect.service(GraphLocks), (locks) =>
              GraphLocks.of({
                ...locks,
                hold: (graph, wait) =>
                  Effect.flatMap(heldLocks, (names) =>
                    !wait && names.includes(`seqno/graph/${graph}`)
                      ? Effect.succeedNone
                      : locks.hold(graph, wait),
                  ),
              }),
            ),
          ).pipe(Layer.provide(layerWebLocks))
          const tab = yield* tabsOn(root, storage, handoverTooLate)
          const closing = yield* tab(0)
          const reopening = yield* tab(1)
          const close = yield* holdLock(tabLock("closing-late"))
          const attached = yield* Effect.forkChild(
            Stream.runDrain(closing.Attach({ tab: "closing-late" })),
          )
          const opened = yield* closing.OpenGraph({ graph: "og-late" })
          const tasks = yield* closing.GetPage({ pageId: named(opened.pages, "tasks").id })
          const block = tasks.blocks[2] ?? assert.fail("tasks has no third block")
          held.writes = true
          yield* closing.Dispatch({
            command: { _tag: "EditText", blockId: block.id, from: 0, to: 1, insert: "We" },
          })
          yield* close
          yield* Fiber.join(attached)
          const reopened = yield* Effect.forkChild(reopening.OpenGraph({ graph: "og-late" }))
          assert.isTrue(Option.isNone(yield* Fiber.await(reopened).pipe(Effect.timeoutOption(50))))
          held.writes = false
          yield* Deferred.succeed(written, undefined)
          assert.strictEqual((yield* Fiber.join(reopened)).graph, "og-late")
          assert.strictEqual(
            (yield* reopening.GetBlock({ blockId: block.id })).text,
            "We recorded a [[voice note]].",
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
