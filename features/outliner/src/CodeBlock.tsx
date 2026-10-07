import { useState } from "react"
import { CodeEditor } from "./CodeEditor.tsx"
import { highlightLines } from "./highlight.ts"

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
  const lines = highlightLines(code, language)
  if (editing !== null && onEdit !== undefined) {
    return (
      <div
        className="seqno-codeblock is-editing"
        data-language={language === "" ? undefined : language}
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
        {language === "" ? null : <span className="seqno-code-lang">{language}</span>}
      </div>
    )
  }
  return (
    <div
      className="seqno-codeblock"
      data-language={language === "" ? undefined : language}
      onClick={(event) => {
        if (onEdit === undefined) return
        event.stopPropagation()
        setEditing({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="seqno-code-gutter" aria-hidden>
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <pre className="seqno-code-body">
        <code>
          {lines.map((line, index) => (
            <div key={index} className="seqno-code-line">
              {line.map((token, at) =>
                token.kind === "" ? (
                  token.text
                ) : (
                  <span key={at} className={`seqno-tok-${token.kind}`}>
                    {token.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </code>
      </pre>
      {language === "" ? null : <span className="seqno-code-lang">{language}</span>}
    </div>
  )
}
