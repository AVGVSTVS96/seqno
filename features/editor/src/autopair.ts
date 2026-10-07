import { EditorView } from "@codemirror/view"

const pairs: Readonly<Record<string, string>> = {
  "[": "]",
  "{": "}",
  "(": ")",
  "`": "`",
  "~": "~",
  "*": "*",
  _: "_",
  "^": "^",
  "=": "=",
  "/": "/",
  "+": "+",
}

const onlyAroundSelection = new Set(["*", "^", "_", "=", "+", "/"])
const closers = new Set(Object.values(pairs))

const opensParen = (before: string) => before === "" || /[\s\](]/.test(before)

export const autopair = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || view.composing) return false
  const { state } = view
  const selected = state.sliceDoc(from, to)
  const before = state.sliceDoc(from - 1, from)
  const after = state.sliceDoc(to, to + 1)
  if (selected === "" && after === text && closers.has(text) && !(text === "`" && before === "`")) {
    view.dispatch({ selection: { anchor: from + 1 }, userEvent: "select" })
    return true
  }
  if (
    text === "$" &&
    selected === "" &&
    before === "$" &&
    state.sliceDoc(from - 2, from - 1) !== "$"
  ) {
    view.dispatch({
      changes: { from, to, insert: "$$$" },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    })
    return true
  }
  const close = pairs[text]
  if (close === undefined) return false
  if (selected === "" && onlyAroundSelection.has(text)) return false
  if (selected === "" && text === "(" && !opensParen(before)) return false
  view.dispatch({
    changes: { from, to, insert: text + selected + close },
    selection: { anchor: from + 1, head: from + 1 + selected.length },
    userEvent: "input.type",
    scrollIntoView: true,
  })
  return true
})

export const deletePair = (view: EditorView): boolean => {
  const { main } = view.state.selection
  if (!main.empty || main.head === 0) return false
  const before = view.state.sliceDoc(main.head - 1, main.head)
  const after = view.state.sliceDoc(main.head, main.head + 1)
  if (pairs[before] !== after) return false
  view.dispatch({
    changes: { from: main.head - 1, to: main.head + 1 },
    userEvent: "delete.backward",
  })
  return true
}
