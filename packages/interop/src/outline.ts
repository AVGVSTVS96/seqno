import { Context, Layer } from "effect"
import type { Props } from "@seqno/domain"
import * as Syntax from "@seqno/syntax"

export interface OutlineBlock {
  readonly text: string
  readonly props: Props
  readonly collapsed: boolean
  readonly children: ReadonlyArray<OutlineBlock>
}

export interface Outline {
  readonly props: Props
  readonly blocks: ReadonlyArray<OutlineBlock>
}

export class LogseqSyntax extends Context.Service<
  LogseqSyntax,
  {
    readonly parse: (source: string) => Outline
    readonly print: (outline: Outline) => string
  }
>()("@seqno/interop/LogseqSyntax") {}

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

const fromLines = (lines: ReadonlyArray<string>, children: ReadonlyArray<OutlineBlock>) => {
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

const parse = (source: string): Outline => {
  const outline = Syntax.toOutline(Syntax.parse(source.replaceAll("\r\n", "\n")))
  const preamble = outline.preamble === "" ? [] : outline.preamble.split("\n")
  if (preamble.at(-1) === "") preamble.pop()
  const pageRun = propertyRun(preamble)
  const rest = preamble.slice(pageRun.length)
  const blocks = outline.blocks.map(fromSyntax)
  return rest.every((line) => line.trim() === "")
    ? { props: pageRun.props, blocks }
    : { props: {}, blocks: [fromLines(preamble, []), ...blocks] }
}

const propertyLines = (props: Props, collapsed: boolean): Array<string> => [
  ...Object.entries(props).map(([key, value]) => `${key}:: ${value}`),
  ...(collapsed ? ["collapsed:: true"] : []),
]

const toSyntax = (block: OutlineBlock): Syntax.Block => {
  const [head = "", ...rest] = block.text === "" ? [] : block.text.split("\n")
  const props = propertyLines(block.props, block.collapsed)
  return {
    text: (block.text === "" ? props : [head, ...props, ...rest]).join("\n"),
    children: block.children.map(toSyntax),
  }
}

const print = (outline: Outline): string => {
  const props = propertyLines(outline.props, false)
  const preamble = [...props, ...(props.length > 0 && outline.blocks.length > 0 ? ["", ""] : [])]
  return Syntax.render({
    preamble: preamble.join("\n"),
    blocks: outline.blocks.map(toSyntax),
    format: Syntax.logseqFormat,
  })
    .replace(/^[ \t]+$/gm, "")
    .replace(/^([ \t]*-) $/gm, "$1")
}

export const LogseqSyntaxLive = Layer.succeed(LogseqSyntax, LogseqSyntax.of({ parse, print }))
