import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { defineLanguageFacet, Language, syntaxHighlighting } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"
import { useState } from "react"
import { codeNames } from "./code-names.ts"
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

const viewOf = (
  parent: HTMLElement,
  code: string,
  language: string,
  save: (view: EditorView) => void,
) =>
  new EditorView({
    parent,
    state: EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        codeNames(language),
        history(),
        keymap.of([
          {
            key: "Escape",
            run: (target) => {
              save(target)

              return true
            },
          },
          indentWithTab,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        languageOf(language),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && !update.view.hasFocus) {
            save(update.view)
          }
        }),
      ],
    }),
  })

const mountCode =
  ({ code, language, at, onDone }: CodeEdit) =>
  (parent: HTMLDivElement | null) => {
    if (parent === null) {
      return
    }

    let done = false

    const view = viewOf(parent, code, language, (target) => {
      if (done) {
        return
      }

      done = true
      onDone(target.state.doc.toString())
    })

    const pos = view.posAtCoords(at)
    view.dispatch({ selection: EditorSelection.cursor(pos ?? view.state.doc.length) })
    view.focus()

    return () => {
      view.destroy()
    }
  }

export const CodeEditor = (edit: CodeEdit) => {
  const [mount] = useState(() => mountCode(edit))

  return (
    <div
      className="seqno-code-editor"
      ref={mount}
      onClick={(event) => {
        event.stopPropagation()
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
    />
  )
}

export interface FileEdit {
  readonly code: string
  readonly language: string
  readonly onSave: (code: string) => void
}

export const FileEditor = ({ code, language, onSave }: FileEdit) => {
  const [mount] = useState(() => (parent: HTMLDivElement | null) => {
    if (parent === null) {
      return
    }

    const view = viewOf(parent, code, language, (target) => {
      onSave(target.state.doc.toString())
    })

    return () => {
      view.destroy()
    }
  })

  return <div className="seqno-code-editor" ref={mount} />
}
