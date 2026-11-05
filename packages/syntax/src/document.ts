import { Schema } from "effect"

export interface Node {
  readonly indent: string
  readonly lines: readonly string[]
  readonly children: readonly Node[]
  readonly bare?: true
}

export const Node: Schema.Codec<Node> = Schema.Struct({
  indent: Schema.String,
  lines: Schema.Array(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)),
  bare: Schema.optionalKey(Schema.Literal(true)),
})

export const Document = Schema.Struct({
  preamble: Schema.String,
  blocks: Schema.Array(Node),
})

export type Document = typeof Document.Type

const BOM = "﻿"
const BULLET = /^([ \t]*)-(?=[ \t\r]|$)/
const HEADING = /^([ \t]*)#+[ \t]/
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/
const DIRECTIVE_OPEN = /^[ \t]*#\+BEGIN_(\S+)/i

interface Fence {
  readonly close: (line: string) => boolean
  readonly ownerWidth: number
}

interface Open {
  readonly width: number
  readonly lines: string[]
  readonly children: Open[]
  readonly indent: string
  readonly bare: boolean
}

export const startsBlock = (line: string): boolean => BULLET.test(line) || HEADING.test(line)

export const width = (indent: string): number =>
  [...indent].reduce((column, char) => (char === "\t" ? column + 4 - (column % 4) : column + 1), 0)

const fenceOpenedBy = (line: string, ownerWidth: number): Fence | null => {
  const fence = FENCE_OPEN.exec(line)

  if (fence !== null) {
    const run = fence[1] ?? ""
    const info = fence[2] ?? ""

    if (run.startsWith("`") && info.includes("`")) {
      return null
    }

    const closing = new RegExp(`^[ \\t]*${run[0] === "`" ? "`" : "~"}{${run.length},}[ \\t\\r]*$`)

    return { close: (next) => closing.test(next), ownerWidth }
  }

  const directive = DIRECTIVE_OPEN.exec(line)

  if (directive === null) {
    return null
  }

  const end = `#+END_${(directive[1] ?? "").toUpperCase()}`

  return { close: (next) => next.trimStart().toUpperCase().startsWith(end), ownerWidth }
}

const freeze = (open: Open): Node => ({
  indent: open.indent,
  lines: open.lines,
  children: open.children.map(freeze),
  ...(open.bare ? { bare: true } : {}),
})

const frontMatterEnd = (lines: readonly string[]): number => {
  if (lines[0] !== "---" && lines[0] !== "---\r") {
    return 0
  }

  const close = lines.findIndex((line, index) => index > 0 && line.startsWith("---"))

  return close === -1 ? 0 : close + 1
}

export const parse = (source: string): Document => {
  const bom = source.startsWith(BOM) ? BOM : ""
  const lines = source.slice(bom.length).split("\n")
  const skip = frontMatterEnd(lines)
  const roots: Open[] = []
  const stack: Open[] = []
  const preamble: string[] = []
  let fence: Fence | null = null

  for (const [index, line] of lines.entries()) {
    const current = stack.at(-1)
    const body = index >= skip
    const bullet = body ? BULLET.exec(line)?.[1] : undefined
    const heading = body && fence === null && bullet === undefined ? HEADING.exec(line) : null
    const fenced = fence !== null && (bullet === undefined || width(bullet) > fence.ownerWidth)

    if (fenced || (bullet === undefined && heading === null)) {
      if (current === undefined) {
        preamble.push(line)
      } else {
        current.lines.push(line)
      }

      if (body) {
        const owner = current?.width ?? -1
        fence = fence === null ? fenceOpenedBy(line, owner) : fence.close(line) ? null : fence
      }

      continue
    }

    const indent = bullet ?? heading?.[1] ?? ""
    const depth = bullet === undefined ? 0 : width(indent)

    while ((stack.at(-1)?.width ?? -1) >= depth) {
      stack.pop()
    }

    const rest = line.slice(indent.length + (bullet === undefined ? 0 : 1))

    const node: Open = {
      indent,
      width: depth,
      lines: [rest],
      children: [],
      bare: bullet === undefined,
    }

    const parent = stack.at(-1)

    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }

    stack.push(node)
    fence = fenceOpenedBy(rest, depth)
  }

  const head = preamble.length === 0 ? "" : `${preamble.join("\n")}\n`

  return {
    preamble: bom + (roots.length === 0 ? head.slice(0, -1) : head),
    blocks: roots.map(freeze),
  }
}

const nodeLines = (node: Node): readonly string[] => [
  `${node.indent}${node.bare === true ? "" : "-"}${node.lines[0] ?? ""}`,
  ...node.lines.slice(1),
  ...node.children.flatMap(nodeLines),
]

export const print = (document: Document): string =>
  document.preamble + document.blocks.flatMap(nodeLines).join("\n")
