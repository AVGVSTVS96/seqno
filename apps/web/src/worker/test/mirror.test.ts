import { cp, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option, Stream } from "effect"
import { RpcTest } from "effect/rpc"
import { DeviceId } from "@seqno/domain"
import { Graph, PeerId, vaultReplica } from "@seqno/graph"
import { layerNode } from "@seqno/index/node"
import { AssetRpcs, CoreRpcs, PageRpcs } from "@seqno/rpc"
import { Vault, layer as vaultLayer, type Storage } from "@seqno/vault"
import { layerNode as nodeVault, nodeStorage } from "@seqno/vault/node"
import { RealCore } from "../core.ts"
import { layerGitDeviceMemory } from "../git.ts"
import { layerWebLocks } from "../lock.ts"
import type { Layout } from "../layout.ts"
import { memoryMirrorStore, type MirrorStore } from "../mirror-store.ts"
import { Device, GraphPlaces } from "../place.ts"

const graphs = fileURLToPath(new URL("../../../../../fixtures/graphs/", import.meta.url))

const layout: Layout = "OneTree"

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the core"),
  }),
)

const fileOf = (storage: Storage["Service"], root: string) => (path: string) =>
  Effect.flatMap(storage.read(path), (bytes) =>
    Effect.map(
      Effect.option(Effect.promise(() => stat(join(root, ...path.split("/"))))),
      (info) =>
        new File([new Uint8Array(bytes)], path.split("/").at(-1) ?? path, {
          lastModified: Option.match(info, { onNone: () => 0, onSome: (found) => found.mtimeMs }),
        }),
    ),
  )

const stores = new Map<string, MirrorStore>()
const storeOf = (key: string) => {
  const found = stores.get(key) ?? memoryMirrorStore()
  stores.set(key, found)
  return found
}

const AllRpcs = CoreRpcs.merge(PageRpcs, AssetRpcs)

const coreOn = (root: string, device = "laptop", storage = nodeStorage(root)) =>
  Effect.gen(function* () {
    const handlers = yield* Layer.build(
      RealCore.pipe(
        Layer.provide(
          Layer.succeed(GraphPlaces, {
            open: () =>
              Effect.succeed({
                storage,
                file: fileOf(storage, root),
                layout,
                synced: true,
                sqlite: layerNode(),
                indexFile: { read: Effect.succeedNone, write: () => Effect.void },
                mirrorStore: storeOf(`${device}:${root}`),
                changed: Stream.empty,
                starter: null,
              }),
            forget: () => Effect.void,
          }),
        ),
        Layer.provide(Layer.succeed(Device, { device: DeviceId.make(device), formerPeers: [] })),
        Layer.provide(layerGitDeviceMemory),
        Layer.provide(layerWebLocks),
        Layer.provide(WebCrypto),
      ),
    )
    return yield* Effect.provide(RpcTest.makeClient(AllRpcs), handlers)
  })

const tempFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-mirror-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

const copyOf = (name: string) =>
  Effect.tap(tempFolder, (root) =>
    Effect.promise(() => cp(join(graphs, name), root, { recursive: true })),
  )

const pageFiles = (root: string) =>
  Effect.promise(async () => {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split("\\").join("/"))
      .filter((path) => /^(journals|pages|whiteboards|logseq)\//.test(path))
      .toSorted()
    return Object.fromEntries(
      await Promise.all(
        files.map(async (path) => [path, await readFile(join(root, path), "utf8")]),
      ),
    )
  })

const folderWith = (files: Readonly<Record<string, string>>) =>
  Effect.tap(tempFolder, (root) =>
    Effect.promise(async () => {
      for (const [path, text] of Object.entries(files)) {
        await mkdir(join(root, ...path.split("/").slice(0, -1)), { recursive: true })
        await writeFile(join(root, path), text)
      }
    }),
  )

