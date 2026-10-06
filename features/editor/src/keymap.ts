import { insertNewline } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import { EditorSelection, Prec, type EditorState } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"
import type { BlockId, Command } from "@seqno/domain"
import type { EditorHost } from "./host.ts"

const insideFencedCode = (state: EditorState, position: number): boolean => {
  for (let node = syntaxTree(state).resolveInner(position, -1); ; ) {
    if (node.name === "FencedCode") {
      return true
    }
    const parent = node.parent
    if (parent === null) {
      return false
    }
    node = parent
  }
}

const caret = (view: EditorView): number | null => {
  const main = view.state.selection.main
  return main.empty ? main.head : null
}

const onFirstVisualLine = (view: EditorView, head: number): boolean =>
  view.moveToLineBoundary(EditorSelection.cursor(head), false, true).head === 0

const onLastVisualLine = (view: EditorView, head: number): boolean =>
  view.moveToLineBoundary(EditorSelection.cursor(head), true, true).head === view.state.doc.length

const column = (view: EditorView, head: number): number => head - view.state.doc.lineAt(head).from

export const blockKeymap = (blockId: BlockId, host: EditorHost) => {
  const split = (view: EditorView): boolean => {
    const { from, to } = view.state.selection.main
    if (insideFencedCode(view.state, from)) {
      return insertNewline(view)
    }
    if (from !== to) {
      view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete" })
    }
    host.dispatch({ _tag: "SplitBlock", blockId, at: from })
    return true
  }

  const mergeWithPrevious = (view: EditorView): boolean => {
    if (caret(view) !== 0) {
      return false
    }
    host.dispatch({ _tag: "MergeWithPrevious", blockId })
    return true
  }

  const up = (view: EditorView): boolean => {
    const head = caret(view)
    if (head === null || !onFirstVisualLine(view, head)) {
      return false
    }
    host.navigate({
      _tag: "ToPrevious",
      cursor: { _tag: "LastLine", column: column(view, head) },
    })
    return true
  }

  const down = (view: EditorView): boolean => {
    const head = caret(view)
    if (head === null || !onLastVisualLine(view, head)) {
      return false
    }
    host.navigate({ _tag: "ToNext", cursor: { _tag: "FirstLine", column: column(view, head) } })
    return true
  }

  const left = (view: EditorView): boolean => {
    if (caret(view) !== 0) {
      return false
    }
    host.navigate({ _tag: "ToPrevious", cursor: { _tag: "End" } })
    return true
  }

  const right = (view: EditorView): boolean => {
    if (caret(view) !== view.state.doc.length) {
      return false
    }
    host.navigate({ _tag: "ToNext", cursor: { _tag: "Start" } })
    return true
  }

  const dispatching = (command: Command) => (): boolean => {
    host.dispatch(command)
    return true
  }

  return Prec.high(
    keymap.of([
      { key: "Enter", run: split },
      { key: "Shift-Enter", run: insertNewline },
      { key: "Backspace", run: mergeWithPrevious },
      { key: "Tab", run: dispatching({ _tag: "Indent", blockIds: [blockId] }) },
      { key: "Shift-Tab", run: dispatching({ _tag: "Outdent", blockIds: [blockId] }) },
      { key: "ArrowUp", run: up },
      { key: "ArrowDown", run: down },
      { key: "ArrowLeft", run: left },
      { key: "ArrowRight", run: right },
      { key: "Mod-z", run: dispatching({ _tag: "Undo" }) },
      { key: "Mod-Shift-z", run: dispatching({ _tag: "Redo" }) },
      { key: "Mod-y", run: dispatching({ _tag: "Redo" }) },
    ]),
  )
}
