import type { Table } from "./names.ts"

export interface CodeParts {
  readonly "seqno-codeblock": readonly [string]
  readonly "seqno-code-lang": readonly []
  readonly "seqno-code-gutter": readonly []
  readonly "seqno-code-number": readonly []
  readonly "seqno-code-text": readonly []
  readonly "seqno-code-line": readonly []
  readonly "seqno-tok": readonly [string]
}

export const codeParts: Table<CodeParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3342
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L507
  "seqno-codeblock": (language) => ({
    className: "cp__fenced-code-block extensions__code CodeMirror cm-s-solarized",
    "data-lang": language === "" ? undefined : language,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L510
  "seqno-code-lang": () => ({ className: "extensions__code-lang" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-gutter": () => ({ className: "CodeMirror-gutters" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-number": () => ({ className: "CodeMirror-linenumber" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-text": () => ({ className: "CodeMirror-code" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-line": () => ({ className: "CodeMirror-line" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-tok": (kind) => ({ className: `cm-${kind}` }),
}