const logseqWrites = (
  root: string,
  path: string,
  text: string,
  meanwhile: () => Effect.Effect<void, unknown>,
) =>
  Effect.gen(function* () {
    const handle = yield* Effect.promise(() => open(join(root, path), "r+"))
    const bytes = Buffer.from(text)
    const half = Math.floor(bytes.length / 2)
    yield* Effect.promise(() => handle.truncate(0))
    yield* Effect.promise(() => handle.write(bytes.subarray(0, half), 0, half, 0))
    yield* Effect.orDie(meanwhile())
    yield* Effect.sleep("300 millis")
    yield* Effect.promise(() => handle.write(bytes.subarray(half), 0, bytes.length - half, half))
    yield* Effect.promise(() => handle.close())
  })

const read = (root: string, path: string) =>
  Effect.promise(() => readFile(join(root, path), "utf8").catch(() => null))

const until = <A>(check: Effect.Effect<A>, done: (value: A) => boolean, seconds = 15) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < seconds * 10; tries++) {
      const value = yield* check
      if (done(value)) return value
      yield* Effect.sleep("100 millis")
    }
    return yield* check
  })

const settled = (root: string, device = "laptop") =>
  until(storeOf(`${device}:${root}`).version, Option.isSome)

const onPhone = (root: string, edit: (graph: Graph["Service"]) => Effect.Effect<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const phone = DeviceId.make("phone")
      const graph = Context.get(
        yield* Layer.build(
          Graph.layer({ peer: PeerId.make("4242"), snapshot: Option.none(), updates: [] }).pipe(
            Layer.provide(WebCrypto),
          ),
        ),
        Graph,
      )
      const vault = Context.get(
        yield* Layer.build(
          vaultLayer({
            device: phone,
            members: [phone],
            compactAfterFiles: 1e6,
            compactEvery: 0,
          }).pipe(Layer.provide(nodeVault(root))),
        ),
        Vault,
      )
      yield* Effect.orDie(vault.sync(vaultReplica(graph)))
      yield* edit(graph)
      yield* graph.flush((update) => Effect.orDie(vault.writeUpdate(update.bytes)))
    }),
  )

const share = (from: string, to: string) =>
  Effect.promise(async () => {
    for (const dir of ["updates", "snapshots", "seen"]) {
      await cp(join(from, dir), join(to, dir), { recursive: true, force: false }).catch(
        () => undefined,
      )
    }
  })

const named = <A extends { readonly title: string }>(items: ReadonlyArray<A>, title: string) =>
  items.find((item) => item.title === title) ?? assert.fail(`no page titled ${title}`)

const fixtures = [
  "og-syntax-mix",
  "org-and-front-matter",
  "whiteboards",
  "showcase",
  "duplicated-block-ids",
  "empty-files",
  "forward-block-refs",
  "recursive-block-refs",
  "legacy-journal-file-refs",
  "pdf-highlights",
]

