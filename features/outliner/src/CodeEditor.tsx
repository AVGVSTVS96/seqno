import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { defineLanguageFacet, Language, syntaxHighlighting } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import { useState } from "react"
import { editorHighlighter, parserFor } from "./highlight.ts"

export interface CodeEdit {
  readonly code: string
  readonly language: string
  readonly at: { readonly x: number; readonly y: number }
  readonly onDone: (code: string) => void
}

const languageOf = (name: string) => {
  const parser = parserFor(name)
  return parser === undefined
    ? []
    : [
        new Language(defineLanguageFacet(), parser, [], name).extension,
        syntaxHighlighting(editorHighlighter),
      ]
}

const mountCode =
  ({ code, language, at, onDone }: CodeEdit) =>
  (parent: HTMLDivElement | null) => {
    if (parent === null) return
    let done = false
    const finish = (view: EditorView) => {
      if (done) return
      done = true
      onDone(view.state.doc.toString())
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([
            {
              key: "Escape",
              run: (target) => {
                finish(target)
                return true
              },
            },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          languageOf(language),
          EditorView.updateListener.of((update) => {
            if (update.focusChanged && !update.view.hasFocus) finish(update.view)
          }),
        ],
      }),
    })
    const pos = view.posAtCoords(at)
    view.dispatch({ selection: EditorSelection.cursor(pos ?? view.state.doc.length) })
    view.focus()
    return () => view.destroy()
  }

export const CodeEditor = (edit: CodeEdit) => {
  const [mount] = useState(() => mountCode(edit))
  return (
    <div
      className="seqno-code-editor"
      ref={mount}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}
