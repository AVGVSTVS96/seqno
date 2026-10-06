export type NodeId = string

export type Delta = { readonly retain: number } | { readonly insert: string } | { readonly delete: number }

export type DocEvent =
  | { readonly kind: "text"; readonly node: NodeId; readonly delta: readonly Delta[] }
  | { readonly kind: "meta"; readonly node: NodeId; readonly updated: Readonly<Record<string, unknown>> }
  | { readonly kind: "create"; readonly node: NodeId; readonly parent: NodeId | null; readonly index: number }
  | {
      readonly kind: "move"
      readonly node: NodeId
      readonly parent: NodeId | null
      readonly index: number
      readonly oldParent: NodeId | null
      readonly oldIndex: number
    }
  | { readonly kind: "delete"; readonly node: NodeId; readonly oldParent: NodeId | null; readonly oldIndex: number }

export interface TreeValue {
  readonly id: NodeId
  readonly meta: Readonly<Record<string, unknown>>
  readonly children: readonly TreeValue[]
}

export interface Version {
  readonly _version: unique symbol
}

export interface Doc {
  importBytes(bytes: Uint8Array): void
  exportSnapshot(): Uint8Array
  exportUpdatesSince(version: Version): Uint8Array
  oplogVersion(): Version
  versionJSON(): Record<string, number>
  frontiersJSON(): string[]
  setPeer(peer: bigint): void
  commit(): void
  subscribe(listener: (events: readonly DocEvent[]) => void): () => void
  tree(): readonly TreeValue[]
  roots(): NodeId[]
  children(node: NodeId): NodeId[]
  getMeta(node: NodeId, key: string): unknown
  toJSON(): unknown
  createNode(parent: NodeId | null, index?: number): NodeId
  move(node: NodeId, parent: NodeId | null, index: number): void
  deleteNode(node: NodeId): void
  setMeta(node: NodeId, key: string, value: string | number): void
  createText(node: NodeId, key: string, initial: string): void
  insertText(node: NodeId, key: string, index: number, text: string): void
  deleteText(node: NodeId, key: string, index: number, length: number): void
}

export interface Engine {
  readonly name: string
  readonly version: string
  createDoc(): Doc
}

export const TREE = "blocks"
