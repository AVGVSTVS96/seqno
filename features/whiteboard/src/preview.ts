import { Match } from "effect"
import { BlockId } from "@seqno/domain"
import type { Block, BlockDraft, Command, PageId } from "@seqno/domain"
import { freshId } from "./ids.ts"

export const isGhost = (id: BlockId) => id.startsWith("00000000-0000-7000-8000-")

export const ghostId = (index: number) =>
  BlockId.make(`00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`)

const withProp = (block: Block, key: string, value: string | null): Block => {
  const { [key]: _, ...rest } = block.props

  return { ...block, props: value === null ? rest : { ...rest, [key]: value } }
}

const insertAt = (
  blocks: readonly Block[],
  after: BlockId | undefined,
  added: readonly Block[],
): readonly Block[] => {
  if (after === undefined) {
    return [...added, ...blocks]
  }

  const index = blocks.findIndex((block) => block.id === after)

  return index === -1
    ? [...blocks, ...added]
    : [...blocks.slice(0, index + 1), ...added, ...blocks.slice(index + 1)]
}

const applyOne = (blocks: readonly Block[], command: Command): readonly Block[] =>
  Match.value(command).pipe(
    Match.tag("SetProperty", ({ target, key, value }) =>
      target._tag === "BlockTarget"
        ? blocks.map((block) => (block.id === target.blockId ? withProp(block, key, value) : block))
        : blocks,
    ),
    Match.tag("InsertBlocks", (insert) =>
      insertAt(
        blocks,
        insert.after,
        insert.blocks.map((draft, index): Block => ({
          id: draft.id ?? ghostId(index),
          pageId: insert.pageId,
          parentId: null,
          text: draft.text,
          collapsed: false,
          props: draft.props,
        })),
      ),
    ),
    Match.tag("DeleteBlocks", ({ blockIds }) => {
      const gone = new Set<BlockId>(blockIds)

      return blocks.filter((block) => !gone.has(block.id))
    }),
    Match.tag("EditText", (edit) =>
      blocks.map((block) =>
        block.id === edit.blockId
          ? {
              ...block,
              text: block.text.slice(0, edit.from) + edit.insert + block.text.slice(edit.to),
            }
          : block,
      ),
    ),
    Match.orElse(() => blocks),
  )

export const applyLocally = (
  blocks: readonly Block[],
  commands: readonly Command[],
): readonly Block[] => commands.reduce(applyOne, blocks)

const withId = ({ id, text, props, children }: BlockDraft): BlockDraft => ({
  id: id ?? freshId(),
  text,
  props,
  children: children.map(withId),
})

export const withIds = (commands: readonly Command[]): readonly Command[] =>
  commands.map((command) => {
    if (command._tag !== "InsertBlocks") {
      return command
    }

    const [first, ...rest] = command.blocks

    return { ...command, blocks: [withId(first), ...rest.map(withId)] }
  })

export interface Pending {
  readonly base: unknown
  readonly pageId: PageId
  readonly commands: readonly Command[]
}
