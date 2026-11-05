import { Context, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import type { RpcClient, RpcClientError } from "effect/rpc"
import { GraphNotOpen } from "./errors.ts"

export class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", {
  reason: Schema.String,
}) {}

export const GitResult = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Int,
})

export type GitResult = typeof GitResult.Type

export const GitCommitted = Schema.TaggedUnion({
  Committed: { oid: Schema.String },
  NothingToCommit: {},
  NoIdentity: {},
  Busy: {},
})

export type GitCommitted = typeof GitCommitted.Type

export const GitVersion = Schema.Struct({
  oid: Schema.String,
  subject: Schema.String,
  date: Schema.String,
})

export type GitVersion = typeof GitVersion.Type

export const GitSettings = Schema.Struct({
  autoCommit: Schema.Boolean,
  seconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 86_400 })),
  commitOnClose: Schema.Boolean,
})

export type GitSettings = typeof GitSettings.Type

export const defaultGitSettings: GitSettings = {
  autoCommit: false,
  seconds: 60,
  commitOnClose: false,
}

export const GitNotice = Schema.TaggedUnion({
  IdentityNeeded: {},
  CommitFailed: { reason: Schema.String },
})

export type GitNotice = typeof GitNotice.Type

export const GitRun = Rpc.make("GitRun", {
  payload: { args: Schema.Array(Schema.String) },
  success: GitResult,
  error: GraphNotOpen,
})

export const GitCommit = Rpc.make("GitCommit", {
  payload: { message: Schema.String },
  success: GitCommitted,
  error: Schema.Union([GraphNotOpen, GitFailed]),
})

export const GitHistory = Rpc.make("GitHistory", {
  payload: { page: Schema.String },
  success: Schema.Struct({
    path: Schema.NullOr(Schema.String),
    versions: Schema.Array(GitVersion),
  }),
  error: Schema.Union([GraphNotOpen, GitFailed]),
})

export const GitRevert = Rpc.make("GitRevert", {
  payload: { oid: Schema.String, path: Schema.String },
  error: Schema.Union([GraphNotOpen, GitFailed]),
})

export const GitSetIdentity = Rpc.make("GitSetIdentity", {
  payload: { name: Schema.NonEmptyString, email: Schema.NonEmptyString },
  error: GitFailed,
})

export const GitLoadIgnore = Rpc.make("GitLoadIgnore", {
  success: Schema.String,
  error: Schema.Union([GraphNotOpen, GitFailed]),
})

export const GitSaveIgnore = Rpc.make("GitSaveIgnore", {
  payload: { text: Schema.String },
  error: Schema.Union([GraphNotOpen, GitFailed]),
})

export const WatchGitSettings = Rpc.make("WatchGitSettings", {
  success: GitSettings,
  stream: true,
})

export const SetGitSettings = Rpc.make("SetGitSettings", {
  payload: GitSettings,
  error: GitFailed,
})

export const WatchGitNotices = Rpc.make("WatchGitNotices", {
  success: GitNotice,
  stream: true,
})

export const GitClosing = Rpc.make("GitClosing", {})

export const GitRpcs = RpcGroup.make(
  GitRun,
  GitCommit,
  GitHistory,
  GitRevert,
  GitSetIdentity,
  GitLoadIgnore,
  GitSaveIgnore,
  WatchGitSettings,
  SetGitSettings,
  WatchGitNotices,
  GitClosing,
)

export class GitClient extends Context.Service<
  GitClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof GitRpcs>, RpcClientError.RpcClientError>
>()("@seqno/rpc/GitClient") {}
