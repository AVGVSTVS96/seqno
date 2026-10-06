import { EditorView, runScopeHandlers } from "@codemirror/view"

export interface Keystroke {
  readonly key: string
  readonly code: string
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

const modifierKeys = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process"])

export const keystrokeOf = (event: KeyboardEvent): Keystroke | null =>
  event.isComposing || modifierKeys.has(event.key)
    ? null
    : {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      }

const printable = (stroke: Keystroke) =>
  [...stroke.key].length === 1 && !stroke.ctrlKey && !stroke.metaKey

export const typeText = (view: EditorView, text: string) => {
  const { from, to } = view.state.selection.main
  const insert = () =>
    view.state.update({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
      scrollIntoView: true,
    })
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert))
  if (!handled) view.dispatch(insert())
}

export const press = (view: EditorView, stroke: Keystroke) => {
  if (runScopeHandlers(view, new KeyboardEvent("keydown", stroke), "editor")) return
  if (printable(stroke)) typeText(view, stroke.key)
}
