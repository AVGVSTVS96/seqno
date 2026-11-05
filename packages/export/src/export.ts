import { strToU8, zipSync } from "fflate"
import type { BlockId, Page, PageId } from "@seqno/domain"
import { defaultPropertyConfig } from "@seqno/syntax"
import type { PropertyConfig } from "@seqno/syntax"
import { ednOf, exportedPages, hasFile, jsonOf, roamJsonOf } from "./data.ts"
import type { Inlines } from "./inline.ts"
import { itemsOfBlocks, itemsOfPage, lineRun, titleOf } from "./items.ts"
import type { Item } from "./items.ts"
import { referencedIds, shelve } from "./library.ts"
import type { Library, Shelf } from "./library.ts"
import { htmlOfItems, opmlOf } from "./outline.ts"
import { pagePreamble, textOf } from "./text.ts"
import type { IndentStyle } from "./text.ts"

export type ExportTarget =
  | { readonly _tag: "Page"; readonly pageId: PageId }
  | { readonly _tag: "Blocks"; readonly blockIds: readonly BlockId[] }

export type BlockFormat = "text" | "opml" | "html"

export interface BlockOptions {
  readonly indent: IndentStyle
  readonly removeBrackets: boolean
  readonly removeEmphasis: boolean
  readonly removeTags: boolean
  readonly removeProperties: boolean
  readonly newlineAfterBlock: boolean
  readonly level: number | null
}

const inlinesOf = (shelf: Shelf, options: BlockOptions): Inlines => ({
  removals: {
    brackets: options.removeBrackets,
    emphasis: options.removeEmphasis,
    tags: options.removeTags,
  },
  ref: (uuid) => {
    const block = shelf.block(uuid)

    if (block === undefined) {
      return
    }

    return shelf.dialect(block.pageId) === "org"
      ? { source: "", from: 0, to: 0, nodes: [] }
      : titleOf(block)
  },
})

const render = (
  items: readonly Item[],
  shelf: Shelf,
  page: Page | null,
  format: BlockFormat,
  options: BlockOptions,
) => {
  const inlines = inlinesOf(shelf, options)
  const front = page?.frontMatter === true
  const gap = format === "text" ? [lineRun(""), lineRun("")] : [lineRun(" ")]

  const shown: readonly Item[] =
    front && items.length > 0 && format !== "html"
      ? [{ _tag: "Paragraph", level: 1, lines: gap }, ...items]
      : items

  switch (format) {
    case "text": {
      return textOf(
        shown,
        inlines,
        {
          indent: options.indent,
          properties: !options.removeProperties,
          newlineAfterBlock: options.newlineAfterBlock,
          level: options.level,
        },
        page === null || front
          ? []
          : pagePreamble(Object.entries(page.props), {
              indent: options.indent,
              properties: !options.removeProperties,
              newlineAfterBlock: false,
              level: null,
            }),
      )
    }

    case "opml": {
      return opmlOf(shown, inlines, page?.name ?? "untitled", options.level)
    }

    case "html": {
      return htmlOfItems(shown, inlines, options.level)
    }
  }
}

export const exportBlocks = (
  library: Library,
  target: ExportTarget,
  format: BlockFormat,
  options: BlockOptions,
): string => {
  const shelf = shelve(library)

  if (target._tag === "Page") {
    const page = library.pages.find((entry) => entry.page.id === target.pageId)?.page ?? null

    return render(itemsOfPage(shelf, target.pageId), shelf, page, format, options)
  }

  const blocks = target.blockIds.flatMap((id) => {
    const block = shelf.block(id)

    return block === undefined ? [] : [block]
  })

  return render(itemsOfBlocks(shelf, blocks), shelf, null, format, options)
}

export const graphFormats = ["edn", "json", "markdown", "opml", "roam-json"] as const

export type GraphFormat = (typeof graphFormats)[number]

const standard: BlockOptions = {
  indent: "dashes",
  removeBrackets: false,
  removeEmphasis: false,
  removeTags: false,
  removeProperties: false,
  newlineAfterBlock: false,
  level: null,
}

export const pageFiles = (
  library: Library,
  format: "markdown" | "opml",
  path: (page: Page) => string,
): ReadonlyArray<readonly [path: string, text: string]> => {
  const shelf = shelve(library)

  return library.pages.filter(hasFile).flatMap(({ page }) => {
    const file = path(page)

    if (!file.endsWith(".md")) {
      return []
    }

    return [
      format === "markdown"
        ? ([file, render(itemsOfPage(shelf, page.id), shelf, page, "text", standard)] as const)
        : ([
            file.replace(/\.md$/u, ".opml"),
            render(itemsOfPage(shelf, page.id), shelf, page, "opml", standard),
          ] as const),
    ]
  })
}

export interface GraphFile {
  readonly name: string
  readonly type: string
  readonly bytes: Uint8Array
}

export const exportGraph = (
  pages: Library["pages"],
  format: GraphFormat,
  {
    graph,
    seconds,
    path,
    properties = defaultPropertyConfig,
  }: {
    readonly graph: string
    readonly seconds: number
    readonly path: (page: Page) => string
    readonly properties?: PropertyConfig
  },
): GraphFile => {
  const library = { pages, referenced: referencedIds(pages), properties }

  switch (format) {
    case "edn": {
      return {
        name: `${graph}_${seconds}.edn`,
        type: "application/edn",
        bytes: strToU8(ednOf(exportedPages(library))),
      }
    }

    case "json": {
      return {
        name: `${graph}_${seconds}.json`,
        type: "application/json",
        bytes: strToU8(jsonOf(exportedPages(library))),
      }
    }

    case "roam-json": {
      return {
        name: `${graph}_roam_${seconds}.json`,
        type: "application/json",
        bytes: strToU8(roamJsonOf(exportedPages(library), library.referenced)),
      }
    }

    case "markdown":
    case "opml": {
      const folder = `${graph}_${format}_${seconds}`

      const files = Object.fromEntries(
        pageFiles(library, format, path).map(([file, text]) => [
          `${folder}/${file}`,
          strToU8(text),
        ]),
      )

      return {
        name: `${folder}.zip`,
        type: "application/zip",
        bytes: zipSync(files, { mtime: seconds * 1000 }),
      }
    }
  }
}
