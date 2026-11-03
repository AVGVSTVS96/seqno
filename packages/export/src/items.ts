import type { Block, PageId } from "@seqno/domain"
import { analyzeBlock, blockContent, parseInline, type Inline } from "@seqno/syntax"
import type { Shelf } from "./library.ts"

export interface Run {
  readonly source: string
  readonly from: number
  readonly to: number
  readonly nodes: ReadonlyArray<Inline>
}

export type PropertyLine = readonly [key: string, value: string]

export type Item =
  | {
      readonly _tag: "Heading"
      readonly level: number
      readonly prefix: string
      readonly marker: string | null
      readonly title: Run
      readonly untitled: boolean
    }
  | {
      readonly _tag: "Properties"
      readonly level: number
      readonly props: ReadonlyArray<PropertyLine>
    }
  | { readonly _tag: "Paragraph"; readonly level: number; readonly lines: ReadonlyArray<Run> }
  | { readonly _tag: "Quote"; readonly level: number; readonly lines: ReadonlyArray<Run> }
  | {
      readonly _tag: "Code"
      readonly level: number
      readonly language: string
      readonly lines: ReadonlyArray<string>
    }
  | { readonly _tag: "Raw"; readonly level: number; readonly lines: ReadonlyArray<string> }

const maxEmbedDepth = 5
const QUOTE = /^[ \t]*>[ \t]?/
const EMBED_BLOCK = /^\(\(([0-9a-f-]{36})\)\)$/i
const EMBED_PAGE = /^\[\[(.+)\]\]$/

export const lineRun = (line: string): Run => ({
  source: line,
  from: 0,
  to: line.length,
  nodes: parseInline(line),
})

export const isEmpty = (run: Run) => run.source.slice(run.from, run.to).trim() === ""

export const propertyLines = (block: Block, referenced: boolean): ReadonlyArray<PropertyLine> => [
  ...Object.entries(block.props),
  ...(referenced && block.props["id"] === undefined ? [["id", block.id] as const] : []),
  ...(block.collapsed && block.props["collapsed"] === undefined
    ? [["collapsed", "true"] as const]
    : []),
]

type Piece =
  | { readonly _tag: "Run"; readonly run: Run }
  | { readonly _tag: "Embed"; readonly items: ReadonlyArray<Item> }

interface Context {
  readonly shelf: Shelf
  readonly depth: number
}

const embedded = (node: Inline, level: number, context: Context): ReadonlyArray<Item> | null => {
  if (node._tag !== "Macro" || node.name !== "embed" || context.depth >= maxEmbedDepth) return null
  const deeper = { ...context, depth: context.depth + 1 }
  const uuid = EMBED_BLOCK.exec(node.args)?.[1]
  if (uuid !== undefined) {
    const target = context.shelf.block(uuid)
    return target === undefined ? null : blockItems(target, target.pageId, level, deeper)
  }
  const name = EMBED_PAGE.exec(node.args)?.[1]
  const page = name === undefined ? undefined : context.shelf.page(name)
  return page === undefined ? null : pageItems(page.page.id, level, deeper)
}

const split = (run: Run, level: number, context: Context): ReadonlyArray<Piece> => {
  const pieces: Array<Piece> = []
  let from = run.from
  let nodes: Array<Inline> = []
  for (const node of run.nodes) {
    const items = embedded(node, level, context)
    if (items === null) {
      nodes.push(node)
      continue
    }
    pieces.push({ _tag: "Run", run: { ...run, from, to: node.span.from, nodes } })
    pieces.push({ _tag: "Embed", items })
    from = node.span.to
    nodes = []
  }
  pieces.push({ _tag: "Run", run: { ...run, from, to: run.to, nodes } })
  return pieces
}

interface Line {
  readonly text: string
  readonly from: number
}

const linesOf = (text: string): ReadonlyArray<Line> => {
  let from = 0
  return text.split("\n").map((line) => {
    const entry = { text: line, from }
    from += line.length + 1
    return entry
  })
}

