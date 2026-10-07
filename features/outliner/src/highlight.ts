import type { Parser, SyntaxNodeRef, Tree } from "@lezer/common"
import { parser as css } from "@lezer/css"
import { highlightTree, tagHighlighter, tags, type Tag } from "@lezer/highlight"
import { parser as html } from "@lezer/html"
import { parser as javascript } from "@lezer/javascript"
import { parser as python } from "@lezer/python"

export interface Token {
  readonly text: string
  readonly kind: string
}

interface Language {
  readonly parser: Parser
  readonly refine: (tree: Tree, code: string, paint: Paint) => void
}

type Paint = (from: number, to: number, kind: string) => void

const functions = new Set([
  "ArrowFunction",
  "FunctionDeclaration",
  "FunctionExpression",
  "MethodDeclaration",
])

const scriptLocals = (tree: Tree, code: string, paint: Paint) => {
  const scopes: Array<{ readonly from: number; readonly to: number; names: Set<string> }> = []
  tree.iterate({
    enter: (node) => {
      if (functions.has(node.name)) scopes.push({ from: node.from, to: node.to, names: new Set() })
      if (node.name === "VariableDefinition") {
        const name = code.slice(node.from, node.to)
        for (const scope of scopes) {
          if (node.from >= scope.from && node.to <= scope.to) scope.names.add(name)
        }
      }
    },
  })
  const isLocal = (node: SyntaxNodeRef) => {
    const name = code.slice(node.from, node.to)
    return scopes.some(
      (scope) => node.from >= scope.from && node.to <= scope.to && scope.names.has(name),
    )
  }
  tree.iterate({
    enter: (node) => {
      if (node.name === "VariableName" && isLocal(node)) paint(node.from, node.to, "local")
      if (node.name === "TypeArgList" || node.name === "TypeParamList") {
        paint(node.from, node.from + 1, "operator")
        paint(node.to - 1, node.to, "operator")
      }
    },
  })
}

const isPropertyName = (word: string) => typeof CSS !== "undefined" && CSS.supports(word, "inherit")

const cssSelectors = (tree: Tree, code: string, paint: Paint) =>
  tree.iterate({
    enter: (node) => {
      if (node.name === "ClassSelector" || node.name === "IdSelector") {
        paint(node.from, node.to, "qualifier")
        return false
      }
      if (node.name === "ValueName" && isPropertyName(code.slice(node.from, node.to))) {
        paint(node.from, node.to, "variable")
      }
      return undefined
    },
  })

const plain = () => undefined

const script = (parser: Parser): Language => ({ parser, refine: scriptLocals })

const languages: ReadonlyMap<string, Language> = new Map([
  ["js", script(javascript)],
  ["javascript", script(javascript)],
  ["mjs", script(javascript)],
  ["cjs", script(javascript)],
  ["jsx", script(javascript.configure({ dialect: "jsx" }))],
  ["ts", script(javascript.configure({ dialect: "ts" }))],
  ["typescript", script(javascript.configure({ dialect: "ts" }))],
  ["tsx", script(javascript.configure({ dialect: "jsx ts" }))],
  ["css", { parser: css, refine: cssSelectors }],
  ["html", { parser: html, refine: plain }],
  ["py", { parser: python, refine: plain }],
  ["python", { parser: python, refine: plain }],
])

const rules: ReadonlyArray<{ readonly tag: Tag | ReadonlyArray<Tag>; readonly class: string }> = [
  { tag: [tags.keyword, tags.modifier, tags.self], class: "keyword" },
  {
    tag: [tags.definition(tags.variableName), tags.function(tags.definition(tags.variableName))],
    class: "def",
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)],
    class: "property",
  },
  { tag: [tags.typeName, tags.namespace], class: "type" },
  { tag: [tags.className, tags.labelName], class: "qualifier" },
  { tag: tags.derefOperator, class: "" },
  { tag: [tags.operator, tags.function(tags.punctuation), tags.angleBracket], class: "operator" },
  { tag: [tags.string, tags.regexp, tags.character, tags.attributeValue], class: "string" },
  { tag: [tags.number, tags.unit, tags.atom, tags.bool, tags.null, tags.color], class: "number" },
  { tag: tags.variableName, class: "variable" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.tagName, class: "tag" },
  { tag: tags.meta, class: "meta" },
]

const highlighter = tagHighlighter(rules)

export const editorHighlighter = tagHighlighter(
  rules.map(({ tag, class: kind }) => ({ tag, class: kind === "" ? "" : `seqno-tok-${kind}` })),
)

export const parserFor = (language: string): Parser | undefined =>
  languages.get(language.toLowerCase())?.parser

const tokensOf = (code: string, kinds: ReadonlyArray<string>) => {
  const lines: Array<Array<Token>> = [[]]
  let start = 0
  const flush = (end: number) => {
    if (end > start) lines.at(-1)?.push({ text: code.slice(start, end), kind: kinds[start] ?? "" })
    start = end
  }
  for (let at = 0; at < code.length; at++) {
    if (code[at] === "\n") {
      flush(at)
      start = at + 1
      lines.push([])
    } else if (kinds[at] !== kinds[start]) {
      flush(at)
    }
  }
  flush(code.length)
  return lines
}

export const highlightLines = (
  code: string,
  language: string,
): ReadonlyArray<ReadonlyArray<Token>> => {
  const chosen = languages.get(language.toLowerCase())
  const kinds = Array.from({ length: code.length }, () => "")
  if (chosen !== undefined) {
    const paint: Paint = (from, to, kind) => kinds.fill(kind, from, to)
    const tree = chosen.parser.parse(code)
    highlightTree(tree, highlighter, (from, to, kind) => paint(from, to, kind))
    chosen.refine(tree, code, paint)
  }
  return tokensOf(code, kinds)
}
