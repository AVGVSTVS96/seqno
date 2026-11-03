import { BlockId, type Block, type Command, type PageId } from "@seqno/domain"

export const isGhost = (id: BlockId) => id.startsWith("00000000-0000-7000-8000-")

export const ghostId = (index: number) =>
  BlockId.make(`00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`)

const withProp = (block: Block, key: string, value: string | null): Block => {
  const { [key]: _, ...rest } = block.props
  return { ...block, props: value === null ? rest : { ...rest, [key]: value } }
}

const insertAt = (
  blocks: ReadonlyArray<Block>,
  after: BlockId | undefined,
  added: ReadonlyArray<Block>,
): ReadonlyArray<Block> => {
  if (after === undefined) return [...added, ...blocks]
  const index = blocks.findIndex((block) => block.id === after)
  return index === -1
    ? [...blocks, ...added]
    : [...blocks.slice(0, index + 1), ...added, ...blocks.slice(index + 1)]
}

const applyOne = (blocks: ReadonlyArray<Block>, command: Command): ReadonlyArray<Block> => {
  switch (command._tag) {
    case "SetProperty": {
      const { target } = command
      return target._tag === "BlockTarget"
        ? blocks.map((block) =>
            block.id === target.blockId ? withProp(block, command.key, command.value) : block,
          )
        : blocks
    }
    case "InsertBlocks":
      return insertAt(
        blocks,
        command.after,
        command.blocks.map((draft, index): Block => ({
          id: draft.id ?? ghostId(index),
          pageId: command.pageId,
          parentId: null,
          text: draft.text,
          collapsed: false,
          props: draft.props,
        })),
      )
    case "DeleteBlocks": {
      const gone = new Set<BlockId>(command.blockIds)
      return blocks.filter((block) => !gone.has(block.id))
    }
    case "EditText":
      return blocks.map((block) =>
        block.id === command.blockId
          ? {
              ...block,
              text:
                block.text.slice(0, command.from) + command.insert + block.text.slice(command.to),
            }
          : block,
      )
    default:
      return blocks
  }
}

export const applyLocally = (
  blocks: ReadonlyArray<Block>,
  commands: ReadonlyArray<Command>,
): ReadonlyArray<Block> => commands.reduce(applyOne, blocks)

export interface Pending {
  readonly base: unknown
  readonly pageId: PageId
  readonly commands: ReadonlyArray<Command>
}
