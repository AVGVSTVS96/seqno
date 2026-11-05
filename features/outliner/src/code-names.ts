import { bracketMatching } from "@codemirror/language"
import { EditorSelection, RangeSet } from "@codemirror/state"
import type { EditorState, Extension } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  layer,
  RectangleMarker,
  ViewPlugin,
} from "@codemirror/view"
import { attributesOf, logseq } from "@seqno/dom"
import type { CodeLook } from "@seqno/dom"

const look: CodeLook = { style: "codemirror", mode: "light", accent: false }
const lineNames = Decoration.line({ class: logseq("seqno-code-line", look).className })
const activeNames = Decoration.line({ class: logseq("seqno-code-active-line").className })
const bracketNames = Decoration.mark({ class: logseq("seqno-code-bracket").className })
const tokens = (made: { readonly className: string }) => made.className.split(" ")

class NumberNames extends GutterMarker {
  override elementClass = logseq("seqno-code-number", look).className
}

const numberNames = new NumberNames()

const lineStarts = (state: EditorState) =>
  Array.from({ length: state.doc.lines }, (_, index) => state.doc.line(index + 1).from)

const lines = EditorView.decorations.compute(["doc", "selection"], (state) => {
  const active = state.doc.lineAt(state.selection.main.head).from

  return Decoration.set(
    lineStarts(state).flatMap((from) =>
      from === active ? [lineNames.range(from), activeNames.range(from)] : [lineNames.range(from)],
    ),
  )
})

const numbers = gutterLineClass.compute(["doc"], (state) =>
  RangeSet.of(lineStarts(state).map((from) => numberNames.range(from))),
)

const frame = ViewPlugin.define((view) => {
  view.scrollDOM.classList.add(...tokens(logseq("seqno-code-scroller")))
  view.dom.querySelector(".cm-gutters")?.classList.add(...tokens(logseq("seqno-code-gutters")))
  view.dom.querySelector(".cm-lineNumbers")?.classList.add(...tokens(logseq("seqno-code-numbers")))

  return {}
})

const cursors = layer({
  above: true,
  class: "cm-cursorLayer",
  markers: (view) =>
    view.state.selection.ranges.flatMap((range) =>
      RectangleMarker.forRange(
        view,
        `cm-cursor cm-cursor-primary ${logseq("seqno-code-cursor").className}`,
        range.empty ? range : EditorSelection.cursor(range.head, range.assoc),
      ),
    ),
  update: (update, dom) => {
    if (update.transactions.some((transaction) => transaction.selection !== undefined)) {
      dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink"
    }

    return update.docChanged || update.selectionSet
  },
})

const selections = layer({
  above: false,
  class: "cm-selectionLayer",
  markers: (view) =>
    view.state.selection.ranges.flatMap((range) =>
      range.empty
        ? []
        : RectangleMarker.forRange(
            view,
            `cm-selectionBackground ${logseq("seqno-code-selected").className}`,
            range,
          ),
    ),
  update: (update) => update.docChanged || update.selectionSet || update.viewportChanged,
})

const nativeSelectionHidden = EditorView.theme({
  ".cm-line": {
    "& ::selection, &::selection": { backgroundColor: "transparent !important" },
    caretColor: "transparent !important",
  },
  ".cm-content": { caretColor: "transparent !important" },
})

// https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L387
// https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L396
const lispLike = new Set(["scheme", "lisp", "clojure", "clj", "cljs", "cljc", "edn"])

export const codeNames = (language: string): Extension => [
  EditorView.contentAttributes.of(attributesOf(logseq("seqno-code-content"))),
  lines,
  numbers,
  frame,
  cursors,
  selections,
  nativeSelectionHidden,
  lispLike.has(language.toLowerCase())
    ? bracketMatching({
        renderMatch: (match) =>
          match.matched
            ? [match.start, match.end].flatMap((side) =>
                side === undefined ? [] : [bracketNames.range(side.from, side.to)],
              )
            : [],
      })
    : [],
]
