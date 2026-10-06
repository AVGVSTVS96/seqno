import { Schema } from "effect"
import type { Effect, Stream } from "effect"
import type { Block, BlockId, Command, Page } from "@seqno/domain"

const Column = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const CursorPlacement = Schema.TaggedUnion({
  Start: {},
  End: {},
  Offset: { offset: Column },
  FirstLine: { column: Column },
  LastLine: { column: Column },
})
export type CursorPlacement = typeof CursorPlacement.Type

export const Navigation = Schema.TaggedUnion({
  ToPrevious: { cursor: CursorPlacement },
  ToNext: { cursor: CursorPlacement },
})
export type Navigation = typeof Navigation.Type

export interface EditorHost {
  readonly dispatch: (command: Command) => void
  readonly navigate: (navigation: Navigation) => void
  readonly searchPages: (query: string) => Effect.Effect<ReadonlyArray<Page>>
  readonly searchBlocks: (query: string) => Effect.Effect<ReadonlyArray<Block>>
}

export interface BlockEditorOptions {
  readonly blockId: BlockId
  readonly text: string
  readonly cursor: CursorPlacement
  readonly textUpdates: Stream.Stream<string>
  readonly host: EditorHost
}
