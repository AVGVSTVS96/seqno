import { Context, Schema } from "effect"
import { Rpc, RpcGroup, type RpcClient, type RpcClientError } from "effect/rpc"
import { Block, BlockId, JournalDay, PageId } from "@seqno/domain"
import { GraphNotOpen } from "./errors.ts"

export const Reference = Schema.Struct({ blockId: BlockId, pageId: PageId })
export type Reference = typeof Reference.Type

export const PageStat = Schema.Struct({
  pageId: PageId,
  backlinks: Schema.Int,
  created: Schema.NullOr(Schema.Number),
  updated: Schema.NullOr(Schema.Number),
})
export type PageStat = typeof PageStat.Type

export const ReferencedPage = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  tag: Schema.Boolean,
  journalDay: Schema.NullOr(JournalDay),
  backlinks: Schema.Int,
  created: Schema.NullOr(Schema.Number),
  updated: Schema.NullOr(Schema.Number),
})
export type ReferencedPage = typeof ReferencedPage.Type

export const GraphNodeKind = Schema.Literals(["page", "journal", "tag"])
export type GraphNodeKind = typeof GraphNodeKind.Type

export const GraphNode = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  kind: GraphNodeKind,
  created: Schema.NullOr(Schema.Number),
})
export type GraphNode = typeof GraphNode.Type

export const PagesGraph = Schema.Struct({
  nodes: Schema.Array(GraphNode),
  links: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})
export type PagesGraph = typeof PagesGraph.Type

export const WatchReferences = Rpc.make("WatchReferences", {
  payload: { pageId: PageId },
  success: Schema.Array(Reference),
  error: GraphNotOpen,
  stream: true,
})

export const WatchNameReferences = Rpc.make("WatchNameReferences", {
  payload: { name: Schema.String },
  success: Schema.Array(Reference),
  error: GraphNotOpen,
  stream: true,
})

export const WatchUnlinkedReferences = Rpc.make("WatchUnlinkedReferences", {
  payload: { pageId: PageId },
  success: Schema.Array(Reference),
  error: GraphNotOpen,
  stream: true,
})

export const WatchPageStats = Rpc.make("WatchPageStats", {
  success: Schema.Array(PageStat),
  error: GraphNotOpen,
  stream: true,
})

export const WatchReferencedPages = Rpc.make("WatchReferencedPages", {
  success: Schema.Array(ReferencedPage),
  error: GraphNotOpen,
  stream: true,
})

export const WatchPagesGraph = Rpc.make("WatchPagesGraph", {
  success: PagesGraph,
  error: GraphNotOpen,
  stream: true,
})

export const Ancestors = Rpc.make("Ancestors", {
  payload: { blockIds: Schema.Array(BlockId) },
  success: Schema.Array(Block),
  error: GraphNotOpen,
})

export const PageRpcs = RpcGroup.make(
  WatchReferences,
  WatchNameReferences,
  WatchUnlinkedReferences,
  WatchPageStats,
  WatchReferencedPages,
  WatchPagesGraph,
  Ancestors,
)

export class PageClient extends Context.Service<
  PageClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof PageRpcs>, RpcClientError.RpcClientError>
>()("@seqno/rpc/PageClient") {}
