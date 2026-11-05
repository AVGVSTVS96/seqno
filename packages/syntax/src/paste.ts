import { parse } from "./document.ts"
import { toOutline } from "./outline.ts"
import type { Block } from "./outline.ts"
import { splitProperties } from "./properties.ts"

export interface PastedBlock {
  readonly text: string
  readonly props: Readonly<Record<string, string>>
  readonly children: readonly PastedBlock[]
}

const pasted = (block: Block): PastedBlock => {
  const { text, props } = splitProperties(block.text)

  return { text, props: Object.fromEntries(props), children: block.children.map(pasted) }
}

const fence = /^\s*(`{3,}|~{3,})/

const paragraphs = (source: string): readonly string[] => {
  const found: string[] = []
  let lines: string[] = []
  let fenced = false

  for (const line of source.split("\n")) {
    if (fence.test(line)) {
      fenced = !fenced
    }

    if (!fenced && line.trim() === "") {
      if (lines.length > 0) {
        found.push(lines.join("\n"))
      }

      lines = []
    } else {
      lines.push(line)
    }
  }

  if (lines.length > 0) {
    found.push(lines.join("\n"))
  }

  return found
}

const plain = (text: string): PastedBlock => ({ text, props: {}, children: [] })

export const pastedBlocks = (source: string): readonly PastedBlock[] | null => {
  const text = source.replaceAll("\r\n", "\n")
  const outline = toOutline(parse(text))

  if (outline.blocks.length === 0) {
    const found = paragraphs(text)

    return found.length === 0 ? null : found.map(plain)
  }

  return outline.preamble.trim() === "" ? outline.blocks.map(pasted) : null
}

export const isSingleLine = (blocks: readonly PastedBlock[]) => {
  const [only, ...rest] = blocks

  return (
    only !== undefined &&
    rest.length === 0 &&
    only.children.length === 0 &&
    Object.keys(only.props).length === 0
  )
}
