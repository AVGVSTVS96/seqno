import { Crypto, Effect, Option, PlatformError, Result, Schema } from "effect"
import {
  BlockId,
  newBlockId,
  newPageId,
  normalizePageName,
  type Block,
  type JournalDay,
  type PageId,
} from "@seqno/domain"
import { PageTree } from "@seqno/rpc"
import { LogseqConfig, defaultConfig, parseConfig } from "./config.ts"
import { formatJournalDay, parseJournalDay } from "./dates.ts"
import { titleFromFileBody } from "./filenames.ts"
import { GraphFolder } from "./folder.ts"
import { LogseqSyntax, type OutlineBlock } from "./outline.ts"

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

interface Source {
  readonly path: string
  readonly body: string
  readonly journal: boolean
}

const configPath = "logseq/config.edn"
const placeholder = /^\.(.+)\.icloud$/
const markdown = /\.(md|markdown)$/i

const within = (path: string, directory: string) =>
  directory === "" || path === directory || path.startsWith(`${directory}/`)

const classify = (
  path: string,
  config: LogseqConfig,
): Option.Option<Result.Result<Source, ImportIssue>> => {
  const nfc = path.normalize("NFC")
  const slash = nfc.lastIndexOf("/")
  const name = nfc.slice(slash + 1)
  const journal = within(nfc, config.journalsDirectory)
  if ((!journal && !within(nfc, config.pagesDirectory)) || slash === -1) return Option.none()
  if (config.hidden.some((directory) => within(nfc, directory))) return Option.none()
  const evicted = placeholder.exec(name)
  if (evicted !== null) {
    return Option.some(
      Result.fail(
        ImportIssue.cases.NotDownloaded.make({ path: `${nfc.slice(0, slash + 1)}${evicted[1]}` }),
      ),
    )
  }
  if (name.startsWith(".")) return Option.none()
  if (!markdown.test(name))
    return Option.some(Result.fail(ImportIssue.cases.Unsupported.make({ path })))
  return Option.some(Result.succeed({ path, body: name.replace(markdown, ""), journal }))
}

const journalDayOf = (source: Source, config: LogseqConfig): Option.Option<JournalDay> =>
  source.journal
    ? Option.orElse(parseJournalDay(source.body, config.journalFileFormat), () =>
        parseJournalDay(source.body, defaultConfig.journalFileFormat),
      )
    : Option.none()

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

export const importGraph = Effect.gen(function* () {
  const folder = yield* GraphFolder
  const syntax = yield* LogseqSyntax
  const files = yield* folder.list
  const config = files.includes(configPath)
    ? parseConfig(yield* folder.read(configPath))
    : defaultConfig
  const issues: Array<ImportIssue> = []
  const pages: Array<PageTree> = []
  const pageNames = new Set<string>()
  const keptIds = new Set<string>()
  const sourceIds = new Set<string>()

  const blockIdFor = (block: OutlineBlock, path: string) =>
    Effect.gen(function* () {
      const written = block.props["id"]
      if (written !== undefined && sourceIds.has(written.toLowerCase())) {
        issues.push(ImportIssue.cases.DuplicateBlockId.make({ path, id: written }))
      }
      if (written !== undefined) sourceIds.add(written.toLowerCase())
      const kept = Option.filter(decodeBlockId(written), (id) => !keptIds.has(id))
      const id = Option.isSome(kept) ? kept.value : yield* newBlockId
      keptIds.add(id)
      return id
    })

  const flatten = (
    blocks: ReadonlyArray<OutlineBlock>,
    pageId: PageId,
    parentId: BlockId | null,
    path: string,
  ): Effect.Effect<ReadonlyArray<Block>, PlatformError.PlatformError, Crypto.Crypto> =>
    Effect.map(
      Effect.forEach(blocks, (block) =>
        Effect.gen(function* () {
          const id = yield* blockIdFor(block, path)
          const own: Block = {
            id,
            pageId,
            parentId,
            text: block.text,
            collapsed: block.collapsed,
            props: block.props,
          }
          return [own, ...(yield* flatten(block.children, pageId, id, path))]
        }),
      ),
      (nested) => nested.flat(),
    )

  for (const path of files) {
    const classified = classify(path, config)
    if (Option.isNone(classified)) continue
    if (Result.isFailure(classified.value)) {
      issues.push(classified.value.failure)
      continue
    }
    const source = classified.value.success
    const read = yield* Effect.result(folder.read(source.path))
    if (Result.isFailure(read)) {
      issues.push(ImportIssue.cases.Unreadable.make({ path, reason: read.failure.reason }))
      continue
    }
    const outline = syntax.parse(read.success)
    const journalDay = journalDayOf(source, config)
    const fileTitle = Option.match(journalDay, {
      onNone: () => titleFromFileBody(source.body, config.fileNameFormat),
      onSome: (day) => formatJournalDay(day, config.journalTitleFormat),
    })
    const title = outline.props["title"]?.trim() || fileTitle
    const name = normalizePageName(title)
    if (name === "") {
      issues.push(ImportIssue.cases.Unsupported.make({ path }))
      continue
    }
    if (pageNames.has(name)) {
      issues.push(ImportIssue.cases.DuplicatePage.make({ path, name }))
      continue
    }
    pageNames.add(name)
    const pageId = yield* newPageId
    const blocks = yield* flatten(outline.blocks, pageId, null, path)
    pages.push({
      page: {
        id: pageId,
        name,
        title,
        journalDay: Option.getOrNull(journalDay),
        props: outline.props,
      },
      blocks,
    })
  }
  return { config, pages, issues }
})
