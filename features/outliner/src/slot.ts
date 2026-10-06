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
})
export type EditorIntent = typeof EditorIntent.Type

export interface EditorSlotProps {
  readonly block: Block
  readonly caret: number
  readonly dispatch: (command: Command) => void
  readonly onIntent: (intent: EditorIntent) => void
}
