import { highlightLines } from "./highlight.ts"

export const CodeBlock = ({
  language,
  code,
}: {
  readonly language: string
  readonly code: string
}) => {
  const lines = highlightLines(code, language)
  return (
    <div className="seqno-codeblock" data-language={language === "" ? undefined : language}>
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
