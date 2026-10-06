import { Context, Layer } from "effect"
import type { Props } from "@seqno/domain"

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

const bullet = /^([ \t]*)-(?: (.*))?$/
const property = /^([^\s:]+):: (.*)$/
const fence = /^\s*(```|~~~)/

const indentWidth = (indent: string): number =>
  [...indent].reduce((width, char) => width + (char === "\t" ? 4 : 1), 0)

const dedent = (line: string, prefix: string): string => {
  let index = 0
  while (index < prefix.length && line[index] === prefix[index]) index += 1
  return line.slice(index)
}

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

const blockFromLines = (lines: ReadonlyArray<string>, children: ReadonlyArray<OutlineBlock>) => {
  const head = lines[0] ?? ""
  const whole = propertyRun(lines)
  if (head !== "" && whole.length === lines.length) {
    return { text: "", props: whole.props, collapsed: whole.collapsed, children }
  }
  const run = propertyRun(lines.slice(1))
  const body = [head, ...lines.slice(1 + run.length)]
  return { text: body.join("\n"), props: run.props, collapsed: run.collapsed, children }
}

interface Draft {
  readonly width: number
  readonly continuation: string
  readonly lines: Array<string>
  readonly children: Array<Draft>
  fenced: boolean
}

const finish = (draft: Draft): OutlineBlock =>
  blockFromLines(draft.lines, draft.children.map(finish))

const parse = (source: string): Outline => {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  if (lines.at(-1) === "") lines.pop()
  const firstBullet = lines.findIndex((line) => bullet.test(line))
  const preamble = firstBullet === -1 ? lines : lines.slice(0, firstBullet)
  const pageRun = propertyRun(preamble)
  const preambleRest = preamble.slice(pageRun.length)
  const pageProps = preambleRest.every((line) => line.trim() === "") ? pageRun.props : {}
  const roots: Array<Draft> = []
  if (preambleRest.some((line) => line.trim() !== "")) {
    roots.push({ width: -1, continuation: "", lines: [...preamble], children: [], fenced: false })
  }
  const stack: Array<Draft> = []
  for (const line of firstBullet === -1 ? [] : lines.slice(firstBullet)) {
    const current = stack.at(-1)
    const match = bullet.exec(line)
    const indent = match?.[1] ?? ""
    const width = indentWidth(indent)
    if (current !== undefined && (match === null || (current.fenced && width > current.width))) {
      const content = dedent(line, current.continuation)
      if (fence.test(content)) current.fenced = !current.fenced
      current.lines.push(content)
      continue
    }
    while ((stack.at(-1)?.width ?? -1) >= width) stack.pop()
    const head = match?.[2] ?? ""
    const draft: Draft = {
      width,
      continuation: `${indent}  `,
      lines: [head],
      children: [],
      fenced: fence.test(head),
    }
    const parent = stack.at(-1)
    if (parent === undefined) roots.push(draft)
    else parent.children.push(draft)
    stack.push(draft)
  }
  return { props: pageProps, blocks: roots.map(finish) }
}

const propertyLines = (props: Props, collapsed: boolean): Array<string> => [
  ...Object.entries(props).map(([key, value]) => `${key}:: ${value}`),
  ...(collapsed ? ["collapsed:: true"] : []),
]

const printBlock = (block: OutlineBlock, depth: number): Array<string> => {
  const indent = "\t".repeat(depth)
  const [head = "", ...rest] = block.text === "" ? [] : block.text.split("\n")
  const props = propertyLines(block.props, block.collapsed)
  const lines = block.text === "" ? props : [head, ...props, ...rest]
  const [first = "", ...continuation] = lines
  return [
    first === "" ? `${indent}-` : `${indent}- ${first}`,
    ...continuation.map((line) => (line === "" ? "" : `${indent}  ${line}`)),
    ...block.children.flatMap((child) => printBlock(child, depth + 1)),
  ]
}

const print = (outline: Outline): string => {
  const props = propertyLines(outline.props, false)
  const blocks = outline.blocks.flatMap((block) => printBlock(block, 0))
  return [...props, ...(props.length > 0 && blocks.length > 0 ? [""] : []), ...blocks].join("\n")
}

export const LogseqSyntaxLive = Layer.succeed(LogseqSyntax, LogseqSyntax.of({ parse, print }))
