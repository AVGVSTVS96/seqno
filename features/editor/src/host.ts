import { Schema } from "effect"
import type { Effect } from "effect"
import type { Block, Command, Page } from "@seqno/domain"

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const CursorPlacement = Schema.TaggedUnion({
  Start: {},
  End: {},
  Offset: { offset: Offset },
  FirstLine: { x: Schema.Number },
  LastLine: { x: Schema.Number },
})
export type CursorPlacement = typeof CursorPlacement.Type

export const LinkTarget = Schema.TaggedUnion({
  Url: { url: Schema.String },
  Page: { name: Schema.String },
  Block: { uuid: Schema.String },
})
export type LinkTarget = typeof LinkTarget.Type

export const EditorAction = Schema.TaggedUnion({
  FocusPrevious: {},
  FocusNext: {},
  Exit: {},
  MoveUp: {},
  MoveDown: {},
  SelectUp: {},
  SelectDown: {},
  Collapse: {},
  Expand: {},
  ToggleCollapse: {},
  MergeNext: {},
  ZoomIn: {},
  ZoomOut: {},
  Open: { target: LinkTarget, sidebar: Schema.Boolean },
})
export type EditorAction = typeof EditorAction.Type

export interface BlockHit {
  readonly block: Block
  readonly path: ReadonlyArray<string>
}

export interface EditorHost {
  readonly dispatch: (command: Command) => void
  readonly act: (action: EditorAction) => void
  readonly searchPages: (query: string) => Effect.Effect<ReadonlyArray<Page>>
  readonly searchBlocks: (query: string) => Effect.Effect<ReadonlyArray<BlockHit>>
}
