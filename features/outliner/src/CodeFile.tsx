import { logseq } from "@seqno/dom"
import type { CodeLook } from "@seqno/dom"
import { use } from "react"
import { FileEditor } from "./CodeEditor.tsx"
import type { FileEdit } from "./CodeEditor.tsx"
import styles from "./outliner.css?inline"
import { Accent, ColorMode } from "./render.ts"

export const CodeFile = ({ code, language, onSave }: FileEdit) => {
  const look: CodeLook = {
    style: "codemirror",
    mode: use(ColorMode),
    accent: use(Accent) !== "logseq",
  }

  return (
    <div {...logseq("seqno-file-code", language, look)}>
      <style href="@seqno/outliner" precedence="default">
        {styles}
      </style>
      <FileEditor code={code} language={language} onSave={onSave} />
      <span {...logseq("seqno-code-lang", look)}>{language}</span>
    </div>
  )
}
