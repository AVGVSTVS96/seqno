import { Schema } from "effect"

export interface Node {
  readonly indent: string
  readonly lines: ReadonlyArray<string>
  readonly children: ReadonlyArray<Node>
}

export const Node: Schema.Codec<Node> = Schema.Struct({
  indent: Schema.String,
  lines: Schema.Array(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
})

export const Document = Schema.Struct({
  preamble: Schema.String,
  blocks: Schema.Array(Node),
})
export type Document = typeof Document.Type

const BOM = "﻿"
const BULLET = /^([ \t]*)-(?=[ \t]|$)/
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/
const DIRECTIVE_OPEN = /^[ \t]*#\+BEGIN_(\S+)/i

interface Fence {
  readonly close: (line: string) => boolean
  readonly ownerWidth: number
}

interface Open {
  readonly width: number
  readonly lines: Array<string>
  readonly children: Array<Open>
  readonly indent: string
}

export const width = (indent: string): number =>
  [...indent].reduce((column, char) => (char === "\t" ? column + 4 - (column % 4) : column + 1), 0)

const fenceOpenedBy = (line: string, ownerWidth: number): Fence | null => {
  const fence = FENCE_OPEN.exec(line)
  if (fence !== null) {
    const run = fence[1] ?? ""
    const info = fence[2] ?? ""
    if (run.startsWith("`") && info.includes("`")) return null
    const closing = new RegExp(`^[ \\t]*${run[0] === "`" ? "`" : "~"}{${run.length},}[ \\t]*$`)
    return { close: (next) => closing.test(next), ownerWidth }
  }
  const directive = DIRECTIVE_OPEN.exec(line)
  if (directive === null) return null
  const end = `#+END_${(directive[1] ?? "").toUpperCase()}`
  return { close: (next) => next.trimStart().toUpperCase().startsWith(end), ownerWidth }
}

const freeze = (open: Open): Node => ({
  indent: open.indent,
  lines: open.lines,
  children: open.children.map(freeze),
})

const frontMatterEnd = (lines: ReadonlyArray<string>): number => {
  if (lines[0]?.trimEnd() !== "---") return 0
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
  return close === -1 ? 0 : close + 1
}

export const parse = (source: string): Document => {
  const bom = source.startsWith(BOM) ? BOM : ""
  const lines = source.slice(bom.length).split("\n")
  const skip = frontMatterEnd(lines)
  const roots: Array<Open> = []
  const stack: Array<Open> = []
  const preamble: Array<string> = []
  let fence: Fence | null = null

  for (const [index, line] of lines.entries()) {
    const current = stack.at(-1)
    const indent = index < skip ? undefined : BULLET.exec(line)?.[1]
    if (current === undefined) {
      if (indent === undefined) {
        preamble.push(line)
        continue
      }
    } else if (indent === undefined || (fence !== null && width(indent) > fence.ownerWidth)) {
      current.lines.push(line)
      fence = fence === null ? fenceOpenedBy(line, current.width) : fence.close(line) ? null : fence
      continue
    }
    const depth = width(indent)
    while ((stack.at(-1)?.width ?? -1) >= depth) stack.pop()
    const rest = line.slice(indent.length + 1)
    const node: Open = { indent, width: depth, lines: [rest], children: [] }
    const parent = stack.at(-1)
    if (parent === undefined) roots.push(node)
    else parent.children.push(node)
    stack.push(node)
    fence = fenceOpenedBy(rest, depth)
  }

  const head = preamble.length === 0 ? "" : `${preamble.join("\n")}\n`
  return { preamble: bom + (roots.length === 0 ? head.slice(0, -1) : head), blocks: roots.map(freeze) }
}

const nodeLines = (node: Node): ReadonlyArray<string> => [
  `${node.indent}-${node.lines[0] ?? ""}`,
  ...node.lines.slice(1),
  ...node.children.flatMap(nodeLines),
]

export const print = (document: Document): string =>
  document.preamble + document.blocks.flatMap(nodeLines).join("\n")
