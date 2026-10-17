import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Option, Stream } from "effect"
import { DeviceId, type Command, type PageId } from "@seqno/domain"
import { generateGraph, toLogseqFiles } from "@seqno/fixtures"
import { journalsByDay, vaultReplica } from "@seqno/graph"
import { Index } from "@seqno/index"
import { layerNode } from "@seqno/index/node"
import { GraphFolder, LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { bulkOnLongPage } from "./bulk.ts"
import { Vault, layer as vaultLayer, seenPath, snapshotName, snapshotPath } from "@seqno/vault"
import { layerNode as folderStorage, nodeStorage } from "@seqno/vault/node"
import { emptyGraph, emptyPagesGraph, serviceOf } from "./graph.ts"
import { opensInFreshProcess, writeYearsAsPages } from "./pages.ts"
import { undoAfterRemote } from "./undo.ts"

const budgets = {
  openMs: 1000,
  vaultOpenMs: 1000,
  keystrokeP95Ms: 16,
  undoMs: 16,
  bulkMs: 2000,
  reopenIndexMs: 100,
  pagesOpenMs: 300,
  pagesBlockMs: 2000,
}
const OPENS = 3
const KEYSTROKES = 300
const REMOTE_EDITS = 1000
const LONG_PAGE = 20_000
const SELECTED = 5_000
const YEARS = Number(process.env["SEQNO_BENCH_YEARS"] ?? 10)

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const started = performance.now()
    const value = yield* effect
    return [value, performance.now() - started] as const
  })

const median = (values: ReadonlyArray<number>) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
const p95 = (values: ReadonlyArray<number>) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0

type Empty = typeof emptyGraph

interface Layout {
  readonly label: string
  readonly empty: Empty
  readonly incoming: typeof journalsByDay
}

const layouts: ReadonlyArray<Layout> = [
  { label: "", empty: emptyGraph, incoming: (pages) => pages },
  { label: ", a tree per page", empty: emptyPagesGraph, incoming: journalsByDay },
]

const snapshotOfGenerated = ({ empty, incoming }: Layout) =>
  Effect.gen(function* () {
    const files = toLogseqFiles(generateGraph())
    const byPath = new Map(files.map((file) => [file.path, file.content]))
    const folder = Layer.succeed(
      GraphFolder,
      GraphFolder.of({
        list: Effect.succeed([...byPath.keys()].toSorted()),
        read: (path) => Effect.succeed(byPath.get(path) ?? ""),
        write: () => Effect.void,
        remove: () => Effect.void,
      }),
    )
    const imported = yield* importGraph.pipe(Effect.provide(Layer.merge(folder, LogseqSyntaxLive)))
    const graph = yield* empty("1")
    yield* graph.seed(incoming(imported.pages))
    return yield* graph.snapshot
  })

const open = (empty: Empty, snapshot: Uint8Array, peer: string) =>
  Effect.gen(function* () {
    const graph = yield* empty(peer)
    yield* graph.restore([snapshot])
    const pages = yield* graph.pages
    const journal = pages.find((page) => page.journalDay !== null) ?? pages[0]
    if (journal === undefined) return yield* Effect.die("the generated graph has no pages")
    const first = yield* graph.page(journal.id)
    return { graph, first }
  })

const device = DeviceId.make("bench")

const folderOf = (snapshot: Uint8Array, version: ReadonlyMap<string, number>) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "seqno-bench-vault-")))
      const storage = nodeStorage(root)
      const name = yield* Effect.promise(() => snapshotName(device, snapshot))
      yield* storage.write(snapshotPath(name), snapshot)
      const seen = {
        vv: Object.fromEntries(version),
        verified: [],
        snapshots: [[name, Object.fromEntries(version)]],
      }
      yield* storage.write(seenPath(device), new TextEncoder().encode(JSON.stringify(seen)))
      return root
    }),
    (root) => Effect.promise(() => rm(root, { recursive: true })),
  )

const openThroughVault = (empty: Empty, root: string, peer: string) =>
  Effect.gen(function* () {
    const graph = yield* empty(peer)
    const vault = yield* serviceOf(
      Vault,
      vaultLayer({ device, members: [device], compactAfterFiles: 100, compactEvery: 0 }).pipe(
        Layer.provide(folderStorage(root)),
      ),
    )
    yield* vault.sync(vaultReplica(graph))
    const pages = yield* graph.pages
    const journal = pages.find((page) => page.journalDay !== null) ?? pages[0]
    if (journal === undefined) return yield* Effect.die("the generated graph has no pages")
    return yield* graph.page(journal.id)
  })

const written = (graph: Effect.Success<ReturnType<typeof emptyGraph>>, pages: Iterable<PageId>) =>
  Stream.fromIterable(pages).pipe(
    Stream.mapEffect((page) =>
      Effect.map(graph.pageEvents(page), (events) => [page, events] as const),
    ),
  )

const reopenIndex = (
  graph: Effect.Success<ReturnType<typeof emptyGraph>>,
  image: Uint8Array,
  since: ReadonlyMap<string, number>,
) =>
  Effect.gen(function* () {
    const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(layerNode())))
    yield* index.load(image)
    const changed = yield* graph.changedSince(since)
    if (Option.isNone(changed)) return yield* Effect.die("the saved stamp is not in the graph")
    yield* index.owe(
      [...changed.value.pages],
      Effect.map(graph.pages, (pages) => pages.filter((page) => changed.value.pages.has(page.id))),
    )
    yield* index.refresh(written(graph, changed.value.pages))
  })

