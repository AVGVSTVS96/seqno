import {
  Annotation,
  EditorSelection,
  type SelectionRange,
  type Transaction,
} from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
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

export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export const minimalChange = (current: string, next: string): TextChange => {
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

export interface TextSync {
  readonly local: (text: string) => void
  readonly external: () => void
  readonly isNews: (text: string) => boolean
  readonly confirmed: () => boolean
}

export const textSync = (confirmed: string, pending: Array<string>): TextSync => {
  let base: string | null = confirmed
  return {
    local: (text) => {
      pending.push(text)
    },
    external: () => {
      base = null
      pending.length = 0
    },
    isNews: (text) => {
      const echo = pending.indexOf(text)
      if (echo !== -1) {
        base = text
        pending.splice(0, echo + 1)
        return false
      }
      if (text === base) return false
      base = text
      pending.length = 0
      return true
    },
    confirmed: () => pending.length === 0,
  }
}

export const placeCursor = (view: EditorView, placement: CursorPlacement): SelectionRange => {
  const length = view.state.doc.length
  return CursorPlacement.match(placement, {
    Start: () => EditorSelection.cursor(0),
    End: () => EditorSelection.cursor(length),
    Offset: ({ offset }) => EditorSelection.cursor(Math.min(offset, length)),
    FirstLine: ({ column }) => {
      const end = view.moveToLineBoundary(EditorSelection.cursor(0), true, true).head
      return EditorSelection.cursor(Math.min(column, end))
    },
    LastLine: ({ column }) => {
      const start = view.moveToLineBoundary(EditorSelection.cursor(length), false, true).head
      return EditorSelection.cursor(Math.min(start + column, length))
    },
  })
}
