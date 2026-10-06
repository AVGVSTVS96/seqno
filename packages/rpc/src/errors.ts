import { Schema } from "effect"
import { BlockId, PageId } from "@seqno/domain"

export class GraphNotOpen extends Schema.TaggedError<GraphNotOpen>()("GraphNotOpen", {}) {}

export class GraphUnavailable extends Schema.TaggedError<GraphUnavailable>()("GraphUnavailable", {
  graph: Schema.String,
  reason: Schema.String,
}) {}

export class PageNotFound extends Schema.TaggedError<PageNotFound>()("PageNotFound", {
  pageId: PageId,
}) {}

export class BlockNotFound extends Schema.TaggedError<BlockNotFound>()("BlockNotFound", {
  blockId: BlockId,
}) {}

export class CommandRejected extends Schema.TaggedError<CommandRejected>()("CommandRejected", {
  reason: Schema.String,
}) {}

export class QueryInvalid extends Schema.TaggedError<QueryInvalid>()("QueryInvalid", {
  query: Schema.String,
  reason: Schema.String,
}) {}