describe("the markdown mirror", () => {
  it.live(
    "turning it on rewrites none of a Logseq folder's files",
    () =>
      Effect.gen(function* () {
        const changed: Array<string> = []
        for (const name of fixtures) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const root = yield* copyOf(name)
              const before = yield* pageFiles(root)
              const core = yield* coreOn(root)
              yield* core.OpenGraph({ graph: name })
              yield* settled(root)
              yield* Effect.sleep("2500 millis")
              const after = yield* pageFiles(root)
              for (const [path, text] of Object.entries(before)) {
                if (after[path] !== text) changed.push(`${name}/${path}`)
              }
              for (const path of Object.keys(after)) {
                if (!(path in before) && path !== "logseq/config.edn")
                  changed.push(`${name}/+${path}`)
              }
            }),
          )
        }
        assert.deepStrictEqual(changed, [])
      }),
    120_000,
  )

  it.live(
    "an edit reaches its page's file within two seconds, and no other file changes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          yield* settled(root)
          const before = yield* pageFiles(root)
          const tasks = yield* core.GetPage({ pageId: named(yield* core.GetPages(), "tasks").id })
          const voice = tasks.blocks[2] ?? assert.fail("tasks has no third block")
          yield* core.Dispatch({
            command: { _tag: "EditText", blockId: voice.id, from: 0, to: 1, insert: "We" },
          })
          const expected = (before["pages/tasks.md"] ?? "")
            .replace(
              "- I recorded a [[voice note]].\n  - TODO",
              "- We recorded a [[voice note]].\n\t- TODO",
            )
            .trimEnd()
          const started = Date.now()
          yield* until(read(root, "pages/tasks.md"), (text) => text === expected)
          const took = Date.now() - started
          const after = yield* pageFiles(root)
          const others = Object.keys(before).filter(
            (path) => path !== "pages/tasks.md" && after[path] !== before[path],
          )
          assert.deepStrictEqual(
            { tasks: after["pages/tasks.md"], others, inTime: took < 2000 },
            { tasks: expected, others: [], inTime: true },
          )
        }),
      ),
    30_000,
  )

  it.live(
    "a ref to a block on another page writes the block's id:: into that page's file",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          yield* settled(root)
          const pages = yield* core.GetPages()
          const tasks = yield* core.GetPage({ pageId: named(pages, "tasks").id })
          const target = tasks.blocks[1] ?? assert.fail("tasks has no second block")
          const headings = yield* core.GetPage({ pageId: named(pages, "headings").id })
          const source = headings.blocks[0] ?? assert.fail("headings has no block")
          yield* core.Dispatch({
            command: {
              _tag: "EditText",
              blockId: source.id,
              from: source.text.length,
              to: source.text.length,
              insert: ` ((${target.id}))`,
            },
          })
          const tasksFile = yield* until(read(root, "pages/tasks.md"), (text) =>
            (text ?? "").includes(`id:: ${target.id}`),
          )
          assert.include(tasksFile ?? "", `- DONE\n  id:: ${target.id}\n`)
        }),
      ),
    30_000,
  )

  it.live(
    "a rename writes the new file and moves the old one to logseq/.recycle",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          yield* settled(root)
          const before = yield* pageFiles(root)
          const queries = named(yield* core.GetPages(), "queries")
          yield* core.Dispatch({
            command: { _tag: "RenamePage", pageId: queries.id, title: "Saved queries" },
          })
          const moved = yield* until(read(root, "pages/Saved queries.md"), (text) => text !== null)
          const recycled = yield* until(
            read(root, "logseq/.recycle/pages_queries.md"),
            (text) => text !== null,
          )
          assert.deepStrictEqual(
            {
              moved,
              recycled,
              old: yield* read(root, "pages/queries.md"),
            },
            {
              moved: (before["pages/queries.md"] ?? "").trimEnd(),
              recycled: before["pages/queries.md"],
              old: null,
            },
          )
        }),
      ),
    30_000,
  )

  it.live(
    "a rename made before the mirror's first pass still moves the file, and adds no page",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          const before = yield* pageFiles(root)
          const queries = named(yield* core.GetPages(), "queries")
          yield* core.Dispatch({
            command: { _tag: "RenamePage", pageId: queries.id, title: "Saved queries" },
          })
          const recycled = yield* until(
            read(root, "logseq/.recycle/pages_queries.md"),
            (text) => text !== null,
          )
          yield* settled(root)
          const titles = (yield* core.GetPages()).map((page) => page.title)
          assert.deepStrictEqual(
            {
              moved: yield* read(root, "pages/Saved queries.md"),
              recycled,
              old: yield* read(root, "pages/queries.md"),
              pages: titles.filter((title) => title.toLowerCase().includes("queries")),
            },
            {
              moved: (before["pages/queries.md"] ?? "").trimEnd(),
              recycled: before["pages/queries.md"] ?? "",
              old: null,
              pages: ["Saved queries"],
            },
          )
        }),
      ),
    30_000,
  )

  it.live(
    "a page whose file names it apart from its title keeps writing to that file",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          yield* settled(root)
          const before = yield* pageFiles(root)
          const pages = yield* core.GetPages()
          const page =
            pages.find((one) => one.props["title"] !== undefined) ?? assert.fail("no titled page")
          const tree = yield* core.GetPage({ pageId: page.id })
          const last = tree.blocks.at(-1) ?? assert.fail("the titled page has no block")
          yield* core.Dispatch({
            command: {
              _tag: "EditText",
              blockId: last.id,
              from: last.text.length,
              to: last.text.length,
              insert: " (edited)",
            },
          })
          const text = yield* until(read(root, "pages/file name differs.md"), (found) =>
            (found ?? "").includes("(edited)"),
          )
          const after = yield* pageFiles(root)
          assert.deepStrictEqual(
            {
              edited: (text ?? "").includes("(edited)"),
              added: Object.keys(after).filter((path) => !(path in before)),
            },
            { edited: true, added: [] },
          )
        }),
      ),
    30_000,
  )

  it.live(
    "Logseq desktop's half-written save merges in once, next to an edit made in seqno meanwhile",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folderWith({ "pages/plans.md": "- a\n- b\n\t- b1\n- c" })
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "plans" })
          yield* settled(root)
          const before = yield* core.GetPage({ pageId: named(yield* core.GetPages(), "plans").id })
          const id = (text: string) =>
            before.blocks.find((block) => block.text === text)?.id ?? assert.fail(`no ${text}`)
          const saved = "- b edited in Logseq\n\t- b1\n\t- b2 added in Logseq\n- c"
          yield* logseqWrites(root, "pages/plans.md", saved, () =>
            Effect.asVoid(
              core.Dispatch({
                command: {
                  _tag: "EditText",
                  blockId: id("c"),
                  from: 1,
                  to: 1,
                  insert: " typed in seqno",
                },
              }),
            ),
          )
          const merged = "- b edited in Logseq\n\t- b1\n\t- b2 added in Logseq\n- c typed in seqno"
          yield* until(read(root, "pages/plans.md"), (text) => text === merged, 20)
          const after = yield* core.GetPage({ pageId: before.page.id })
          const status = yield* Effect.orDie(Stream.runHead(core.WatchMirror()))
          assert.deepStrictEqual(
            {
              file: (yield* read(root, "pages/plans.md")) ?? "no file",
              blocks: after.blocks.map((block) => [block.id, block.parentId ?? "top", block.text]),
              left: Option.match(status, {
                onNone: () => ["no status"],
                onSome: (found) => found.left.map((file) => file.path),
              }),
            },
            {
              file: merged,
              blocks: [
                [id("b"), "top", "b edited in Logseq"],
                [id("b1"), id("b"), "b1"],
                [after.blocks[2]?.id ?? "missing", id("b"), "b2 added in Logseq"],
                [id("c"), "top", "c typed in seqno"],
              ],
              left: new Array<string>(),
            },
          )
        }),
      ),
    40_000,
  )

  it.live(
    "a page made, and a page deleted, in Logseq desktop are made and deleted in seqno",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folderWith({ "pages/plans.md": "- a", "pages/old.md": "- gone soon" })
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "plans" })
          yield* settled(root)
          yield* Effect.promise(() =>
            writeFile(join(root, "pages", "fresh.md"), "- hello\n\t- child"),
          )
          yield* Effect.promise(() => rm(join(root, "pages", "old.md")))
          yield* core.CheckFiles()
          const titles = yield* until(
            Effect.map(Effect.orDie(core.GetPages()), (pages) =>
              pages.map((page) => page.title).toSorted(),
            ),
            (found) => found.includes("fresh") && !found.includes("old"),
          )
          const fresh = yield* core.GetPage({ pageId: named(yield* core.GetPages(), "fresh").id })
          yield* Effect.sleep("2500 millis")
          assert.deepStrictEqual(
            {
              titles: titles.filter((title) => ["fresh", "old", "plans"].includes(title)),
              fresh: fresh.blocks.map((block) => block.text),
              files: yield* pageFiles(root),
            },
            {
              titles: ["fresh", "plans"],
              fresh: ["hello", "child"],
              files: {
                "logseq/config.edn": yield* read(root, "logseq/config.edn"),
                "pages/fresh.md": "- hello\n\t- child",
                "pages/plans.md": "- a",
              },
            },
          )
        }),
      ),
    40_000,
  )

  it.live(
    "a page file that appears empty and fills in later gets its blocks",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folderWith({ "pages/plans.md": "- a" })
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "plans" })
          yield* settled(root)
          yield* Effect.promise(() => writeFile(join(root, "pages", "late.md"), ""))
          yield* core.CheckFiles()
          yield* until(
            Effect.map(Effect.orDie(core.GetPages()), (pages) =>
              pages.some((page) => page.title === "late"),
            ),
            (found) => found,
          )
          yield* Effect.promise(() =>
            writeFile(join(root, "pages", "late.md"), "- hello\n\t- child"),
          )
          yield* core.CheckFiles()
          const late = named(yield* core.GetPages(), "late")
          const blocks = yield* until(
            Effect.map(Effect.orDie(core.GetPage({ pageId: late.id })), (tree) =>
              tree.blocks.map((block) => block.text),
            ),
            (texts) => texts.length === 2,
          )
          assert.deepStrictEqual(blocks, ["hello", "child"])
        }),
      ),
    40_000,
  )

  it.live(
    "a device that imports the files before the folder's history arrives never doubles a block",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const laptopRoot = yield* folderWith({ "pages/plans.md": "- a\n- b" })
          const laptop = yield* coreOn(laptopRoot, "laptop")
          yield* laptop.OpenGraph({ graph: "plans" })
          yield* settled(laptopRoot, "laptop")
          const plans = named(yield* laptop.GetPages(), "plans")
          const first = (yield* laptop.GetPage({ pageId: plans.id })).blocks[0]
          if (first === undefined) return assert.fail("plans has no block")
          yield* laptop.Dispatch({
            command: { _tag: "EditText", blockId: first.id, from: 1, to: 1, insert: " edited" },
          })
          yield* until(read(laptopRoot, "pages/plans.md"), (text) => text === "- a edited\n- b")
          const phoneRoot = yield* tempFolder
          yield* Effect.promise(() =>
            cp(join(laptopRoot, "pages"), join(phoneRoot, "pages"), { recursive: true }),
          )
          const phone = yield* coreOn(phoneRoot, "phone")
          yield* phone.OpenGraph({ graph: "plans on the phone" })
          yield* settled(phoneRoot, "phone")
          yield* share(laptopRoot, phoneRoot)
          yield* share(phoneRoot, laptopRoot)
          yield* Effect.sleep("12 seconds")
          const outline = (core: typeof laptop) =>
            Effect.gen(function* () {
              const pages = (yield* core.GetPages()).filter((page) => page.title === "plans")
              const trees = yield* Effect.forEach(pages, (page) =>
                core.GetPage({ pageId: page.id }),
              )
              return trees.map((tree) => tree.blocks.map((block) => block.text))
            })
          assert.deepStrictEqual(
            { laptop: yield* outline(laptop), phone: yield* outline(phone) },
            { laptop: [["a edited", "b"]], phone: [["a edited", "b"]] },
          )
        }),
      ),
    60_000,
  )

  it.live(
    "two devices on one folder settle on one writer, and writing moves when the other device asks",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folderWith({ "pages/plans.md": "- a\n- b" })
          const laptop = yield* coreOn(root, "laptop")
          const phone = yield* coreOn(root, "phone")
          yield* Effect.all(
            [
              laptop.OpenGraph({ graph: "plans" }),
              phone.OpenGraph({ graph: "plans on the phone" }),
            ],
            { concurrency: 2 },
          )
          const writerOn = (core: typeof laptop) =>
            Effect.map(Effect.orDie(Stream.runHead(core.WatchMirror())), (status) =>
              Option.getOrNull(Option.map(status, (found) => found.writer)),
            )
          const both = Effect.all({ laptop: writerOn(laptop), phone: writerOn(phone) })
          const settledOn = yield* until(
            both,
            (found) => found.laptop?.device === "laptop" && found.phone?.device === "laptop",
            20,
          )
          const edit = (core: typeof laptop, insert: string) =>
            Effect.gen(function* () {
              const plans = named(yield* core.GetPages(), "plans")
              const first = (yield* core.GetPage({ pageId: plans.id })).blocks[0]
              if (first === undefined) return yield* Effect.die("plans has no block")
              yield* core.Dispatch({
                command: { _tag: "EditText", blockId: first.id, from: 1, to: 1, insert },
              })
            })
          yield* edit(phone, " from the phone")
          const viaLaptop = yield* until(
            read(root, "pages/plans.md"),
            (text) => text === "- a from the phone\n- b",
            20,
          )
          yield* phone.WriteFilesHere()
          const movedTo = yield* until(
            both,
            (found) => found.laptop?.device === "phone" && found.phone?.device === "phone",
            20,
          )
          yield* edit(laptop, " and the laptop")
          const viaPhone = yield* until(
            read(root, "pages/plans.md"),
            (text) => text === "- a and the laptop from the phone\n- b",
            25,
          )
          assert.deepStrictEqual(
            { settledOn, viaLaptop, movedTo, viaPhone },
            {
              settledOn: {
                laptop: { device: "laptop", here: true },
                phone: { device: "laptop", here: false },
              },
              viaLaptop: "- a from the phone\n- b",
              movedTo: {
                laptop: { device: "phone", here: false },
                phone: { device: "phone", here: true },
              },
              viaPhone: "- a and the laptop from the phone\n- b",
            },
          )
        }),
      ),
    90_000,
  )

  it.live(
    "pages/ going missing pauses the mirror and deletes nothing",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folderWith({ "pages/a.md": "- a", "pages/b.md": "- b" })
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "ab" })
          yield* settled(root)
          yield* Effect.promise(() => rm(join(root, "pages"), { recursive: true }))
          yield* core.CheckFiles()
          const status = yield* until(
            Effect.map(Effect.orDie(Stream.runHead(core.WatchMirror())), Option.getOrNull),
            (found) => found?.paused !== null && found?.paused !== undefined,
          )
          const titles = (yield* core.GetPages()).map((page) => page.title)
          assert.deepStrictEqual(
            { paused: status?.paused, kept: ["a", "b"].map((title) => titles.includes(title)) },
            {
              paused:
                "seqno stopped writing Logseq's files: the folder pages is gone, which looks like the graph's folder moved or isn't available. Nothing in seqno was deleted.",
              kept: [true, true],
            },
          )
        }),
      ),
    40_000,
  )

  it.live(
    "another device's edit reaches the file once this device merges it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* copyOf("og-syntax-mix")
          const core = yield* coreOn(root)
          yield* core.OpenGraph({ graph: "og" })
          yield* settled(root)
          yield* onPhone(root, (graph) =>
            Effect.gen(function* () {
              const pages = yield* graph.pages
              const tasks = pages.find((page) => page.title === "tasks") ?? assert.fail("no tasks")
              const tree = yield* Effect.orDie(graph.page(tasks.id))
              const first = tree.blocks[0] ?? assert.fail("tasks has no block")
              yield* Effect.orDie(
                graph.dispatch({
                  _tag: "EditText",
                  blockId: first.id,
                  from: 4,
                  to: 4,
                  insert: " from the phone",
                }),
              )
            }),
          )
          const text = yield* until(
            read(root, "pages/tasks.md"),
            (found) => (found ?? "").startsWith("- TODO from the phone\n"),
            20,
          )
          assert.isTrue((text ?? "").startsWith("- TODO from the phone\n- DONE\n"))
        }),
      ),
    40_000,
  )
})
