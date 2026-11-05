import { Effect, Option, Result, Schema } from "effect"
import { BlockId, normalizePageName } from "@seqno/domain"
import type { PageId } from "@seqno/domain"
import { PageTree } from "@seqno/rpc"
import { LogseqConfig, defaultConfig, parseConfig } from "./config.ts"
import { classify, configPath, readFile } from "./files.ts"
import type { PageFile } from "./files.ts"
import { GraphFolder } from "./folder.ts"
import { contentSeed, seededIds } from "./ids.ts"
import { LogseqSyntax } from "./outline.ts"

export const ImportIssue = Schema.TaggedUnion({
  NotDownloaded: { path: Schema.String },
  Unreadable: { path: Schema.String, reason: Schema.String },
  Unsupported: { path: Schema.String },
  DuplicatePage: { path: Schema.String, name: Schema.String },
  DuplicateBlockId: { path: Schema.String, id: Schema.String },
})

export type ImportIssue = typeof ImportIssue.Type

export const ImportedGraph = Schema.Struct({
  config: LogseqConfig,
  pages: Schema.Array(PageTree),
  issues: Schema.Array(ImportIssue),
})

export type ImportedGraph = typeof ImportedGraph.Type

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

export const importGraph = Effect.gen(function* () {
  const folder = yield* GraphFolder
  const syntax = yield* LogseqSyntax
  const files = yield* folder.list
  const configText = files.includes(configPath) ? yield* folder.read(configPath) : null
  const config = configText === null ? defaultConfig : parseConfig(configText)
  const issues: ImportIssue[] = []
  const pages: PageTree[] = []
  const pageNames = new Set<string>()
  const keptIds = new Set<string>()
  const sourceIds = new Set<string>()

  const sources: Array<readonly [PageFile, string]> = []

  for (const path of files) {
    const classified = classify(path, config)

    if (Option.isNone(classified)) {
      continue
    }

    if (Result.isFailure(classified.value)) {
      const { path: issuePath, evicted } = classified.value.failure
      issues.push(
        evicted
          ? ImportIssue.cases.NotDownloaded.make({ path: issuePath })
          : ImportIssue.cases.Unsupported.make({ path: issuePath }),
      )
      continue
    }

    const source = classified.value.success
    const read = yield* Effect.result(folder.read(source.path))

    if (Result.isFailure(read)) {
      issues.push(ImportIssue.cases.Unreadable.make({ path, reason: read.failure.reason }))
      continue
    }

    sources.push([source, read.success])
  }

  const ids = seededIds(
    yield* contentSeed([
      configText ?? "",
      ...sources.flatMap(([source, text]) => [source.path, text]),
    ]),
  )

  const blockIdFor = (path: string) => (written: string | undefined) => {
    if (written !== undefined && sourceIds.has(written.toLowerCase())) {
      issues.push(ImportIssue.cases.DuplicateBlockId.make({ path, id: written }))
    }

    if (written !== undefined) {
      sourceIds.add(written.toLowerCase())
    }

    const kept = Option.filter(decodeBlockId(written), (id) => !keptIds.has(id))
    const id = Option.isSome(kept) ? kept.value : ids.block()
    keptIds.add(id)

    return id
  }

  const claim = (path: string, title: string): Option.Option<{ id: PageId; name: string }> => {
    const name = normalizePageName(title)

    if (name === "") {
      issues.push(ImportIssue.cases.Unsupported.make({ path }))

      return Option.none()
    }

    if (pageNames.has(name)) {
      issues.push(ImportIssue.cases.DuplicatePage.make({ path, name }))

      return Option.none()
    }

    pageNames.add(name)

    return Option.some({ id: ids.page(), name })
  }

  for (const [source, text] of sources) {
    const path = source.path
    const read = readFile(source, text, config, syntax)

    if (Result.isFailure(read)) {
      issues.push(ImportIssue.cases.Unreadable.make({ path, reason: read.failure }))
      continue
    }

    const claimed = claim(path, read.success.page.title)

    if (Option.isNone(claimed)) {
      continue
    }

    const { id, name } = claimed.value
    pages.push({
      page: { id, name, ...read.success.page },
      blocks: read.success.blocks(id, blockIdFor(path)),
    })
  }

  return { config, pages, issues }
})
