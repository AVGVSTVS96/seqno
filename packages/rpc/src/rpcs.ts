import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Block, BlockDraft, BlockId, Command, GraphEvent, Page, PageId } from "@seqno/domain"
import {
  BlockNotFound,
  BlockRefNotFound,
  CommandRejected,
  GraphLocked,
  GraphNotOpen,
  GraphUnavailable,
  PageNotFound,
  QueryInvalid,
  WhiteboardUnreadable,
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

export const ExportedTree = Schema.Struct({
  page: Page,
  blocks: Schema.Array(Block),
  path: Schema.String,
})
export type ExportedTree = typeof ExportedTree.Type

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

export const ExportPages = Rpc.make("ExportPages", {
  payload: { from: Schema.optionalKey(Schema.Array(PageId)) },
  success: Schema.Array(ExportedTree),
  error: GraphNotOpen,
})

export const ReadWhiteboard = Rpc.make("ReadWhiteboard", {
  payload: { pageId: PageId, edn: Schema.String },
  success: Schema.Array(BlockDraft),
  error: WhiteboardUnreadable,
})

export const GetBlock = Rpc.make("GetBlock", {
  payload: { blockId: BlockId },
  success: Block,
  error: Schema.Union([GraphNotOpen, BlockNotFound]),
})

export const GetBlockByRef = Rpc.make("GetBlockByRef", {
  payload: { uuid: Schema.String },
  success: Block,
  error: Schema.Union([GraphNotOpen, BlockRefNotFound]),
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
  payload: {
    text: Schema.String,
    pageId: Schema.optional(PageId),
    code: Schema.optional(Schema.Boolean),
  },
  success: SearchHits,
  error: GraphNotOpen,
})

export const RebuildIndex = Rpc.make("RebuildIndex", { error: GraphNotOpen })

export const PageFile = Schema.Struct({ path: Schema.String, name: Schema.String })
export type PageFile = typeof PageFile.Type

export const ListPageFiles = Rpc.make("ListPageFiles", {
  success: Schema.Array(PageFile),
  error: GraphNotOpen,
})

export const AppFilePath = Schema.Literals([
  "logseq/config.edn",
  "logseq/custom.css",
  "logseq/custom.js",
  "logseq/export.css",
])
export type AppFilePath = typeof AppFilePath.Type

export const AppFile = Schema.Struct({ path: AppFilePath, text: Schema.String })
export type AppFile = typeof AppFile.Type

export const WatchAppFiles = Rpc.make("WatchAppFiles", {
  success: Schema.Array(AppFile),
  error: GraphNotOpen,
  stream: true,
})

export const WriteAppFile = Rpc.make("WriteAppFile", {
  payload: AppFile,
  error: Schema.Union([GraphNotOpen, CommandRejected]),
})

export const ConfigFlag = Schema.Literals([":ui/show-brackets?"])

export const SetConfigFlag = Rpc.make("SetConfigFlag", {
  payload: { key: ConfigFlag, value: Schema.Boolean },
  error: Schema.Union([GraphNotOpen, CommandRejected]),
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

export const MirrorFile = Schema.Struct({ path: Schema.String, reason: Schema.String })
export type MirrorFile = typeof MirrorFile.Type

export const MirrorWriter = Schema.Struct({ device: Schema.String, here: Schema.Boolean })
export type MirrorWriter = typeof MirrorWriter.Type

export const MirrorStatus = Schema.Struct({
  left: Schema.Array(MirrorFile),
  failed: Schema.Array(MirrorFile),
  paused: Schema.NullOr(Schema.String),
  writer: Schema.NullOr(MirrorWriter),
})
export type MirrorStatus = typeof MirrorStatus.Type

export const WatchMirror = Rpc.make("WatchMirror", {
  success: MirrorStatus,
  error: GraphNotOpen,
  stream: true,
})

export const WriteFilesHere = Rpc.make("WriteFilesHere", { error: GraphNotOpen })

export const CheckFiles = Rpc.make("CheckFiles", { error: GraphNotOpen })

export const Change = Schema.Struct({
  events: Schema.Array(GraphEvent),
  madeIn: Schema.Literals(["thisTab", "otherTab", "noTab"]),
})
export type Change = typeof Change.Type

export const WatchChanges = Rpc.make("WatchChanges", {
  success: Change,
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
  ExportPages,
  ReadWhiteboard,
  GetBlock,
  GetBlockByRef,
  WatchPage,
  WatchQuery,
  Search,
  RebuildIndex,
  ListPageFiles,
  WatchAppFiles,
  WriteAppFile,
  SetConfigFlag,
  WatchBlockRefCounts,
  WatchBlockReferences,
  WatchSaveState,
  WatchChanges,
  WatchMirror,
  WriteFilesHere,
  CheckFiles,
)
