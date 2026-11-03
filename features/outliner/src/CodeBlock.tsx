import { useState } from "react"
import { CodeEditor } from "./CodeEditor.tsx"
import { highlightLines } from "./highlight.ts"

const logseqCode = "cp__fenced-code-block extensions__code CodeMirror cm-s-solarized"

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
        className={`seqno-codeblock is-editing ${logseqCode}`}
        data-language={language === "" ? undefined : language}
        data-lang={language === "" ? undefined : language}
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
        {language === "" ? null : (
          <span className="seqno-code-lang extensions__code-lang">{language}</span>
        )}
      </div>
    )
  }
  return (
    <div
      className={`seqno-codeblock ${logseqCode}`}
      data-language={language === "" ? undefined : language}
      data-lang={language === "" ? undefined : language}
      onClick={(event) => {
        if (onEdit === undefined) return
        event.stopPropagation()
        setEditing({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="seqno-code-gutter CodeMirror-gutters" aria-hidden>
        {lines.map((_, index) => (
          <div key={index} className="CodeMirror-linenumber">
            {index + 1}
          </div>
        ))}
      </div>
      <pre className="seqno-code-body">
        <code className="CodeMirror-code">
          {lines.map((line, index) => (
            <div key={index} className="seqno-code-line CodeMirror-line">
              {line.map((token, at) =>
                token.kind === "" ? (
                  token.text
                ) : (
                  <span key={at} className={`seqno-tok-${token.kind} cm-${token.kind}`}>
                    {token.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </code>
      </pre>
      {language === "" ? null : (
        <span className="seqno-code-lang extensions__code-lang">{language}</span>
      )}
    </div>
  )
}
