import { BlockId, PageId, normalizePageName, type Block, type Page } from "@seqno/domain"
import { parse, splitProperties, toOutline, type Block as Parsed } from "@seqno/syntax"
import { referencedIds, type Library, type PageBlocks } from "../src/index.ts"

const id = (prefix: string, n: number) =>
  `0190${prefix}000-0000-7000-8000-${String(n).padStart(12, "0")}`

export const pageId = (n: number) => PageId.make(id("0", n))

export const pagesOf = (files: Record<string, string>): ReadonlyArray<PageBlocks> => {
  let blocks = 0
  return Object.entries(files).map(([title, source], index): PageBlocks => {
    const outline = toOutline(parse(source))
    const preamble = splitProperties(`-\n${outline.preamble.trim()}`)
    const page: Page = {
      id: pageId(index + 1),
      name: normalizePageName(title),
      title,
      journalDay: null,
      props: Object.fromEntries(preamble.props),
    }
    const flat: Array<Block> = []
    const walk = (nodes: ReadonlyArray<Parsed>, parentId: BlockId | null) => {
      for (const node of nodes) {
        const draft = splitProperties(node.text)
        const props = Object.fromEntries(draft.props.filter(([key]) => key !== "collapsed"))
        const block: Block = {
          id: BlockId.make(id("1", ++blocks)),
          pageId: page.id,
          parentId,
          text: draft.text,
          collapsed: draft.props.some(([key, value]) => key === "collapsed" && value === "true"),
          props,
        }
        flat.push(block)
        walk(node.children, block.id)
      }
    }
    walk(outline.blocks, null)
    return { page, blocks: flat }
  })
}

export const libraryOf = (files: Record<string, string>): Library => {
  const pages = pagesOf(files)
  return { pages, referenced: referencedIds(pages) }
}

export const blockOf = (library: Library, text: string): BlockId => {
  const found = library.pages.flatMap((entry) => entry.blocks).find((block) => block.text === text)
  if (found === undefined) throw new Error(`no block ${text}`)
  return found.id
}
