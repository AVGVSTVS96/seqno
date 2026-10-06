import { Schema } from "effect"
import { type Document, type Node, print } from "./document.ts"

export interface Block {
  readonly text: string
  readonly children: ReadonlyArray<Block>
}

export const Block: Schema.Codec<Block> = Schema.Struct({
  text: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Codec<Block> => Block)),
})

export const Format = Schema.Struct({
  indent: Schema.String,
  eol: Schema.Literals(["\n", "\r\n"]),
  finalNewline: Schema.Boolean,
  bom: Schema.Boolean,
})
export type Format = typeof Format.Type

export const Outline = Schema.Struct({
  preamble: Schema.String,
  blocks: Schema.Array(Block),
  format: Format,
})
export type Outline = typeof Outline.Type

export const logseqFormat: Format = { indent: "\t", eol: "\n", finalNewline: false, bom: false }

const BOM = "﻿"

const commonPrefix = (line: string, prefix: string): number => {
  let at = 0
  while (at < prefix.length && line[at] === prefix[at]) at++
  return at
}

const lastNode = (nodes: ReadonlyArray<Node>): Node | undefined => {
  const last = nodes.at(-1)
  return last === undefined || last.children.length === 0 ? last : lastNode(last.children)
}

const indentUnit = (nodes: ReadonlyArray<Node>): string => {
  for (const parent of nodes) {
    const child = parent.children[0]
    if (
      child !== undefined &&
      child.indent.startsWith(parent.indent) &&
      child.indent !== parent.indent
    ) {
      return child.indent.slice(parent.indent.length)
    }
  }
  return logseqFormat.indent
}

export const toOutline = (document: Document): Outline => {
  const source = print(document)
  const bom = source.startsWith(BOM)
  const firstBreak = source.indexOf("\n")
  const eol = firstBreak > 0 && source[firstBreak - 1] === "\r" ? "\r\n" : "\n"
  const last = lastNode(document.blocks)
  const finalNewline = last !== undefined && last.lines.length > 1 && last.lines.at(-1) === ""
  const unCr = (line: string) => (eol === "\r\n" && line.endsWith("\r") ? line.slice(0, -1) : line)

  const toBlock = (node: Node): Block => {
    const prefix = `${node.indent}  `
    const [first = "", ...rest] =
      node === last && finalNewline ? node.lines.slice(0, -1) : node.lines
    const head = first.startsWith(" ") || first.startsWith("\t") ? first.slice(1) : first
    const lines = [head, ...rest.map((line) => line.slice(commonPrefix(line, prefix)))]
    return { text: lines.map(unCr).join("\n"), children: node.children.map(toBlock) }
  }

  const preamble = bom ? document.preamble.slice(BOM.length) : document.preamble
  return {
    preamble: eol === "\r\n" ? preamble.replaceAll("\r\n", "\n") : preamble,
    blocks: document.blocks.map(toBlock),
    format: { indent: indentUnit(document.blocks), eol, finalNewline, bom },
  }
}

export const render = (outline: Outline): string => {
  const { indent: unit, eol, finalNewline, bom } = outline.format

  const blockLines = (block: Block, depth: number): ReadonlyArray<string> => {
    const indent = unit.repeat(depth)
    const [first = "", ...rest] = block.text.split("\n")
    return [
      block.text === "" ? `${indent}-` : `${indent}- ${first}`,
      ...rest.map((line) => `${indent}  ${line}`),
      ...block.children.flatMap((child) => blockLines(child, depth + 1)),
    ]
  }

  const body = outline.blocks.flatMap((block) => blockLines(block, 0)).join("\n")
  const separator =
    body !== "" && outline.preamble !== "" && !outline.preamble.endsWith("\n") ? "\n" : ""
  const ending = body !== "" && finalNewline ? "\n" : ""
  const text = outline.preamble + separator + body + ending
  return (bom ? BOM : "") + (eol === "\n" ? text : text.replaceAll("\n", eol))
}
