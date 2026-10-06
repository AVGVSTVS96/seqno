import type { BlockId, PageId } from "@seqno/domain"

export type NavigationTarget =
  | { readonly _tag: "Journals" }
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "Zoom"; readonly pageId: PageId; readonly blockId: BlockId | null }
  | { readonly _tag: "SidebarPage"; readonly name: string }
  | { readonly _tag: "SidebarBlock"; readonly blockId: BlockId }

export type Navigate = (target: NavigationTarget) => void

export interface BlockMenuRequest {
  readonly pageId: PageId
  readonly blockIds: readonly [BlockId, ...Array<BlockId>]
  readonly x: number
  readonly y: number
}

export type OpenBlockMenu = (request: BlockMenuRequest) => void
