import { Schema } from "effect"
import { BlockId, PageId } from "./ids.ts"
import { Props } from "./model.ts"

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const BlockIds = Schema.NonEmptyArray(BlockId)

export const PropertyTarget = Schema.TaggedUnion({
  BlockTarget: { blockId: BlockId },
  PageTarget: { pageId: PageId },
})
export type PropertyTarget = typeof PropertyTarget.Type

export interface BlockDraft {
  readonly text: string
  readonly props: Props
  readonly children: ReadonlyArray<BlockDraft>
}

export const BlockDraft: Schema.Codec<BlockDraft> = Schema.Struct({
  text: Schema.String,
  props: Props,
  children: Schema.Array(Schema.suspend((): Schema.Codec<BlockDraft> => BlockDraft)),
})

export const Command = Schema.TaggedUnion({
  CreatePage: { title: Schema.String },
  RenamePage: { pageId: PageId, title: Schema.String },
  DeletePage: { pageId: PageId },
  InsertBlock: {
    pageId: PageId,
    parentId: Schema.NullOr(BlockId),
    after: Schema.optionalKey(BlockId),
    text: Schema.String,
  },
  InsertBlocks: {
    pageId: PageId,
    parentId: Schema.NullOr(BlockId),
    after: Schema.optionalKey(BlockId),
    blocks: Schema.NonEmptyArray(BlockDraft),
  },
  EditText: { blockId: BlockId, from: Offset, to: Offset, insert: Schema.String },
  SplitBlock: { blockId: BlockId, at: Offset },
  MergeWithPrevious: { blockId: BlockId },
  Indent: { blockIds: BlockIds },
  Outdent: { blockIds: BlockIds },
  MoveBlocks: {
    blockIds: BlockIds,
    parentId: Schema.NullOr(BlockId),
    after: Schema.optionalKey(BlockId),
  },
  DeleteBlocks: { blockIds: BlockIds },
  SetCollapsed: { blockId: BlockId, collapsed: Schema.Boolean },
  SetProperty: {
    target: PropertyTarget,
    key: Schema.NonEmptyString,
    value: Schema.NullOr(Schema.String),
  },
  Undo: {},
  Redo: {},
})
export type Command = typeof Command.Type
