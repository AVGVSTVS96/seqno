import { insertNewline } from "@codemirror/commands"
import { EditorSelection, Prec, type EditorState } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"
import type { BlockId, Command } from "@seqno/domain"
import { deletePair } from "./autopair.ts"
import { bound, editorBindings } from "./bindings.ts"
import { minimalChange } from "./edits.ts"
import { cycleMarker, insertLink, toggleMark, type Draft } from "./format.ts"
import type { Handoff } from "./handoff.ts"
import type { EditorAction, EditorHost } from "./host.ts"
import { linkAt } from "./links.ts"

const fenceLine = /^\s*(`{3,}|~{3,})/gm

const insideCodeFence = (state: EditorState, position: number): boolean =>
  (state.sliceDoc(0, position).match(fenceLine)?.length ?? 0) % 2 === 1

const propertyLine = /^[^\s:]+:: /

const atPropertyLineEnd = (state: EditorState, from: number, to: number): boolean => {
  const line = state.doc.lineAt(from)
  return from === to && from === line.to && propertyLine.test(line.text)
}

const historyStep = (event: KeyboardEvent): "Undo" | "Redo" | null => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === "z") return event.shiftKey ? "Redo" : "Undo"
  return key === "y" && !event.shiftKey ? "Redo" : null
}

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
    if (insideCodeFence(view.state, from) || atPropertyLineEnd(view.state, from, to)) {
      return insertNewline(view)
    }
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
    if (handoff.replaying()) handoff.hold(view)
    host.dispatch({ _tag: "MergeWithPrevious", blockId })
    return true
  }

  const vertical = (forward: boolean) => (view: EditorView) => {
    const head = caret(view)
    if (head === null) return false
    if (!(forward ? onLastVisualLine(view, head) : onFirstVisualLine(view, head))) return false
    const column = head - view.moveToLineBoundary(EditorSelection.cursor(head), false, true).head
    handoff.carry({
      _tag: "Caret",
      cursor: forward ? { _tag: "FirstLine", column } : { _tag: "LastLine", column },
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

  const history = (event: KeyboardEvent) => {
    const step = historyStep(event)
    if (step !== null) host.dispatch({ _tag: step })
    return step !== null
  }

  const follow = (sidebar: boolean) => (view: EditorView) => {
    const target = linkAt(view.state.doc.toString(), view.state.selection.main.head)
    if (target !== null) host.act({ _tag: "Open", target, sidebar })
    return true
  }

  return Prec.high(
    keymap.of([
      { any: (_view, event) => history(event) },
      { ...bound(editorBindings.newBlock), run: split },
      { ...bound(editorBindings.newLine), run: insertNewline },
      { key: "Backspace", run: (view) => deletePair(view) || merge(view) },
      { ...bound(editorBindings.indent), run: send({ _tag: "Indent", blockIds: [blockId] }) },
      { ...bound(editorBindings.outdent), run: send({ _tag: "Outdent", blockIds: [blockId] }) },
      { key: "ArrowUp", run: vertical(false) },
      { key: "ArrowDown", run: vertical(true) },
      { key: "ArrowLeft", run: atEdge(false, { _tag: "FocusPrevious" }) },
      { key: "ArrowRight", run: atEdge(true, { _tag: "FocusNext" }) },
      { key: "Delete", run: atEdge(true, { _tag: "MergeNext" }) },
      { ...bound(editorBindings.selectAbove), run: selectBeyond(false) },
      { ...bound(editorBindings.selectBelow), run: selectBeyond(true) },
      { ...bound(editorBindings.exit), run: act({ _tag: "Exit" }) },
      { ...bound(editorBindings.cycleTask), run: rewrite(cycleMarker) },
      { ...bound(editorBindings.bold), run: rewrite((draft) => toggleMark(draft, "**")) },
      { ...bound(editorBindings.italic), run: rewrite((draft) => toggleMark(draft, "*")) },
      { ...bound(editorBindings.highlight), run: rewrite((draft) => toggleMark(draft, "==")) },
      { ...bound(editorBindings.strike), run: rewrite((draft) => toggleMark(draft, "~~")) },
      { ...bound(editorBindings.link), run: rewrite(insertLink) },
      { ...bound(editorBindings.collapse), run: act({ _tag: "Collapse" }) },
      { ...bound(editorBindings.expand), run: act({ _tag: "Expand" }) },
      { ...bound(editorBindings.toggleCollapse), run: act({ _tag: "ToggleCollapse" }) },
      { ...bound(editorBindings.moveUp), run: act({ _tag: "MoveUp" }) },
      { ...bound(editorBindings.moveDown), run: act({ _tag: "MoveDown" }) },
      { ...bound(editorBindings.follow), run: follow(false) },
      { ...bound(editorBindings.followInSidebar), run: follow(true) },
      { ...bound(editorBindings.zoomIn), run: act({ _tag: "ZoomIn" }) },
      { ...bound(editorBindings.zoomOut), run: act({ _tag: "ZoomOut" }) },
    ]),
  )
}

export const propertiesKeymap = (host: EditorHost) =>
  Prec.high(
    keymap.of([
      { key: "Enter", run: insertNewline },
      {
        key: "Escape",
        run: () => {
          host.act({ _tag: "Exit" })
          return true
        },
      },
    ]),
  )