const bodyItems = (
  text: string,
  lines: ReadonlyArray<Line>,
  level: number,
  context: Context,
): ReadonlyArray<Item> => {
  const regions = analyzeBlock(text).regions
  const items: Array<Item> = []
  let paragraph: Array<Run> = []
  let quote: Array<Run> = []
  const flush = () => {
    if (paragraph.length > 0) items.push({ _tag: "Paragraph", level, lines: paragraph })
    if (quote.length > 0) items.push({ _tag: "Quote", level, lines: quote })
    paragraph = []
    quote = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line === undefined) continue
    const region = regions.find((candidate) => candidate.span.from === line.from)
    if (region !== undefined) {
      flush()
      const inner: Array<string> = [line.text]
      while (index + 1 < lines.length && (lines[index + 1]?.from ?? 0) < region.span.to) {
        index++
        inner.push(lines[index]?.text ?? "")
      }
      items.push(
        region.kind === "Fence"
          ? { _tag: "Code", level, language: region.name.split(/\s/)[0] ?? "", lines: inner }
          : { _tag: "Raw", level, lines: inner },
      )
      continue
    }
    const marked = QUOTE.exec(line.text)
    if (marked !== null) {
      if (paragraph.length > 0) flush()
      quote.push(lineRun(line.text.slice(marked[0].length)))
      continue
    }
    if (quote.length > 0) flush()
    const pieces = split(lineRun(line.text), level, context)
    for (const piece of pieces) {
      if (piece._tag === "Run") {
        if (pieces.length === 1 || !isEmpty(piece.run)) paragraph.push(piece.run)
      } else {
        flush()
        items.push(...piece.items)
      }
    }
  }
  flush()
  return items
}

const blockItems = (
  block: Block,
  pageId: PageId,
  level: number,
  context: Context,
): ReadonlyArray<Item> => {
  const text = block.text
  const lines = linesOf(text)
  const first = lines[0]?.text ?? ""
  const content = blockContent(text)
  const items: Array<Item> = []
  const titled = content.title !== null
  const start = content.title?.[0]?.span.from ?? (titled ? first.length : 0)
  const title: Run = {
    source: text,
    from: start,
    to: titled ? first.length : 0,
    nodes: content.title ?? [],
  }
  const pieces = split(title, level, context)
  const [lead, ...rest] = pieces
  const shown = rest.length === 0 || (lead?._tag === "Run" && !isEmpty(lead.run))
  if (shown && lead?._tag === "Run") {
    items.push({
      _tag: "Heading",
      level,
      prefix: titled ? first.slice(0, start) : "",
      marker: content.marker,
      title: lead.run,
      untitled: !titled,
    })
    const props = propertyLines(block, context.shelf.referenced(block)).filter(
      ([key]) => context.depth === 0 || key !== "id",
    )
    if (props.length > 0) items.push({ _tag: "Properties", level, props })
  }
  for (const piece of rest) {
    if (piece._tag === "Embed") items.push(...piece.items)
    else if (!isEmpty(piece.run)) items.push({ _tag: "Paragraph", level, lines: [piece.run] })
  }
  items.push(...bodyItems(text, titled ? lines.slice(1) : lines, level, context))
  for (const child of context.shelf.children(pageId, block.id)) {
    items.push(...blockItems(child, pageId, level + 1, context))
  }
  return items
}

const pageItems = (pageId: PageId, level: number, context: Context): ReadonlyArray<Item> =>
  context.shelf.children(pageId, null).flatMap((block) => blockItems(block, pageId, level, context))

export const itemsOfPage = (shelf: Shelf, pageId: PageId): ReadonlyArray<Item> =>
  pageItems(pageId, 1, { shelf, depth: 0 })

export const itemsOfBlocks = (shelf: Shelf, blocks: ReadonlyArray<Block>): ReadonlyArray<Item> =>
  blocks.flatMap((block) => blockItems(block, block.pageId, 1, { shelf, depth: 0 }))

export const upToLevel = (
  items: ReadonlyArray<Item>,
  level: number | null,
): ReadonlyArray<Item> => {
  if (level === null) return items
  let kept = false
  return items.filter((item) => {
    if (item._tag === "Heading") kept = item.level <= level
    return kept
  })
}

export const titleOf = (block: Block): Run => {
  const content = blockContent(block.text)
  const first = block.text.split("\n")[0] ?? ""
  const nodes = (content.title ?? []).filter((node) => node._tag !== "Priority")
  const from = nodes[0]?.span.from ?? first.length
  return { source: block.text, from, to: content.title === null ? from : first.length, nodes }
}
