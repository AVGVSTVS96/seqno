import { parse } from "./document.ts"
import { toOutline, type Block } from "./outline.ts"
import { splitProperties } from "./properties.ts"

export interface PastedBlock {
  readonly text: string
  readonly props: Readonly<Record<string, string>>
  readonly children: ReadonlyArray<PastedBlock>
}

const pasted = (block: Block): PastedBlock => {
  const { text, props } = splitProperties(block.text)
  return { text, props: Object.fromEntries(props), children: block.children.map(pasted) }
}

export const pastedBlocks = (source: string): ReadonlyArray<PastedBlock> | null => {
  const outline = toOutline(parse(source.replaceAll("\r\n", "\n")))
  return outline.blocks.length === 0 || outline.preamble.trim() !== ""
    ? null
    : outline.blocks.map(pasted)
}

export const isSingleLine = (blocks: ReadonlyArray<PastedBlock>) => {
  const [only, ...rest] = blocks
  return (
    only !== undefined &&
    rest.length === 0 &&
    only.children.length === 0 &&
    Object.keys(only.props).length === 0
  )
}
