import { Schema } from "effect"
import { BlockId, PageId } from "./ids.ts"
import { Block, Page } from "./model.ts"

const EpochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const GraphEvent = Schema.TaggedUnion({
  PageUpserted: { page: Page },
  PageDeleted: { pageId: PageId },
  BlockUpserted: { block: Block, createdAt: EpochMillis, updatedAt: EpochMillis },
  BlockMoved: { blockId: BlockId, pageId: PageId, parentId: Schema.NullOr(BlockId) },
  BlockDeleted: { blockId: BlockId, pageId: PageId },
})
export type GraphEvent = typeof GraphEvent.Type
