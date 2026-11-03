import { Effect } from "effect"
import { isWhiteboard, type Block, type BlockId, type Page, type Props } from "@seqno/domain"
import type { PageTree } from "@seqno/rpc"
import type { LogseqConfig } from "./config.ts"
import { formatJournalDay } from "./dates.ts"
import { fileBodyFromTitle } from "./filenames.ts"
import { LogseqSyntax, titleKey, type OutlineBlock } from "./outline.ts"
import { renderWhiteboard } from "./whiteboard.ts"

const blockRef = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

export const refsIn = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(blockRef)].map((match) => (match[1] ?? "").toLowerCase())

export const referencedIds = (pages: ReadonlyArray<PageTree>): ReadonlySet<string> =>
  new Set(
    pages.flatMap(({ blocks }) =>
      blocks.flatMap((block) => [block.text, ...Object.values(block.props)].flatMap(refsIn)),
    ),
  )

export interface RenderOptions {
  readonly referenced: ReadonlySet<string>
  readonly keepIds?: ReadonlySet<string>
}

const outlineOf = (
  blocks: ReadonlyArray<Block>,
  { referenced, keepIds }: RenderOptions,
): ReadonlyArray<OutlineBlock> => {
  const ids = new Set(blocks.map((block) => block.id))
  const children = Map.groupBy(blocks, (block) =>
    block.parentId !== null && ids.has(block.parentId) ? block.parentId : null,
  )
  const written = (id: BlockId) =>
    referenced.has(id.toLowerCase()) || (keepIds?.has(id.toLowerCase()) ?? false)
  const build = (parent: BlockId | null): ReadonlyArray<OutlineBlock> =>
    (children.get(parent) ?? []).map((block) => ({
      text: block.text,
      props:
        block.props["id"] === undefined && written(block.id)
          ? { ...block.props, id: block.id }
          : block.props,
      collapsed: block.collapsed,
      children: build(block.id),
    }))
  return build(null)
}

const pageProps = (page: Page): Props => {
  const key = titleKey(page.props)
  return key === undefined ? page.props : { ...page.props, [key]: page.title }
}

export const mirrorPath = (page: Page, config: LogseqConfig): string => {
  const extension = page.format === "org" ? "org" : "md"
  return page.journalDay !== null
    ? `${config.journalsDirectory}/${formatJournalDay(page.journalDay, config.journalFileFormat)}.${extension}`
    : isWhiteboard(page)
      ? `${config.whiteboardsDirectory}/${fileBodyFromTitle(page.title)}.edn`
      : `${config.pagesDirectory}/${fileBodyFromTitle(page.title)}.${extension}`
}

export const hasFile = ({ page, blocks }: PageTree): boolean =>
  blocks.length > 0 || Object.keys(page.props).length > 0

export const printPage = (
  syntax: LogseqSyntax["Service"],
  { page, blocks }: PageTree,
  options: RenderOptions,
): string =>
  isWhiteboard(page)
    ? renderWhiteboard(page, blocks)
    : syntax.print({
        props: pageProps(page),
        blocks: outlineOf(blocks, options),
        ...(page.frontMatter === true ? { frontMatter: true } : {}),
        ...(page.format === undefined ? {} : { format: page.format }),
      })

export const renderPage = (tree: PageTree, options: RenderOptions) =>
  Effect.gen(function* () {
    return printPage(yield* LogseqSyntax, tree, options)
  })

export const renderMirror = (pages: ReadonlyArray<PageTree>, config: LogseqConfig) =>
  Effect.gen(function* () {
    const syntax = yield* LogseqSyntax
    const referenced = referencedIds(pages)
    return new Map(
      pages
        .filter(hasFile)
        .map((tree) => [mirrorPath(tree.page, config), printPage(syntax, tree, { referenced })]),
    )
  })
