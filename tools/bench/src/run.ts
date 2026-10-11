import { Context, Crypto, Effect, Layer, Option } from "effect"
import type { Command } from "@seqno/domain"
import { generateGraph, toLogseqFiles } from "@seqno/fixtures"
import { Graph, PeerId } from "@seqno/graph"
import { Index } from "@seqno/index"
import { layerNode } from "@seqno/index/node"
import { GraphFolder, LogseqSyntaxLive, importGraph } from "@seqno/interop"

const budgets = { openMs: 1000, keystrokeP95Ms: 16 }
const OPENS = 3
const KEYSTROKES = 300

const WebCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: () => Effect.die("digest is not used by the graph"),
  }),
)

const serviceOf = <I, S, E>(tag: Context.Key<I, S>, layer: Layer.Layer<I, E>) =>
  Effect.map(Layer.build(layer), (context) => Context.get(context, tag))

const emptyGraph = (peer: string) =>
  serviceOf(
    Graph,
    Graph.layer({ peer: PeerId.make(peer), snapshot: Option.none(), updates: [] }).pipe(
      Layer.provide(WebCrypto),
    ),
  )

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

const snapshotOfGenerated = Effect.gen(function* () {
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
  const graph = yield* emptyGraph("1")
  yield* graph.seed(imported.pages)
  return yield* graph.snapshot
})

const open = (snapshot: Uint8Array, peer: string) =>
  Effect.gen(function* () {
    const graph = yield* emptyGraph(peer)
    yield* graph.restore([snapshot])
    const pages = yield* graph.pages
    const journal = pages.find((page) => page.journalDay !== null) ?? pages[0]
    if (journal === undefined) return yield* Effect.die("the generated graph has no pages")
    const first = yield* graph.page(journal.id)
    return { graph, first }
  })

const main = Effect.gen(function* () {
  const [snapshot, seedMs] = yield* timed(snapshotOfGenerated)
  const opens: Array<number> = []
  for (let run = 0; run < OPENS; run++) {
    const [, ms] = yield* timed(Effect.scoped(open(snapshot, String(10 + run))))
    opens.push(ms)
  }
  const { graph, first } = yield* open(snapshot, "20")
  const index = yield* serviceOf(Index, Index.layer.pipe(Layer.provide(layerNode())))
  const [, fillMs] = yield* timed(index.fill(graph.everything))
  const block = first.blocks[0]
  if (block === undefined) return yield* Effect.die("the first journal has no blocks")
  const keystrokes: Array<number> = []
  for (let at = 0; at < KEYSTROKES; at++) {
    const command: Command = { _tag: "EditText", blockId: block.id, from: at, to: at, insert: "x" }
    const [, ms] = yield* timed(
      Effect.flatMap(graph.dispatch(command), (events) => index.apply(events, String(at))),
    )
    keystrokes.push(ms)
  }
  const rows = [
    { what: "open: page list and first page (median)", ms: median(opens), budget: budgets.openMs },
    {
      what: "keystroke: edit and index write (p95)",
      ms: p95(keystrokes),
      budget: budgets.keystrokeP95Ms,
    },
    { what: "import and seed", ms: seedMs, budget: null },
    { what: "index fill behind the open", ms: fillMs, budget: null },
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
