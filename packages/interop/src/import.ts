import { Effect, Option, Result, Schema } from "effect"
import { BlockId, normalizePageName, type Block, type JournalDay, type PageId } from "@seqno/domain"
import { PageTree } from "@seqno/rpc"
import { LogseqConfig, defaultConfig, parseConfig } from "./config.ts"
import { formatJournalDay, parseJournalDay } from "./dates.ts"
import { titleFromFileBody } from "./filenames.ts"
import { GraphFolder } from "./folder.ts"
import { contentSeed, seededIds } from "./ids.ts"
import { LogseqSyntax, type OutlineBlock } from "./outline.ts"
import { readWhiteboard, whiteboardBlocks } from "./whiteboard.ts"

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

type Kind = "journal" | "page" | "whiteboard"

interface Source {
  readonly path: string
  readonly body: string
  readonly kind: Kind
  readonly format?: "org"
}

const configPath = "logseq/config.edn"
const placeholder = /^\.(.+)\.icloud$/
const markdown = /\.(md|markdown)$/i
const org = /\.org$/i
const edn = /\.edn$/i

const within = (path: string, directory: string) =>
  directory === "" || path === directory || path.startsWith(`${directory}/`)

const classify = (
  path: string,
  config: LogseqConfig,
): Option.Option<Result.Result<Source, ImportIssue>> => {
  const nfc = path.normalize("NFC")
  const slash = nfc.lastIndexOf("/")
  const name = nfc.slice(slash + 1)
  const kind: Kind | null = within(nfc, config.journalsDirectory)
    ? "journal"
    : within(nfc, config.pagesDirectory)
      ? "page"
      : within(nfc, config.whiteboardsDirectory)
        ? "whiteboard"
        : null
  if (kind === null || slash === -1) return Option.none()
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
  if (kind !== "whiteboard" && org.test(name)) {
    return Option.some(Result.succeed({ path, body: name.replace(org, ""), kind, format: "org" }))
  }
  const extension = kind === "whiteboard" ? edn : markdown
  if (!extension.test(name))
    return Option.some(Result.fail(ImportIssue.cases.Unsupported.make({ path })))
  return Option.some(Result.succeed({ path, body: name.replace(extension, ""), kind }))
}

const journalDayOf = (source: Source, config: LogseqConfig): Option.Option<JournalDay> =>
  source.kind === "journal"
    ? Option.orElse(parseJournalDay(source.body, config.journalFileFormat), () =>
        parseJournalDay(source.body, defaultConfig.journalFileFormat),
      )
    : Option.none()

const decodeBlockId = Schema.decodeUnknownOption(BlockId)

export const importGraph = Effect.gen(function* () {
  const folder = yield* GraphFolder
  const syntax = yield* LogseqSyntax
  const files = yield* folder.list
  const configText = files.includes(configPath) ? yield* folder.read(configPath) : null
  const config = configText === null ? defaultConfig : parseConfig(configText)
  const issues: Array<ImportIssue> = []
  const pages: Array<PageTree> = []
  const pageNames = new Set<string>()
  const keptIds = new Set<string>()
  const sourceIds = new Set<string>()

  const sources: Array<readonly [Source, string]> = []
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
    sources.push([source, read.success])
  }
  const ids = seededIds(
    yield* contentSeed([
      configText ?? "",
      ...sources.flatMap(([source, text]) => [source.path, text]),
    ]),
  )

  const blockIdFor = (written: string | undefined, path: string) => {
    if (written !== undefined && sourceIds.has(written.toLowerCase())) {
      issues.push(ImportIssue.cases.DuplicateBlockId.make({ path, id: written }))
    }
    if (written !== undefined) sourceIds.add(written.toLowerCase())
    const kept = Option.filter(decodeBlockId(written), (id) => !keptIds.has(id))
    const id = Option.isSome(kept) ? kept.value : ids.block()
    keptIds.add(id)
    return id
  }

  const flatten = (
    blocks: ReadonlyArray<OutlineBlock>,
    pageId: PageId,
    parentId: BlockId | null,
    path: string,
  ): ReadonlyArray<Block> =>
    blocks.flatMap((block) => {
      const id = blockIdFor(block.props["id"], path)
      const own: Block = {
        id,
        pageId,
        parentId,
        text: block.text,
        collapsed: block.collapsed,
        props: block.props,
      }
      return [own, ...flatten(block.children, pageId, id, path)]
    })

  const claim = (path: string, title: string) => {
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
    const fileTitle = titleFromFileBody(source.body, config.fileNameFormat)
    if (source.kind === "whiteboard") {
      const read = readWhiteboard(text)
      if (Result.isFailure(read)) {
        issues.push(ImportIssue.cases.Unreadable.make({ path, reason: read.failure }))
        continue
      }
      const board = read.success
      const title = board.title?.trim() || fileTitle
      const claimed = claim(path, title)
      if (Option.isNone(claimed)) continue
      const { id, name } = claimed.value
      pages.push({
        page: { id, name, title, journalDay: null, props: board.props },
        blocks: whiteboardBlocks(board, id, (written) => blockIdFor(written, path)),
      })
      continue
    }
    const outline = syntax.parse(text, source.format)
    const journalDay = journalDayOf(source, config)
    const title =
      outline.props["title"]?.trim() ||
      Option.match(journalDay, {
        onNone: () => fileTitle,
        onSome: (day) => formatJournalDay(day, config.journalTitleFormat),
      })
    const claimed = claim(path, title)
    if (Option.isNone(claimed)) continue
    const { id, name } = claimed.value
    pages.push({
      page: {
        id,
        name,
        title,
        journalDay: Option.getOrNull(journalDay),
        props: outline.props,
        ...(outline.frontMatter === true ? { frontMatter: true } : {}),
        ...(source.format === undefined ? {} : { format: source.format }),
      },
      blocks: flatten(outline.blocks, id, null, path),
    })
  }
  return { config, pages, issues }
})
