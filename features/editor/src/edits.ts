import { Annotation, type ChangeSpec, type Text, type Transaction } from "@codemirror/state"
import type { BlockId, Command } from "@seqno/domain"
import { CursorPlacement } from "./host.ts"

export const fromGraph = Annotation.define<true>()

export const editTextCommands = (blockId: BlockId, transaction: Transaction): Array<Command> => {
  const edits: Array<Command> = []
  transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
    edits.unshift({
      _tag: "EditText",
      blockId,
      from: fromA,
      to: toA,
      insert: transaction.newDoc.sliceString(fromB, toB),
    })
  })
  return edits
}

export const minimalChange = (current: string, next: string): ChangeSpec => {
  const shorter = Math.min(current.length, next.length)
  let prefix = 0
  while (prefix < shorter && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++
  }
  return {
    from: prefix,
    to: current.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  }
}

export const resolveCursor = (doc: Text, placement: CursorPlacement): number =>
  CursorPlacement.match(placement, {
    Start: () => 0,
    End: () => doc.length,
    Offset: ({ offset }) => Math.min(offset, doc.length),
    FirstLine: ({ column }) => {
      const line = doc.line(1)
      return line.from + Math.min(column, line.length)
    },
    LastLine: ({ column }) => {
      const line = doc.line(doc.lines)
      return line.from + Math.min(column, line.length)
    },
  })
