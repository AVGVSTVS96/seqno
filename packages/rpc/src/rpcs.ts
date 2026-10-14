import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Block, BlockId, Command, GraphEvent, Page, PageId } from "@seqno/domain"
import {
  BlockNotFound,
  CommandRejected,
  GraphLocked,
  GraphNotOpen,
  GraphUnavailable,
  PageNotFound,
  QueryInvalid,
} from "./errors.ts"

export const SkippedFile = Schema.Struct({ path: Schema.String, reason: Schema.String })
export type SkippedFile = typeof SkippedFile.Type

export const GraphOpened = Schema.Struct({
  graph: Schema.String,
  skipped: Schema.Array(SkippedFile),
})
export type GraphOpened = typeof GraphOpened.Type

export const PageTree = Schema.Struct({
  page: Page,
  blocks: Schema.Array(Block),
})
export type PageTree = typeof PageTree.Type

export const QueryResult = Schema.TaggedUnion({
  BlockRows: { blocks: Schema.Array(Block) },
  PageRows: { pages: Schema.Array(Page) },
})
export type QueryResult = typeof QueryResult.Type

export const SearchHits = Schema.Struct({
  pages: Schema.Array(Page),
  blocks: Schema.Array(Block),
})
export type SearchHits = typeof SearchHits.Type

export const SaveState = Schema.TaggedUnion({
  Saved: {},
  Unsaved: {},
  Failed: { reason: Schema.String },
})
export type SaveState = typeof SaveState.Type

export const GraphMoved = Schema.Struct({ graph: Schema.String })
export type GraphMoved = typeof GraphMoved.Type

export const tabLock = (tab: string) => `seqno/tab/${tab}`

export const Attach = Rpc.make("Attach", {
  payload: { tab: Schema.NonEmptyString },
  success: GraphMoved,
  stream: true,
})

export const OpenGraph = Rpc.make("OpenGraph", {
  payload: { graph: Schema.NonEmptyString, wait: Schema.optionalKey(Schema.Boolean) },
  success: GraphOpened,
  error: Schema.Union([GraphUnavailable, GraphLocked]),
})

export const ForgetGraph = Rpc.make("ForgetGraph", {
  payload: { graph: Schema.NonEmptyString },
})

export const Dispatch = Rpc.make("Dispatch", {
  payload: { command: Command },
  success: Schema.Array(GraphEvent),
  error: Schema.Union([GraphNotOpen, CommandRejected]),
})

export const DispatchAll = Rpc.make("DispatchAll", {
  payload: { commands: Schema.Array(Command) },
  success: Schema.Array(GraphEvent),
  error: Schema.Union([GraphNotOpen, CommandRejected]),
})

export const GetPages = Rpc.make("GetPages", {
  success: Schema.Array(Page),
  error: GraphNotOpen,
})

export const GetPage = Rpc.make("GetPage", {
  payload: { pageId: PageId },
  success: PageTree,
  error: Schema.Union([GraphNotOpen, PageNotFound]),
})

export const GetBlock = Rpc.make("GetBlock", {
  payload: { blockId: BlockId },
  success: Block,
  error: Schema.Union([GraphNotOpen, BlockNotFound]),
})

export const WatchPage = Rpc.make("WatchPage", {
  payload: { pageId: PageId },
  success: PageTree,
  error: Schema.Union([GraphNotOpen, PageNotFound]),
  stream: true,
})

export const WatchQuery = Rpc.make("WatchQuery", {
  payload: { query: Schema.String },
  success: QueryResult,
  error: Schema.Union([GraphNotOpen, QueryInvalid]),
  stream: true,
})

export const Search = Rpc.make("Search", {
  payload: { text: Schema.String },
  success: SearchHits,
  error: GraphNotOpen,
})

export const WatchBlockRefCounts = Rpc.make("WatchBlockRefCounts", {
  success: Schema.Record(Schema.String, Schema.Int),
  error: GraphNotOpen,
  stream: true,
})

export const WatchBlockReferences = Rpc.make("WatchBlockReferences", {
  payload: { uuid: Schema.String },
  success: Schema.Array(Block),
  error: GraphNotOpen,
  stream: true,
})

export const WatchSaveState = Rpc.make("WatchSaveState", {
  success: SaveState,
  error: GraphNotOpen,
  stream: true,
})

export const CoreRpcs = RpcGroup.make(
  Attach,
  OpenGraph,
  ForgetGraph,
  Dispatch,
  DispatchAll,
  GetPages,
  GetPage,
  GetBlock,
  WatchPage,
  WatchQuery,
  Search,
  WatchBlockRefCounts,
  WatchBlockReferences,
  WatchSaveState,
)
