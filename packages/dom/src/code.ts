import { names } from "./names.ts"
import type { Table } from "./names.ts"

export type CodeStyle = "codemirror" | "highlight.js"

export interface CodeLook {
  readonly style: CodeStyle
  readonly mode: "light" | "dark"
  readonly accent: boolean
}

// https://github.com/codemirror/codemirror5/blob/5.65.13/mode/javascript/javascript.js
// https://github.com/highlightjs/highlight.js/blob/10.4.1/src/languages/javascript.js
const tokenNames = {
  keyword: ["keyword", "keyword"],
  atom: ["atom", "literal"],
  pyLiteral: ["keyword", "literal"],
  color: ["atom", "number"],
  number: ["number", "number"],
  string: ["string", "string"],
  template: ["string-2", "string"],
  interpolation: ["string-2", "subst"],
  regexp: ["string-2", "regexp"],
  def: ["def", "title"],
  property: ["property", ""],
  cssProperty: ["property", "attribute"],
  attribute: ["attribute", "attr"],
  type: ["type", ""],
  qualifier: ["qualifier", "selector-class"],
  id: ["builtin", "selector-id"],
  pseudo: ["variable-3", "selector-pseudo"],
  selector: ["tag", "selector-tag"],
  selectorAttr: ["tag", "selector-attr"],
  tag: ["tag", "name"],
  tagBracket: ["tag bracket", "tag"],
  builtin: ["builtin", "built_in"],
  local: ["variable-2", ""],
  variable: ["variable", ""],
  operator: ["operator", ""],
  comment: ["comment", "comment"],
  doctag: ["comment", "doctag"],
  docType: ["comment", "type"],
  docVariable: ["comment", "variable"],
  entity: ["atom", "symbol"],
  meta: ["meta", "meta"],
  error: ["error", ""],
  plain: ["", ""],
} as const

export type TokenKind = keyof typeof tokenNames

const prefixed = (prefix: string, styles: string) =>
  names(...styles.split(" ").map((style) => style !== "" && `${prefix}${style}`))

const codemirror = (look: CodeLook, ...parts: readonly string[]) =>
  look.style === "codemirror" ? parts.join(" ") : ""

export interface CodeParts {
  readonly "seqno-codeblock": readonly [string, CodeLook, boolean]
  readonly "seqno-file-code": readonly [string, CodeLook]
  readonly "seqno-code-lang": readonly [CodeLook]
  readonly "seqno-code-gutter": readonly [CodeLook]
  readonly "seqno-code-number": readonly [CodeLook]
  readonly "seqno-code-body": readonly [CodeLook]
  readonly "seqno-code-text": readonly [string, CodeLook]
  readonly "seqno-code-line": readonly [CodeLook]
  readonly "seqno-tok": readonly [TokenKind, CodeStyle]
  readonly "seqno-code-scroller": readonly []
  readonly "seqno-code-content": readonly []
  readonly "seqno-code-gutters": readonly []
  readonly "seqno-code-numbers": readonly []
  readonly "seqno-code-cursor": readonly []
  readonly "seqno-code-selected": readonly []
  readonly "seqno-code-active-line": readonly []
  readonly "seqno-code-bracket": readonly []
}

export const codeParts: Table<CodeParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3342-L3343
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3164-L3174
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L391-L397
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L507
  "seqno-codeblock": (language, look, focused) => ({
    className:
      look.style === "highlight.js"
        ? "cp__fenced-code-block ui-fenced-code-editor"
        : names(
            "cp__fenced-code-block extensions__code CodeMirror",
            look.accent ? "cm-s-lsradix" : "cm-s-solarized",
            `cm-s-${look.mode}`,
            focused && "CodeMirror-focused",
          ),
    "data-lang": language === "" ? undefined : language,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L507-L516
  "seqno-file-code": (language, look) => ({
    className: names(
      "extensions__code CodeMirror",
      look.accent ? "cm-s-lsradix" : "cm-s-solarized",
      `cm-s-${look.mode}`,
    ),
    "data-lang": language === "" ? undefined : language,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/code.cljs#L510
  "seqno-code-lang": (look) => ({ className: codemirror(look, "extensions__code-lang") }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-gutter": (look) => ({
    className: codemirror(look, "CodeMirror-gutters CodeMirror-gutter CodeMirror-linenumbers"),
  }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-number": (look) => ({ className: codemirror(look, "CodeMirror-linenumber") }),
  // https://codemirror.net/5/doc/manual.html#styling
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/highlight.cljs#L17
  "seqno-code-body": (look) => ({
    className: look.style === "highlight.js" ? "code pre-wrap-white-space" : "CodeMirror-scroll",
  }),
  // https://codemirror.net/5/doc/manual.html#styling
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/highlight.cljs#L18
  "seqno-code-text": (language, look) =>
    look.style === "highlight.js"
      ? {
          className: names("hljs", language !== "" && `language-${language}`),
          "data-lang": language === "" ? undefined : language,
        }
      : { className: "CodeMirror-sizer CodeMirror-code" },
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-line": (look) => ({ className: codemirror(look, "CodeMirror-line") }),
  // https://codemirror.net/5/doc/manual.html#styling
  // https://highlightjs.readthedocs.io/en/latest/css-classes-reference.html
  "seqno-tok": (kind, style) => {
    const [cm, hljs] = tokenNames[kind]

    return { className: style === "codemirror" ? prefixed("cm-", cm) : prefixed("hljs-", hljs) }
  },
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-scroller": () => ({ className: "CodeMirror-scroll" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-content": () => ({ className: "CodeMirror-sizer CodeMirror-code" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-gutters": () => ({ className: "CodeMirror-gutters" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-numbers": () => ({ className: "CodeMirror-gutter CodeMirror-linenumbers" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-cursor": () => ({ className: "CodeMirror-cursor" }),
  // https://codemirror.net/5/doc/manual.html#styling
  "seqno-code-selected": () => ({ className: "CodeMirror-selected" }),
  // https://github.com/codemirror/codemirror5/blob/5.65.13/addon/selection/active-line.js#L13-L14
  "seqno-code-active-line": () => ({
    className: "CodeMirror-activeline CodeMirror-activeline-background",
  }),
  // https://github.com/codemirror/codemirror5/blob/5.65.13/addon/edit/matchbrackets.js#L90
  "seqno-code-bracket": () => ({ className: "CodeMirror-matchingbracket" }),
}
