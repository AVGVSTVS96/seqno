import { Schema } from "effect"
import type { Block, Command } from "@seqno/domain"

export const EditorIntent = Schema.TaggedUnion({
  Split: { at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) },
  MergeWithPrevious: {},
  Indent: {},
  Outdent: {},
  FocusPrevious: {},
  FocusNext: {},
  Exit: {},
  SelectUp: {},
  SelectDown: {},
  MoveUp: {},
  MoveDown: {},
  Collapse: {},
  Expand: {},
})
export type EditorIntent = typeof EditorIntent.Type

export interface EditorSlotProps {
  readonly block: Block
  readonly caret: number
  readonly dispatch: (command: Command) => void
  readonly dispatchAll: (commands: ReadonlyArray<Command>) => void
  readonly onIntent: (intent: EditorIntent) => void
}
