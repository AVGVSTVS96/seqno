import { logseq, names } from "@seqno/dom"
import type { CodeStyle, TokenKind } from "@seqno/dom"
import type { Parser, SyntaxNodeRef, Tree } from "@lezer/common"
import { parser as css } from "@lezer/css"
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight"
import type { Tag } from "@lezer/highlight"
import { parser as html } from "@lezer/html"
import { parser as javascript } from "@lezer/javascript"
import { parser as python } from "@lezer/python"

export interface Token {
  readonly text: string
  readonly kind: TokenKind | ""
}

interface Language {
  readonly parser: Parser
  readonly refine: (tree: Tree, code: string, paint: Paint) => void
}

type Paint = (from: number, to: number, kind: TokenKind) => void

const functions = new Set([
  "ArrowFunction",
  "FunctionDeclaration",
  "FunctionExpression",
  "MethodDeclaration",
])

const docTag = /(@\w+)(?:(\s*)(\{[^}\n]*\}))?(?:(\s+)([A-Za-z_$][\w$]*)(?=\s*-|\s*$))?/gmu

const scriptLocals = (tree: Tree, code: string, paint: Paint) => {
  const scopes: Array<{ readonly from: number; readonly to: number; names: Set<string> }> = []
  tree.iterate({
    enter: (node) => {
      if (functions.has(node.name)) {
        scopes.push({ from: node.from, to: node.to, names: new Set() })
      }

      if (node.name === "VariableDefinition") {
        const name = code.slice(node.from, node.to)

        for (const scope of scopes) {
          if (node.from >= scope.from && node.to <= scope.to) {
            scope.names.add(name)
          }
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
      if (node.name === "VariableName" && isLocal(node)) {
        paint(node.from, node.to, "local")
      }

      if (node.name === "TypeArgList" || node.name === "TypeParamList") {
        paint(node.from, node.from + 1, "operator")
        paint(node.to - 1, node.to, "operator")
      }

      if (node.name === "BlockComment" && code.startsWith("/**", node.from)) {
        for (const tag of code.slice(node.from, node.to).matchAll(docTag)) {
          const [, name = "", typeGap = "", type = "", gap = "", variable = ""] = tag
          const typed = node.from + tag.index + name.length + typeGap.length
          const named = typed + type.length + gap.length
          paint(node.from + tag.index, node.from + tag.index + name.length, "doctag")
          paint(typed, typed + type.length, "docType")
          paint(named, named + variable.length, "docVariable")
        }
      }
    },
  })
}

const isPropertyName = (word: string) => typeof CSS !== "undefined" && CSS.supports(word, "inherit")

const cssSelectors = (tree: Tree, code: string, paint: Paint) => {
  tree.iterate({
    enter: (node) => {
      if (node.name === "IdName") {
        paint(node.from, node.to, "id")
      }

      if (node.name === "ClassName") {
        paint(node.from - 1, node.to, "qualifier")
      }

      if (node.name === "AttributeSelector") {
        paint(node.node.getChild("[")?.from ?? node.from, node.to, "selectorAttr")
      }

      if (node.name === "TagName") {
        paint(node.from, node.to, "selector")
      }

      if (node.name === "PropertyName") {
        paint(node.from, node.to, "cssProperty")
      }

      if (node.name === "ValueName" && isPropertyName(code.slice(node.from, node.to))) {
        paint(node.from, node.to, "variable")
      }

      return undefined
    },
  })
}

// https://github.com/codemirror/codemirror5/blob/5.65.13/mode/python/python.js#L25-L37
const pythonBuiltins = new Set([
  "abs",
  "all",
  "any",
  "bin",
  "bool",
  "bytearray",
  "callable",
  "chr",
  "classmethod",
  "compile",
  "complex",
  "delattr",
  "dict",
  "dir",
  "divmod",
  "enumerate",
  "eval",
  "filter",
  "float",
  "format",
  "frozenset",
  "getattr",
  "globals",
  "hasattr",
  "hash",
  "help",
  "hex",
  "id",
  "input",
  "int",
  "isinstance",
  "issubclass",
  "iter",
  "len",
  "list",
  "locals",
  "map",
  "max",
  "memoryview",
  "min",
  "next",
  "object",
  "oct",
  "open",
  "ord",
  "pow",
  "property",
  "range",
  "repr",
  "reversed",
  "round",
  "set",
  "setattr",
  "slice",
  "sorted",
  "staticmethod",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "vars",
  "zip",
  "__import__",
  "NotImplemented",
  "Ellipsis",
  "__debug__",
  "ascii",
  "bytes",
  "exec",
  "print",
])

const pythonNames = (tree: Tree, code: string, paint: Paint) => {
  tree.iterate({
    enter: (node) => {
      const word = code.slice(node.from, node.to)

      if (node.name === "Decorator") {
        paint(node.from, node.to, "meta")

        return false
      }

      if (node.name === "Boolean" || node.name === "None") {
        paint(node.from, node.to, "pyLiteral")
      }

      if (node.name === "FormatString") {
        paint(node.from, node.to, "string")
      }

      if ((node.name === "VariableName" || node.name === "print") && pythonBuiltins.has(word)) {
        paint(node.from, node.to, "builtin")
      }

      if (node.name === "VariableName" && (word === "self" || word === "cls")) {
        paint(node.from, node.to, "local")
      }

      return undefined
    },
  })
}

const htmlEntities = (tree: Tree, _code: string, paint: Paint) => {
  tree.iterate({
    enter: (node) => {
      if (node.name === "EntityReference" || node.name === "CharacterReference") {
        paint(node.from, node.to, "entity")
      }
    },
  })
}

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
  ["html", { parser: html, refine: htmlEntities }],
  ["py", { parser: python, refine: pythonNames }],
  ["python", { parser: python, refine: pythonNames }],
])

