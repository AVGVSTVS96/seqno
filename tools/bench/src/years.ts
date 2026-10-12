import { Effect, Layer } from "effect"
import { generateGraph, toLogseqFiles } from "@seqno/fixtures"
import type { Graph } from "@seqno/graph"
import { GraphFolder, LogseqSyntaxLive, importGraph } from "@seqno/interop"

export interface Years {
  readonly years: number
  readonly until: Date
  readonly longPage: number
}

const blocksPerYear = 13_000
const pagesPerYear = 300
const filesPerLoad = 1_000

const dayOf = (date: Date) =>
  date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()

export const importFiles = (
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
) => {
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
  return importGraph.pipe(Effect.provide(Layer.merge(folder, LogseqSyntaxLive)))
}

export const lastBlock = "The long page ends with a quillwort."

export const longPageFiles = (blocks: number) => {
  const generated = generateGraph({
    seed: 7,
    blocks,
    pages: Math.ceil(blocks / 1_000),
    journals: 1,
  })
  const page = { id: "long", name: "Long page", journalDay: null }
  return toLogseqFiles({
    options: generated.options,
    pages: [page],
    blocks: generated.blocks.map((block) => ({ ...block, pageId: page.id })),
  })
    .slice(1)
    .map((file) => ({ ...file, content: `${file.content.trimEnd()}\n- ${lastBlock}\n` }))
}

export const loadYears = (graph: Graph["Service"], { years, until, longPage }: Years) =>
  Effect.gen(function* () {
    const days = Math.round(years * 365.25)
    const first = new Date(until.getFullYear(), until.getMonth(), until.getDate() - days + 1)
    const generated = generateGraph({
      seed: 20261011,
      journals: days,
      pages: Math.round(years * pagesPerYear),
      blocks: Math.round(years * blocksPerYear),
      firstJournalDay: dayOf(first),
    })
    const [config, ...files] = toLogseqFiles(generated)
    const all = longPage > 0 ? [...files, ...longPageFiles(longPage)] : files
    for (let at = 0; at < all.length; at += filesPerLoad) {
      const chunk = all.slice(at, at + filesPerLoad)
      const imported = yield* importFiles(config === undefined ? chunk : [config, ...chunk])
      yield* graph.load(imported.pages)
    }
    return {
      days,
      pages: generated.pages.length + (longPage > 0 ? 1 : 0),
      blocks: generated.blocks.length + longPage,
    }
  })
