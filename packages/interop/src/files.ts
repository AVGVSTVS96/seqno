import { Option, Result } from "effect"
import type { Block, BlockId, JournalDay, Page, PageId } from "@seqno/domain"
import { defaultConfig, type LogseqConfig } from "./config.ts"
import { formatJournalDay, parseJournalDay } from "./dates.ts"
import { titleFromFileBody } from "./filenames.ts"
import { titleKey, type LogseqSyntax, type OutlineBlock } from "./outline.ts"
import { readWhiteboard, whiteboardBlocks } from "./whiteboard.ts"

export type FileKind = "journal" | "page" | "whiteboard"

export interface PageFile {
  readonly path: string
  readonly body: string
  readonly kind: FileKind
  readonly format?: "org"
}

export type Classified = Result.Result<
  PageFile,
  { readonly path: string; readonly evicted: boolean }
>

export const configPath = "logseq/config.edn"

const placeholder = /^\.(.+)\.icloud$/
const swapFile = /\.(crswap|seqno-tmp)$/i
const markdown = /\.(md|markdown)$/i
const org = /\.org$/i
const edn = /\.edn$/i

const within = (path: string, directory: string) =>
  directory === "" || path === directory || path.startsWith(`${directory}/`)

export const classify = (path: string, config: LogseqConfig): Option.Option<Classified> => {
  const nfc = path.normalize("NFC")
  const slash = nfc.lastIndexOf("/")
  const name = nfc.slice(slash + 1)
  const kind: FileKind | null = within(nfc, config.journalsDirectory)
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
    const inner = evicted[1] ?? ""
    if (swapFile.test(inner)) return Option.none()
    return Option.some(Result.fail({ path: `${nfc.slice(0, slash + 1)}${inner}`, evicted: true }))
  }
  if (name.startsWith(".") || swapFile.test(name)) return Option.none()
  if (kind !== "whiteboard" && org.test(name)) {
    return Option.some(Result.succeed({ path, body: name.replace(org, ""), kind, format: "org" }))
  }
  const extension = kind === "whiteboard" ? edn : markdown
  if (!extension.test(name)) return Option.some(Result.fail({ path, evicted: false }))
  return Option.some(Result.succeed({ path, body: name.replace(extension, ""), kind }))
}

export const ownsPath = (path: string, config: LogseqConfig): boolean =>
  Option.match(classify(path, config), { onNone: () => false, onSome: Result.isSuccess })

const journalDayOf = (file: PageFile, config: LogseqConfig): Option.Option<JournalDay> =>
  file.kind === "journal"
    ? Option.orElse(parseJournalDay(file.body, config.journalFileFormat), () =>
        parseJournalDay(file.body, defaultConfig.journalFileFormat),
      )
    : Option.none()

export type PageFields = Omit<Page, "id" | "name">

export interface FileContent {
  readonly page: PageFields
  readonly blocks: (
    pageId: PageId,
    idFor: (written: string | undefined) => BlockId,
  ) => ReadonlyArray<Block>
}

const outlineBlocks = (
  outline: ReadonlyArray<OutlineBlock>,
  pageId: PageId,
  idFor: (written: string | undefined) => BlockId,
): ReadonlyArray<Block> => {
  const flatten = (
    blocks: ReadonlyArray<OutlineBlock>,
    parentId: BlockId | null,
  ): ReadonlyArray<Block> =>
    blocks.flatMap((block) => {
      const id = idFor(block.props["id"])
      const own: Block = {
        id,
        pageId,
        parentId,
        text: block.text,
        collapsed: block.collapsed,
        props: block.props,
      }
      return [own, ...flatten(block.children, id)]
    })
  return flatten(outline, null)
}

export const readFile = (
  file: PageFile,
  text: string,
  config: LogseqConfig,
  syntax: LogseqSyntax["Service"],
): Result.Result<FileContent, string> => {
  const fileTitle = titleFromFileBody(file.body, config.fileNameFormat)
  if (file.kind === "whiteboard") {
    return Result.map(readWhiteboard(text), (board) => ({
      page: { title: board.title?.trim() || fileTitle, journalDay: null, props: board.props },
      blocks: (pageId, idFor) => whiteboardBlocks(board, pageId, idFor),
    }))
  }
  const outline = syntax.parse(text, file.format)
  const journalDay = journalDayOf(file, config)
  const title =
    outline.props[titleKey(outline.props) ?? "title"]?.trim() ||
    Option.match(journalDay, {
      onNone: () => fileTitle,
      onSome: (day) => formatJournalDay(day, config.journalTitleFormat),
    })
  return Result.succeed({
    page: {
      title,
      journalDay: Option.getOrNull(journalDay),
      props: outline.props,
      ...(outline.frontMatter === true ? { frontMatter: true } : {}),
      ...(file.format === undefined ? {} : { format: file.format }),
    },
    blocks: (pageId, idFor) => outlineBlocks(outline.blocks, pageId, idFor),
  })
}
