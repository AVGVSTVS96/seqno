import { closeBrackets } from "@codemirror/autocomplete"
import { defaultKeymap } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { Effect, Fiber, Stream } from "effect"
import { refCompletions } from "./autocomplete.ts"
import { editTextCommands, fromGraph, minimalChange, resolveCursor } from "./edits.ts"
import type { BlockEditorOptions } from "./host.ts"
import { blockKeymap } from "./keymap.ts"
import { liveMarkdown } from "./markdown.ts"

export interface BlockEditor {
  readonly view: EditorView
  readonly destroy: () => void
}

export const mountBlockEditor = (
  parent: HTMLElement,
  { blockId, text, cursor, textUpdates, host }: BlockEditorOptions,
): BlockEditor => {
  const unconfirmed: Array<string> = []

  const initial = EditorState.create({
    doc: text,
    extensions: [
      blockKeymap(blockId, host),
      refCompletions(host),
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
      keymap.of(defaultKeymap),
      liveMarkdown,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions) {
          if (transaction.docChanged && transaction.annotation(fromGraph) !== true) {
            for (const command of editTextCommands(blockId, transaction)) {
              host.dispatch(command)
            }
            unconfirmed.push(transaction.newDoc.toString())
          }
        }
      }),
    ],
  })

  const view = new EditorView({
    parent,
    state: initial.update({ selection: { anchor: resolveCursor(initial.doc, cursor) } }).state,
  })

  const receive = (next: string) => {
    const echo = unconfirmed.indexOf(next)
    if (echo !== -1) {
      unconfirmed.splice(0, echo + 1)
      return
    }
    unconfirmed.length = 0
    const current = view.state.doc.toString()
    if (current !== next) {
      view.dispatch({ changes: minimalChange(current, next), annotations: fromGraph.of(true) })
    }
  }

  const updates = Effect.runFork(
    Stream.runForEach(textUpdates, (next) => Effect.sync(() => receive(next))),
  )
  view.focus()

  return {
    view,
    destroy: () => {
      Effect.runFork(Fiber.interrupt(updates))
      view.destroy()
    },
  }
}
