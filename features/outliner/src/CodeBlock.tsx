import { logseq, type CodeLook } from "@seqno/dom"
import { use, useState } from "react"
import { CodeEditor } from "./CodeEditor.tsx"
import { highlightLines, tokenClass } from "./highlight.ts"
import { Accent, ColorMode, RenderContext } from "./render.ts"

export const CodeBlock = ({
  language,
  code,
  onEdit,
}: {
  readonly language: string
  readonly code: string
  readonly onEdit?: (code: string) => void
}) => {
  const [editing, setEditing] = useState<{ readonly x: number; readonly y: number } | null>(null)
  const appearance = { mode: use(ColorMode), accent: use(Accent) !== "logseq" }
  const { codeStyle } = use(RenderContext)
  const lines = highlightLines(code, language)
  if (editing !== null && onEdit !== undefined) {
    const look: CodeLook = { ...appearance, style: "codemirror" }
    return (
      <div
        {...logseq("seqno-codeblock", language, look, true)}
        data-language={language === "" ? undefined : language}
        data-editing
      >
        <CodeEditor
          code={code}
          language={language}
          at={editing}
          onDone={(next) => {
            setEditing(null)
            if (next !== code) onEdit(next)
          }}
        />
        {language === "" ? null : <span {...logseq("seqno-code-lang", look)}>{language}</span>}
      </div>
    )
  }
  const look: CodeLook = { ...appearance, style: codeStyle }
  const numbered = codeStyle === "codemirror"
  return (
    <div
      {...logseq("seqno-codeblock", language, look, false)}
      data-language={language === "" ? undefined : language}
      onClick={(event) => {
        if (onEdit === undefined) return
        event.stopPropagation()
        setEditing({ x: event.clientX, y: event.clientY })
      }}
    >
      {numbered ? (
        <div {...logseq("seqno-code-gutter", look)} aria-hidden>
          {lines.map((_, index) => (
            <div key={index} {...logseq("seqno-code-number", look)}>
              {index + 1}
            </div>
          ))}
        </div>
      ) : null}
      <pre {...logseq("seqno-code-body", look)}>
        <code {...logseq("seqno-code-text", language, look)}>
          {lines.map((line, index) => (
            <div key={index} {...logseq("seqno-code-line", look)}>
              {line.map((token, at) =>
                token.kind === "" ? (
                  token.text
                ) : (
                  <span key={at} className={tokenClass(token.kind, codeStyle)}>
                    {token.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </code>
      </pre>
      {language === "" || !numbered ? null : (
        <span {...logseq("seqno-code-lang", look)}>{language}</span>
      )}
    </div>
  )
}
