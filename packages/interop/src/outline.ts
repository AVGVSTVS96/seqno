import { Context, Layer } from "effect"
import type { Props } from "@seqno/domain"
import * as Syntax from "@seqno/syntax"
import { parseOrg, printOrg } from "./org.ts"

export interface OutlineBlock {
  readonly text: string
  readonly props: Props
  readonly collapsed: boolean
  readonly children: ReadonlyArray<OutlineBlock>
}

export interface Outline {
  readonly props: Props
  readonly blocks: ReadonlyArray<OutlineBlock>
  readonly frontMatter?: true
  readonly format?: "org"
}

export class LogseqSyntax extends Context.Service<
  LogseqSyntax,
  {
    readonly parse: (source: string, format?: "org") => Outline
    readonly print: (outline: Outline) => string
  }
>()("@seqno/interop/LogseqSyntax") {}

export const titleKey = (props: Props): string | undefined =>
  Object.keys(props).find((key) => key.toLowerCase() === "title")

const property = /^([^\s:]+):: (.*)$/
const opensVerbatim = /^\s*(```|~~~|#\+BEGIN_)/i

interface PropertyRun {
  readonly props: Props
  readonly collapsed: boolean
  readonly length: number
}

const propertyRun = (lines: ReadonlyArray<string>): PropertyRun => {
  const props: Record<string, string> = {}
  let collapsed = false
  let length = 0
  for (const line of lines) {
    const match = property.exec(line)
    const key = match?.[1]
    const value = match?.[2]
    if (key === undefined || value === undefined || key in props || /^\d+$/.test(key)) break
    if (key === "collapsed") {
      if (value !== "true" || collapsed) break
      collapsed = true
    } else {
      props[key] = value
    }
    length += 1
  }
  return { props, collapsed, length }
}

const fromLines = (
  lines: ReadonlyArray<string>,
  children: ReadonlyArray<OutlineBlock>,
): OutlineBlock => {
  const head = lines[0] ?? ""
  const whole = propertyRun(lines)
  if (head !== "" && whole.length === lines.length) {
    return { text: "", props: whole.props, collapsed: whole.collapsed, children }
  }
  const run = propertyRun(opensVerbatim.test(head) ? [] : lines.slice(1))
  const body = [head, ...lines.slice(1 + run.length)]
  return { text: body.join("\n"), props: run.props, collapsed: run.collapsed, children }
}

const fromSyntax = (block: Syntax.Block): OutlineBlock =>
  fromLines(block.text.split("\n"), block.children.map(fromSyntax))

const filled = (line: string) => line.trim() !== ""

const frontMatterLine = /^([^:]+):(.*)$/

const frontMatterOf = (preamble: ReadonlyArray<string>) => {
  const close = preamble.findIndex((line, index) => index > 0 && line.startsWith("---"))
  if (preamble[0] !== "---" || close < 2) return null
  const props: Record<string, string> = {}
  for (const line of preamble.slice(1, close)) {
    const match = frontMatterLine.exec(line)
    if (match === null) return null
    props[match[1] ?? ""] = (match[2] ?? "").trim()
  }
  return { props, rest: preamble.slice(close + 1) }
}

const frontMatterOutline = (preamble: ReadonlyArray<string>): Outline | null => {
  const front = frontMatterOf(preamble)
  if (front === null) return null
  const body = front.rest.slice(front.rest.findIndex(filled), front.rest.findLastIndex(filled) + 1)
  return {
    props: front.props,
    blocks: body.length === 0 ? [] : [fromLines(body, [])],
    frontMatter: true,
  }
}

const parse = (source: string, format?: "org"): Outline => {
  if (format === "org") return { ...parseOrg(source, frontMatterOutline), format }
  const outline = Syntax.toOutline(Syntax.parse(source.replaceAll("\r\n", "\n")))
  const preamble = outline.preamble === "" ? [] : outline.preamble.split("\n")
  if (preamble.at(-1) === "") preamble.pop()
  const blocks = outline.blocks.map(fromSyntax)
  const front = frontMatterOf(preamble)
  if (front !== null) {
    const body = front.rest.slice(
      front.rest.findIndex(filled),
      front.rest.findLastIndex(filled) + 1,
    )
    const extra = body.length === 0 ? [] : [fromLines(body, [])]
    return { props: front.props, blocks: [...extra, ...blocks], frontMatter: true }
  }
  const pageRun = propertyRun(preamble)
  const rest = preamble.slice(pageRun.length)
  return rest.every((line) => line.trim() === "")
    ? { props: pageRun.props, blocks }
    : { props: {}, blocks: [fromLines(preamble, []), ...blocks] }
}

const propertyLines = (props: Props, collapsed: boolean): Array<string> => [
  ...Object.entries(props).map(([key, value]) => `${key}:: ${value}`),
  ...(collapsed ? ["collapsed:: true"] : []),
]

export const blockContent = (block: Omit<OutlineBlock, "children">): string => {
  const [head = "", ...rest] = block.text === "" ? [] : block.text.split("\n")
  const props = propertyLines(block.props, block.collapsed)
  return (block.text === "" ? props : [head, ...props, ...rest]).join("\n")
}

export const contentBlock = (content: string): OutlineBlock =>
  fromLines(content.replaceAll("\r\n", "\n").split("\n"), [])

const toSyntax = (block: OutlineBlock): Syntax.Block => ({
  text: blockContent(block),
  children: block.children.map(toSyntax),
})

const heading = /^#+[ \t]/

const topHeading = (block: Syntax.Block): Syntax.Block => {
  const [first = "", ...rest] = block.text.split("\n")
  const plain = rest.every((line) => !Syntax.startsBlock(line) && !/^[ \t]/.test(line))
  return heading.test(first) && plain ? { ...block, bare: true } : block
}

const frontMatterLines = (props: Props) =>
  Object.keys(props).length === 0
    ? []
    : ["---", ...Object.entries(props).map(([key, value]) => `${key}: ${value}`), "---"]

const print = (outline: Outline): string => {
  if (outline.format === "org") return printOrg(outline, frontMatterLines)
  const props =
    outline.frontMatter === true
      ? frontMatterLines(outline.props)
      : propertyLines(outline.props, false)
  const preamble = [...props, ...(props.length > 0 && outline.blocks.length > 0 ? ["", ""] : [])]
  const [first, ...rest] = outline.blocks.map(toSyntax)
  const blocks =
    first === undefined ? [] : [props.length === 0 ? topHeading(first) : first, ...rest]
  return Syntax.render({
    preamble: preamble.join("\n"),
    blocks,
    format: Syntax.logseqFormat,
  })
    .replace(/^[ \t]+$/gm, "")
    .replace(/^([ \t]*-) $/gm, "$1")
}

export const LogseqSyntaxLive = Layer.succeed(LogseqSyntax, LogseqSyntax.of({ parse, print }))
