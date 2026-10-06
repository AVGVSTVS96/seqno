import { insertNewline } from "@codemirror/commands"
import { EditorSelection, Prec, type EditorState } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"
import type { BlockId, Command } from "@seqno/domain"
import { deletePair } from "./autopair.ts"
import { goalX, minimalChange } from "./edits.ts"
import { cycleMarker, insertLink, toggleMark, type Draft } from "./format.ts"
import type { Handoff } from "./handoff.ts"
import type { EditorAction, EditorHost } from "./host.ts"
import { linkAt } from "./links.ts"

const fenceLine = /^\s*(`{3,}|~{3,})/gm

const insideCodeFence = (state: EditorState, position: number): boolean =>
  (state.sliceDoc(0, position).match(fenceLine)?.length ?? 0) % 2 === 1

const caret = (view: EditorView): number | null => {
  const { main } = view.state.selection
  return main.empty ? main.head : null
}

const onFirstVisualLine = (view: EditorView, head: number): boolean =>
  view.moveToLineBoundary(EditorSelection.cursor(head), false, true).head === 0

const onLastVisualLine = (view: EditorView, head: number): boolean =>
  view.moveToLineBoundary(EditorSelection.cursor(head), true, true).head === view.state.doc.length

const draftOf = (view: EditorView): Draft => {
  const { from, to } = view.state.selection.main
  return { text: view.state.doc.toString(), from, to }
}

const rewrite = (transform: (draft: Draft) => Draft) => (view: EditorView) => {
  const before = view.state.doc.toString()
  const after = transform(draftOf(view))
  view.dispatch({
    changes: minimalChange(before, after.text),
    selection: { anchor: after.from, head: after.to },
    userEvent: "input",
    scrollIntoView: true,
  })
  return true
}

export const blockKeymap = (
  blockId: BlockId,
  host: EditorHost,
  handoff: Handoff,
  whenConfirmed: (run: () => void) => void,
  textOf: (draft: string) => string,
) => {
  const send = (command: Command) => () => {
    host.dispatch(command)
    return true
  }

  const act = (action: EditorAction) => () => {
    host.act(action)
    return true
  }

  const split = (view: EditorView): boolean => {
    const { from, to } = view.state.selection.main
    if (insideCodeFence(view.state, from)) return insertNewline(view)
    if (from !== to) {
      view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete" })
    }
    handoff.hold(view)
    whenConfirmed(() => host.dispatch({ _tag: "SplitBlock", blockId, at: from }))
    return true
  }

  const merge = (view: EditorView): boolean => {
    if (caret(view) !== 0) return false
    handoff.carry({ _tag: "Merged", tail: textOf(view.state.doc.toString()) })
    host.dispatch({ _tag: "MergeWithPrevious", blockId })
    return true
  }

  const vertical = (forward: boolean) => (view: EditorView) => {
    const head = caret(view)
    if (head === null) return false
    if (!(forward ? onLastVisualLine(view, head) : onFirstVisualLine(view, head))) return false
    const x = goalX(view)
    handoff.carry({
      _tag: "Caret",
      cursor: forward ? { _tag: "FirstLine", x } : { _tag: "LastLine", x },
    })
    host.act({ _tag: forward ? "FocusNext" : "FocusPrevious" })
    return true
  }

  const atEdge = (forward: boolean, action: EditorAction) => (view: EditorView) => {
    if (caret(view) !== (forward ? view.state.doc.length : 0)) return false
    host.act(action)
    return true
  }

  const selectBeyond = (forward: boolean) => (view: EditorView) => {
    if (view.state.selection.main.head !== (forward ? view.state.doc.length : 0)) return false
    host.act({ _tag: forward ? "SelectDown" : "SelectUp" })
    return true
  }

  const follow = (sidebar: boolean) => (view: EditorView) => {
    const target = linkAt(view.state.doc.toString(), view.state.selection.main.head)
    if (target !== null) host.act({ _tag: "Open", target, sidebar })
    return true
  }

  return Prec.high(
    keymap.of([
      { key: "Enter", run: split },
      { key: "Shift-Enter", run: insertNewline },
      { key: "Backspace", run: (view) => deletePair(view) || merge(view) },
      { key: "Tab", run: send({ _tag: "Indent", blockIds: [blockId] }) },
      { key: "Shift-Tab", run: send({ _tag: "Outdent", blockIds: [blockId] }) },
      { key: "ArrowUp", run: vertical(false) },
      { key: "ArrowDown", run: vertical(true) },
      { key: "ArrowLeft", run: atEdge(false, { _tag: "FocusPrevious" }) },
      { key: "ArrowRight", run: atEdge(true, { _tag: "FocusNext" }) },
      { key: "Delete", run: atEdge(true, { _tag: "MergeNext" }) },
      { key: "Shift-ArrowUp", run: selectBeyond(false) },
      { key: "Shift-ArrowDown", run: selectBeyond(true) },
      { key: "Escape", run: act({ _tag: "Exit" }) },
      { key: "Mod-z", run: send({ _tag: "Undo" }) },
      { key: "Mod-Shift-z", run: send({ _tag: "Redo" }) },
      { key: "Mod-y", run: send({ _tag: "Redo" }) },
      { key: "Mod-Enter", run: rewrite(cycleMarker) },
      { key: "Mod-b", run: rewrite((draft) => toggleMark(draft, "**")) },
      { key: "Mod-i", run: rewrite((draft) => toggleMark(draft, "*")) },
      { key: "Mod-Shift-h", run: rewrite((draft) => toggleMark(draft, "==")) },
      { key: "Mod-Shift-s", run: rewrite((draft) => toggleMark(draft, "~~")) },
      { key: "Mod-l", run: rewrite(insertLink) },
      { key: "Mod-ArrowUp", run: act({ _tag: "Collapse" }) },
      { key: "Mod-ArrowDown", run: act({ _tag: "Expand" }) },
      { key: "Mod-;", run: act({ _tag: "ToggleCollapse" }) },
      { key: "Alt-Shift-ArrowUp", run: act({ _tag: "MoveUp" }) },
      { key: "Alt-Shift-ArrowDown", run: act({ _tag: "MoveDown" }) },
      { key: "Mod-o", run: follow(false) },
      { key: "Mod-Shift-o", run: follow(true) },
      { key: "Alt-ArrowRight", mac: "Mod-.", run: act({ _tag: "ZoomIn" }) },
      { key: "Alt-ArrowLeft", mac: "Mod-,", run: act({ _tag: "ZoomOut" }) },
    ]),
  )
}
