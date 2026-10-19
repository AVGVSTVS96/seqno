import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect, Layer, Option, Schema } from "effect"
import { PageId } from "@seqno/domain"
import { configFile, generateGraph, logseqPageFiles, toLogseqFiles } from "@seqno/fixtures"
import { journalsByDay } from "@seqno/graph"
import { GraphFolder, LogseqSyntaxLive, importGraph } from "@seqno/interop"
import { emptyGraph, emptyPagesGraph } from "./graph.ts"
import type { Size } from "./size.ts"

export interface Years extends Size {
  readonly until: Date
  readonly longPage: number
}

const blocksPerYear = 13_000
const pagesPerYear = 300
const filesPerLoad = 1_000
const loadsPerSlice = 4

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

export const lastReference = "quillwort"

export const lastWords = "The long page ends with a"

const lastBlock = `${lastWords} [[${lastReference}]].`

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

const longPageId = PageId.make("ffffffff-ffff-7fff-bfff-ffffffffffff")

const lastById: typeof journalsByDay = (pages) =>
  pages.map(({ page, blocks }) => ({
    page: { ...page, id: longPageId },
    blocks: blocks.map((block) => ({ ...block, pageId: longPageId })),
  }))

const chunked = function* <A>(items: Iterable<A>, size: number): Generator<ReadonlyArray<A>> {
  let chunk: Array<A> = []
  for (const item of items) {
    chunk.push(item)
    if (chunk.length === size) {
      yield chunk
      chunk = []
    }
  }
  if (chunk.length > 0) yield chunk
}

export type Layout = "one-tree" | "tree-per-page"

const layouts: Record<
  Layout,
  { readonly empty: typeof emptyGraph; readonly incoming: typeof journalsByDay }
> = {
  "one-tree": { empty: emptyGraph, incoming: (pages) => pages },
  "tree-per-page": { empty: emptyPagesGraph, incoming: journalsByDay },
}

const generatorOptions = ({ years, density, until }: Years) => {
  const days = Math.round(years * 365.25)
  const first = new Date(until.getFullYear(), until.getMonth(), until.getDate() - days + 1)
  return {
    seed: 20261011,
    journals: days,
    pages: Math.round(years * pagesPerYear),
    blocks: Math.round(years * blocksPerYear * density),
    firstJournalDay: dayOf(first),
  }
}

export const shapeOf = (years: Years) => {
  const { journals, pages, blocks } = generatorOptions(years)
  const loads = Math.ceil((pages + journals) / filesPerLoad) + (years.longPage > 0 ? 1 : 0)
  return {
    days: journals,
    pages: pages + journals + (years.longPage > 0 ? 1 : 0),
    blocks: blocks + years.longPage,
    slices: Math.ceil(loads / loadsPerSlice),
  }
}

const loadsOf = function* (years: Years, incoming: typeof journalsByDay) {
  for (const files of chunked(logseqPageFiles(generatorOptions(years)), filesPerLoad)) {
    yield Effect.map(importFiles([configFile, ...files]), ({ pages }) => incoming(pages))
  }
  if (years.longPage > 0) {
    yield Effect.map(importFiles([configFile, ...longPageFiles(years.longPage)]), ({ pages }) =>
      lastById(pages),
    )
  }
}

const sliceOf = <A>(items: Iterable<A>, slice: number): ReadonlyArray<A> => {
  let at = 0
  for (const chunk of chunked(items, loadsPerSlice)) if (at++ === slice) return chunk
  return []
}

const writeSlice = (
  years: Years,
  layout: Layout,
  slice: number,
  before: Option.Option<Uint8Array>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { empty, incoming } = layouts[layout]
      const graph = yield* empty(String(slice + 1))
      if (Option.isSome(before)) yield* graph.restore([before.value])
      for (const load of sliceOf(loadsOf(years, incoming), slice)) yield* graph.load(yield* load)
      return { snapshot: yield* graph.snapshot, version: yield* graph.version }
    }),
  )

const slicePath = (folder: string, slice: number) => join(folder, `${slice}.loro`)

const Version = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Finite))

const heapAboveWasm = "--max-old-space-size=16384"

export const writeSlicesInFreshProcesses = async (folder: string, years: Years, layout: Layout) => {
  let version: typeof Version.Type = {}
  for (let slice = 0; slice < shapeOf(years).slices; slice++) {
    const { stdout } = await promisify(execFile)(process.execPath, [
      heapAboveWasm,
      import.meta.filename,
      folder,
      layout,
      String(years.years),
      String(years.density),
      years.until.toISOString(),
      String(years.longPage),
      String(slice),
    ])
    version = Schema.decodeUnknownSync(Version)(stdout.trim().split("\n").at(-1))
  }
  return { snapshot: await readFile(slicePath(folder, shapeOf(years).slices - 1)), version }
}

if (import.meta.main) {
  const [
    folder = "",
    layout,
    years = "10",
    density = "1",
    until = "",
    longPage = "0",
    slice = "0",
  ] = process.argv.slice(2)
  const at = Number(slice)
  Effect.runPromise(
    Effect.gen(function* () {
      const before =
        at === 0
          ? Option.none()
          : Option.some(yield* Effect.promise(() => readFile(slicePath(folder, at - 1))))
      const written = yield* writeSlice(
        {
          years: Number(years),
          density: Number(density),
          until: new Date(until),
          longPage: Number(longPage),
        },
        layout === "tree-per-page" ? layout : "one-tree",
        at,
        before,
      )
      yield* Effect.promise(() => writeFile(slicePath(folder, at), written.snapshot))
      return Object.fromEntries(written.version)
    }),
  ).then(
    (version) => console.log(JSON.stringify(version)),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
