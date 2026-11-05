import { Context, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import type { RpcClient, RpcClientError } from "effect/rpc"
import { GraphNotOpen } from "./errors.ts"

export const Asset = Schema.Struct({
  path: Schema.String,
  url: Schema.String,
  size: Schema.Number,
  modified: Schema.Number,
})

export type Asset = typeof Asset.Type

export class AssetFailed extends Schema.TaggedError<AssetFailed>()("AssetFailed", {
  path: Schema.String,
  reason: Schema.String,
}) {}

export const WatchAssets = Rpc.make("WatchAssets", {
  success: Schema.Array(Asset),
  error: GraphNotOpen,
  stream: true,
})

export const SaveAsset = Rpc.make("SaveAsset", {
  payload: { name: Schema.String, data: Schema.Uint8Array },
  success: Asset,
  error: Schema.Union([GraphNotOpen, AssetFailed]),
})

export const WriteAsset = Rpc.make("WriteAsset", {
  payload: { path: Schema.String, data: Schema.Uint8Array },
  success: Asset,
  error: Schema.Union([GraphNotOpen, AssetFailed]),
})

export const RemoveAsset = Rpc.make("RemoveAsset", {
  payload: { path: Schema.String },
  error: Schema.Union([GraphNotOpen, AssetFailed]),
})

export const AssetRpcs = RpcGroup.make(WatchAssets, SaveAsset, WriteAsset, RemoveAsset)

export class AssetClient extends Context.Service<
  AssetClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof AssetRpcs>, RpcClientError.RpcClientError>
>()("@seqno/rpc/AssetClient") {}
