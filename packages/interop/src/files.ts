import { Option, Result, Struct } from "effect"
import type { Block, BlockId, JournalDay, Page, PageId } from "@seqno/domain"
import { defaultConfig } from "./config.ts"
import type { LogseqConfig } from "./config.ts"
import { formatJournalDay, parseJournalDay } from "./dates.ts"
import { titleFromFileBody } from "./filenames.ts"
import { titleKey } from "./outline.ts"
import type { LogseqSyntax, OutlineBlock } from "./outline.ts"
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

const placeholder = /^\.(.+)\.icloud$/u
const swapFile = /\.(crswap|seqno-tmp)$/iu
const markdown = /\.(md|markdown)$/iu
const org = /\.org$/iu
const edn = /\.edn$/iu

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

  if (kind === null || slash === -1) {
    return Option.none()
  }

  if (config.hidden.some((directory) => within(nfc, directory))) {
    return Option.none()
  }

  const evicted = placeholder.exec(name)

  if (evicted !== null) {
    const inner = evicted[1] ?? ""

    if (swapFile.test(inner)) {
      return Option.none()
    }

    return Option.some(Result.fail({ path: `${nfc.slice(0, slash + 1)}${inner}`, evicted: true }))
  }

  if (name.startsWith(".") || swapFile.test(name)) {
    return Option.none()
  }

  if (kind !== "whiteboard" && org.test(name)) {
    return Option.some(Result.succeed({ path, body: name.replace(org, ""), kind, format: "org" }))
  }

  const extension = kind === "whiteboard" ? edn : markdown

  if (!extension.test(name)) {
    return Option.some(Result.fail({ path, evicted: false }))
  }

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
  ) => readonly Block[]
}

const outlineBlocks = (
  outline: readonly OutlineBlock[],
  pageId: PageId,
  idFor: (written: string | undefined) => BlockId,
): readonly Block[] => {
  const flatten = (blocks: readonly OutlineBlock[], parentId: BlockId | null): readonly Block[] =>
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

const trimmed = (text: string | undefined): string | undefined => {
  const value = text?.trim()

  return value === "" ? undefined : value
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
      page: { title: trimmed(board.title) ?? fileTitle, journalDay: null, props: board.props },
      blocks: (pageId, idFor) => whiteboardBlocks(board, pageId, idFor),
    }))
  }

  const outline = syntax.parse(text, file.format)
  const journalDay = journalDayOf(file, config)

  const title =
    trimmed(outline.props[titleKey(outline.props) ?? "title"]) ??
    Option.match(journalDay, {
      onNone: () => fileTitle,
      onSome: (day) => formatJournalDay(day, config.journalTitleFormat),
    })

  return Result.succeed({
    page: {
      title,
      journalDay: Option.getOrNull(journalDay),
      props: outline.props,
      ...Struct.pick(outline, ["frontMatter"]),
      ...Struct.pick(file, ["format"]),
    },
    blocks: (pageId, idFor) => outlineBlocks(outline.blocks, pageId, idFor),
  })
}