const onGenerated = (layout: Layout) =>
  Effect.gen(function* () {
    const [snapshot, seedMs] = yield* timed(snapshotOfGenerated(layout))
    const opens: Array<number> = []
    for (let run = 0; run < OPENS; run++) {
      const [, ms] = yield* timed(Effect.scoped(open(layout.empty, snapshot, String(10 + run))))
      opens.push(ms)
    }
    const { graph, first } = yield* open(layout.empty, snapshot, "20")
    const folder = yield* folderOf(snapshot, yield* graph.version)
    const vaultOpens: Array<number> = []
    for (let run = 0; run < OPENS; run++) {
      const [, ms] = yield* timed(
        Effect.scoped(openThroughVault(layout.empty, folder, String(30 + run))),
      )
      vaultOpens.push(ms)
    }
    const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(layerNode())))
    const [, fillMs] = yield* timed(
      Effect.andThen(
        index.start(graph.pages),
        Effect.flatMap(index.unwritten, (pages) => index.refresh(written(graph, pages))),
      ),
    )
    const stamp = yield* graph.version
    const image = yield* index.image(JSON.stringify(Object.fromEntries(stamp)))
    const block = first.blocks[0]
    if (block === undefined) return yield* Effect.die("the first journal has no blocks")
    const keystrokes: Array<number> = []
    for (let at = 0; at < KEYSTROKES; at++) {
      const command: Command = {
        _tag: "EditText",
        blockId: block.id,
        from: at,
        to: at,
        insert: "x",
      }
      const [, ms] = yield* timed(
        Effect.flatMap(graph.dispatch(command), (events) => index.apply(events)),
      )
      keystrokes.push(ms)
    }
    const reopens: Array<number> = []
    for (let run = 0; run < OPENS; run++) {
      const [, ms] = yield* timed(Effect.scoped(reopenIndex(graph, image, stamp)))
      reopens.push(ms)
    }
    const undos = yield* Effect.scoped(undoAfterRemote(snapshot, REMOTE_EDITS, layout.empty))
    const { label } = layout
    return [
      {
        what: `open: page list and first page (median)${label}`,
        ms: median(opens),
        budget: budgets.openMs,
      },
      {
        what: `open through the vault: newest snapshot to first page (median)${label}`,
        ms: median(vaultOpens),
        budget: budgets.vaultOpenMs,
      },
      {
        what: `keystroke: edit and index write (p95)${label}`,
        ms: p95(keystrokes),
        budget: budgets.keystrokeP95Ms,
      },
      {
        what: `undo after ${REMOTE_EDITS} edits from another device (slowest)${label}`,
        ms: Math.max(...undos),
        budget: budgets.undoMs,
      },
      { what: `import and seed${label}`, ms: seedMs, budget: null },
      { what: `index fill behind the open${label}`, ms: fillMs, budget: null },
      {
        what: `index: load the saved image and catch up after typing (median)${label}`,
        ms: median(reopens),
        budget: budgets.reopenIndexMs,
      },
    ]
  }).pipe(Effect.scoped)

const main = Effect.gen(function* () {
  const generated = yield* Effect.forEach(layouts, onGenerated)
  const bulk = yield* bulkOnLongPage(LONG_PAGE, SELECTED)
  const pagesBulk = yield* bulkOnLongPage(LONG_PAGE, SELECTED, emptyPagesGraph)
  const [years, yearsMs] = yield* timed(writeYearsAsPages(YEARS, LONG_PAGE))
  const pagesOpens = yield* Effect.orDie(
    opensInFreshProcess(years.snapshot, { blockId: years.last.id, pageId: years.last.pageId }),
  )
  const ofLongPage = `${SELECTED.toLocaleString("en")} of a ${LONG_PAGE / 1000}k-block page`
  const bulkRows = (layout: string, times: typeof bulk) => [
    { what: `delete ${ofLongPage}${layout}`, ms: times.deleteMs, budget: budgets.bulkMs },
    { what: `undo that delete${layout}`, ms: times.undoMs, budget: budgets.bulkMs },
    { what: `move ${ofLongPage}${layout}`, ms: times.moveMs, budget: budgets.bulkMs },
    { what: `indent ${ofLongPage}${layout}`, ms: times.indentMs, budget: budgets.bulkMs },
  ]
  const rows = [
    ...generated.flat(),
    ...bulkRows("", bulk),
    ...bulkRows(", a tree per page", pagesBulk),
    {
      what: `${YEARS} years, a tree per page: snapshot to page list and today's journal, fresh process (median)`,
      ms: median(pagesOpens.map(({ openMs }) => openMs)),
      budget: budgets.pagesOpenMs,
    },
    {
      what: `${YEARS} years, a tree per page: then the long page's last block, by id and page (median)`,
      ms: median(pagesOpens.map(({ blockMs }) => blockMs)),
      budget: budgets.pagesBlockMs,
    },
    { what: `${YEARS} years, a tree per page: write them`, ms: yearsMs, budget: null },
  ]
  console.table(rows.map((row) => ({ ...row, ms: Math.round(row.ms * 100) / 100 })))
  const over = rows.filter((row) => row.budget !== null && row.ms > row.budget)
  if (over.length > 0) {
    return yield* Effect.die(`over budget: ${over.map((row) => row.what).join(", ")}`)
  }
})

Effect.runPromise(Effect.scoped(main)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
