import { Context, type Crypto, type Effect, type Option, type Scope } from "effect"
import type { Block, BlockId, Command, DeviceId, GraphEvent, PageId } from "@seqno/domain"
import type { CommandRejected } from "@seqno/rpc"
import type { CloudFs } from "./cloud.ts"
import type { Span, VV } from "./vv.ts"

export type Fate =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Alive"; readonly root: string }
  | { readonly _tag: "Deleted"; readonly top: string }

export interface Replica {
  readonly peer: string
  readonly dispatch: (command: Command) => Effect.Effect<ReadonlyArray<GraphEvent>, CommandRejected>
  readonly block: (id: BlockId) => Effect.Effect<Option.Option<Block>>
  readonly pageAlive: (id: PageId) => Effect.Effect<boolean>
  readonly children: (
    pageId: PageId,
    parentId: BlockId | null,
  ) => Effect.Effect<ReadonlyArray<BlockId>>
  readonly fate: (id: string) => Effect.Effect<Fate>
  readonly version: Effect.Effect<VV>
  readonly exportUpdates: (from: VV) => Effect.Effect<Uint8Array>
  readonly exportSnapshot: Effect.Effect<Uint8Array>
  readonly importBlobs: (blobs: ReadonlyArray<Uint8Array>) => Effect.Effect<ReadonlyArray<boolean>>
  readonly canonical: Effect.Effect<string>
  readonly liveNodes: Effect.Effect<number>
}

export interface ReplicaSpec {
  readonly deviceId: DeviceId
  readonly peer: number
}

export class Graphs extends Context.Service<
  Graphs,
  {
    readonly open: (spec: ReplicaSpec) => Effect.Effect<Replica, never, Scope.Scope | Crypto.Crypto>
    readonly blobSpan: (bytes: Uint8Array, checksum: boolean) => Option.Option<Span>
  }
>()("@seqno/sync-sim/Graphs") {}

export interface VaultSpec {
  readonly deviceId: DeviceId
  readonly members: ReadonlyArray<DeviceId>
  readonly compaction: boolean
  readonly compactAfterFiles: number
  readonly compactMinIntervalMs: number
  readonly snapshotImportDelayMs: number
  readonly seenMinIntervalMs: number
}

export interface VaultStats {
  readonly importedFiles: number
  readonly importedBytes: number
  readonly placeholdersSeen: number
}

export interface PassOutcome {
  readonly wakeInMs: number | null
}

export interface VaultSync {
  readonly flush: Effect.Effect<void>
  readonly pass: Effect.Effect<PassOutcome>
  readonly stats: Effect.Effect<VaultStats>
}

export class Vaults extends Context.Service<
  Vaults,
  {
    readonly attach: (
      spec: VaultSpec,
      fs: CloudFs,
      replica: Replica,
    ) => Effect.Effect<VaultSync, never, Graphs>
  }
>()("@seqno/sync-sim/Vaults") {}
