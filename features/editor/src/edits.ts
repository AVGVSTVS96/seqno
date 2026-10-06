import {
  Annotation,
  EditorSelection,
  type ChangeSpec,
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

const atX = (view: EditorView, x: number, edge: number, side: -1 | 1): SelectionRange => {
  const glyph = view.coordsAtPos(edge, side)
  if (glyph === null) return EditorSelection.cursor(edge)
  const content = view.contentDOM.getBoundingClientRect()
  const clamped = Math.min(Math.max(x, content.left), content.right)
  const pos = view.posAtCoords({ x: clamped, y: (glyph.top + glyph.bottom) / 2 }, false)
  return EditorSelection.cursor(pos, 0, undefined, x - content.left)
}

export const placeCursor = (view: EditorView, placement: CursorPlacement): SelectionRange => {
  const length = view.state.doc.length
  return CursorPlacement.match(placement, {
    Start: () => EditorSelection.cursor(0),
    End: () => EditorSelection.cursor(length),
    Offset: ({ offset }) => EditorSelection.cursor(Math.min(offset, length)),
    FirstLine: ({ x }) => atX(view, x, 0, 1),
    LastLine: ({ x }) => atX(view, x, length, -1),
  })
}

export const goalX = (view: EditorView): number => {
  const { main } = view.state.selection
  const left = view.contentDOM.getBoundingClientRect().left
  return main.goalColumn === undefined
    ? (view.coordsAtPos(main.head, main.assoc < 0 ? -1 : 1)?.left ?? left)
    : left + main.goalColumn
}