const rules: ReadonlyArray<{ readonly tag: Tag | readonly Tag[]; readonly class: TokenKind }> = [
  { tag: [tags.keyword, tags.modifier, tags.self], class: "keyword" },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.function(tags.definition(tags.variableName)),
      tags.definition(tags.className),
    ],
    class: "def",
  },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], class: "property" },
  { tag: tags.attributeName, class: "attribute" },
  { tag: [tags.typeName, tags.namespace], class: "type" },
  { tag: [tags.className, tags.labelName], class: "qualifier" },
  { tag: tags.constant(tags.className), class: "pseudo" },
  { tag: tags.derefOperator, class: "plain" },
  { tag: [tags.operator, tags.function(tags.punctuation)], class: "operator" },
  { tag: tags.angleBracket, class: "tagBracket" },
  { tag: [tags.string, tags.character, tags.attributeValue], class: "string" },
  { tag: tags.special(tags.string), class: "template" },
  { tag: tags.special(tags.brace), class: "interpolation" },
  { tag: tags.regexp, class: "regexp" },
  { tag: [tags.number, tags.unit], class: "number" },
  { tag: tags.color, class: "color" },
  { tag: [tags.atom, tags.bool, tags.null], class: "atom" },
  { tag: tags.variableName, class: "variable" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.tagName, class: "tag" },
  { tag: [tags.meta, tags.documentMeta], class: "meta" },
  { tag: tags.invalid, class: "error" },
]

const kinds: ReadonlyMap<string, TokenKind> = new Map(rules.map((rule) => [rule.class, rule.class]))

const kindOf = (classes: string): TokenKind | "" =>
  classes
    .split(" ")
    .flatMap((name) => {
      const kind = kinds.get(name)

      return kind === undefined ? [] : [kind]
    })
    .at(-1) ?? ""

const highlighter = tagHighlighter(rules)

export const tokenClass = (kind: TokenKind, style: CodeStyle) =>
  names(`seqno-tok-${kind}`, logseq("seqno-tok", kind, style).className)

export const editorHighlighter = tagHighlighter(
  rules.map(({ tag, class: kind }) => ({ tag, class: tokenClass(kind, "codemirror") })),
)

export const parserFor = (language: string): Parser | undefined =>
  languages.get(language.toLowerCase())?.parser

const tokensOf = (code: string, painted: ReadonlyArray<TokenKind | "">) => {
  const lines: Token[][] = [[]]
  let start = 0

  const flush = (end: number) => {
    if (end > start) {
      lines.at(-1)?.push({ text: code.slice(start, end), kind: painted[start] ?? "" })
    }

    start = end
  }

  for (let at = 0; at < code.length; at++) {
    if (code[at] === "\n") {
      flush(at)
      start = at + 1
      lines.push([])
    } else if (painted[at] !== painted[start]) {
      flush(at)
    }
  }

  flush(code.length)

  return lines
}

export const highlightLines = (code: string, language: string): ReadonlyArray<readonly Token[]> => {
  const chosen = languages.get(language.toLowerCase())
  const painted: Array<TokenKind | ""> = Array.from({ length: code.length }, () => "")

  if (chosen !== undefined) {
    const paint: Paint = (from, to, kind) => painted.fill(kind, from, to)
    const tree = chosen.parser.parse(code)
    highlightTree(tree, highlighter, (from, to, classes) => {
      const kind = kindOf(classes)

      if (kind !== "") {
        paint(from, to, kind)
      }
    })
    chosen.refine(tree, code, paint)
  }

  return tokensOf(code, painted)
}
